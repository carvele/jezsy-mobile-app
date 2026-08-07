import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getLatestPayment,
  getPaymentStatus,
  TERMINAL_PAYMENT_STATUSES,
  PaymentStatus,
} from '@/src/lib/payments';

// PayMongo sends the customer to PAYMONGO_RETURN_URL
// (jezsymobileapp://payment-return) when checkout finishes or is cancelled.
// The in-app WebView catches that redirect when it happens inside the app, but
// GCash routinely completes in an external browser, and then Android hands the
// deep link straight to the OS instead. With no route at this path expo-router
// rendered its "page not found" screen -- so a customer who had just paid was
// told the page did not exist.
//
// Same trust model as app/payment/[paymentId].tsx: landing here proves only
// that checkout closed, never that the money moved. The webhook settles the
// payment; this screen just waits for the row to reflect it.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90000;

export default function PaymentReturnScreen() {
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [status, setStatus] = useState<PaymentStatus | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    startedAt.current = Date.now();

    const tick = async (paymentId: string) => {
      if (cancelled) return;

      const current = await getPaymentStatus(paymentId);
      if (cancelled) return;
      setStatus(current);

      if (current && TERMINAL_PAYMENT_STATUSES.includes(current)) {
        finish(current);
        return;
      }
      if (Date.now() - (startedAt.current ?? 0) > POLL_TIMEOUT_MS) {
        finish(current);
        return;
      }
      setTimeout(() => tick(paymentId), POLL_INTERVAL_MS);
    };

    (async () => {
      const latest = await getLatestPayment();
      if (cancelled) return;

      // No payment row at all means this deep link arrived without a checkout
      // behind it; drop the customer somewhere useful rather than stranding
      // them on a spinner.
      if (!latest) {
        router.replace('/reservations');
        return;
      }

      setStatus(latest.status);
      if (TERMINAL_PAYMENT_STATUSES.includes(latest.status)) {
        finish(latest.status);
        return;
      }
      tick(latest.id);
    })();

    return () => {
      cancelled = true;
    };
  }, [finish, router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.title, { color: colors.text }]}>Confirming your payment…</Text>
        <Text style={[styles.hint, { color: colors.secondaryText }]}>
          {status === 'processing'
            ? 'Your bank or wallet is still processing this.'
            : 'This usually takes a few seconds. Please do not close the app.'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xxl },
  title: { ...Type.bodyLargeStrong, marginTop: Spacing.lg },
  hint: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: Spacing.sm },
});
