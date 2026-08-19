import React, { useState, useCallback } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, Text, Dimensions, ActivityIndicator, Image as RNImage } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { width: SCREEN_W } = Dimensions.get('window');
const FRAME_W = SCREEN_W - Spacing.xl * 2;
const FRAME_H = (FRAME_W * 4) / 3; // matches the [3, 4] aspect the old native cropper used
const MIN_SCALE = 1;
const MAX_SCALE = 4;

interface Props {
  visible: boolean;
  uri: string | null;
  onCancel: () => void;
  onConfirm: (croppedUri: string) => void;
}

// Replaces expo-image-picker's allowsEditing native crop UI: on several
// Android OEM skins that system cropper's confirm/cancel toolbar doesn't
// reliably render when the crop box is close to full-screen height (a [3,4]
// portrait aspect on a tall phone), leaving users staring at a crop frame
// with no visible way to proceed. This is fully our own View hierarchy, so
// the buttons are always exactly where this component puts them.
export function ImageCropModal({ visible, uri, onCancel, onConfirm }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [processing, setProcessing] = useState(false);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Base display size at scale=1: the image covers the frame exactly (like
  // resizeMode="cover"), so there's never a gap before the user even touches
  // it. Whichever dimension is relatively larger overflows the frame.
  const base = imgSize
    ? (() => {
        const imgAspect = imgSize.width / imgSize.height;
        const frameAspect = FRAME_W / FRAME_H;
        return imgAspect > frameAspect
          ? { width: FRAME_H * imgAspect, height: FRAME_H }
          : { width: FRAME_W, height: FRAME_W / imgAspect };
      })()
    : null;

  const clamp = useCallback(
    (val: number, min: number, max: number) => Math.min(Math.max(val, min), max),
    []
  );

  const clampTranslation = useCallback(
    (tx: number, ty: number, s: number) => {
      'worklet';
      if (!base) return { x: 0, y: 0 };
      const displayW = base.width * s;
      const displayH = base.height * s;
      const maxX = Math.max(0, (displayW - FRAME_W) / 2);
      const maxY = Math.max(0, (displayH - FRAME_H) / 2);
      return {
        x: Math.min(Math.max(tx, -maxX), maxX),
        y: Math.min(Math.max(ty, -maxY), maxY),
      };
    },
    [base]
  );

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
      const clamped = clampTranslation(translateX.value, translateY.value, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      const clamped = clampTranslation(
        savedTranslateX.value + e.translationX,
        savedTranslateY.value + e.translationY,
        scale.value
      );
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const reset = useCallback(() => {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    setImgSize(null);
  }, [scale, translateX, translateY, savedScale, savedTranslateX, savedTranslateY]);

  const handleCancel = useCallback(() => {
    reset();
    onCancel();
  }, [reset, onCancel]);

  const handleConfirm = useCallback(async () => {
    if (!uri || !imgSize || !base) return;
    setProcessing(true);
    try {
      const totalScale = (base.width / imgSize.width) * scale.value;
      const imageTopLeftX = (FRAME_W - base.width * scale.value) / 2 + translateX.value;
      const imageTopLeftY = (FRAME_H - base.height * scale.value) / 2 + translateY.value;

      const originX = clamp(-imageTopLeftX / totalScale, 0, imgSize.width);
      const originY = clamp(-imageTopLeftY / totalScale, 0, imgSize.height);
      const cropWidth = clamp(FRAME_W / totalScale, 1, imgSize.width - originX);
      const cropHeight = clamp(FRAME_H / totalScale, 1, imgSize.height - originY);

      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      reset();
      onConfirm(result.uri);
    } catch (e) {
      console.error('Error cropping image:', e);
      // Fall back to the uncropped photo rather than trapping the user with
      // no way to proceed.
      reset();
      onConfirm(uri);
    } finally {
      setProcessing(false);
    }
  }, [uri, imgSize, base, scale, translateX, translateY, clamp, reset, onConfirm]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleCancel} statusBarTranslucent>
      <SafeAreaView style={[styles.container, { backgroundColor: '#000' }]} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.headerBtnText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Adjust Photo</Text>
          <TouchableOpacity
            onPress={handleConfirm}
            style={styles.headerBtn}
            disabled={!imgSize || processing}
            accessibilityRole="button"
            accessibilityLabel="Use Photo"
          >
            <Text style={[styles.headerBtnText, styles.confirmText, (!imgSize || processing) && { opacity: 0.4 }]}>
              Use Photo
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.frameOuter}>
          <View style={[styles.frame, { width: FRAME_W, height: FRAME_H }]}>
            {uri && (
              <GestureDetector gesture={composedGesture}>
                <Animated.View style={StyleSheet.absoluteFill}>
                  {base && (
                    <Animated.Image
                      source={{ uri }}
                      style={[
                        {
                          width: base.width,
                          height: base.height,
                          position: 'absolute',
                          left: (FRAME_W - base.width) / 2,
                          top: (FRAME_H - base.height) / 2,
                        },
                        animatedStyle,
                      ]}
                      resizeMode="cover"
                    />
                  )}
                </Animated.View>
              </GestureDetector>
            )}
            {!imgSize && uri && (
              <RNImage
                source={{ uri }}
                style={{ width: 0, height: 0 }}
                onLoad={(e) => {
                  const { width: w, height: h } = e.nativeEvent.source;
                  if (w && h) setImgSize({ width: w, height: h });
                }}
              />
            )}
            {!imgSize && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator color={colors.tint} size="large" />
              </View>
            )}
            <View pointerEvents="none" style={styles.frameBorder} />
          </View>
          <Text style={styles.hint}>Pinch to zoom, drag to reposition</Text>
        </View>

        {processing && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.processingText}>Cropping...</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  headerBtn: {
    minWidth: 80,
    paddingVertical: Spacing.sm,
  },
  headerBtnText: {
    ...Type.body,
    fontWeight: '600',
    color: '#fff',
  },
  confirmText: {
    textAlign: 'right',
    color: '#C9A96E',
  },
  headerTitle: {
    ...Type.bodyStrong,
    fontWeight: '700',
    color: '#fff',
  },
  frameOuter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    overflow: 'hidden',
    backgroundColor: '#111',
    borderRadius: 8,
  },
  frameBorder: {
    ...StyleSheet.absoluteFill,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    color: 'rgba(255,255,255,0.6)',
    marginTop: Spacing.lg,
    ...Type.caption,
  },
  processingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    color: '#fff',
    marginTop: Spacing.md,
    ...Type.bodyStrong,
  },
});
