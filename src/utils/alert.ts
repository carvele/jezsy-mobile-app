import { Alert, Platform } from 'react-native';

type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

/**
 * React Native's Alert.alert silently no-ops on web -- react-native-web does
 * not implement it, so it shows no dialog, logs no warning, and never calls
 * a button's onPress. Every flow that gated a user action behind an Alert
 * (payment confirmation, reservation cancel, item delete, legal acceptance,
 * ...) was unreachable on the deployed web build: the screen just looked
 * stuck. This wraps Alert.alert and, on web only, falls back to
 * window.confirm/alert so the same callback actually runs.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons as Parameters<typeof Alert.alert>[2]);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;

  if (!buttons || buttons.length === 0) {
    window.alert(text);
    return;
  }

  if (buttons.length === 1) {
    window.alert(text);
    buttons[0].onPress?.();
    return;
  }

  // window.confirm only gives one OK/Cancel choice. This codebase's Alerts
  // are all one dismiss option plus one action option, so map the
  // 'cancel'-style button to Cancel and the rest to OK.
  const cancelBtn = buttons.find((b) => b.style === 'cancel') ?? buttons[0];
  const actionBtn = buttons.find((b) => b !== cancelBtn) ?? buttons[buttons.length - 1];

  if (window.confirm(text)) {
    actionBtn.onPress?.();
  } else {
    cancelBtn.onPress?.();
  }
}
