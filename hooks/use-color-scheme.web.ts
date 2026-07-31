import { useEffect, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import { useThemeContext } from '@/src/context/ThemeContext';

/**
 * To support static rendering, this value needs to be re-calculated on the
 * client side for web. Mirrors the native hook otherwise, including the in-app
 * theme override.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const themeContext = useThemeContext();
  const systemScheme = useSystemColorScheme();

  if (!hasHydrated) return 'light';

  return themeContext?.scheme ?? systemScheme ?? 'dark';
}
