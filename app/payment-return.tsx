import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Alert, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
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
  const { payment_id: paymentId } = useLocalSearchParams<{ payment_id?: string }>();
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [status, setStatus] = useState<PaymentStatus | null>(null);

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
    // Budget counts foreground time only: GCash completes in an external browser,
    // and wall-clock elapsed would time out before the user even returns to the app.
    let foregroundMs = 0;
    let lastForegroundAt = AppState.currentState === 'active' ? Date.now() : null;

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        lastForegroundAt = Date.now();
      } else {
        if (lastForegroundAt !== null) {
          foregroundMs += Date.now() - lastForegroundAt;
        }
        lastForegroundAt = null;
      }
    });

    const foregroundElapsed = () => {
      const extra = lastForegroundAt !== null ? Date.now() - lastForegroundAt : 0;
      return foregroundMs + extra;
    };

    const tick = async (paymentId: string) => {
      if (cancelled) return;

      const current = await getPaymentStatus(paymentId);
      if (cancelled) return;
      setStatus(current);

      if (current && TERMINAL_PAYMENT_STATUSES.includes(current)) {
        finish(current);
        return;
      }
      if (foregroundElapsed() > POLL_TIMEOUT_MS) {
        finish(current);
        return;
      }
      setTimeout(() => tick(paymentId), POLL_INTERVAL_MS);
    };

    (async () => {
      if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
        router.replace('/reservations');
        return;
      }

      const current = await getPaymentStatus(paymentId);
      if (cancelled) return;
      if (!current) {
        router.replace('/reservations');
        return;
      }

      setStatus(current);
      if (TERMINAL_PAYMENT_STATUSES.includes(current)) {
        finish(current);
        return;
      }
      tick(paymentId);
    })();

    return () => {
      cancelled = true;
      appStateSub.remove();
    };
  }, [finish, paymentId, router]);

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
