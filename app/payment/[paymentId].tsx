import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getPaymentStatus, TERMINAL_PAYMENT_STATUSES, PaymentStatus } from '@/src/lib/payments';

// How long to keep checking after the checkout page hands control back. The
// webhook is usually in within a couple of seconds, but GCash can lag.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90000;

export default function PaymentScreen() {
  const { paymentId, url } = useLocalSearchParams<{ paymentId: string; url: string }>();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [settling, setSettling] = useState(false);
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  // "A few seconds" is only true for the common case; the poll loop itself
  // waits up to 90s for a slow webhook, so the copy needs to catch up once
  // it's clearly not a few seconds anymore instead of overpromising the
  // whole time.
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  const finish = useCallback(
    (finalStatus: PaymentStatus | null) => {
      if (finalStatus === 'paid') {
        Alert.alert(
          'Payment received',
          'Your deposit is in. We will confirm your reservation shortly.',
          [{ text: 'OK', onPress: () => router.replace('/reservations') }],
        );
        return;
      }

      Alert.alert(
        'Payment not completed',
        finalStatus === 'failed'
          ? 'Your payment did not go through. You can try again from the reservation.'
          : 'We have not seen the payment yet. If you completed it, it will appear on the reservation shortly.',
        [{ text: 'OK', onPress: () => router.replace('/reservations') }],
      );
    },
    [router],
  );

  // Only the webhook can mark a payment paid, so leaving the checkout page is a
  // cue to start checking -- never proof of payment in itself.
  useEffect(() => {
    if (!settling || !paymentId) return;

    let cancelled = false;
    startedAt.current = startedAt.current ?? Date.now();

    const tick = async () => {
      if (cancelled) return;

      const current = await getPaymentStatus(paymentId);
      if (cancelled) return;

      setStatus(current);
      setSecondsElapsed(Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000));

      if (current && TERMINAL_PAYMENT_STATUSES.includes(current)) {
        finish(current);
        return;
      }

      if (Date.now() - (startedAt.current ?? 0) > POLL_TIMEOUT_MS) {
        finish(current);
        return;
      }

      setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();

    return () => {
      cancelled = true;
    };
  }, [settling, paymentId, finish]);

  const handleNavigation = (navState: { url: string }) => {
    // The success and cancel URLs are both our own scheme, so either one means
    // the hosted page is done with us.
    if (navState.url?.startsWith('jezsymobileapp://')) {
      setSettling(true);
      return false;
    }
    return true;
  };

  if (!url) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>This payment link is no longer valid.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.tint }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Cancel payment"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Secure Payment</Text>
        <View style={{ width: 32 }} />
      </View>

      {settling ? (
        <View style={[styles.center, styles.flexOne]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.settlingText, { color: colors.text }]}>Confirming your payment…</Text>
          <Text style={[styles.settlingHint, { color: colors.secondaryText }]}>
            {status === 'processing'
              ? 'Your bank or wallet is still processing this.'
              : secondsElapsed > 10
              ? 'Still confirming — some banks and e-wallets take a minute or two. Please do not close the app.'
              : 'This usually takes a few seconds. Please do not close the app.'}
          </Text>
        </View>
      ) : (
        <WebView
          source={{ uri: String(url) }}
          onShouldStartLoadWithRequest={handleNavigation}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.center, styles.flexOne, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flexOne: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, width: 32 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  settlingText: { fontSize: 16, fontWeight: '700', marginTop: 16 },
  settlingHint: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
});
