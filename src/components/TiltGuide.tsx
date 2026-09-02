import { Spacing } from '@/constants/theme';
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
  const [guideState, setGuideState] = useState<GuideState>('hold_steady');

  const onTiltValidRef = React.useRef(onTiltValid);
  const onGuideStateRef = React.useRef(onGuideState);

  React.useEffect(() => {
    onTiltValidRef.current = onTiltValid;
    onGuideStateRef.current = onGuideState;
  });

  useEffect(() => {
    // 20Hz sensor update interval (50ms) to conserve battery and CPU
    Accelerometer.setUpdateInterval(50);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      // Calculate pitch angle in degrees from gravity vector
      const pitchAngle = Math.atan2(y, z) * (180 / Math.PI);
      // Calculate roll angle in degrees
      const rollAngle = Math.atan2(x, Math.sqrt(y * y + z * z)) * (180 / Math.PI);

      let normalizedPitch = pitchAngle - 90;
      if (normalizedPitch < -180) normalizedPitch += 360;

      // Valid if phone is within ±15 degrees of vertical pitch and ±10 degrees roll
      const isPitchValid = Math.abs(normalizedPitch) <= 15;
      const isRollValid = Math.abs(rollAngle) <= 10;
      const isValid = isPitchValid && isRollValid;

      onTiltValidRef.current(isValid);

      let currentState: GuideState = 'hold_steady';
      if (normalizedPitch > 15) {
        currentState = 'tilt_down';
      } else if (normalizedPitch < -15) {
        currentState = 'tilt_up';
      }

      setGuideState(prev => {
        if (prev === currentState) return prev;
        onGuideStateRef.current?.(currentState);
        return currentState;
      });
    });

    return () => subscription.remove();
  }, []);

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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
