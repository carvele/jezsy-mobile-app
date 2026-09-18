import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePoseDetection,
  RunningMode,
  Delegate,
  NATIVE_VISION_AVAILABLE,
  type PoseDetectionResultBundle,
} from "@/src/utils/nativeVision";
import * as Speech from "expo-speech";
import * as Linking from "expo-linking";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ConsentModal } from "@/src/components/ConsentModal";
import { HardwarePermissionState } from "@/src/components/HardwarePermissionState";
import { TiltGuide } from "@/src/components/TiltGuide";
import { PoseLandmarkOverlay } from "@/src/components/PoseLandmarkOverlay";
import { BodyAlignmentGuide } from "@/src/components/BodyAlignmentGuide";
import { CaptureTransitionOverlay } from "@/src/components/CaptureTransitionOverlay";
import { useBodyAlignment } from "@/src/hooks/useBodyAlignment";
import { evaluatePoseOrientation, ALIGNMENT_CONFIG, type RequestedPose, type AlignmentViolation } from "@/src/utils/bodyAlignmentEvaluator";
import { FirstUseHintModal } from "@/src/components/FirstUseHintModal";
import { useAuth } from "@/src/context/AuthContext";
import { hasSeenHint, markHintSeen } from "@/src/utils/firstUseHints";
import { ScanPrep } from "@/src/components/ScanPrep";
import { PoseLandmarkFilter } from "@/src/utils/oneEuroFilter";
import {
  getPoseOrientation,
  getPoseConfidence,
  extractBodyRatios,
  type Landmark,
  type WorldLandmark,
} from "@/src/utils/poseDetector";
import {
  estimateCircumferenceFromCrossSection,
  type Gender,
} from "@/src/utils/measurementCalculator";
import { extractBodyExtents, type BodyExtents, type MaskLike } from "@/src/utils/bodyMask";
import { applyNativePoseCompatibility } from "@/src/utils/nativePoseCompatibility";
import { BurstCollector } from "@/src/utils/burstAverager";
import { useToast } from '@/src/context/ToastContext';
import { createScanSession } from '@/src/utils/scanSession';
import { notifySuccess } from '@/src/utils/haptics';

// CPU (default) delegate. GPU delegate is a device-tuning follow-up: an
// unsupported delegate fails the whole model load, so correctness-first we
// run on CPU and only opt into GPU once validated per-platform on real
// hardware (same rationale as the original tflite pipeline this replaced).
const POSE_DELEGATE = Delegate.CPU;
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL;

// TEMPORARY: side view disabled while the side-profile orientation/framing
// checks are still being verified on-device. Skips turn_to_side/side_positioning/
// side_capturing entirely and finishes on the front pass alone, reusing the
// existing single_view_fallback path finishScan() already has for when side
// capture doesn't complete. Flip back to true once side view is re-verified.
const SIDE_VIEW_ENABLED = false;

// Multi-view scan flow phases:
// front_positioning -> front_capturing -> turn_to_side -> side_positioning -> side_capturing -> processing -> complete
export type BodyScanPhase =
  | "front_positioning"
  | "front_capturing"
  | "turn_to_side"
  | "side_positioning"
  | "side_capturing"
  | "processing"
  | "complete";

export default function BodyScanScreen() {
  const { showToast } = useToast();
  const theme = useColorScheme() ?? "dark";
  const { session } = useAuth();
  const colors = Colors[theme];
  const router = useRouter();
  const params = useLocalSearchParams();

  const height = params.height ? parseFloat(params.height as string) : null;
  const weight = params.weight ? parseFloat(params.weight as string) : null;
  const gender = (params.gender as string as Gender) || "non-binary";

  const [showConsent, setShowConsent] = useState(true);
  const [consentGranted, setConsentGranted] = useState(false);
  // Preparation runs between consent and the camera. Everything that decides
  // whether the scan is any good -- clothing, lighting, phone height, phone
  // angle -- was previously one spoken sentence over a live camera.
  const [prepDone, setPrepDone] = useState(false);
  const { hasPermission, requestPermission } = useCameraPermission();
  const [hasRequestedPermission, setHasRequestedPermission] = useState(false);
  const device = useCameraDevice("front");

  const openPrivacyPolicy = useCallback(async () => {
    if (!PRIVACY_URL) {
      showToast('Privacy Policy link is not configured yet.', 'info');
      return;
    }
    try {
      await Linking.openURL(PRIVACY_URL);
    } catch {
      showToast('Could not open the Privacy Policy.', 'error');
    }
  }, [showToast]);

  const [isTiltValid, setIsTiltValid] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [overlayLandmarks, setOverlayLandmarks] = useState<Landmark[]>([]);
  const [progress, setProgress] = useState(0);
  const [modelError, setModelError] = useState(false);
  const [cameraRuntimeError, setCameraRuntimeError] = useState<string | null>(null);
  const [showScanHint, setShowScanHint] = useState(false);

  useEffect(() => {
    hasSeenHint(session?.user?.id, 'body_scan:v1').then((seen) => {
      if (!seen) setShowScanHint(true);
    });
  }, [session?.user?.id]);

  const handleAcknowledgeScanHint = () => {
    setShowScanHint(false);
    markHintSeen(session?.user?.id, 'body_scan:v1');
  };

  const lastSpokenRef = useRef<string>("");
  // Mirrors isTiltValid/isCapturing into refs so the onResults callback
  // (fired per-frame, outside React's render cycle) always reads the latest
  // value without needing to be recreated every render.
  const isTiltValidRef = useRef(false);
  const isCapturingRef = useRef(false);

  // Temporal smoothing for world metrics
  const nativeFilterRef = useRef<import('@/src/utils/oneEuroFilter').PoseLandmarkFilter | null>(null);
  if (!nativeFilterRef.current) {
    nativeFilterRef.current = new PoseLandmarkFilter(1.2, 0.015, 1.0);
  }

  // Burst collector persists across frames.
  const burstRef = useRef(new BurstCollector());

  const [phase, setPhase] = useState<BodyScanPhase>("front_positioning");
  const phaseRef = useRef<BodyScanPhase>("front_positioning");
  // Extents are collected per frame and reduced at the end, so one frame that
  // clipped a hand or a belt cannot skew the result.
  const frontExtentsRef = useRef<BodyExtents[]>([]);
  const sideExtentsRef = useRef<BodyExtents[]>([]);
  const SIDE_TARGET_SAMPLES = 5;
  const SIDE_CAPTURE_TIMEOUT_MS = 4000;
  const SIDE_MAX_ATTEMPTS = 60;
  const sideAttemptCountRef = useRef(0);
  const sidePhaseStartRef = useRef<number | null>(null);
  const sideOrientationConfirmedStartRef = useRef<number | null>(null);
  const ambiguousStartRef = useRef<number | null>(null);
  // Minimum time the big front/side-complete transition card stays up before a
  // phase can advance, independent of how fast geometry/orientation resolves.
  const turnPhaseStartRef = useRef<number | null>(null);
  const lastNudgeTimeRef = useRef<number>(0);
  const [turnOrientationLabel, setTurnOrientationLabel] = useState<string>("front");
  // Shows the big "FRONT COMPLETE / TURN SIDEWAYS" card for the first
  // completionTransitionMinMs of turn_to_side, then hands off to live "keep
  // turning" guidance for however long the rest of the turn takes.
  const [showFrontComplete, setShowFrontComplete] = useState(false);
  const turnOrientationLabelRef = useRef<string>("front");
  const instructionDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const setPhaseBoth = useCallback((next: BodyScanPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /**
   * Single place that clears every piece of per-attempt state.
   */
  const resetScanSession = useCallback(() => {
    burstRef.current.reset();
    frontExtentsRef.current = [];
    sideExtentsRef.current = [];
    sideAttemptCountRef.current = 0;
    sidePhaseStartRef.current = null;
    sideOrientationConfirmedStartRef.current = null;
    ambiguousStartRef.current = null;
    turnOrientationLabelRef.current = "front";
    setTurnOrientationLabel("front");
    if (instructionDebounceTimerRef.current) {
      clearTimeout(instructionDebounceTimerRef.current);
      instructionDebounceTimerRef.current = null;
    }
    nativeFilterRef.current?.reset();
    isCapturingRef.current = false;
    setIsCapturing(false);
    setProgress(0);
    setPhaseBoth("front_positioning");
    lastSpokenRef.current = "";
  }, [setPhaseBoth]);

  useEffect(() => {
    if (!height) {
      showToast("Please enter your height first.", 'info');
      router.back();
    }
  }, [height, router, showToast]);

  useEffect(() => {
    isTiltValidRef.current = isTiltValid;
  }, [isTiltValid]);

  const speakIfNew = useCallback((text: string, forceImmediate = false) => {
    // Strip UI adornments (checkmarks, dashes) so TTS receives natural imperative speech
    const speechText = text.replace(/^[✓✔]\s*/, '').replace(/—/g, '. ').trim();
    if (!speechText) return;
    if (!forceImmediate && lastSpokenRef.current === speechText) return;
    Speech.stop();
    Speech.speak(speechText);
    lastSpokenRef.current = speechText;
  }, []);

  const medianExtents = (samples: BodyExtents[]): BodyExtents | null => {
    if (!samples.length) return null;
    const pick = (key: keyof BodyExtents) => {
      const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    return { bust: pick("bust"), waist: pick("waist"), hips: pick("hips") };
  };

  const finishScan = useCallback(() => {
    if (!height) return;
    const result = burstRef.current.getResult(height, gender);
    if (!result) {
      // Not enough valid frames; reset everything and let the user retry.
      resetScanSession();
      speakIfNew("Could not read your measurements clearly. Please reposition and try again.", true);
      lastSpokenRef.current = "";
      return;
    }

    const reachedSideTarget = sideExtentsRef.current.length >= SIDE_TARGET_SAMPLES;
    const width = reachedSideTarget ? medianExtents(frontExtentsRef.current) : null;
    const depth = reachedSideTarget ? medianExtents(sideExtentsRef.current) : null;
    let final = result;

    if (width && depth) {
      const bust = estimateCircumferenceFromCrossSection({ widthRatio: width.bust, depthRatio: depth.bust }, height);
      const waist = estimateCircumferenceFromCrossSection({ widthRatio: width.waist, depthRatio: depth.waist }, height);
      const hips = estimateCircumferenceFromCrossSection({ widthRatio: width.hips, depthRatio: depth.hips }, height);
      const { shoulderWidth, armLength, torsoLength, legLength, inseam } = result;
      const confidences = [shoulderWidth, armLength, torsoLength, legLength, inseam, bust, waist, hips].map((m) => m.confidence);
      final = {
        ...result,
        bust,
        waist,
        hips,
        overallConfidence: confidences.reduce((sum, c) => sum + c, 0) / confidences.length,
      };
    }

    setIsProcessing(true);
    Speech.stop();
    Speech.speak("Got it! Here are your measurements.");
    const scanId = createScanSession({
      measurements: final,
      height,
      weight,
      gender,
    });
    router.replace({
      pathname: "/profile/measurements",
      params: { scanId },
    });
  }, [router, height, weight, gender, speakIfNew, resetScanSession]);

  const beginTurn = useCallback(() => {
    isCapturingRef.current = false;
    setIsCapturing(false);
    setProgress(0);
    setPhaseBoth("turn_to_side");
    turnPhaseStartRef.current = Date.now();
    setShowFrontComplete(true);
    setTimeout(() => setShowFrontComplete(false), ALIGNMENT_CONFIG.completionTransitionMinMs);
    sideOrientationConfirmedStartRef.current = null;
    ambiguousStartRef.current = null;
    turnOrientationLabelRef.current = "front";
    setTurnOrientationLabel("front");
    lastNudgeTimeRef.current = Date.now();
    lastSpokenRef.current = "";
    speakIfNew("Great. Now turn sideways. Keep your feet in place and look straight ahead.", true);
  }, [setPhaseBoth, speakIfNew]);

  const alignmentContext = useMemo(() => ({
    isMirrored: device?.position === "front",
    sensorRotation: 0 as const,
  }), [device?.position]);

  const requestedPose: RequestedPose =
    phase === "side_positioning" || phase === "side_capturing" ? "side" : "front";

  const handleLock = useCallback(() => {
    notifySuccess();
    speakIfNew("Perfect. Hold still.", true);
  }, [speakIfNew]);

  const handleCaptureReady = useCallback(() => {
    if (phaseRef.current === "front_positioning" && !isCapturingRef.current) {
      setPhaseBoth("front_capturing");
      isCapturingRef.current = true;
      setIsCapturing(true);
    } else if (phaseRef.current === "side_positioning" && !isCapturingRef.current) {
      setPhaseBoth("side_capturing");
      isCapturingRef.current = true;
      setIsCapturing(true);
      sideAttemptCountRef.current = 0;
      sidePhaseStartRef.current = Date.now();
    }
  }, [setPhaseBoth]);

  const { result: alignmentState, processFrame: processAlignmentFrame } = useBodyAlignment({
    onLock: handleLock,
    onCaptureReady: handleCaptureReady,
    context: alignmentContext,
    requestedPose
  });

  // The silhouette is a brief positioning aid, not a permanent overlay: shown for
  // guideInitialVisibleMs on entering a positioning phase, then faded -- reappearing
  // only if the wearer becomes badly misaligned, per the reference flow.
  const RESTORE_GUIDE_VIOLATIONS: AlignmentViolation[] = ['BODY_CLIPPED', 'OFF_CENTER_LEFT', 'OFF_CENTER_RIGHT', 'FEET_PLACEMENT'];
  const [guideVisible, setGuideVisible] = useState(true);
  const guideHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const guidePhaseRef = useRef<BodyScanPhase | null>(null);

  const scheduleGuideHide = useCallback(() => {
    if (guideHideTimerRef.current) clearTimeout(guideHideTimerRef.current);
    guideHideTimerRef.current = setTimeout(() => {
      setGuideVisible(false);
      guideHideTimerRef.current = null;
    }, ALIGNMENT_CONFIG.guideInitialVisibleMs);
  }, []);

  useEffect(() => {
    if (phase === "front_positioning" || phase === "side_positioning") {
      if (guidePhaseRef.current !== phase) {
        guidePhaseRef.current = phase;
        setGuideVisible(true);
        scheduleGuideHide();
      }
    } else {
      guidePhaseRef.current = null;
      if (guideHideTimerRef.current) {
        clearTimeout(guideHideTimerRef.current);
        guideHideTimerRef.current = null;
      }
    }
  }, [phase, scheduleGuideHide]);

  const hasRestoreViolation = alignmentState.violations.some((v) => RESTORE_GUIDE_VIOLATIONS.includes(v));
  useEffect(() => {
    if (phase !== "front_positioning" && phase !== "side_positioning") return;
    if (hasRestoreViolation) {
      if (guideHideTimerRef.current) {
        clearTimeout(guideHideTimerRef.current);
        guideHideTimerRef.current = null;
      }
      setGuideVisible(true);
    } else if (guideVisible && !guideHideTimerRef.current) {
      // A restore violation just cleared while the guide is showing -- fade again.
      scheduleGuideHide();
    }
  }, [hasRestoreViolation, phase, guideVisible, scheduleGuideHide]);

  useEffect(() => {
    if (
      (phase !== "front_positioning" && phase !== "side_positioning") ||
      isCapturing ||
      !alignmentState.instruction ||
      !prepDone
    ) {
      if (instructionDebounceTimerRef.current) {
        clearTimeout(instructionDebounceTimerRef.current);
        instructionDebounceTimerRef.current = null;
      }
      return;
    }

    // Suppress positioning speech during STABILIZING or LOCKED
    // (STABILIZING is silent stillness; LOCKED speaks immediately via onLock)
    if (alignmentState.state === "STABILIZING" || alignmentState.state === "LOCKED") {
      if (instructionDebounceTimerRef.current) {
        clearTimeout(instructionDebounceTimerRef.current);
        instructionDebounceTimerRef.current = null;
      }
      return;
    }

    const targetInstruction = alignmentState.instruction;
    if (instructionDebounceTimerRef.current) {
      clearTimeout(instructionDebounceTimerRef.current);
    }

    instructionDebounceTimerRef.current = setTimeout(() => {
      speakIfNew(targetInstruction);
      instructionDebounceTimerRef.current = null;
    }, ALIGNMENT_CONFIG.voiceInstructionPersistenceMs);

    return () => {
      if (instructionDebounceTimerRef.current) {
        clearTimeout(instructionDebounceTimerRef.current);
        instructionDebounceTimerRef.current = null;
      }
    };
  }, [alignmentState.instruction, alignmentState.state, phase, isCapturing, prepDone, speakIfNew]);

  const lastOverlayUpdateRef = useRef(0);

  const handleResults = useCallback(
    (result: PoseDetectionResultBundle) => {
      const pose = result.results[0]?.landmarks?.[0];
      const worldPose = result.results[0]?.worldLandmarks?.[0];

      if (!pose || pose.length < 33) {
        setOverlayLandmarks([]);
        nativeFilterRef.current?.reset();
        return;
      }

      const rawLandmarks: Landmark[] = pose.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? p.presence ?? 0,
      }));

      const rawWorldLandmarks: WorldLandmark[] | undefined = worldPose?.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z ?? 0,
        visibility: p.visibility ?? p.presence ?? 0,
      }));

      const compat = applyNativePoseCompatibility(rawLandmarks, rawWorldLandmarks);
      const compatLandmarks = (compat.normalizedLandmarks ?? rawLandmarks) as Landmark[];
      const compatWorldLandmarks = (compat.worldLandmarks ?? rawWorldLandmarks) as WorldLandmark[] | undefined;

      const landmarks = nativeFilterRef.current?.filterLandmarks(compatLandmarks) ?? compatLandmarks;
      const worldLandmarks = compatWorldLandmarks 
        ? (nativeFilterRef.current?.filterWorldLandmarks(compatWorldLandmarks) ?? compatWorldLandmarks) 
        : undefined;

      const now = Date.now();
      if (now - lastOverlayUpdateRef.current > 80) {
        lastOverlayUpdateRef.current = now;
        setOverlayLandmarks(landmarks.slice(0, 33));
      }

      if (!isTiltValidRef.current) {
        processAlignmentFrame(landmarks, false);
        return;
      }

      const mask = result.results[0]?.segmentationMasks?.[0] as MaskLike | undefined;

      // 1. Front Positioning
      if (phaseRef.current === "front_positioning") {
        processAlignmentFrame(landmarks, true);
        return;
      }

      // 2. Front Capturing
      if (phaseRef.current === "front_capturing") {
        if (!height) return;
        const bodyRatios = extractBodyRatios(landmarks);
        burstRef.current.addSample({
          bodyRatios,
          worldLandmarks,
          orientation: getPoseOrientation(landmarks),
          poseConfidence: getPoseConfidence(landmarks),
        });
        if (mask) {
          const extents = extractBodyExtents(landmarks, mask);
          if (extents) frontExtentsRef.current.push(extents);
        }
        setProgress(burstRef.current.capturedCount / burstRef.current.targetCount);

        if (burstRef.current.isComplete()) {
          if (SIDE_VIEW_ENABLED) {
            beginTurn();
          } else {
            setPhaseBoth("processing");
            setIsProcessing(true);
            speakIfNew("Front view complete. Processing your measurements.", true);
            setTimeout(() => {
              finishScan();
            }, 1500);
          }
        }
        return;
      }

      // 3. Turn to Side (Orientation Hysteresis)
      if (phaseRef.current === "turn_to_side") {
        const orientation = evaluatePoseOrientation(landmarks);
        const now = Date.now();

        // Update UI badge orientation state
        if (turnOrientationLabelRef.current !== orientation.label) {
          turnOrientationLabelRef.current = orientation.label;
          setTurnOrientationLabel(orientation.label);
        }

        // Voice reminder after 5s if user hasn't turned
        if (now - lastNudgeTimeRef.current >= 5000 && orientation.label !== 'side') {
          speakIfNew("Turn your body sideways.", true);
          lastNudgeTimeRef.current = now;
        }

        // If user is partially turned (ambiguous), prompt "Keep turning sideways." after ambiguousTurnDwellMs (700ms)
        if (orientation.label === 'ambiguous') {
          if (!ambiguousStartRef.current) {
            ambiguousStartRef.current = now;
          } else if (now - ambiguousStartRef.current >= ALIGNMENT_CONFIG.ambiguousTurnDwellMs) {
            speakIfNew("Keep turning sideways.");
          }
        } else {
          ambiguousStartRef.current = null;
        }

        // Must maintain verified side orientation (confidence >= threshold) continuously for sideOrientationDwellMs (400ms)
        if (orientation.label === 'side' && orientation.confidence >= ALIGNMENT_CONFIG.sideOrientationThreshold) {
          if (!sideOrientationConfirmedStartRef.current) {
            sideOrientationConfirmedStartRef.current = now;
          } else if (
            now - sideOrientationConfirmedStartRef.current >= ALIGNMENT_CONFIG.sideOrientationDwellMs &&
            now - (turnPhaseStartRef.current ?? 0) >= ALIGNMENT_CONFIG.completionTransitionMinMs
          ) {
            setPhaseBoth("side_positioning");
            sideOrientationConfirmedStartRef.current = null;
          }
        } else {
          sideOrientationConfirmedStartRef.current = null;
        }
        return;
      }

      // 4. Side Positioning
      if (phaseRef.current === "side_positioning") {
        processAlignmentFrame(landmarks, true);
        return;
      }

      // 5. Side Capturing
      if (phaseRef.current === "side_capturing") {
        if (mask) {
          const extents = extractBodyExtents(landmarks, mask);
          if (extents) sideExtentsRef.current.push(extents);
        } else {
          sideAttemptCountRef.current += 1;
        }

        const currentCount = mask ? sideExtentsRef.current.length : sideAttemptCountRef.current;
        setProgress(Math.min(1, currentCount / SIDE_TARGET_SAMPLES));

        const reachedTarget = currentCount >= SIDE_TARGET_SAMPLES;
        const elapsedMs = sidePhaseStartRef.current ? Date.now() - sidePhaseStartRef.current : 0;
        const timedOut = elapsedMs >= SIDE_CAPTURE_TIMEOUT_MS;
        const ceilingHit = sideAttemptCountRef.current >= SIDE_MAX_ATTEMPTS;

        if (reachedTarget || timedOut || ceilingHit) {
          setPhaseBoth("processing");
          setIsProcessing(true);
          speakIfNew("Side view complete. Processing your measurements.", true);
          setTimeout(() => {
            finishScan();
          }, 1500);
        }
        return;
      }
    },
    [height, speakIfNew, finishScan, beginTurn, setPhaseBoth, processAlignmentFrame]
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
      // Joints sit on the body's centreline, so landmarks alone cannot say how
      // thick a torso is -- which is why depth used to be inferred from BMI.
      // The mask is a per-pixel person map, so one row of it gives the real
      // horizontal extent: width from the front pass, depth from the side.
      shouldOutputSegmentationMasks: false, // Disabled to eliminate HostFunction exception
    }
  );

  const onOutputOrientationChanged = poseDetection.cameraOrientationChangedHandler;
  const cameraDeviceChangeHandler = poseDetection.cameraDeviceChangeHandler;

  // cameraDeviceChangeHandler is a fresh function reference from the native-vision
  // hook on every render, so depending on it directly re-fires this effect every
  // render; if the handler itself triggers any state update, that recreates the
  // handler and loops forever ("Maximum update depth exceeded", confirmed live on
  // device). A ref for the handler plus device?.id (a stable primitive) as the only
  // dependency fires this only when the physical device actually changes.
  const cameraDeviceChangeHandlerRef = useRef(cameraDeviceChangeHandler);
  cameraDeviceChangeHandlerRef.current = cameraDeviceChangeHandler;

  useEffect(() => {
    if (device && cameraDeviceChangeHandlerRef.current) {
      cameraDeviceChangeHandlerRef.current(device);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);

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

  // Removed handleTiltGuideState as it is handled by unified alignment state machine

  if (!consentGranted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ConsentModal
          visible={showConsent}
          onAccept={handleConsentAccept}
          onDecline={handleConsentDecline}
          onPrivacyPress={openPrivacyPolicy}
        />
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }}>
          <HardwarePermissionState
            status={
              !NATIVE_VISION_AVAILABLE
                ? 'hardware_unavailable'
                : hasRequestedPermission
                ? 'permanently_denied'
                : 'denied_can_ask_again'
            }
            featureName="Body Scan"
            onRequestPermission={async () => {
              setHasRequestedPermission(true);
              await requestPermission();
            }}
            onOpenSettings={() => {
              Linking.openSettings().catch((err) => console.warn('Could not open settings', err));
            }}
          />
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, marginTop: Spacing.lg }]}
            onPress={() => router.replace({ pathname: "/profile/measurements", params: { height, weight, gender } })}
            accessibilityRole="button"
            accessibilityLabel="Enter measurements manually"
          >
            <Text style={[styles.actionText, { color: colors.text }]}>Enter Manually</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // After permission so the wizard is not shown to someone who then declines
  // the camera, and before the device check so a phone with no front camera
  // still falls through to the manual-entry escape below.
  if (!prepDone) {
    return <ScanPrep onDone={() => setPrepDone(true)} onCancel={() => router.back()} />;
  }

  if (device == null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }}>
          <HardwarePermissionState
            status="hardware_unavailable"
            featureName="Body Scan"
          />
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.tint, marginTop: Spacing.xl }]}
            onPress={() => router.replace({ pathname: "/profile/measurements", params: { height, weight, gender } })}
            accessibilityRole="button"
            accessibilityLabel="Enter measurements manually"
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

  if (cameraRuntimeError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl }}>
          <HardwarePermissionState
            status="runtime_error"
            featureName="Body Scan"
            errorMessage={cameraRuntimeError}
            onRetry={() => {
              setCameraRuntimeError(null);
              resetScanSession();
            }}
          />
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, marginTop: Spacing.lg }]}
            onPress={() => router.replace({ pathname: "/profile/measurements", params: { height, weight, gender } })}
            accessibilityRole="button"
            accessibilityLabel="Enter measurements manually"
          >
            <Text style={[styles.actionText, { color: colors.text }]}>Enter Manually</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!isProcessing}
        pixelFormat="rgb"
        frameProcessor={poseDetection.frameProcessor}
        onLayout={poseDetection.cameraViewLayoutChangeHandler}
        onOutputOrientationChanged={onOutputOrientationChanged}
        onError={(e: any) => {
          console.warn('Camera Error:', e);
          setCameraRuntimeError(e?.message || 'Camera failed during scan. Please try again.');
        }}
      />
      <PoseLandmarkOverlay landmarks={overlayLandmarks} />

      {(phase === "front_positioning" || phase === "side_positioning") && (
        <BodyAlignmentGuide
          requestedPose={requestedPose}
          state={alignmentState.state}
          footStatus={alignmentState.footStatus}
          visible={guideVisible}
        />
      )}

      {phase === "turn_to_side" && (
        showFrontComplete
          ? <CaptureTransitionOverlay mode="front_complete" />
          : <CaptureTransitionOverlay mode="turning_side" keepTurning={turnOrientationLabel === "ambiguous"} />
      )}

      {phase === "processing" && (
        <CaptureTransitionOverlay mode={SIDE_VIEW_ENABLED ? "side_complete" : "processing"} />
      )}

      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { Speech.stop(); router.back(); }}>
            <BlurView intensity={40} tint="dark" style={styles.iconBtn}>
              <IconSymbol name="chevron.left" size={24} color="#fff" />
            </BlurView>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {phase === "front_positioning" || phase === "front_capturing"
              ? (SIDE_VIEW_ENABLED ? "Front View (1/2)" : "Body Scan")
              : phase === "turn_to_side"
              ? "Turn Sideways"
              : phase === "side_positioning" || phase === "side_capturing"
              ? "Side View (2/2)"
              : "Body Scan"}
          </Text>
          <TouchableOpacity
            onPress={() => { Speech.stop(); router.replace({ pathname: "/profile/measurements", params: { height, weight, gender } }); }}
          >
            <BlurView intensity={40} tint="dark" style={styles.iconBtnText}>
              <Text style={styles.skipText}>Skip</Text>
            </BlurView>
          </TouchableOpacity>
        </View>

        {!isCapturing && <TiltGuide onTiltValid={setIsTiltValid} renderBadge={false} />}

        {/* turn_to_side and processing get the big CaptureTransitionOverlay instead --
            a small bottom pill here would be redundant with (and easy to miss next to)
            that center-screen checkpoint. */}
        {phase !== "turn_to_side" && phase !== "processing" && (
          <View style={styles.controls}>
            {isCapturing ? (
              <View style={styles.countdownBadge}>
                <Text style={styles.countdownText}>
                  {phase === "side_capturing" ? "Side View" : "Front View"} {Math.round(progress * 100)}%
                </Text>
              </View>
            ) : (
              <BlurView intensity={40} tint="dark" style={styles.warningWrap}>
                <Text style={styles.warningText}>
                  {alignmentState.instruction || (requestedPose === "front" ? "Face the camera" : "Turn sideways")}
                </Text>
              </BlurView>
            )}
          </View>
        )}
      </SafeAreaView>
      <FirstUseHintModal
        visible={showScanHint}
        icon="figure.stand"
        title="Body Scan Guidance"
        message="Create an accurate digital profile by performing a quick body scan. Your measurements are calculated securely on your device to recommend your perfect size."
        onAcknowledge={handleAcknowledgeScanHint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  safeArea: { ...StyleSheet.absoluteFill, justifyContent: "space-between" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    zIndex: 20,
  },
  // Real backdrop blur (expo-blur BlurView), not a flat rgba(13,13,13,0.5)
  // fill: this is nav chrome floating over the live camera feed, the same
  // case as the AR Try-On overlay panels -- translucency over genuinely
  // varying content, not flat app chrome (Apple HIG Materials guidance).
  // overflow hidden clips the blur to the rounded shape. countdownBadge below
  // is left opaque on purpose -- it's a semantic status signal during a timed
  // pose-hold, where ambiguous legibility is a real usability risk, not just
  // decoration. Phase completion/processing states use CaptureTransitionOverlay's
  // own opaque backdrop instead of a bottom pill.
  iconBtn: {
    width: 40, height: 40,
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 20,
  },
  iconBtnText: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
    borderRadius: Radius.lg,
  },
  // Wraps each warningText Text node (BlurView can't blur text directly --
  // it needs its own container to blur behind).
  warningWrap: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: Radius.lg,
  },
  headerTitle: { ...Type.subtitle, color: "#fff" },
  skipText: { color: "#fff", fontWeight: "600" },
  centerCard: {
    flex: 1, justifyContent: "center", alignItems: "center",
    paddingHorizontal: Spacing.xxl,
  },
  cardTitle: { fontSize: 22, fontWeight: "700", marginBottom: Spacing.md, textAlign: "center" },
  cardBody: { fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: Spacing.xxl },
  actionButton: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: Radius.pill },
  actionText: { fontSize: 14, fontWeight: "700" },
  controls: {
    alignItems: "center",
    paddingBottom: 60,
    zIndex: 20,
  },
  warningText: {
    color: "#FFCC00",
    fontWeight: "600",
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    fontSize: 16,
    textAlign: "center",
  },
  countdownBadge: {
    backgroundColor: "rgba(0,255,0,0.8)",
    paddingHorizontal: Spacing.xxl, paddingVertical: Spacing.md,
    borderRadius: Radius.xl,
  },
  countdownText: { color: "#000", ...Type.title },
});
