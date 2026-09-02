/* eslint-disable */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { MannequinCanvasItem as CanvasItemType, CATEGORY_PLACEMENT_DEFAULTS, DEFAULT_FALLBACK_PLACEMENT } from '@/src/utils/mannequinConfig';

interface Props {
  item: CanvasItemType;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onUpdateTransform: (
    id: string,
    updates: { x: number; y: number; scale: number; rotation: number }
  ) => void;
  onRemove: (id: string) => void;
  onBringForward?: (id: string) => void;
  onScaleChange?: (id: string, delta: number) => void;
  onRotateChange?: (id: string, deltaDeg: number) => void;
}

export function MannequinCanvasItem({
  item,
  canvasWidth,
  canvasHeight,
  isSelected,
  onSelect,
  onUpdateTransform,
}: Props) {
  const placement = CATEGORY_PLACEMENT_DEFAULTS[item.garment_type] || DEFAULT_FALLBACK_PLACEMENT;
  const baseItemWidth = canvasWidth * placement.widthPercent;
  const baseItemHeight = baseItemWidth * 1.25;

  const initialPixelX = item.x * canvasWidth;
  const initialPixelY = item.y * canvasHeight;

  const translationX = useSharedValue(initialPixelX);
  const translationY = useSharedValue(initialPixelY);
  const prevTranslationX = useSharedValue(initialPixelX);
  const prevTranslationY = useSharedValue(initialPixelY);

  const scale = useSharedValue(item.scale);
  const savedScale = useSharedValue(item.scale);

  const rotation = useSharedValue(item.rotation);
  const savedRotation = useSharedValue(item.rotation);

  useEffect(() => {
    translationX.value = item.x * canvasWidth;
    translationY.value = item.y * canvasHeight;
    prevTranslationX.value = item.x * canvasWidth;
    prevTranslationY.value = item.y * canvasHeight;
    scale.value = item.scale;
    savedScale.value = item.scale;
    rotation.value = item.rotation;
    savedRotation.value = item.rotation;
  }, [item.x, item.y, item.scale, item.rotation, canvasWidth, canvasHeight]);

  const notifyTransformComplete = () => {
    const normX = translationX.value / canvasWidth;
    const normY = translationY.value / canvasHeight;
    onUpdateTransform(item.id, {
      x: normX,
      y: normY,
      scale: scale.value,
      rotation: rotation.value,
    });
  };

  const handleSelectFromGesture = () => {
    onSelect(item.id);
  };

  // Pan gesture
  const panGesture = Gesture.Pan()
    .onBegin(() => {
      runOnJS(handleSelectFromGesture)();
    })
    .onUpdate((e) => {
      translationX.value = prevTranslationX.value + e.translationX;
      translationY.value = prevTranslationY.value + e.translationY;
    })
    .onEnd(() => {
      prevTranslationX.value = translationX.value;
      prevTranslationY.value = translationY.value;
      runOnJS(notifyTransformComplete)();
    });

  // Pinch gesture
  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      runOnJS(handleSelectFromGesture)();
    })
    .onUpdate((e) => {
      scale.value = Math.max(0.25, Math.min(3.5, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      runOnJS(notifyTransformComplete)();
    });

  // Rotation gesture
  const rotationGesture = Gesture.Rotation()
    .onBegin(() => {
      runOnJS(handleSelectFromGesture)();
    })
    .onUpdate((e) => {
      rotation.value = savedRotation.value + (e.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      savedRotation.value = rotation.value;
      runOnJS(notifyTransformComplete)();
    });

  // Tap gesture
  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(handleSelectFromGesture)();
  });

  const composedGestures = Gesture.Simultaneous(
    tapGesture,
    Gesture.Race(panGesture, Gesture.Simultaneous(pinchGesture, rotationGesture))
  );

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translationX.value },
        { translateY: translationY.value },
        { scale: scale.value },
        { rotate: `${rotation.value}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width: baseItemWidth,
          height: baseItemHeight,
          left: (canvasWidth - baseItemWidth) / 2,
          top: 0,
          zIndex: item.zIndex,
        },
        animatedStyle,
      ]}
    >
      <GestureDetector gesture={composedGestures}>
        <View style={styles.touchArea}>
          <Image
            source={{ uri: item.image_url }}
            style={styles.image}
            contentFit="contain"
            transition={150}
          />
          {isSelected && (
            <View style={[styles.selectionBorder, { pointerEvents: 'none' } as any]} />
          )}
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchArea: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  selectionBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1.5,
    borderColor: '#C9A96E',
    borderStyle: 'dashed',
    borderRadius: 8,
    backgroundColor: 'rgba(201, 169, 110, 0.04)',
  },
});
