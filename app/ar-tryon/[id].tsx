import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking, Platform, useWindowDimensions, AppState } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Camera, useCameraDevice, useCameraFormat, useCameraPermission, usePoseDetection, RunningMode, Delegate } from '@/src/utils/nativeVision';
import * as Speech from 'expo-speech';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useSizingProfile } from '@/src/hooks/useSizingProfile';
import { useSafeBack } from '@/src/hooks/useSafeBack';
import { recommendSize, analyzeFit } from '@/src/utils/sizeRecommender';
import { computeLiveLengthFit } from '@/src/utils/liveLengthFit';
import { useARTrackingSession } from '@/src/hooks/useARTrackingSession';
import { AR_TRACKING_GUIDANCE } from '@/src/utils/arTrackingSession';
import { FilamentExperimentRenderer } from '@/src/components/AR/FilamentExperimentRenderer';
import { filamentReplayFrame, FILAMENT_REPLAY_INTERVAL_MS } from '@/src/utils/filamentReplay';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirstUseHintModal } from '@/src/components/FirstUseHintModal';
import { useAuth } from '@/src/context/AuthContext';
import { hasSeenHint, markHintSeen } from '@/src/utils/firstUseHints';
import { ConsentModal } from '@/src/components/ConsentModal';
import { useToast } from '@/src/context/ToastContext';
import { constructBodyPose } from '@/src/utils/poseConstructor';
import { calculateGarmentFit } from '@/src/utils/garmentFitter';
import { calculateBoneRotationsFromCanonical } from '@/src/utils/skeletalRetargeter';
import { normalizePose, torsoEulerDegrees } from '@/src/utils/poseNormalizer';
import { adaptGarmentMetadata } from '@/src/utils/garmentMetadataAdapter';
import type { GarmentFitProfile } from '@/src/types/garment';
import {
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { WebPoseTracker } from '@/src/utils/webPoseDetection';
import { PoseLandmarkFilter } from '@/src/utils/oneEuroFilter';
import type { PoseFrame } from '@/src/types/pose';
import { GarmentRenderer, type GarmentRendererRef } from '@/src/components/AR/GarmentRenderer';
type Product = Database['public']['Tables']['products']['Row'];

interface WebCameraFeedProps {
  active: boolean;
  onPoseResults?: (poseFrame: PoseFrame) => void;
  onTrackingLost?: () => void;
}

function WebCameraFeed({ active, onPoseResults, onTrackingLost }: WebCameraFeedProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const occlusionCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const trackerRef = React.useRef<WebPoseTracker | null>(null);
  const animFrameRef = React.useRef<number | null>(null);
  const onPoseResultsRef = React.useRef(onPoseResults);
  const onTrackingLostRef = React.useRef(onTrackingLost);

  React.useEffect(() => {
    onPoseResultsRef.current = onPoseResults;
    onTrackingLostRef.current = onTrackingLost;
  });

  React.useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let isMounted = true;
    const tracker = new WebPoseTracker();
    trackerRef.current = tracker;

    async function initWebcamAndTracking() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (!isMounted) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }

        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current && isMounted) {
              const vw = videoRef.current.videoWidth || 640;
              const vh = videoRef.current.videoHeight || 480;
              if (occlusionCanvasRef.current) {
                occlusionCanvasRef.current.width = vw;
                occlusionCanvasRef.current.height = vh;
              }
              videoRef.current.play().catch((e) => console.warn('Video play error:', e));
            }
          };
        }

        // Initialize MediaPipe WASM pose detector
        const ready = await tracker.init();
        if (!isMounted) {
          tracker.close();
          return;
        }
        if (!ready) return;

        // Continuous pose detection loop with ~20 FPS inference budget
        let isProcessing = false;
        let lastInferenceTime = 0;

        const filter = new PoseLandmarkFilter(1.2, 0.015, 1.0);

        function detectLoop() {
          if (!isMounted) return;
          const now = performance.now();

          if (
            now - lastInferenceTime >= 48 &&
            videoRef.current &&
            videoRef.current.readyState >= 2 &&
            !isProcessing
          ) {
            isProcessing = true;
            lastInferenceTime = now;
            try {
              const detectResult = tracker.detect(videoRef.current, now);
              const canvas = occlusionCanvasRef.current;

              if (detectResult) {
                const rawLandmarks = detectResult.landmarks;
                const worldLandmarks = detectResult.worldLandmarks;
                const landmarks = filter.filterLandmarks(rawLandmarks, now);
                if (onPoseResultsRef.current) {
                  onPoseResultsRef.current({
                    normalizedLandmarks: landmarks,
                    worldLandmarks: worldLandmarks as any,
                    segmentation: detectResult.segmentation,
                    timestamp: now
                  });
                }
              } else {
                filter.reset();
                onTrackingLostRef.current?.();
                // Tracking lost: clear occlusion canvas immediately to prevent stale cutouts
                if (canvas) {
                  const ctx = canvas.getContext('2d');
                  ctx?.clearRect(0, 0, canvas.width, canvas.height);
                }
              }
            } catch (err) {
              onTrackingLostRef.current?.();
              console.warn('Frame processing error:', err);
            } finally {
              isProcessing = false;
            }
          }
          animFrameRef.current = requestAnimationFrame(detectLoop);
        }

        animFrameRef.current = requestAnimationFrame(detectLoop);
      } catch (err) {
        console.warn('Webcam or Tracker init failed:', err);
      }
    }

    initWebcamAndTracking();

    return () => {
      isMounted = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      tracker.close();
    };
  }, [active]);

  return (
    <>
      {/* Layer 1: Live Camera Video Feed */}
      {/* @ts-ignore */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)', // Mirror front selfie camera
          zIndex: 1,
        }}
      />
      {/* Layer 3: Foreground Arm/Hand Occlusion Canvas */}
      {/* @ts-ignore */}
      <canvas
        ref={occlusionCanvasRef}
        width={640}
        height={480}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
          pointerEvents: 'none',
          zIndex: 20,
        }}
      />
    </>
  );
}

// Device-specific compensation for a native/MediaPipe orientation bug. Raw
// landmarks arrive from the native pose-detection callback already rotated
// ~90deg -- the two shoulder landmarks show near-zero separation on X and the
// full shoulder-width separation on Y (see
// docs/ar-tryon-audit-implementation-plan.md #23/#24). Applying a proper 90deg
// rotation (x,y) -> (y,-x) for metric world landmarks -- derived algebraically
// from ~30 captured live samples, verified against every one -- confirmed the
// fix on all three fronts simultaneously: roll dropped from a pinned ~-90deg
// to ~0-9deg, camera distance triangulation started actually varying with real
// distance instead of being stuck at its 0.6m bootstrap seed, and the garment
// rendered upright and centered on the wearer's shoulders instead of
// edge-on/off-screen. For normalized [0,1] image-space landmarks the same
// rotation is applied about the image center (0.5, 0.5): (x,y) -> (y, 1-x).
//
// Only wired into the NATIVE pose-detection path (onNativePoseResults below) --
// the web path (WebCameraFeed/handlePoseResults) is untouched and unaffected.
// 2026-09-02: tried removing this in favor of the forceCameraOrientation fix
// below (BaseViewCoordinator.constructor logs sensorOrientation="landscape-right"
// correctly and consistently), but live re-test showed the bug still occurs
// intermittently (roll swinging to -90/-106deg, landmarks stacked vertically,
// cameraDistanceM stuck at the 0.6m bootstrap value) even with the coordinator
// reporting the right config -- so whatever BaseViewCoordinator does with that
// config doesn't fully/reliably prevent the rotated landmarks. Keeping this
// compensation as the actual fix; forceCameraOrientation is left in place since
// it's still correct to set, just not sufficient on its own. Gated behind a
// plausibility check so a device that DOESN'T have this bug (dx already larger
// than dy) is left untouched -- see shouldCorrectNativeLandmarkRotation.
function shouldCorrectNativeLandmarkRotation(landmarks: any[]): boolean {
  const l11 = landmarks[11];
  const l12 = landmarks[12];
  if (!l11 || !l12) return false;
  const dx = Math.abs(l12.x - l11.x);
  const dy = Math.abs(l12.y - l11.y);
  // Only correct when the vertical separation clearly dominates -- a real
  // frontal shoulder line should be wider than it is tall. Requiring dy to be
  // meaningfully larger (not just marginally) avoids flipping a frame that's
  // just noisy or a person genuinely turned near-profile.
  return dy > 0.15 && dy > dx * 2;
}

function correctWorldLandmarkRotation(p: any) {
  return { ...p, x: p.y, y: -p.x };
}

function correctNormalized2DLandmarkRotation(p: any) {
  return { ...p, x: p.y, y: 1 - p.x };
}

function buildFallbackMetadata(p: Product | null | undefined): import('@/src/types/garment').GarmentMetadata {
  const cat = (p?.category || 'shirt').toLowerCase();
  return {
    id: p?.id || 'mock',
    category: cat as any,
    calibrationVersion: '1.0.0',
    ingestionStatus: 'DEMO_RIG',
    anatomicalAnchorOffset: { x: 0, y: 0.5, z: 0 },
    anchorConfidence: 'inferred',
    anchorType: 'SHOULDER_CENTER',
    restPoseMetricWidth: cat === 'dress' ? 0.38 : (cat === 'jacket' ? 0.42 : 0.35),
    boneMap: {
      'Spine': 'mixamorigSpine',
      'Spine1': 'mixamorigSpine1',
      'Spine2': 'mixamorigSpine2',
      'LeftShoulder': 'mixamorigLeftShoulder',
      'LeftArm': 'mixamorigLeftArm',
      'LeftForeArm': 'mixamorigLeftForeArm',
      'RightShoulder': 'mixamorigRightShoulder',
      'RightArm': 'mixamorigRightArm',
      'RightForeArm': 'mixamorigRightForeArm'
    },
    restPose: 'A_POSE'
  };
}

export default function ARTryOnScreen() {
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasConsented, setHasConsented] = useState<boolean | null>(null);
  const [stageLayout, setStageLayout] = useState<{ width: number; height: number }>({ width: 390, height: 600 });
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const experimentEnabled = __DEV__ && Platform.OS !== 'web' && process.env.EXPO_PUBLIC_AR_FILAMENT_EXPERIMENT === '1';
  const [experimentRenderer, setExperimentRenderer] = useState<'three' | 'filament'>('three');
  const [replay, setReplay] = useState(false);
  const replayActive = experimentEnabled && replay;
  const LiveRenderer = experimentEnabled && experimentRenderer === 'filament' ? FilamentExperimentRenderer : GarmentRenderer;
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  // Phase 3: an explicit format so fieldOfView/videoWidth/videoHeight below are
  // guaranteed to describe what's actually active, not vision-camera's own
  // (unknown to us) default pick. 1280x720 balances pose-detection frame rate
  // against resolution; unrelated to the calibration math, which works at any
  // resolution as long as format and the values read from it agree.
  const format = useCameraFormat(device, [{ videoResolution: { width: 1280, height: 720 } }]);

  const [arLoadError, setArLoadError] = useState<string | null>(null);
  // Fix for #29 in the AR audit plan: <Camera>'s onError used to only console.warn,
  // leaving a permanently black feed with the "AI Body Tracking Active" pill still
  // shown (stale/false) whenever a camera-level error fired -- confirmed live on this
  // device via a real system/camera-is-restricted error after a background/foreground
  // cycle. cameraRetryKey remounts <Camera> on retry (clearing state alone doesn't
  // force vision-camera to re-attempt); a full app restart was confirmed to recover
  // the same error, so the underlying condition is transient, not a persistent lock.
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraRetryKey, setCameraRetryKey] = useState(0);

  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setIsAppActive(state === 'active'));
    return () => sub.remove();
  }, []);

  // Reanimated SharedValues for 60FPS UI-thread smooth garment positioning
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotateDeg = useSharedValue(0);
  const opacity = useSharedValue(0.9);
  const torsoLogCounter = React.useRef(0);
  const compGuardLogCounter = React.useRef(0);
  // Phase 1 instrumentation (ar-tryon-implementation-roadmap.md): the roadmap's own
  // occlusion-scoping decision (Tier 2 base64-mask-in-the-loop, only if measurements
  // justify it) and the contract's "native transport is prototype-grade and unmeasured"
  // gap both depend on knowing the real per-second call rate into updateTransform, not
  // an assumed detector frame rate. This ref-pair counts calls in a rolling 1s window and
  // logs the rate once per window; see the matching WebView-side counter in
  // GarmentRenderer.tsx for what actually reaches the renderer, since a call here does
  // not guarantee the WebView processed it before the next one arrived.
  const transportRateCountRef = React.useRef(0);
  const transportRateWindowStartRef = React.useRef(0);
  const garmentRendererRef = React.useRef<GarmentRendererRef>(null);

  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const stageWidth = stageLayout.width || Math.min(winWidth || 390, 480);
  const stageHeight = stageLayout.height || Math.min(winHeight || 844, 900);

  const { metadata: garmentMetadata, isDemoRig } = useMemo(
    () => adaptGarmentMetadata(product?.garment_metadata, () => buildFallbackMetadata(product)),
    [product]
  );

  // Biometric consent check on mount
  useEffect(() => {
    AsyncStorage.getItem('@jezsy_camera_biometric_consent').then((val) => {
      setHasConsented(val === 'granted');
    });
  }, []);

  // Global Speech cleanup on unmount
  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  // Moved above handlePoseResults (Section 00 Phase 2's stale-closure lesson applies
  // here too): handlePoseResults's dependency array needs these identifiers declared
  // before it, not just referenced inside its body.
  const { measurements: sizingMeasurements, fitPreference, ready: sizingReady } = useSizingProfile();
  const recommendedSize = useMemo(
    () => (sizingReady && sizingMeasurements && product?.measurements
      ? recommendSize(sizingMeasurements, product.measurements as any, fitPreference, product?.category)
      : null),
    [sizingReady, sizingMeasurements, fitPreference, product?.measurements, product?.category]
  );
  const cameraActive = mode === '2d' && isFocused && isAppActive && hasConsented === true
    && !loading && product?.id === id && (Platform.OS === 'web' || (hasPermission && !!device));
  const trackingEnabled = cameraActive && !cameraError && !arLoadError;
  const trackingSessionKey = JSON.stringify([id, product?.id, product?.model_3d_url, recommendedSize,
    product?.measurements, cameraRetryKey, device?.id, stageWidth, stageHeight, experimentRenderer, replayActive]);
  const { status: trackingStatus, lengthFit, report: reportTracking, isActive: isTrackingSessionActive } = useARTrackingSession(trackingEnabled, trackingSessionKey);
  const isTrackerActive = trackingStatus === 'tracking' || trackingStatus === 'turned';
  const handleTrackingLost = useCallback(() => { reportTracking('TRACKING_LOST'); }, [reportTracking]);
  const fitZones = useMemo(
    () => {
      if (!recommendedSize || !product?.measurements || !sizingMeasurements) return [];
      const garmentData = {
        ...(product.measurements as any)[recommendedSize],
        stretch: (product.garment_metadata as any)?.fabric_stretch
      };
      return analyzeFit(sizingMeasurements, garmentData);
    },
    [recommendedSize, sizingMeasurements, product?.measurements, product?.garment_metadata]
  );

  // Phase B2: real-measurement fit modifier for the AR overlay's scale (see
  // src/components/AR/GarmentRenderer.tsx). Ratio of the selected/recommended
  // size's real chart width to the wearer's own saved shoulder width -- multiplies
  // the live silhouette-matched base scale so different sizes actually look
  // different on the same tracked body. Clamped to a modest range so missing or
  // noisy measurement data can't send the garment wildly off scale; defaults to 1
  // (today's silhouette-match-only behavior) whenever either side is unavailable.
  const fitModifier = useMemo(() => {
    const wearerCm = sizingMeasurements?.shoulderWidth;
    const garmentCm = recommendedSize && product?.measurements
      ? (product.measurements as any)[recommendedSize]?.shoulderWidth
      : null;
    if (!wearerCm || !garmentCm || wearerCm <= 0) return 1;
    return Math.min(1.4, Math.max(0.7, garmentCm / wearerCm));
  }, [sizingMeasurements, recommendedSize, product?.measurements]);

  // Phase 3: real camera calibration (native only -- see GarmentRenderer.tsx and
  // the AR Implementation Plan). vision-camera's format.fieldOfView is the
  // *diagonal* FOV in both its Android (sensor-diagonal-derived) and iOS
  // (AVCaptureDevice.videoFieldOfView, Apple-documented as diagonal)
  // implementations, confirmed by reading both native source files rather than
  // assumed -- horizontal/vertical FOV are NOT the same value and using the
  // wrong one would silently miscalibrate every downstream measurement.
  // focalLengthPx is derived once from the diagonal relationship and serves
  // both the render camera's vertical FOV and the real-distance triangulation
  // GarmentRenderer performs every frame; without a real wearer measurement to
  // triangulate against, calibration data is withheld entirely and
  // GarmentRenderer falls back to its existing uncalibrated behavior.
  const cameraCalibration = useMemo(() => {
    if (Platform.OS === 'web' || !format || !format.fieldOfView) return undefined;
    const wearerShoulderWidthM = sizingMeasurements?.shoulderWidth
      ? sizingMeasurements.shoulderWidth / 100
      : undefined;
    if (!wearerShoulderWidthM || wearerShoulderWidthM <= 0) return undefined;

    const { videoWidth, videoHeight, fieldOfView } = format;
    if (!videoWidth || !videoHeight) return undefined;

    // format.videoWidth/videoHeight describe the raw SENSOR buffer (e.g. 1280x720,
    // landscape), but forceOutputOrientation: device.sensorOrientation (see
    // usePoseDetection below) tells MediaPipe to rotate that buffer to upright before
    // running pose detection -- confirmed live via the sensor-orientation fix earlier
    // this session. On a landscape-mounted sensor (the common case), that rotation is
    // 90deg, so the landmarks GarmentRenderer receives are normalized against the
    // ROTATED (e.g. 720x1280, portrait) frame, not the raw sensor dimensions. Using
    // the unswapped sensor dimensions here would transpose the pixel-space triangulation
    // (dx measured against the wrong axis's pixel count) and also compute verticalFovDeg
    // from the wrong "height". Only a 90/270deg mount needs the swap; portrait and
    // upside-down sensors already match the rotated frame's own dimensions.
    const isRotated90 = device?.sensorOrientation === 'landscape-left' || device?.sensorOrientation === 'landscape-right';
    const rotatedWidth = isRotated90 ? videoHeight : videoWidth;
    const rotatedHeight = isRotated90 ? videoWidth : videoHeight;

    const diagonalPx = Math.sqrt(videoWidth * videoWidth + videoHeight * videoHeight);
    const diagonalFovRad = (fieldOfView * Math.PI) / 180;
    const focalLengthPx = (diagonalPx / 2) / Math.tan(diagonalFovRad / 2);
    const verticalFovRad = 2 * Math.atan(rotatedHeight / (2 * focalLengthPx));
    const verticalFovDeg = (verticalFovRad * 180) / Math.PI;

    if (!Number.isFinite(focalLengthPx) || !Number.isFinite(verticalFovDeg) || verticalFovDeg <= 0) return undefined;

    return {
      focalLengthPx,
      verticalFovDeg,
      videoWidthPx: rotatedWidth,
      videoHeightPx: rotatedHeight,
      wearerShoulderWidthM,
    };
  }, [format, sizingMeasurements, device]);

  const handlePoseResults = useCallback(
    (poseFrame: PoseFrame) => {
      if (!isTrackingSessionActive()) return;
      const { normalizedLandmarks: landmarks, worldLandmarks, segmentation } = poseFrame;
      if (!landmarks || landmarks.length < 33) {
        handleTrackingLost();
        return;
      }

      // 1. Construct canonical BodyPose
      const transformCtx = {
        videoWidth: stageWidth,
        videoHeight: stageHeight,
        stageWidth,
        stageHeight,
        isMirrored: true,
        objectFit: 'cover' as const
      };
      
      const pose = constructBodyPose(landmarks, landmarks, (worldLandmarks || []) as any, transformCtx);

      // 2. Generate GarmentFitState driven by garment profile
      const cat = (product?.category || 'shirt').toLowerCase();
      const garmentProfile: GarmentFitProfile = {
        category: cat as any,
        anchors: {},
        dimensions: {
          shoulderWidth: cat === 'dress' ? 0.38 : (cat === 'jacket' ? 0.42 : 0.35),
          chestWidth: cat === 'dress' ? 0.42 : 0.40,
          length: cat === 'dress' ? 1.2 : (cat === 'jacket' ? 0.9 : 0.75)
        }
      };

      // Normalize once per frame: the fitter (garment orientation) and the retargeter
      // (bone deltas) must agree on the same torso frame, or they fight each other --
      // see poseNormalizer for the full write-up.
      const canonical = normalizePose(pose.worldLandmarks);

      // Phase B2: pass the wearer's saved measurements and the selected/recommended
      // size's real chart entry so the legacy 2D overlay's scale stays consistent with
      // the 3D WebGL overlay's own fitModifier -- undefined on either side degrades to
      // today's pure silhouette-match behavior, never worse than before.
      const fitState = calculateGarmentFit(
        pose, garmentProfile, stageWidth, stageHeight, garmentMetadata, canonical,
        sizingMeasurements ?? undefined,
        recommendedSize && product?.measurements ? (product.measurements as any)[recommendedSize] : undefined
      );
      
      const isTracking = pose.trackingState === 'GOOD_FIT' || pose.trackingState === 'TURN_TOO_FAR';
      const chartLength = recommendedSize && product?.measurements
        ? (product.measurements as any)[recommendedSize]?.length : undefined;
      if (!reportTracking(pose.trackingState, pose.trackingState === 'GOOD_FIT'
        ? computeLiveLengthFit(poseFrame, chartLength, product?.category) : null)) return;
      if (isTracking) {

        // Phase 2: Direct filter binding. We bypass withSpring because One Euro already smoothes the coordinate frame!
        translateX.value = fitState.anchor.x;
        translateY.value = fitState.anchor.y;
        scale.value = fitState.scale.x;
        
        const rollDeg = 2 * Math.acos(fitState.rotation.w) * (180 / Math.PI);
        rotateDeg.value = fitState.rotation.z >= 0 ? rollDeg : -rollDeg;
        
        const targetOpacity = pose.trackingState === 'TURN_TOO_FAR' ? 0.3 : 1.0;
        opacity.value = withTiming(targetOpacity, { duration: 120 }); // Opacity still gets a timing transition for UX

        // Phase 4A/4B: Push 3D transform and skinning data directly to the WebGL prototype
        if (garmentRendererRef.current && garmentMetadata) {
          const boneRotations = calculateBoneRotationsFromCanonical(canonical, garmentMetadata.restPose, pose.orientation.rollRad);

          // TEMP DEBUG: throttled torso readout for the live torso-bend test. pitch goes
          // negative when bending forward, roll tracks a sideways lean, yaw a twist; all
          // three should read ~0 standing upright and square to the camera.
          torsoLogCounter.current += 1;
          if (torsoLogCounter.current % 20 === 0) {
            const e = torsoEulerDegrees(canonical.torso);
            console.log('[AR-DEBUG-TORSO] valid=' + canonical.torso.valid
              + ' pitch=' + e.pitch.toFixed(1)
              + ' yaw=' + e.yaw.toFixed(1)
              + ' roll=' + e.roll.toFixed(1));
          }

          // Phase 1 instrumentation: real per-second call rate into the transport, not an
          // assumed one. Rolling 1s window rather than a frame-count modulus, since the
          // detector's own frame rate isn't constant (drops under load, on backgrounding
          // resume, etc.) -- a modulus would silently stretch or compress the logging
          // interval along with it.
          const rateNow = performance.now();
          if (transportRateWindowStartRef.current === 0) {
            transportRateWindowStartRef.current = rateNow;
          }
          transportRateCountRef.current += 1;
          const rateElapsedMs = rateNow - transportRateWindowStartRef.current;
          if (rateElapsedMs >= 1000) {
            const ratePerSec = (transportRateCountRef.current / rateElapsedMs) * 1000;
            console.log('[AR-TRANSPORT-RATE] updateTransform calls/sec=' + ratePerSec.toFixed(1));
            transportRateCountRef.current = 0;
            transportRateWindowStartRef.current = rateNow;
          }

          garmentRendererRef.current.updateTransform(
            { x: fitState.anchor.x, y: fitState.anchor.y, z: fitState.anchor.z },
            fitState.orientation3D,
            fitState.scale.x,
            boneRotations,
            segmentation,
            landmarks,
            worldLandmarks
          );
        }
      }
    },
    [stageWidth, stageHeight, translateX, translateY, scale, rotateDeg, opacity, garmentMetadata, product, sizingMeasurements, recommendedSize, isTrackingSessionActive, handleTrackingLost, reportTracking]
  );
  
  const nativeFilterRef = React.useRef<PoseLandmarkFilter | null>(null);
  useEffect(() => {
    if (!replayActive || !trackingEnabled) return;
    let frame = 0;
    const timer = setInterval(() => handlePoseResults(filamentReplayFrame(frame++)), FILAMENT_REPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [replayActive, trackingEnabled, handlePoseResults]);
  if (!nativeFilterRef.current) {
    nativeFilterRef.current = new PoseLandmarkFilter(1.2, 0.015, 1.0);
  }
  useEffect(() => { nativeFilterRef.current?.reset(); }, [reportTracking]);

  // onResults/onError used to be inline literals recreated every render; the library
  // chains them through several layers of useMemo/useCallback that all transitively
  // depend on that fresh identity, so poseDetection (and therefore the
  // [device, poseDetection] effect dependency below) never stabilized. Memoized at
  // the root instead of patching each downstream symptom separately.
  const onNativePoseResults = useCallback(
    (result: any) => {
      if (replayActive) return;
      if (!isTrackingSessionActive()) return;
      let landmarks = result.results?.[0]?.landmarks?.[0];
      let worldLandmarks = result.results?.[0]?.worldLandmarks?.[0];

      if (!Array.isArray(landmarks) || landmarks.length < 33
        || !landmarks.every((point: any) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
          && (point.z === undefined || Number.isFinite(point.z)))) {
        nativeFilterRef.current?.reset();
        handleTrackingLost();
        return;
      }
      if (!Array.isArray(worldLandmarks) || worldLandmarks.length < 33
        || !worldLandmarks.every((point: any) => point && Number.isFinite(point.x)
          && Number.isFinite(point.y) && Number.isFinite(point.z))) {
        worldLandmarks = [];
      }

      const compGuardTriggered = !!(landmarks && landmarks.length > 0 && shouldCorrectNativeLandmarkRotation(landmarks));
      if (compGuardTriggered) {
        landmarks = landmarks.map(correctNormalized2DLandmarkRotation);
        if (worldLandmarks) worldLandmarks = worldLandmarks.map(correctWorldLandmarkRotation);
      }
      compGuardLogCounter.current += 1;
      if (compGuardLogCounter.current % 15 === 0) {
        const rawL11 = result.results?.[0]?.landmarks?.[0]?.[11];
        const rawL12 = result.results?.[0]?.landmarks?.[0]?.[12];
        const wl11 = worldLandmarks?.[11];
        const wl12 = worldLandmarks?.[12];
        console.log('[COMP-GUARD] triggered=' + compGuardTriggered
          + ' rawDx=' + (rawL11 && rawL12 ? Math.abs(rawL12.x - rawL11.x).toFixed(3) : 'n/a')
          + ' rawDy=' + (rawL11 && rawL12 ? Math.abs(rawL12.y - rawL11.y).toFixed(3) : 'n/a')
          + ' postL11=(' + landmarks?.[11]?.x?.toFixed(3) + ',' + landmarks?.[11]?.y?.toFixed(3) + ')'
          + ' postL12=(' + landmarks?.[12]?.x?.toFixed(3) + ',' + landmarks?.[12]?.y?.toFixed(3) + ')'
          + ' worldL11=(' + wl11?.x?.toFixed(3) + ',' + wl11?.y?.toFixed(3) + ',' + wl11?.z?.toFixed(3) + ')'
          + ' worldL12=(' + wl12?.x?.toFixed(3) + ',' + wl12?.y?.toFixed(3) + ',' + wl12?.z?.toFixed(3) + ')');
      }

      // Evaluate pose
      const normalizedLandmarks = landmarks.map((p: any) => ({
        x: p.x,
        y: p.y,
        z: p.z || 0,
        visibility: p.visibility ?? p.presence ?? 0,
      }));
      const smoothedLandmarks = nativeFilterRef.current?.filterLandmarks(normalizedLandmarks as any) ?? normalizedLandmarks;

      const smoothedWorldLandmarks = worldLandmarks && worldLandmarks.length > 0
        ? nativeFilterRef.current?.filterWorldLandmarks(worldLandmarks as any)
        : worldLandmarks;

      const rawMask = result.results?.[0]?.segmentationMasks?.[0];
      let segmentation: import('@/src/types/pose').SegmentationFrame | undefined = undefined;
      const timestamp = Date.now();
      
      if (rawMask) {
        segmentation = {
          width: 0, // Should be populated from native frame dimensions if available
          height: 0,
          timestamp,
          source: 'native-buffer',
          data: rawMask
        };
      }

      handlePoseResults({
        normalizedLandmarks: smoothedLandmarks as any,
        worldLandmarks: smoothedWorldLandmarks as any,
        segmentation,
        timestamp
      });
    },
    [handlePoseResults, handleTrackingLost, isTrackingSessionActive, replayActive]
  );

  const onNativePoseError = useCallback((e: any) => {
    handleTrackingLost();
    console.error(e);
  }, [handleTrackingLost]);

  const poseDetectionCallbacks = useMemo(
    () => ({ onResults: onNativePoseResults, onError: onNativePoseError }),
    [onNativePoseResults, onNativePoseError]
  );

  // Pose Detection Hook (Native)
  const poseDetection = usePoseDetection(poseDetectionCallbacks, RunningMode.LIVE_STREAM, 'pose_landmarker_lite.task', {
    numPoses: 1,
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
    delegate: Delegate.GPU,
    shouldOutputSegmentationMasks: true,
    // Root-caused live via the library's own Kotlin source
    // (PoseDetectionFrameProcessorPlugin.kt): the frame processor worklet tracks the
    // camera's real per-frame orientation internally but never forwards it to native --
    // only forceOutputOrientation/outputOrientation (default 'portrait') reaches
    // detector.detectLiveStream(mpImage, orientation), which is the rotation MediaPipe
    // applies to the raw buffer before detection. This device's front camera reports
    // sensorOrientation='landscape-right', so with the unset default ('portrait' = no
    // rotation) MediaPipe never rotates the frame and landmarks come back in the raw
    // sensor frame -- confirmed live via AR-DEBUG-TORSO logging roll=-83.9deg while
    // standing upright, and shoulder landmarks 11/12 swapping which axis carries their
    // real separation. forceOutputOrientation and device.sensorOrientation share the
    // same Orientation type, so the device's real value can be passed straight through.
    forceOutputOrientation: device?.sensorOrientation,
    // BaseViewCoordinator's own "sensorOrientation" (used for its point-rotation
    // math) is built from forceCameraOrientation.value ?? frameOrientation.value --
    // NOT forceOutputOrientation above, which only reaches the separate
    // outputOrientation constructor argument. Still correct to set this so the
    // coordinator's declared config matches the device's real sensor mount.
    // 2026-09-02: with this set, BaseViewCoordinator.constructor logs
    // sensorOrientation="landscape-right" correctly and consistently, but a live
    // re-test with the JS-side compensation removed still hit the ~90deg-rotated
    // landmark bug intermittently (roll swinging to -90/-106deg). Whatever
    // BaseViewCoordinator does downstream with this config doesn't reliably
    // prevent the rotated landmarks, so shouldCorrectNativeLandmarkRotation's
    // runtime compensation (above) remains the actual fix -- this option is left
    // set because it's still correct, not because it's sufficient on its own.
    // See docs/ar-tryon-audit-implementation-plan.md #24.
    forceCameraOrientation: device?.sensorOrientation,
  });

  // react-native-mediapipe-posedetection's own <MediapipeCamera> wrapper wires
  // cameraDeviceChangeHandler and onOutputOrientationChanged=cameraOrientationChangedHandler
  // automatically (see its mediapipeCamera.tsx); this app renders vision-camera's
  // <Camera> directly instead (needed for other native-only behavior below) and had
  // wired only frameProcessor/onLayout, silently skipping both. Root-caused live: with
  // no orientation handler, the library never learns the true output rotation, so
  // landmarks come back in the sensor's native frame -- confirmed via AR-DEBUG-TORSO
  // logging roll=-83.9deg while the wearer stood upright and squared to the camera,
  // a ~90deg rotation error consistent with an uncorrected landscape-sensor frame.
  useEffect(() => {
    if (device) poseDetection.cameraDeviceChangeHandler(device);
  }, [device, poseDetection]);

  const fetchProduct = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
      if (error) throw error;
      setProduct(data);
    } catch (err) {
      console.error('Error fetching product for AR:', err);
      showToast('Could not load product details.', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  const [showHintModal, setShowHintModal] = useState(false);

  useEffect(() => {
    hasSeenHint(session?.user?.id, 'ar_try_on:v1').then((seen) => {
      if (!seen) setShowHintModal(true);
    });
  }, [session?.user?.id]);

  const handleAcknowledgeHint = () => {
    setShowHintModal(false);
    markHintSeen(session?.user?.id, 'ar_try_on:v1');
  };

  const [showFit, setShowFit] = useState(true);

  const theme = useColorScheme();
  const colors = Colors[theme];

  const goBack = useSafeBack('/');
  const handleBack = goBack;

  if (hasConsented === false) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ConsentModal
          visible={true}
          onAccept={async () => {
            await AsyncStorage.setItem('@jezsy_camera_biometric_consent', 'granted');
            setHasConsented(true);
          }}
          onDecline={handleBack}
          onPrivacyPress={() => {
            const privacyUrl = process.env.EXPO_PUBLIC_PRIVACY_URL;
            if (privacyUrl) Linking.openURL(privacyUrl).catch(() => {});
          }}
        />
      </View>
    );
  }

  if (loading || hasConsented === null) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={{ color: colors.text, marginTop: Spacing.lg }}>Loading 3D Model...</Text>
      </View>
    );
  }

  if (mode === '2d' && Platform.OS !== 'web' && !hasPermission) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>We need your permission to show the camera</Text>
        <TouchableOpacity onPress={requestPermission} style={{ marginTop: Spacing.xl }}>
          <Text style={{ color: colors.tint }}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('3d')} style={{ marginTop: Spacing.xl }}>
          <Text style={{ color: colors.tint }}>Switch to 3D View</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleBack} style={{ marginTop: Spacing.xl }}>
          <Text style={{ color: colors.text }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Product not found.</Text>
        <TouchableOpacity onPress={handleBack} style={{ marginTop: Spacing.xl }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const toggleMode = async () => {
    if (mode === '3d') {
      if (Platform.OS !== 'web' && !hasPermission) {
        const granted = await requestPermission();
        if (!granted) {
          showToast("Camera access is needed for the 2D overlay.", 'info');
          return;
        }
      }
      setMode('2d');
    } else {
      setMode('3d');
    }
  };

  const rawModelUrl = product.model_3d_url || 'https://modelviewer.dev/shared-assets/models/Astronaut.glb';
  const validatedUrl = /^https?:\/\//.test(rawModelUrl) ? rawModelUrl : 'https://modelviewer.dev/shared-assets/models/Astronaut.glb';
  // Attempt to map to USDZ for iOS QuickLook — only if not the fallback
  const rawIosModelUrl = product.model_3d_url ? validatedUrl.replace(/\.glb$/i, '.usdz') : '';

  // Escape for safe HTML attribute interpolation — prevents XSS via crafted URLs
  const escapeAttr = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const modelUrl = escapeAttr(validatedUrl);
  const iosModelUrl = escapeAttr(rawIosModelUrl);
  const safeName = escapeAttr(product.name ?? '');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body, html {
            width: 100%; height: 100%;
            background: radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #0D0D0D 100%);
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          model-viewer {
            width: 100%; height: 100%;
            --poster-color: transparent;
            background-color: transparent;
          }
          #controls-bar {
            position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
            display: flex; gap: 8px; z-index: 2;
          }
          #controls-bar button {
            background: rgba(0,0,0,0.55); color: #fff; border: 1px solid rgba(255,255,255,0.2);
            border-radius: 20px; padding: 8px 14px; font-size: 13px;
          }
          #hint {
            position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
            color: rgba(255,255,255,0.7); font-size: 12px; z-index: 2;
          }
          #error-state {
            display: none; position: absolute; top: 50%; left: 50%;
            transform: translate(-50%, -50%); width: 80%; text-align: center;
            color: #fff; font-size: 15px; line-height: 1.5; z-index: 3;
          }
          #error-state span { font-size: 32px; display: block; margin-bottom: 8px; }
          #error-state.visible { display: block; }
        </style>
        <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
      </head>
      <body>
        <model-viewer
          id="mv"
          src="${modelUrl}"
          ios-src="${iosModelUrl}"
          camera-controls
          auto-rotate
          rotation-per-second="18deg"
          shadow-intensity="1.4"
          shadow-softness="0.9"
          exposure="1.1"
          tone-mapping="commerce"
          environment-image="legacy"
          min-camera-orbit="auto auto 5%"
          max-camera-orbit="auto auto 200%"
          interpolation-decay="200"
          alt="A 3D model of ${safeName}">
        </model-viewer>
        <div id="controls-bar">
          <button onclick="adjustExposure(0.2)">☀️ Light +</button>
          <button onclick="adjustExposure(-0.2)">🌙 Light -</button>
          <button onclick="resetCamera()">🔄 Reset View</button>
        </div>
        <div id="hint">Drag to rotate &nbsp;·&nbsp; Pinch to zoom</div>
        <div id="error-state">
          <span>📦</span>
          3D model unavailable offline.<br/>Switch to 2D overlay to preview the item.
        </div>
        <script>
          const mv = document.getElementById('mv');
          mv.addEventListener('error', () => {
            mv.style.display = 'none';
            document.getElementById('error-state').classList.add('visible');
          });
          mv.addEventListener('camera-change', () => {
            const hint = document.getElementById('hint');
            if (hint) hint.style.display = 'none';
          });
          function adjustExposure(delta) {
            const current = parseFloat(mv.getAttribute('exposure') || '1.1');
            const next = Math.min(Math.max(current + delta, 0.4), 2.5);
            mv.setAttribute('exposure', next.toFixed(2));
          }
          function resetCamera() {
            mv.cameraOrbit = 'auto auto auto';
            mv.fieldOfView = 'auto';
            mv.setAttribute('exposure', '1.1');
          }
        </script>
      </body>
    </html>
  `;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>AR Try-On</Text>
          {isDemoRig && (
            <View style={{ backgroundColor: '#FFCC00', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: 'black', fontSize: 10, fontWeight: 'bold' }}>⚠️ Demo rig</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          onPress={toggleMode}
          style={styles.modeToggle}
          accessibilityRole="button"
          accessibilityLabel={mode === '3d' ? 'Switch to live camera AR' : 'Switch to 3D studio view'}
        >
          <Text style={[styles.modeToggleText, { color: colors.onTint }]}>
            {mode === '3d' ? 'Live Camera AR' : '3D Studio Mode'}
          </Text>
        </TouchableOpacity>
      </View>

      {experimentEnabled && mode === '2d' && (
        <View style={{ padding: 8, backgroundColor: '#352b16', gap: 8 }}>
          <Text style={{ color: 'white' }}>Renderer experiment only. Filament has no body occlusion yet.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => {
            setExperimentRenderer((current) => current === 'three' ? 'filament' : 'three');
            setArLoadError(null);
          }}>
            <Text style={{ color: 'white' }}>Renderer: {experimentRenderer === 'three' ? 'Three.js reference' : 'Filament prototype'} (switch)</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => setReplay((current) => !current)}>
            <Text style={{ color: 'white' }}>Input: {replayActive ? 'synthetic replay; camera paused' : 'live camera'} (switch)</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === '3d' ? (
        <View style={styles.webviewContainer}>
          {Platform.OS === 'web' ? (
            // @ts-ignore
            <iframe
              srcDoc={htmlContent}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="camera; microphone; xr-spatial-tracking; fullscreen"
            />
          ) : (
            <WebView
              originWhitelist={['https://*', 'http://*']}
              source={{ html: htmlContent }}
              style={styles.webview}
              scrollEnabled={false}
              bounces={false}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              allowsInlineMediaPlayback={true}
              allowsFullscreenVideo={true}
              mediaPlaybackRequiresUserAction={false}
              onShouldStartLoadWithRequest={(request) => {
                const { url } = request;
                // Pass through normal http/https/blob/data URLs
                if (
                  url.startsWith('http://') ||
                  url.startsWith('https://') ||
                  url.startsWith('blob:') ||
                  url.startsWith('data:') ||
                  url === 'about:blank'
                ) {
                  return true;
                }
                // For intent:// and other native scheme URLs (Google Scene Viewer AR),
                // hand off to the OS via Linking so the native handler can open it.
                Linking.openURL(url).catch(() => {
                  Alert.alert(
                    'AR Not Supported',
                    'AR is not available on this device. Make sure Google Play Services for AR is installed.',
                    [{ text: 'OK' }]
                  );
                });
                return false; // Prevent WebView from loading it (it can't handle intent://)
              }}
            />
          )}
          
          {!product.model_3d_url && (
            <View style={styles.demoWarning}>
              <Text style={styles.demoWarningText}>Showing Demo Model</Text>
            </View>
          )}
        </View>
      ) : (
        <View 
          style={styles.webviewContainer}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width > 0 && height > 0) {
              setStageLayout({ width, height });
            }
          }}
        >
          {Platform.OS === 'web' ? (
            <WebCameraFeed
              key={trackingSessionKey}
              active={cameraActive}
              onPoseResults={handlePoseResults}
              onTrackingLost={handleTrackingLost}
            />
          ) : device ? (
            <Camera
              key={cameraRetryKey}
              style={styles.camera}
              device={device}
              format={format}
              isActive={cameraActive && !cameraError && !replayActive}
              pixelFormat="rgb"
              frameProcessor={poseDetection.frameProcessor}
              onLayout={poseDetection.cameraViewLayoutChangeHandler}
              onOutputOrientationChanged={poseDetection.cameraOrientationChangedHandler}
              onError={(e: any) => {
                console.warn('Camera Error:', e);
                setCameraError(e?.message || 'Camera error');
                handleTrackingLost();
              }}
            />
          ) : (
            <View style={[styles.camera, { backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ color: 'white' }}>Camera not available</Text>
            </View>
          )}

          {/* Layer 2: 3D Garment WebGL Overlay */}
          {garmentMetadata && (
            <LiveRenderer
              key={experimentEnabled ? trackingSessionKey : undefined}
              stageWidth={stageWidth}
              stageHeight={stageHeight}
              ref={garmentRendererRef}
              visible={trackingEnabled && isTrackerActive}
              modelUrl={validatedUrl}
              metadata={garmentMetadata}
              fitModifier={fitModifier}
              cameraCalibration={cameraCalibration}
              onLoadError={setArLoadError}
            />
          )}

          {arLoadError && (
            <View style={[styles.arLoadErrorBanner, { pointerEvents: 'none' }]}>
              <Text style={styles.arLoadErrorText}>Garment failed to load. Try again shortly.</Text>
            </View>
          )}

          {cameraError && (
            <View style={[styles.arLoadErrorBanner, { pointerEvents: 'box-none' }]}>
              <Text style={styles.arLoadErrorText}>Camera unavailable. This can happen after switching apps -- try again.</Text>
              <TouchableOpacity
                onPress={() => {
                  setCameraError(null);
                  setCameraRetryKey((k) => k + 1);
                }}
                style={styles.cameraErrorRetryButton}
              >
                <Text style={styles.cameraErrorRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.overlayContainer, { pointerEvents: 'box-none' }]}>
            {/* AI Tracking Status Pill */}
            {trackingEnabled && (
              <View style={styles.trackingPill}>
                <View style={[styles.statusDot, { backgroundColor: trackingStatus === 'tracking' ? '#00E5FF' : '#FFB800' }]} />
                <Text style={styles.trackingPillText}>
                  {AR_TRACKING_GUIDANCE[trackingStatus]}
                </Text>
              </View>
            )}

          </View>
        </View>
      )}

      {!replayActive && sizingReady && recommendedSize && (fitZones.length > 0 || lengthFit) && showFit && (
        <View style={[styles.fitPanel, { pointerEvents: 'box-none' }]}>
          <View style={[styles.fitCard, { borderColor: colors.tint }]}>
            <View style={styles.fitHeader}>
              <Text style={styles.fitTitle}>Your fit · Size {recommendedSize}</Text>
              <TouchableOpacity
                onPress={() => setShowFit(false)}
                accessibilityRole="button"
                accessibilityLabel="Hide fit guide"
                hitSlop={8}
              >
                <IconSymbol name="xmark" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
            {fitZones.map((z) => {
              const vColor = z.verdict === 'too_tight' ? '#FF6B6B' : z.verdict === 'snug' ? '#FFCC00' : z.verdict === 'roomy' ? '#4DA3FF' : '#34C759';
              return (
                <View key={z.zone} style={styles.fitRow}>
                  <Text style={styles.fitZone}>{z.zone}</Text>
                  <Text style={[styles.fitVerdict, { color: vColor }]}>{z.verdict}</Text>
                </View>
              );
            })}
            {lengthFit && (
              <View style={styles.fitRow}>
                <Text style={styles.fitZone}>Length</Text>
                <Text style={[styles.fitVerdict, { color: lengthFit.verdict === 'appropriate' ? '#34C759' : '#FFCC00' }]}>
                  {lengthFit.verdict === 'appropriate' ? 'Typical' : lengthFit.verdict === 'runs_short' ? 'Shorter' : 'Longer'}
                </Text>
              </View>
            )}
            <Text style={styles.fitNote}>
              {lengthFit ? 'Length: rough camera estimate for a hip-covering top. Other fit: saved measurements. Not a fit guarantee.'
                : 'Estimated from your measurements'}
            </Text>
          </View>
        </View>
      )}
      <FirstUseHintModal
        visible={showHintModal}
        icon="camera"
        title="Virtual Try-On"
        message="Preview clothing on your body. Face the camera in good light with your shoulders and hips visible. Fit guidance is approximate, not a fit guarantee."
        onAcknowledge={handleAcknowledgeHint}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  arLoadErrorBanner: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    zIndex: 40,
    backgroundColor: 'rgba(153,27,27,0.92)',
    borderRadius: 10,
    padding: Spacing.sm,
    alignItems: 'center',
  },
  arLoadErrorText: {
    color: 'white',
    fontSize: 13,
    textAlign: 'center',
  },
  cameraErrorRetryButton: {
    marginTop: Spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
  },
  cameraErrorRetryText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  fitPanel: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    zIndex: 30,
  },
  fitCard: {
    backgroundColor: 'rgba(13,13,13,0.92)',
    borderRadius: 14,
    borderWidth: 1,
    padding: Spacing.md,
    width: 190,
  },
  fitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  fitTitle: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  fitRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.xs },
  fitZone: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  fitVerdict: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  fitNote: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 6 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    zIndex: 10,
  },
  backButton: {
    padding: Spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  headerTitle: {
    ...Type.subtitle,
  },
  webviewContainer: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  demoWarning: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    backgroundColor: 'rgba(239, 71, 111, 0.8)', // red warning
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
  },
  demoWarningText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 12,
  },
  modeToggle: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    backgroundColor: '#C9A96E',
    borderRadius: Radius.md,
  },
  modeToggleText: {
    fontWeight: '700',
    fontSize: 12,
  },
  camera: {
    flex: 1,
  },
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  garmentWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 15,
  },
  overlay3DContainer: {
    width: 320,
    height: 420,
    maxWidth: '92%',
    maxHeight: '75%',
    justifyContent: 'center',
    alignItems: 'center',
    transformOrigin: '50% 18%',
  },
  overlayImage: {
    width: 270,
    height: 340,
    maxWidth: '85%',
    maxHeight: '62%',
    opacity: 0.90,
    transformOrigin: '50% 18%',
    ...(Platform.OS === 'web'
      ? ({
          filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.4))',
        } as any)
      : {}),
  },
  overlayImageMatched: {
    opacity: 0.96,
    ...(Platform.OS === 'web'
      ? ({
          filter: 'drop-shadow(0 0 20px rgba(52,199,89,0.7)) drop-shadow(0 8px 24px rgba(0,0,0,0.4))',
        } as any)
      : {}),
  },
  trackingPill: {
    maxWidth: '90%',
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 25,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  trackingPillText: {
    flexShrink: 1,
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  overlayGuide: {
    position: 'absolute',
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
  },
  overlayGuideText: {
    color: '#FFF',
    fontWeight: '600',
  },
  shuffleButton: {
    marginLeft: 10,
    padding: Spacing.xs,
  },
  matchBadge: {
    position: 'absolute',
    top: 40,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
    zIndex: 20,
  },
  matchBadgeText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  pipContainer: {
    position: 'absolute',
    top: 50,
    left: 16,
    width: 80,
    height: 110,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    backgroundColor: '#0F172A',
    zIndex: 25,
  },
  pipImage: {
    width: '100%',
    height: '100%',
  },
  pipLabelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  pipLabelText: {
    color: '#FDE68A',
    fontSize: 9,
    fontWeight: '800',
  },
});
