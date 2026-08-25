import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking, Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Camera, useCameraDevice, useCameraPermission, usePoseDetection, RunningMode, Delegate, NATIVE_VISION_AVAILABLE } from '@/src/utils/nativeVision';
import { Image } from 'expo-image';
import * as Speech from 'expo-speech';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useSizingProfile } from '@/src/hooks/useSizingProfile';
import { useSafeBack } from '@/src/hooks/useSafeBack';
import { recommendSize, analyzeFit } from '@/src/utils/sizeRecommender';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirstUseHintModal } from '@/src/components/FirstUseHintModal';
import { ConsentModal } from '@/src/components/ConsentModal';
import { useToast } from '@/src/context/ToastContext';
import { evaluatePoseMatch, calculateGarmentAutoFit, getForegroundOcclusionSegments } from '@/src/utils/poseMatcher';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
type Product = Database['public']['Tables']['products']['Row'];
type PoseGuide = Pick<Database['public']['Tables']['pose_guides']['Row'], 'id' | 'name' | 'category' | 'image_url' | 'occasion' | 'base_pose_type'>;

import { WebPoseTracker } from '@/src/utils/webPoseDetection';
import type { Landmark } from '@/src/utils/poseDetector';

interface WebCameraFeedProps {
  onPoseResults?: (landmarks: Landmark[]) => void;
  onTrackerReady?: (ready: boolean) => void;
}

function WebCameraFeed({ onPoseResults, onTrackerReady }: WebCameraFeedProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const occlusionCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const trackerRef = React.useRef<WebPoseTracker | null>(null);
  const animFrameRef = React.useRef<number | null>(null);
  const onPoseResultsRef = React.useRef(onPoseResults);
  const onTrackerReadyRef = React.useRef(onTrackerReady);

  React.useEffect(() => {
    onPoseResultsRef.current = onPoseResults;
    onTrackerReadyRef.current = onTrackerReady;
  });

  React.useEffect(() => {
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
        if (isMounted) {
          onTrackerReadyRef.current?.(ready);
        }

        if (!ready) return;

        // Continuous pose detection loop with ~20 FPS inference budget
        let isProcessing = false;
        let lastInferenceTime = 0;

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
              const landmarks = tracker.detect(videoRef.current, now);
              const canvas = occlusionCanvasRef.current;

              if (landmarks) {
                if (onPoseResultsRef.current) {
                  onPoseResultsRef.current(landmarks);
                }

                // Layer 3 Occlusion Sandwich: Render foreground arms, hands & neck over the garment
                if (canvas && videoRef.current) {
                  const ctx = canvas.getContext('2d');
                  if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    const occluders = getForegroundOcclusionSegments(landmarks);
                    if (occluders.length > 0) {
                      ctx.save();
                      ctx.beginPath();
                      for (const occ of occluders) {
                        const sx = occ.start.x * canvas.width;
                        const sy = occ.start.y * canvas.height;
                        const ex = occ.end.x * canvas.width;
                        const ey = occ.end.y * canvas.height;
                        const r = Math.max(8, occ.radius * canvas.width);

                        ctx.moveTo(sx, sy);
                        ctx.lineTo(ex, ey);
                        ctx.lineWidth = r * 2;
                        ctx.lineCap = 'round';
                        ctx.strokeStyle = '#FFFFFF';
                        ctx.stroke();
                      }
                      ctx.globalCompositeOperation = 'source-in';
                      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                      ctx.restore();
                    }
                  }
                }
              } else {
                // Tracking lost: clear occlusion canvas immediately to prevent stale cutouts
                if (canvas) {
                  const ctx = canvas.getContext('2d');
                  ctx?.clearRect(0, 0, canvas.width, canvas.height);
                }
              }
            } catch (err) {
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
  }, []);

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

export default function ARTryOnScreen() {
  const { showToast } = useToast();
  const { id, stylePoseId } = useLocalSearchParams<{ id: string; stylePoseId?: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasConsented, setHasConsented] = useState<boolean | null>(null);
  const [stageLayout, setStageLayout] = useState<{ width: number; height: number }>({ width: 390, height: 600 });
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const [poseGuides, setPoseGuides] = useState<PoseGuide[]>([]);
  const [poseIndex, setPoseIndex] = useState(0);
  const currentPose = poseGuides.length > 0 ? poseGuides[poseIndex % poseGuides.length] : null;

  const [matchScore, setMatchScore] = useState(0);
  const [isMatched, setIsMatched] = useState(false);
  const [matchFeedback, setMatchFeedback] = useState('Align with outline');
  const [isTrackerActive, setIsTrackerActive] = useState(false);

  // Reanimated SharedValues for 60FPS UI-thread smooth garment positioning
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotateDeg = useSharedValue(0);
  const opacity = useSharedValue(0.9);
  const lostFramesRef = React.useRef(0);
  const lastStateUpdateRef = React.useRef(0);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

  const animatedGarmentStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotateDeg.value}deg` },
    ],
  }));

  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const stageWidth = stageLayout.width || Math.min(winWidth || 390, 480);
  const stageHeight = stageLayout.height || Math.min(winHeight || 844, 900);

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

  const handlePoseResults = useCallback(
    (landmarks: Landmark[]) => {
      // 1. Continuous real-time 2D similarity transform auto-fit
      const autoFit = calculateGarmentAutoFit(landmarks, {
        isMirrored: true,
        screenWidth: stageWidth,
        screenHeight: stageHeight,
        fitEase: 1.05,
      });

      if (autoFit.isTracking) {
        lostFramesRef.current = 0;

        const config = {
          duration: 45,
          easing: Easing.out(Easing.quad),
        };

        translateX.value = withTiming(autoFit.targetX, config);
        translateY.value = withTiming(autoFit.targetY, config);
        scale.value = withTiming(autoFit.targetScale, config);
        rotateDeg.value = withTiming(autoFit.targetRotation, config);
        opacity.value = withTiming(autoFit.targetOpacity, { duration: 120 });

        // Continuous 3D Perspective Rotation (Yaw & Pitch) to 3D model-viewer
        if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            {
              type: 'UPDATE_3D_POSE',
              yaw: autoFit.yawDeg,
              pitch: autoFit.pitchDeg,
            },
            '*'
          );
        }
      } else {
        lostFramesRef.current += 1;
        // Debounced hysteresis: only return to neutral if lost for >6 consecutive frames (~200ms)
        if (lostFramesRef.current > 6) {
          translateX.value = withTiming(0, { duration: 250 });
          translateY.value = withTiming(0, { duration: 250 });
          scale.value = withTiming(1, { duration: 250 });
          rotateDeg.value = withTiming(0, { duration: 250 });
          opacity.value = withTiming(0.85, { duration: 200 });
        }
      }

      // 2. Throttled React state updates (every 200ms) to eliminate main-thread re-render stutter
      const now = performance.now();
      if (now - lastStateUpdateRef.current > 200) {
        lastStateUpdateRef.current = now;
        setIsTrackerActive(autoFit.isTracking);

        if (currentPose) {
          const match = evaluatePoseMatch(landmarks, currentPose.name, {
            isMirrored: true,
            screenWidth: stageWidth,
            screenHeight: stageHeight,
          });
          setMatchScore(match.score);
          setIsMatched(match.isMatched);
          setMatchFeedback(match.feedback);
        } else {
          setMatchFeedback(autoFit.isTracking ? autoFit.feedback : 'Position yourself in frame');
          setIsMatched(false);
        }
      }
    },
    [currentPose, stageWidth, stageHeight, translateX, translateY, scale, rotateDeg, opacity]
  );
  
  // Pose Detection Hook (Native)
  const poseDetection = usePoseDetection({
    onResults: (result) => {
      const landmarks = result.results?.[0]?.landmarks?.[0];
      if (!landmarks || landmarks.length === 0) return;
      
      // Evaluate pose
      const normalizedLandmarks = landmarks.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z || 0,
        visibility: p.visibility ?? p.presence ?? 0,
      }));
      handlePoseResults(normalizedLandmarks as any);
    },
    onError: (e) => console.error(e)
  }, RunningMode.LIVE_STREAM, 'pose_landmarker_lite.task', {
    numPoses: 1,
    delegate: Delegate.CPU
  });

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

  const fetchPoseGuides = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('pose_guides')
        .select('id, name, category, image_url, occasion, base_pose_type')
        .eq('deleted', false)
        .order('created_at');
      if (error) throw error;
      if (data && data.length > 0) {
        setPoseGuides(data);
        if (stylePoseId) {
          const matchedIdx = data.findIndex(p => p.id === stylePoseId);
          if (matchedIdx !== -1) {
            setPoseIndex(matchedIdx);
            setMode('2d');
          }
        }
      }
    } catch (err) {
      console.error('Error fetching pose guides:', err);
    }
  }, [stylePoseId]);

  useEffect(() => {
    fetchProduct();
    fetchPoseGuides();
  }, [fetchProduct, fetchPoseGuides]);

  const [showHintModal, setShowHintModal] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('ar_hint_seen').then((seen) => {
      if (!seen) setShowHintModal(true);
    });
  }, []);

  const handleAcknowledgeHint = () => {
    setShowHintModal(false);
    AsyncStorage.setItem('ar_hint_seen', 'true');
  };

  const handleShufflePose = () => {
    if (poseGuides.length === 0) return;
    setPoseIndex((i) => (i + 1) % poseGuides.length);
    setIsMatched(false);
    setMatchScore(0);
    setMatchFeedback('Align with outline');
  };

  const { measurements: sizingMeasurements, fitPreference, ready: sizingReady } = useSizingProfile();
  const [showFit, setShowFit] = useState(true);
  const recommendedSize = useMemo(
    () => (sizingReady && sizingMeasurements && product?.measurements
      ? recommendSize(sizingMeasurements, product.measurements as any, fitPreference)
      : null),
    [sizingReady, sizingMeasurements, fitPreference, product?.measurements]
  );
  const fitZones = useMemo(
    () => (recommendedSize && product?.measurements && sizingMeasurements
      ? analyzeFit(sizingMeasurements, (product.measurements as any)[recommendedSize])
      : []),
    [recommendedSize, sizingMeasurements, product?.measurements]
  );

  const theme = useColorScheme();
  const colors = Colors[theme];

  const goBack = useSafeBack('/');
  const handleBack = goBack;

  const isFocused = useIsFocused();
  const lastSpokenSpeechRef = React.useRef<string>('');
  const isSpeechThrottledRef = React.useRef<boolean>(false);
  const speechTimeoutRef = React.useRef<any>(null);

  useEffect(() => {
    if (isMatched && matchFeedback && mode === '2d' && isFocused) {
      if (matchFeedback !== lastSpokenSpeechRef.current && !isSpeechThrottledRef.current) {
        Speech.stop();
        Speech.speak(matchFeedback, { rate: 1.0, pitch: 1.0 });
        lastSpokenSpeechRef.current = matchFeedback;
        isSpeechThrottledRef.current = true;
        if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = setTimeout(() => {
          isSpeechThrottledRef.current = false;
        }, 3000);
      }
    }
  }, [isMatched, matchFeedback, mode, isFocused]);

  useEffect(() => {
    return () => {
      Speech.stop();
      if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
    };
  }, []);

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

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={{ color: colors.text, marginTop: 16 }}>Loading 3D Model...</Text>
      </View>
    );
  }

  if (mode === '2d' && Platform.OS !== 'web' && !hasPermission) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>We need your permission to show the camera</Text>
        <TouchableOpacity onPress={requestPermission} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('3d')} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Switch to 3D View</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleBack} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.text }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Product not found.</Text>
        <TouchableOpacity onPress={handleBack} style={{ marginTop: 20 }}>
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
          /* Elegant gold AR button */
          #ar-button {
            position: absolute;
            bottom: 32px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #C9A96E 0%, #8A6D3B 100%);
            color: #0D0D0D;
            padding: 14px 36px;
            border-radius: 100px;
            font-size: 15px;
            font-weight: 800;
            border: none;
            letter-spacing: 0.5px;
            box-shadow: 0 4px 24px rgba(201,169,110,0.45), 0 1px 4px rgba(0,0,0,0.4);
            cursor: pointer;
            transition: opacity 0.15s;
          }
          #ar-button:active { opacity: 0.8; }
          /* Contextual controls hint */
          #hint {
            position: absolute;
            bottom: 92px;
            left: 50%;
            transform: translateX(-50%);
            color: rgba(255,255,255,0.45);
            font-size: 12px;
            white-space: nowrap;
            pointer-events: none;
          }
          /* Offline / error state */
          #error-state {
            display: none;
            position: absolute;
            inset: 0;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: rgba(255,255,255,0.6);
            font-size: 14px;
            gap: 12px;
          }
          #error-state.visible { display: flex; }
          #error-state span { font-size: 36px; }
          #controls-bar {
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 8px;
            background: rgba(0, 0, 0, 0.7);
            padding: 6px 12px;
            border-radius: 20px;
            backdrop-filter: blur(8px);
            z-index: 10;
          }
          #controls-bar button {
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.35);
            color: #fff;
            padding: 6px 12px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
          }
        </style>
        <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
      </head>
      <body>
        <model-viewer
          id="mv"
          src="${modelUrl}"
          ios-src="${iosModelUrl}"
          ar
          ar-modes="webxr quick-look scene-viewer"
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
          <button slot="ar-button" id="ar-button">
            View in your space (AR)
          </button>
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

  const htmlContentOverlay = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body, html {
            width: 100%; height: 100%;
            background: transparent !important;
            overflow: hidden;
          }
          model-viewer {
            width: 100%; height: 100%;
            --poster-color: transparent;
            background-color: transparent !important;
          }
        </style>
        <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
      </head>
      <body>
        <model-viewer
          id="mv-overlay"
          src="${modelUrl}"
          ios-src="${iosModelUrl}"
          camera-orbit="0deg 75deg 105%"
          interpolation-decay="80"
          shadow-intensity="0.8"
          shadow-softness="0.8"
          exposure="1.15"
          tone-mapping="commerce"
          environment-image="legacy"
          alt="A 3D model of ${safeName}">
        </model-viewer>
        <script>
          const mv = document.getElementById('mv-overlay');
          window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'UPDATE_3D_POSE') {
              const { yaw, pitch } = e.data;
              if (mv) {
                // Invert yaw for mirrored camera display
                const orbitYaw = (-(yaw || 0)).toFixed(1);
                const orbitPitch = Math.max(55, Math.min(95, 75 + (pitch || 0))).toFixed(1);
                mv.cameraOrbit = orbitYaw + 'deg ' + orbitPitch + 'deg 105%';
              }
            }
          });
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>AR Try-On</Text>

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
              onPoseResults={handlePoseResults}
              onTrackerReady={(ready) => setIsTrackerActive(ready)}
            />
          ) : device ? (
            <Camera
              style={styles.camera}
              device={device}
              isActive={mode === '2d' && isFocused}
              pixelFormat="rgb"
              frameProcessor={poseDetection.frameProcessor}
              onLayout={poseDetection.cameraViewLayoutChangeHandler}
            />
          ) : (
            <View style={[styles.camera, { backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ color: '#fff' }}>Camera not available</Text>
            </View>
          )}
          <View style={styles.overlayContainer} pointerEvents="box-none">
            {/* AI Tracking Status Pill */}
            {isTrackerActive && (
              <View style={styles.trackingPill}>
                <View style={[styles.statusDot, { backgroundColor: isMatched ? '#34C759' : '#00E5FF' }]} />
                <Text style={styles.trackingPillText}>
                  {isMatched ? 'Pose Matched' : 'AI Body Tracking Active'}
                </Text>
              </View>
            )}

            {/* Reference Pose Picture-in-Picture Box */}
            {currentPose?.image_url && (
              <View style={styles.pipContainer}>
                <Image source={{ uri: currentPose.image_url }} style={styles.pipImage} contentFit="cover" />
                <View style={styles.pipLabelContainer}>
                  <Text style={styles.pipLabelText}>Target Look</Text>
                </View>
              </View>
            )}

            <View pointerEvents="none" style={styles.garmentWrapper}>
              <Animated.View
                style={[
                  styles.overlay3DContainer,
                  animatedGarmentStyle,
                  isMatched && styles.overlayImageMatched,
                ]}
              >
                {Platform.OS === 'web' ? (
                  // @ts-ignore
                  <iframe
                    ref={iframeRef}
                    srcDoc={htmlContentOverlay}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      background: 'transparent',
                    }}
                    allow="xr-spatial-tracking"
                  />
                ) : (
                  <Image
                    source={{ uri: product.image_url || '' }}
                    style={styles.overlayImage}
                    contentFit="contain"
                  />
                )}
              </Animated.View>
            </View>
            <View style={[styles.matchBadge, { backgroundColor: isMatched ? 'rgba(52, 199, 89, 0.92)' : 'rgba(0, 0, 0, 0.72)' }]}>
              <Text style={styles.matchBadgeText}>{matchFeedback}</Text>
            </View>
            <View style={styles.overlayGuide} pointerEvents="box-none">
              <Text style={styles.overlayGuideText}>
                {currentPose ? `Recreating: ${currentPose.name}` : 'Align your body with the item'}
              </Text>
              {currentPose && (
                <TouchableOpacity
                  onPress={handleShufflePose}
                  style={styles.shuffleButton}
                  accessibilityRole="button"
                  accessibilityLabel="Suggest another pose"
                >
                  <IconSymbol name="arrow.clockwise" size={16} color="#FFF" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}

      {sizingReady && recommendedSize && fitZones.length > 0 && showFit && (
        <View style={styles.fitPanel} pointerEvents="box-none">
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
              const vColor = z.verdict === 'snug' ? '#FFCC00' : z.verdict === 'roomy' ? '#4DA3FF' : '#34C759';
              return (
                <View key={z.zone} style={styles.fitRow}>
                  <Text style={styles.fitZone}>{z.zone}</Text>
                  <Text style={[styles.fitVerdict, { color: vColor }]}>{z.verdict}</Text>
                </View>
              );
            })}
            <Text style={styles.fitNote}>Estimated from your measurements</Text>
          </View>
        </View>
      )}
      <FirstUseHintModal
        visible={showHintModal}
        icon="camera"
        title="Virtual Try-On"
        message="Align your body with the camera frame in a well-lit area. You can switch between 3D model view and 2D pose guidance overlay."
        onAcknowledge={handleAcknowledgeHint}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 12,
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
    padding: 4,
  },
  matchBadge: {
    position: 'absolute',
    top: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
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
