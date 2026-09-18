import { useState, useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Observes the system Reduce Motion accessibility preference.
 * Honors vestibular and cognitive accessibility preferences.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (mounted) setReduceMotion(enabled);
      }
    );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}
