import { useState, useCallback, useEffect } from 'react';
import { Platform, Linking } from 'react-native';
import { useCameraPermission, NATIVE_VISION_AVAILABLE } from '@/src/utils/nativeVision';

export type HardwarePermissionStatus =
  | 'not_determined'
  | 'denied_can_ask_again'
  | 'permanently_denied'
  | 'hardware_unavailable'
  | 'runtime_error'
  | 'granted';

export interface UseHardwarePermissionOptions {
  hasDevice?: boolean;
}

export interface HardwarePermissionResult {
  status: HardwarePermissionStatus;
  requestPermission: () => Promise<boolean>;
  openSettings: () => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Standard hardware permission hook enforcing the 6-state contract (UX-FOUND-005):
 * - not_determined: Initial state prior to any user prompt
 * - denied_can_ask_again: User dismissed prompt, can be re-prompted
 * - permanently_denied: Blocked at system level, requires Linking.openSettings()
 * - hardware_unavailable: Sensor or native module missing on device
 * - runtime_error: Driver or initialization failure
 * - granted: Full operational permission
 */
export function useHardwarePermission(options?: UseHardwarePermissionOptions): HardwarePermissionResult {
  const { hasPermission, requestPermission: nativeRequestPermission } = useCameraPermission();
  const [status, setStatus] = useState<HardwarePermissionStatus>(() => {
    if (Platform.OS !== 'web' && !NATIVE_VISION_AVAILABLE) {
      return 'hardware_unavailable';
    }
    if (options?.hasDevice === false) {
      return 'hardware_unavailable';
    }
    if (hasPermission) {
      return 'granted';
    }
    return 'not_determined';
  });

  const [hasRequestedOnce, setHasRequestedOnce] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Sync when native permission becomes granted externally (e.g. user returns from Settings)
  useEffect(() => {
    if (hasPermission) {
      setStatus('granted');
      setError(null);
    }
  }, [hasPermission]);

  // Handle missing hardware device
  useEffect(() => {
    if (options?.hasDevice === false && status !== 'hardware_unavailable') {
      setStatus('hardware_unavailable');
    }
  }, [options?.hasDevice, status]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'web' && !NATIVE_VISION_AVAILABLE) {
      setStatus('hardware_unavailable');
      return false;
    }
    if (options?.hasDevice === false) {
      setStatus('hardware_unavailable');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const granted = await nativeRequestPermission();
      if (granted) {
        setStatus('granted');
        setIsLoading(false);
        return true;
      }

      // If already requested once and still not granted, treat as permanently denied
      if (hasRequestedOnce || Platform.OS === 'ios') {
        setStatus('permanently_denied');
      } else {
        setStatus('denied_can_ask_again');
      }
      setHasRequestedOnce(true);
      setIsLoading(false);
      return false;
    } catch (err) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      setError(errObj);
      setStatus('runtime_error');
      setIsLoading(false);
      return false;
    }
  }, [nativeRequestPermission, hasRequestedOnce, options?.hasDevice]);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn('Could not open system settings:', err);
    }
  }, []);

  return {
    status,
    requestPermission,
    openSettings,
    isLoading,
    error,
  };
}
