import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from "react-native-vision-camera";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { useSharedValue, useRunOnJS } from "react-native-worklets-core";
import { useTensorflowModel } from "react-native-fast-tflite";
import * as Speech from "expo-speech";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ConsentModal } from "@/src/components/ConsentModal";
import { TiltGuide } from "@/src/components/TiltGuide";
import { PoseLandmarkOverlay } from "@/src/components/PoseLandmarkOverlay";
import {
  isPoseValid,
  getPoseConfidence,
  extractBodyRatios,
  computeRoiFromAlignmentPoints,
  type Landmark,
} from "@/src/utils/poseDetector";
import {
  computeCenterSquareCrop,
  roiLocalLandmarksToFramePixels,
  pixelRoiToClampedCropRect,
  type CropRect,
} from "@/src/utils/frameCropping";
import {
  runDetector,
  runLandmarks,
  generateBlazePoseAnchors,
} from "@/src/utils/poseInference";
import { computeMeasurements, type Gender } from "@/src/utils/measurementCalculator";
import { BurstCollector } from "@/src/utils/burstAverager";

const DETECTOR_INPUT = 224;
const LANDMARK_INPUT = 256;
// Throttle inference to protect against thermal throttling on mid-range devices;
// the burst collector only needs a handful of good frames.
const MIN_FRAME_INTERVAL_MS = 120;

// CPU (default) delegate. GPU delegates (core-ml on iOS, android-gpu on
// Android) are a device-tuning follow-up: an unsupported delegate fails the
// whole model load, so correctness-first we run on CPU and only opt into GPU
// once validated per-platform on real hardware.
const modelDelegates: never[] = [];

export default function BodyScanScreen() {
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];
  const router = useRouter();
  const params = useLocalSearchParams();

  const height = params.height ? parseFloat(params.height as string) : null;
  const weight = params.weight ? parseFloat(params.weight as string) : null;
  const gender = (params.gender as string as Gender) || "non-binary";

  const [showConsent, setShowConsent] = useState(true);
  const [consentGranted, setConsentGranted] = useState(false);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("front");

  const [isTiltValid, setIsTiltValid] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overlayLandmarks, setOverlayLandmarks] = useState<Landmark[]>([]);
  const [progress, setProgress] = useState(0);

  const lastSpokenRef = useRef<string>("");
  const isTiltValidShared = useSharedValue(false);
  const isCapturingShared = useSharedValue(false);

  // ML models (loaded lazily; require() paths resolved by metro's tflite asset ext)
  const detector = useTensorflowModel(
    require("../../assets/models/pose_detection.tflite"),
    modelDelegates
  );
  const landmarkModel = useTensorflowModel(
    require("../../assets/models/blazepose_lite.tflite"),
    modelDelegates
  );

  const { resize } = useResizePlugin();

  // Anchor set is static; build once on JS thread and share into the worklet.
  const anchors = useMemo(() => generateBlazePoseAnchors(), []);

  // Tracking ROI (frame-pixel crop) carried between frames. null => run detector.
  const trackingRoi = useSharedValue<CropRect | null>(null);
  const lastInferenceTs = useSharedValue(0);

  // Burst collector persists across frames on the JS thread.
  const burstRef = useRef(new BurstCollector());

  useEffect(() => {
    if (!height || !weight) {
      Alert.alert("Missing Info", "Please enter your height and weight first.");
      router.back();
    }
  }, [height, weight, router]);

  useEffect(() => {
    if (consentGranted && hasPermission) {
      Speech.speak("Please stand about 2 meters from your device, and make sure your whole body is visible.");
      lastSpokenRef.current = "intro";
    }
    return () => {
      Speech.stop();
    };
  }, [consentGranted, hasPermission]);

  useEffect(() => {
    isTiltValidShared.value = isTiltValid;
  }, [isTiltValid, isTiltValidShared]);

  const speakIfNew = useCallback((text: string) => {
    if (lastSpokenRef.current === text) return;
    Speech.speak(text);
    lastSpokenRef.current = text;
  }, []);

  const finishScan = useCallback(() => {
    const result = burstRef.current.getResult();
    if (!result) {
      // Not enough valid frames; reset and let the user retry.
      burstRef.current.reset();
      setIsCapturing(false);
      isCapturingShared.value = false;
      setProgress(0);
      speakIfNew("Could not read your measurements clearly. Please reposition and try again.");
      lastSpokenRef.current = "";
      return;
    }

    setIsProcessing(true);
    Speech.stop();
    Speech.speak("Got it! Here are your measurements.");
    router.replace({
      pathname: "/profile/measurements",
      params: { scanned: "true", scanData: JSON.stringify(result), height, weight, gender },
    });
  }, [router, height, weight, gender, isCapturingShared, speakIfNew]);

  // Called from the frame-processor worklet (via useRunOnJS) once per processed frame.
  const onFrameResult = useRunOnJS(
    (landmarks: Landmark[], valid: boolean, confidence: number) => {
      // Only draw the 33 public landmarks in the overlay.
      setOverlayLandmarks(landmarks.slice(0, 33));

      if (!isTiltValidShared.value) {
        // Keep the tilt guidance loop in charge until the phone is upright.
        return;
      }

      if (!valid) {
        if (!isCapturingShared.value) speakIfNew("Make sure your whole body is in frame.");
        return;
      }

      // Pose is valid: enter/continue the capture burst.
      if (!isCapturingShared.value) {
        isCapturingShared.value = true;
        setIsCapturing(true);
        speakIfNew("Hold still, scanning now.");
      }

      if (!height || !weight) return;
      const bodyRatios = extractBodyRatios(landmarks);
      const measurement = computeMeasurements({
        bodyRatios,
        heightCm: height,
        weightKg: weight,
        gender,
      });
      burstRef.current.addSample(measurement);
      setProgress(burstRef.current.capturedCount / burstRef.current.targetCount);

      if (burstRef.current.isComplete()) {
        finishScan();
      }
    },
    [height, weight, gender, isTiltValidShared, isCapturingShared, speakIfNew, finishScan]
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      if (isCapturingShared.value === false && isTiltValidShared.value === false) {
        // Don't burn cycles on inference while the user is still leveling the phone.
        return;
      }

      const now = Date.now();
      if (now - lastInferenceTs.value < MIN_FRAME_INTERVAL_MS) return;
      lastInferenceTs.value = now;

      if (detector.state !== "loaded" || landmarkModel.state !== "loaded") return;

      const frameW = frame.width;
      const frameH = frame.height;

      // Resolve the ROI to feed the landmark model. If we don't have a
      // tracking ROI yet, run the detector on a center-square crop first.
      let roiCrop = trackingRoi.value;
      if (roiCrop == null) {
        const squareCrop = computeCenterSquareCrop(frameW, frameH);
        const detectorInput = resize(frame, {
          crop: squareCrop,
          scale: { width: DETECTOR_INPUT, height: DETECTOR_INPUT },
          pixelFormat: "rgb",
          dataType: "float32",
        });
        const detection = runDetector(detector.model, detectorInput, anchors);
        if (detection == null) {
          return;
        }
        // Detection is normalized within the square crop; map to frame pixels.
        const centerX = squareCrop.x + detection.centerX * squareCrop.width;
        const centerY = squareCrop.y + detection.centerY * squareCrop.height;
        const sizePx = detection.size * squareCrop.width;
        roiCrop = pixelRoiToClampedCropRect(
          { centerX, centerY, size: sizePx },
          frameW,
          frameH
        );
      }

      // Landmark stage on the ROI crop.
      const landmarkInput = resize(frame, {
        crop: roiCrop,
        scale: { width: LANDMARK_INPUT, height: LANDMARK_INPUT },
        pixelFormat: "rgb",
        dataType: "float32",
      });
      const result = runLandmarks(landmarkModel.model, landmarkInput);
      if (result == null || !result.posePresent) {
        // Lost the pose: drop the tracking ROI so the next frame re-detects.
        trackingRoi.value = null;
        return;
      }

      const roiLocalLandmarks = result.landmarks;

      // Map landmarks into frame-pixel space for tracking + overlay math.
      const framePixelLandmarks = roiLocalLandmarksToFramePixels(roiLocalLandmarks, roiCrop);

      // Next-frame ROI from auxiliary alignment points (indices 33/34),
      // computed in frame-pixel space.
      const nextRoi = computeRoiFromAlignmentPoints(framePixelLandmarks as unknown as Landmark[]);
      if (nextRoi != null) {
        trackingRoi.value = pixelRoiToClampedCropRect(
          { centerX: nextRoi.centerX, centerY: nextRoi.centerY, size: nextRoi.size },
          frameW,
          frameH
        );
      } else {
        trackingRoi.value = null;
      }

      // Validity + confidence use ROI-local landmarks (uniform square space,
      // safe for the ratio/visibility checks). extractBodyRatios (on the JS
      // side) likewise runs on ROI-local landmarks.
      const publicLandmarks = roiLocalLandmarks.slice(0, 33);
      const valid = isPoseValid(publicLandmarks);
      const confidence = getPoseConfidence(publicLandmarks);

      // Build frame-normalized landmarks for the overlay (per-axis normalization
      // is fine here -- overlay renders each point independently).
      const overlay: Landmark[] = [];
      for (let i = 0; i < framePixelLandmarks.length; i++) {
        const p = framePixelLandmarks[i];
        overlay.push({ x: p.x / frameW, y: p.y / frameH, z: p.z, visibility: p.visibility });
      }

      onFrameResult(overlay, valid, confidence);
    },
    [detector, landmarkModel, resize, anchors, onFrameResult]
  );

  const handleConsentAccept = async () => {
    setShowConsent(false);
    setConsentGranted(true);
    if (!hasPermission) {
      await requestPermission();
    }
  };

  const handleConsentDecline = () => {
    setShowConsent(false);
    router.back();
  };

  const handleTiltGuideState = (state: "tilt_down" | "tilt_up" | "hold_steady") => {
    if (isCapturing) return;
    if (state === "tilt_down") speakIfNew("Tilt phone down");
    else if (state === "tilt_up") speakIfNew("Tilt phone up");
  };

  if (!consentGranted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ConsentModal visible={showConsent} onAccept={handleConsentAccept} onDecline={handleConsentDecline} />
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={styles.centerCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Camera Access Required</Text>
          <Text style={[styles.cardBody, { color: colors.secondaryText }]}>
            We need camera access to perform the body scan and calculate your measurements.
          </Text>
          <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.tint }]} onPress={requestPermission}>
            <Text style={styles.actionText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (device == null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={styles.centerCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>No Front Camera</Text>
          <Text style={[styles.cardBody, { color: colors.secondaryText }]}>
            This device does not expose a front-facing camera for the body scan.
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.tint }]}
            onPress={() => router.replace({ pathname: "/profile/measurements", params: { height, weight, gender } })}
          >
            <Text style={styles.actionText}>Enter Manually</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const modelsLoading = detector.state === "loading" || landmarkModel.state === "loading";
  const modelsError = detector.state === "error" || landmarkModel.state === "error";

  if (modelsError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={styles.centerCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Scan Unavailable</Text>
          <Text style={[styles.cardBody, { color: colors.secondaryText }]}>
            The on-device measurement models could not be loaded on this device. You can enter your measurements manually instead.
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.tint }]}
            onPress={() => router.replace({ pathname: "/profile/measurements", params: { height, weight, gender } })}
          >
            <Text style={styles.actionText}>Enter Manually</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  let outlineColor = "rgba(255,255,255,0.4)";
  if (isProcessing || isCapturing) outlineColor = "#00FF00";
  else if (!isTiltValid) outlineColor = "#FF3B30";
  else outlineColor = "#FFCC00";

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!isProcessing}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />
      <PoseLandmarkOverlay landmarks={overlayLandmarks} />
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { Speech.stop(); router.back(); }} style={styles.iconBtn}>
            <IconSymbol name="chevron.left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Position Your Body</Text>
          <TouchableOpacity
            onPress={() => { Speech.stop(); router.replace({ pathname: "/profile/measurements", params: { height, weight, gender } }); }}
            style={styles.iconBtnText}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {!isCapturing && <TiltGuide onTiltValid={setIsTiltValid} onGuideState={handleTiltGuideState} />}

        {/* Silhouette guide */}
        <View style={styles.silhouetteContainer} pointerEvents="none">
          <View style={[styles.headOutline, { borderColor: outlineColor }]} />
          <View style={[styles.shouldersOutline, { borderColor: outlineColor }]} />
          <View style={[styles.torsoOutline, { borderColor: outlineColor }]} />
        </View>

        <View style={styles.controls}>
          {isProcessing ? (
            <View style={styles.processingBadge}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.processingText}>Processing Scan...</Text>
            </View>
          ) : modelsLoading ? (
            <View style={styles.processingBadge}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.processingText}>Loading models...</Text>
            </View>
          ) : isCapturing ? (
            <View style={styles.countdownBadge}>
              <Text style={styles.countdownText}>Scanning {Math.round(progress * 100)}%</Text>
            </View>
          ) : !isTiltValid ? (
            <Text style={styles.warningText}>Please follow voice instructions</Text>
          ) : (
            <Text style={styles.warningText}>Stand back so your whole body is visible</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  safeArea: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 20,
  },
  iconBtn: {
    width: 40, height: 40,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20,
  },
  iconBtnText: {
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 16,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  skipText: { color: "#fff", fontWeight: "600" },
  centerCard: {
    flex: 1, justifyContent: "center", alignItems: "center",
    paddingHorizontal: 24,
  },
  cardTitle: { fontSize: 22, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  cardBody: { fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 24 },
  actionButton: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 999 },
  actionText: { color: "#0D0D0D", fontSize: 14, fontWeight: "700" },
  silhouetteContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 5,
  },
  headOutline: {
    width: 80, height: 100,
    borderWidth: 2, borderRadius: 50,
    borderStyle: "dashed", marginBottom: 10,
  },
  shouldersOutline: {
    width: 220, height: 60,
    borderWidth: 2, borderRadius: 30,
    borderStyle: "dashed", borderBottomWidth: 0,
  },
  torsoOutline: {
    width: 180, height: 250,
    borderWidth: 2, borderRadius: 20,
    borderStyle: "dashed", borderTopWidth: 0,
  },
  controls: {
    alignItems: "center",
    paddingBottom: 60,
    zIndex: 20,
  },
  warningText: {
    color: "#FFCC00",
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 16,
    fontSize: 16,
    textAlign: "center",
  },
  countdownBadge: {
    backgroundColor: "rgba(0,255,0,0.8)",
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 24,
  },
  countdownText: { color: "#000", fontSize: 20, fontWeight: "700" },
  processingBadge: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.8)",
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, gap: 12,
  },
  processingText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
