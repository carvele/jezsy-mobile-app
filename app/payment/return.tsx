import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Where success_url/cancel_url point on web -- PayMongo's checkout runs in a
// plain browser tab there (not a WebView), so this is the only page that can
// receive control back. window.close() only works because that tab was
// opened via window.open() from the app; a manual fallback covers the case
// where the browser blocks a script-initiated close anyway.
export default function PaymentReturnScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];

  useEffect(() => {
    if (Platform.OS === 'web') {
      const timer = setTimeout(() => window.close(), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <SafeAreaView style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Text style={[styles.title, { color: colors.text }]}>You&apos;re all set</Text>
      <Text style={[styles.hint, { color: colors.secondaryText }]}>
        This tab will close automatically. Check your reservation for the latest payment status.
      </Text>
      {Platform.OS === 'web' && (
        <TouchableOpacity onPress={() => window.close()} style={{ marginTop: Spacing.lg }}>
          <Text style={{ color: colors.tint }}>Close this tab</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center', padding: Spacing.xxl },
  title: { ...Type.bodyLargeStrong },
  hint: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: Spacing.sm },
});
