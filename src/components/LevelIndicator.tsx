import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Accelerometer } from 'expo-sensors';

const RING = 120;
const DOT = 44;
// Same tolerance TiltGuide enforces, so passing this step means the scan's own
// tilt check will also pass rather than immediately complaining.
const TOLERANCE_DEG = 15;
// Travel of the dot at the tolerance edge, so "just outside the ring" reads as
// "just outside tolerance".
const TRAVEL = (RING - DOT) / 2;

interface Props {
  onLevelChange?: (isLevel: boolean) => void;
}

// Visual bubble level for the preparation step. TiltGuide says "tilt phone
// down" in words; this shows the same reading as a dot to centre, which is
// far easier to act on while holding the phone at arm's length.
//
// Sampled at 20Hz rather than the scan's 60Hz: this renders on a static screen
// with no camera or pose model running, and a dot cannot usefully move faster
// than the eye tracks it anyway.
export function LevelIndicator({ onLevelChange }: Props) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isLevel, setIsLevel] = useState(false);

  useEffect(() => {
    Accelerometer.setUpdateInterval(50);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      // Pitch mirrors TiltGuide's derivation so both agree on "upright".
      const pitch = Math.atan2(y, z) * (180 / Math.PI) - 90;
      const normalizedPitch = pitch < -180 ? pitch + 360 : pitch;
      // Roll: how far the phone is tipped left/right off vertical.
      const roll = Math.atan2(x, Math.sqrt(y * y + z * z)) * (180 / Math.PI);

      const clamp = (deg: number) =>
        Math.max(-1, Math.min(1, deg / TOLERANCE_DEG)) * TRAVEL;

      setOffset({ x: clamp(roll), y: clamp(normalizedPitch) });

      const level =
        Math.abs(normalizedPitch) <= TOLERANCE_DEG && Math.abs(roll) <= TOLERANCE_DEG;
      setIsLevel((prev) => {
        if (prev !== level) onLevelChange?.(level);
        return level;
      });
    });

    return () => subscription.remove();
  }, [onLevelChange]);

  const color = isLevel ? '#22C55E' : '#9CA3AF';

  return (
    <View style={styles.wrap}>
      <View style={[styles.crossH, { backgroundColor: '#E5E7EB' }]} />
      <View style={[styles.crossV, { backgroundColor: '#E5E7EB' }]} />
      <View style={[styles.ring, { borderColor: color }]} />
      <View
        style={[
          styles.dot,
          { backgroundColor: color, transform: [{ translateX: offset.x }, { translateY: offset.y }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 220, height: 1 },
  crossV: { position: 'absolute', width: 1, height: 220 },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 5,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
