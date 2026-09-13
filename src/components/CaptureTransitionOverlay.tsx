import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type CaptureTransitionMode = 'front_complete' | 'turning_side' | 'side_complete' | 'processing';

interface CaptureTransitionOverlayProps {
  mode: CaptureTransitionMode;
  /** turning_side only: swaps the sub-line to "Keep turning sideways" while orientation reads ambiguous. */
  keepTurning?: boolean;
}

/**
 * Large, hard-to-miss center-screen checkpoint shown at the moments the wearer's
 * required action changes (front done -> turn -> side done -> processing), replacing
 * a small bottom pill that was too easy to miss between positioning silhouettes.
 */
export const CaptureTransitionOverlay: React.FC<CaptureTransitionOverlayProps> = ({ mode, keepTurning = false }) => {
  let checkmark: string | null = null;
  let title: string;
  let subtitle: string | null = null;
  let showRotationIcon = false;

  switch (mode) {
    case 'front_complete':
      checkmark = '✓';
      title = 'FRONT COMPLETE';
      subtitle = 'TURN SIDEWAYS';
      showRotationIcon = true;
      break;
    case 'turning_side':
      title = keepTurning ? 'KEEP TURNING SIDEWAYS' : 'TURN SIDEWAYS';
      showRotationIcon = true;
      break;
    case 'side_complete':
      checkmark = '✓';
      title = 'SIDE COMPLETE';
      subtitle = 'PROCESSING SCAN...';
      break;
    case 'processing':
      title = 'PROCESSING SCAN...';
      break;
  }

  return (
    <View style={styles.backdrop} pointerEvents="none">
      <View style={styles.card}>
        {checkmark && <Text style={styles.checkmark}>{checkmark}</Text>}
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {showRotationIcon && <Text style={styles.rotationIcon}>{'↻'}</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  card: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 32,
    gap: 8,
  },
  checkmark: {
    color: '#34C759',
    fontSize: 56,
    fontWeight: '700',
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  subtitle: {
    color: '#E5A93C',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 4,
  },
  rotationIcon: {
    color: '#fff',
    fontSize: 40,
    marginTop: 12,
  },
});
