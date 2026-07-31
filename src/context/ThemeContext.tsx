import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = '@jezsy_theme_preference';

type ThemeContextValue = {
  preference: ThemePreference;
  scheme: ResolvedScheme;
  setPreference: (next: ThemePreference) => void;
  /** False until the stored preference has been read; lets callers hold off
   * rendering rather than flashing the wrong scheme for a frame. */
  loaded: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Named AppThemeProvider because app/_layout.tsx already imports a ThemeProvider
// from @react-navigation/native.
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'system' || stored === 'light' || stored === 'dark') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    // Fire and forget: the in-memory value is what renders, so a failed write
    // only costs the choice surviving a restart.
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  // The app is dark-first by design; fall back to that, not 'light', when the
  // OS gives no value.
  const scheme: ResolvedScheme = preference === 'system' ? systemScheme ?? 'dark' : preference;

  const value = useMemo(
    () => ({ preference, scheme, setPreference, loaded }),
    [preference, scheme, setPreference, loaded],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Deliberately returns null rather than throwing when no provider is mounted,
// so hooks/use-color-scheme can fall back to the OS value instead of crashing
// any tree that renders outside the provider.
export function useThemeContext(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

export function useThemePreference(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemePreference must be used inside AppThemeProvider');
  return context;
}
