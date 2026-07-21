import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from "react-native-vision-camera";
import {
  usePoseDetection,
  RunningMode,
  Delegate,
  type PoseDetectionResultBundle,
} from "react-native-mediapipe-posedetection";
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
  type Landmark,
} from "@/src/utils/poseDetector";
import { computeMeasurements, type Gender } from "@/src/utils/measurementCalculator";
import { BurstCollector } from "@/src/utils/burstAverager";

// CPU (default) delegate. GPU delegate is a device-tuning follow-up: an
// unsupported delegate fails the whole model load, so correctness-first we
// run on CPU and only opt into GPU once validated per-platform on real
// hardware (same rationale as the original tflite pipeline this replaced).
const POSE_DELEGATE = Delegate.CPU;

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
  const [modelError, setModelError] = useState(false);

  const lastSpokenRef = useRef<string>("");
  // Mirrors isTiltValid/isCapturing into refs so the onResults callback
  // (fired per-frame, outside React's render cycle) always reads the latest
  // value without needing to be recreated every render.
  const isTiltValidRef = useRef(false);
  const isCapturingRef = useRef(false);

  // Burst collector persists across frames.
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
    isTiltValidRef.current = isTiltValid;
  }, [isTiltValid]);

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
      isCapturingRef.current = false;
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
  }, [router, height, weight, gender, speakIfNew]);

  const handleResults = useCallback(
    (result: PoseDetectionResultBundle) => {
      const pose = result.results[0]?.landmarks?.[0];
      if (!pose || pose.length < 33) {
        setOverlayLandmarks([]);
        return;
      }

      // Normalize the library's optional visibility/presence into our
      // required-visibility Landmark shape; fall back to presence, then 0.
      const landmarks: Landmark[] = pose.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? p.presence ?? 0,
      }));

      setOverlayLandmarks(landmarks.slice(0, 33));

      if (!isTiltValidRef.current) {
        // Keep the tilt guidance loop in charge until the phone is upright.
        return;
      }

      const valid = isPoseValid(landmarks);
      if (!valid) {
        if (!isCapturingRef.current) speakIfNew("Make sure your whole body is in frame.");
        return;
      }

      // Pose is valid: enter/continue the capture burst.
      if (!isCapturingRef.current) {
        isCapturingRef.current = true;
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
    [height, weight, gender, speakIfNew, finishScan]
  );

  const poseDetection = usePoseDetection(
    {
      onResults: handleResults,
      onError: (error) => {
        console.error("Pose detection error:", error?.message);
        setModelError(true);
      },
    },
    RunningMode.LIVE_STREAM,
    "pose_landmarker_lite.task",
    {
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      delegate: POSE_DELEGATE,
    }
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

  if (modelError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={styles.centerCard}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Scan Unavailable</Text>
          <Text style={[styles.cardBody, { color: colors.secondaryText }]}>
            The on-device measurement model could not be loaded on this device. You can enter your measurements manually instead.
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
        frameProcessor={poseDetection.frameProcessor}
        onLayout={poseDetection.cameraViewLayoutChangeHandler}
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
