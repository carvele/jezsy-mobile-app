import { supabase } from '@/src/lib/supabase';

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

// Asks the payments-create Edge Function to open a PayMongo Checkout Session.
// Deliberately sends only the reservation id: the amount is resolved server-side
// from reservations.deposit, so a tampered client cannot choose what it pays.
export async function startReservationPayment(reservationId: string): Promise<StartedPayment> {
  const { data, error } = await supabase.functions.invoke('payments-create', {
    body: { reservation_id: reservationId },
  });

  if (error) throw new Error(error.message || 'Could not start the payment.');
  if (!data?.checkout_url || !data?.payment_id) {
    throw new Error(data?.error || 'Could not start the payment.');
  }

  return { paymentId: data.payment_id, checkoutUrl: data.checkout_url };
}

// PayMongo's return URL carries no payment id, so the deep-link screen has to
// find the attempt it just came back from. Newest row for this customer is
// that attempt: payments-create reuses an open session rather than stacking
// them, so a customer cannot have two in flight at once.
export async function getLatestPayment(): Promise<{ id: string; status: PaymentStatus } | null> {
  const { data } = await supabase
    .from('payments' as any)
    .select('id, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { id: (data as any).id, status: (data as any).status as PaymentStatus };
}

// The webhook is what settles a payment, so the client can only observe. Reading
// the row is the honest check -- returning from the checkout page proves nothing
// about whether the money moved.
export async function getPaymentStatus(paymentId: string): Promise<PaymentStatus | null> {
  const { data } = await supabase
    .from('payments' as any)
    .select('status')
    .eq('id', paymentId)
    .maybeSingle();

  return ((data as any)?.status as PaymentStatus) ?? null;
}
