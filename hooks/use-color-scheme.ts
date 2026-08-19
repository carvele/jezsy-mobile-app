import { useColorScheme as useSystemColorScheme } from 'react-native';
import { useThemeContext } from '@/src/context/ThemeContext';

// Every themed screen already calls this hook, so routing the in-app override
// through it is what makes one toggle apply app-wide without editing each call
// site. Falls back to the OS value when no AppThemeProvider is mounted.
export function useColorScheme(): 'light' | 'dark' {
  const themeContext = useThemeContext();
  const systemScheme = useSystemColorScheme();

  // The app is dark-first by design (see Colors.dark usage throughout); fall
  // back to that, not 'light', when neither a provider nor the OS gives a value.
  return themeContext?.scheme ?? (systemScheme === 'light' || systemScheme === 'dark' ? systemScheme : 'dark');
}
