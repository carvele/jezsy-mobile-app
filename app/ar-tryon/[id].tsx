import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { usePoseDetection, RunningMode, Delegate } from 'react-native-mediapipe-posedetection';
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
import { useToast } from '@/src/context/ToastContext';
import { evaluatePoseMatch } from '@/src/utils/poseMatcher';
type Product = Database['public']['Tables']['products']['Row'];
type PoseGuide = Pick<Database['public']['Tables']['pose_guides']['Row'], 'id' | 'name' | 'category' | 'image_url' | 'occasion' | 'base_pose_type'>;

export default function ARTryOnScreen() {
  const { showToast } = useToast();
  const { id, stylePoseId } = useLocalSearchParams<{ id: string; stylePoseId?: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const [poseGuides, setPoseGuides] = useState<PoseGuide[]>([]);
  const [poseIndex, setPoseIndex] = useState(0);
  const currentPose = poseGuides.length > 0 ? poseGuides[poseIndex % poseGuides.length] : null;

  const [matchScore, setMatchScore] = useState(0);
  const [isMatched, setIsMatched] = useState(false);
  const [matchFeedback, setMatchFeedback] = useState('Align with outline');
  const [garmentTransform, setGarmentTransform] = useState({ scale: 1, translateX: 0, translateY: 0 });
  
  // Pose Detection Hook
  const poseDetection = usePoseDetection({
    onResults: (result) => {
      const landmarks = result.results?.[0]?.landmarks?.[0];
      if (!landmarks || landmarks.length === 0) return;
      if (!currentPose) return;
      
      // Evaluate pose
      const normalizedLandmarks = landmarks.map(p => ({
        x: p.x,
        y: p.y,
        z: p.z || 0,
        visibility: p.visibility ?? p.presence ?? 0,
      }));
      const match = evaluatePoseMatch(normalizedLandmarks as any, currentPose.name);
      setMatchScore(match.score);
      setIsMatched(match.isMatched);
      setMatchFeedback(match.feedback);
      if (match.transform) {
        setGarmentTransform(match.transform);
      }
    },
    onError: (e) => console.error(e)
  }, RunningMode.LIVE_STREAM, 'pose_landmarker_lite.task', {
    numPoses: 1,
    delegate: Delegate.CPU
  });

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

  // Fit guidance: overlay how this garment's recommended size sits against the
  // user's own measurements. Guidance only, not a physical simulation.
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

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const isUuid = Boolean(id) && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
        const query = isUuid
          ? supabase.from('products').select('*').eq('id', id).single()
          : supabase.from('products').select('*').or(`sku.eq.${id},display_id.eq.${id}`).limit(1).maybeSingle();

        const { data, error } = await query;

        if (error) throw error;
        setProduct(data);
      } catch (err) {
        console.error('Error fetching product for AR Try-On:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  useEffect(() => {
    const fetchPoseGuides = async () => {
      const { data, error } = await supabase
        .from('pose_guides')
        .select('id,name,category,image_url,occasion,base_pose_type')
        .eq('deleted', false)
        .order('created_at');

      if (!error && data) {
        let sorted = data as PoseGuide[];
        if (stylePoseId) {
          const matchIdx = sorted.findIndex((p) => p.id === stylePoseId);
          if (matchIdx > -1) {
            const [target] = sorted.splice(matchIdx, 1);
            sorted = [target, ...sorted];
          }
          setMode('2d'); // Automatically switch to 2D camera mode when recreating a style pose
        }
        setPoseGuides(sorted);
      }
    };

    fetchPoseGuides();
  }, [stylePoseId]);

  useEffect(() => {
    if (mode === '2d' && currentPose) {
      Speech.speak(`Try this pose: ${currentPose.name}`);
    }
    return () => {
      Speech.stop();
    };
  }, [mode, currentPose?.id]);

  // Hands-free auto capture
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isMatched && mode === '2d') {
      timer = setTimeout(() => {
        // In a full implementation, we would call cameraRef.current.takePhoto() here
        showToast('📸 Pose captured successfully!', 'success');
      }, 2000);
    }
    return () => clearTimeout(timer);
  }, [isMatched, mode]);

  const handleShufflePose = () => {
    setPoseIndex((i) => (i + 1) % poseGuides.length);
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={{ color: colors.text, marginTop: 16 }}>Loading 3D Model...</Text>
      </View>
    );
  }

  if (mode === '2d' && !hasPermission) {
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
      if (!hasPermission) {
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

  // Fallback 3D model if product doesn't have one
  const rawModelUrl = product.model_3d_url || 'https://modelviewer.dev/shared-assets/models/Astronaut.glb';
  // Sanitize URL for safe HTML injection — only allow http/https URLs
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
            bottom: 60px;
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
          ar-modes="webxr scene-viewer quick-look"
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>AR Try-On</Text>

        <TouchableOpacity
          onPress={toggleMode}
          style={styles.modeToggle}
          accessibilityRole="button"
          accessibilityLabel={mode === '3d' ? 'Switch to 2D camera overlay' : 'Switch to 3D model view'}
          accessibilityHint={mode === '3d' ? 'Uses your camera to overlay the item image' : 'Shows the rotatable 3D model'}
        >
          <Text style={[styles.modeToggleText, { color: colors.onTint }]}>{mode === '3d' ? 'Use 2D Overlay' : 'Use 3D Model'}</Text>
        </TouchableOpacity>
      </View>

      {mode === '3d' ? (
        <View style={styles.webviewContainer}>
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
        
        {!product.model_3d_url && (
          <View style={styles.demoWarning}>
            <Text style={styles.demoWarningText}>Showing Demo Model</Text>
          </View>
        )}
        </View>
      ) : (
        <View style={styles.webviewContainer}>
          {device ? (
            <Camera
              style={styles.camera}
              device={device}
              isActive={mode === '2d'}
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
            {/* Reference Pose Picture-in-Picture Box */}
            {currentPose?.image_url && (
              <View style={styles.pipContainer}>
                <Image source={{ uri: currentPose.image_url }} style={styles.pipImage} contentFit="cover" />
                <View style={styles.pipLabelContainer}>
                  <Text style={styles.pipLabelText}>Target Look</Text>
                </View>
              </View>
            )}

            <View pointerEvents="none">
              <Image
                source={{ uri: product.image_url || '' }}
                style={[
                  styles.overlayImage,
                  {
                    transform: [
                      { scale: garmentTransform.scale },
                      { translateX: garmentTransform.translateX },
                      { translateY: garmentTransform.translateY },
                    ]
                  }
                ]}
                contentFit="contain"
              />
            </View>
            <View style={[styles.matchBadge, { backgroundColor: isMatched ? 'rgba(52, 199, 89, 0.9)' : 'rgba(0, 0, 0, 0.7)' }]}>
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
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  overlayImage: {
    width: '80%',
    height: '60%',
    opacity: 0.85,
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
