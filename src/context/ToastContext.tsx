import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, Platform } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { notifySuccess, notifyError, tapLight } from '@/src/utils/haptics';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastState {
  message: string;
  kind: ToastKind;
}

interface ToastContextData {
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextData>({ showToast: () => {} });

const VISIBLE_MS = 2600;

const ICON: Record<ToastKind, Parameters<typeof IconSymbol>[0]['name']> = {
  success: 'checkmark.circle.fill',
  error: 'exclamationmark.circle',
  info: 'info.circle.fill',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const theme = useColorScheme();
  const insets = useSafeAreaInsets();
  const colors = Colors[theme];

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-20);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => setToast(null), []);

  const hide = useCallback(() => {
    opacity.value = withTiming(0, { duration: 180 }, finished => {
      if (finished) runOnJS(clear)();
    });
    translateY.value = withTiming(-20, { duration: 180 });
  }, [opacity, translateY, clear]);

  const showToast = useCallback((message: string, kind: ToastKind = 'info') => {
    if (timer.current) clearTimeout(timer.current);
    // Every success and failure in the app already routes through here, so one
    // hook-up gives the whole app tactile confirmation rather than touching
    // every call site.
    if (kind === 'success') notifySuccess();
    else if (kind === 'error') notifyError();
    else tapLight();
    setToast({ message, kind });
    opacity.value = withTiming(1, { duration: 180 });
    translateY.value = withTiming(0, { duration: 180 });
    timer.current = setTimeout(hide, VISIBLE_MS);
  }, [opacity, translateY, hide]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const value = useMemo(() => ({ showToast }), [showToast]);

  const accent =
    toast?.kind === 'success' ? colors.success
    : toast?.kind === 'error' ? colors.error
    : colors.tint;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.wrap,
            // Real inset now that a SafeAreaProvider sits above this in the root
            // layout. Under edge-to-edge the old hardcoded guess put the toast
            // under the status bar on any device with a taller one.
            { top: insets.top + 12, backgroundColor: colors.card, borderColor: accent },
            animatedStyle,
          ]}
          pointerEvents="box-none"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          <IconSymbol name={ICON[toast.kind]} size={20} color={accent} />
          <Text style={[styles.message, { color: colors.text }]} numberOfLines={3}>
            {toast.message}
          </Text>
          <TouchableOpacity onPress={hide} accessibilityRole="button" accessibilityLabel="Dismiss notification">
            <IconSymbol name="xmark" size={16} color={colors.secondaryText} />
          </TouchableOpacity>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderLeftWidth: 4,
    zIndex: 9999,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 },
      android: { elevation: 8 },
    }),
  },
  message: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
});
