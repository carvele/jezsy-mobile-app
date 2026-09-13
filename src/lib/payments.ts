import { Platform } from 'react-native';
import { supabase } from '@/src/lib/supabase';
import type { PaymentPurpose } from '@/src/utils/reservationPayment';

export type PaymentStatus =
  | 'awaiting_payment'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = [
  'paid',
  'failed',
  'cancelled',
  'refunded',
];

export type StartedPayment = {
  paymentId: string;
  checkoutUrl: string;
};

const PAYMONGO_CHECKOUT_HOSTS = new Set(['checkout.paymongo.com']);
export const PAYMENT_RETURN_SCHEME = 'jezsymobileapp:';

export function isAllowedCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && PAYMONGO_CHECKOUT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function isPaymentReturnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === PAYMENT_RETURN_SCHEME && url.hostname === 'payment-return' &&
      (url.pathname === '' || url.pathname === '/');
  } catch {
    return false;
  }
}

// Asks the payments-create Edge Function to open a PayMongo Checkout Session.
// The client chooses only a supported payment purpose. The amount is resolved
// server-side from the reservation and paid ledger, so it cannot be tampered with.
export async function startReservationPayment(
  reservationId: string,
  purpose: PaymentPurpose,
): Promise<StartedPayment> {
  const { data, error } = await supabase.functions.invoke('payments-create', {
    body: { reservation_id: reservationId, purpose, platform: Platform.OS },
  });

  if (error) {
    let message = error.message;
    try {
      if ('context' in error && error.context && typeof error.context.json === 'function') {
        const errorBody = await error.context.json();
        if (errorBody?.error && typeof errorBody.error === 'string') {
          message = errorBody.error;
        }
      }
    } catch {
      // Keep original error message if context body cannot be read
    }
    throw new Error(message || 'Could not start the payment.');
  }
  if (!data?.checkout_url || !data?.payment_id) {
    throw new Error(data?.error || 'Could not start the payment.');
  }

  return { paymentId: data.payment_id, checkoutUrl: data.checkout_url };
}

// The webhook is what settles a payment, so the client can only observe. Reading
// the row is the honest check -- returning from the checkout page proves nothing
// about whether the money moved.
export async function getPaymentStatus(paymentId: string): Promise<PaymentStatus | null> {
  const { data, error } = await supabase
    .from('payments')
    .select('status')
    .eq('id', paymentId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Could not confirm the payment status.');
  return (data?.status as PaymentStatus) ?? null;
}

export async function submitReservationBalanceReceipt(params: {
  reservationId: string;
  receiptPath: string;
  method: 'gcash' | 'bank_transfer';
  amountClaimed: number;
  referenceNumber: string;
}): Promise<any> {
  const { data, error } = await supabase.rpc('submit_reservation_balance_receipt' as any, {
    _reservation_id: params.reservationId,
    _receipt_path: params.receiptPath,
    _method: params.method,
    _amount_claimed: params.amountClaimed,
    _reference_number: params.referenceNumber.trim(),
  });

  if (error) {
    throw new Error(error.message || 'Could not submit balance receipt.');
  }

  return data;
}

