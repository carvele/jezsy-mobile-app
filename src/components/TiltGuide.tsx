import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface Props {
  onTiltValid: (isValid: boolean) => void;
}

export function TiltGuide({ onTiltValid }: Props) {
  const [pitch, setPitch] = useState<number>(0);

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
      
      setPitch(normalizedPitch);
      
      // Valid if phone is within ±15 degrees of vertical
      const isValid = Math.abs(normalizedPitch) <= 15;
      onTiltValid(isValid);
    });

    return () => subscription.remove();
  }, [onTiltValid]);

  const isTiltingUp = pitch > 15;
  const isTiltingDown = pitch < -15;

  let message = 'Hold steady';
  let icon = 'checkmark.circle.fill';
  let color = '#00FF00';

  if (isTiltingUp) {
    message = 'Tilt phone down ↓';
    icon = 'arrow.down.circle.fill';
    color = '#FFCC00';
  } else if (isTiltingDown) {
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
