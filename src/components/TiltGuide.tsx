import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface Props {
  onTiltValid: (isValid: boolean) => void;
  onGuideState?: (state: 'tilt_down' | 'tilt_up' | 'hold_steady') => void;
}

type GuideState = 'tilt_down' | 'tilt_up' | 'hold_steady';

export function TiltGuide({ onTiltValid, onGuideState }: Props) {
  // Tracks the discrete guide state rather than the raw pitch, so a render
  // (and effect re-run, since this was in the accelerometer effect's own
  // state) doesn't fire on every ~16ms sample -- only on an actual crossing.
  const [guideState, setGuideState] = useState<GuideState>('hold_steady');

  useEffect(() => {
    // Set update interval to ~60fps
    Accelerometer.setUpdateInterval(16);

    const subscription = Accelerometer.addListener(({ y, z }) => {
      // Calculate pitch angle in degrees from gravity vector
      // y is up/down axis, z is front/back axis
      const angle = Math.atan2(y, z) * (180 / Math.PI);

      // Standardize so 0 is perfectly vertical
      let normalizedPitch = angle - 90;
      if (normalizedPitch < -180) normalizedPitch += 360;

      // Valid if phone is within ±15 degrees of vertical
      const isValid = Math.abs(normalizedPitch) <= 15;
      onTiltValid(isValid);

      let currentState: GuideState = 'hold_steady';
      if (normalizedPitch > 15) {
        currentState = 'tilt_down';
      } else if (normalizedPitch < -15) {
        currentState = 'tilt_up';
      }

      setGuideState(prev => {
        if (prev === currentState) return prev;
        onGuideState?.(currentState);
        return currentState;
      });
    });

    return () => subscription.remove();
  }, [onTiltValid, onGuideState]);

  let message = 'Hold steady';
  let icon = 'checkmark.circle.fill';
  let color = '#00FF00';

  // tilt_down/tilt_up name the instruction, not the phone's own motion --
  // pitching the phone up is what earns the "tilt down" instruction back.
  if (guideState === 'tilt_down') {
    message = 'Tilt phone down ↓';
    icon = 'arrow.down.circle.fill';
    color = '#FFCC00';
  } else if (guideState === 'tilt_up') {
    message = 'Tilt phone up ↑';
    icon = 'arrow.up.circle.fill';
    color = '#FFCC00';
  }

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { borderColor: color }]}>
        <IconSymbol name={icon as any} size={20} color={color} />
        <Text style={[styles.text, { color }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
