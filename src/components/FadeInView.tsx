import React, { useEffect } from 'react';
import { AccessibilityInfo, ViewStyle, StyleProp } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { Motion } from '@/constants/theme';

interface Props {
  children: React.ReactNode;
  /** Position in the list. Staggers the entrance so items arrive in sequence. */
  index?: number;
  /** Distance in points the content rises from. Keep small -- this is a settle, not a slide. */
  offset?: number;
  style?: StyleProp<ViewStyle>;
}

// Standard ease-out: quick to start, decelerating into place. Content that
// eases in and out reads as sluggish because it hesitates at both ends.
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

// Past this many items the stagger stops accumulating, otherwise the tail of a
// long list waits seconds before appearing.
const MAX_STAGGER_INDEX = 8;

/**
 * Fades and lifts its children into place on mount.
 *
 * Entrance motion is the difference between content that appears and content
 * that simply is there on the next frame. Deliberately subtle: the animation
 * should register as smoothness rather than as an effect.
 */
export function FadeInView({ children, index = 0, offset = 12, style }: Props) {
  const progress = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    const delay = Math.min(index, MAX_STAGGER_INDEX) * Motion.stagger;
    progress.value = withDelay(delay, withTiming(1, { duration: Motion.base, easing: EASE }));
  }, [progress, index, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * offset }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
