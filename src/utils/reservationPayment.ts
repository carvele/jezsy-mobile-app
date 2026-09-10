export const PAYMENT_PURPOSES = [
  'initial_deposit',
  'full_payment',
  'remaining_balance',
] as const;

export type PaymentPurpose = typeof PAYMENT_PURPOSES[number];

export function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return typeof value === 'string' && PAYMENT_PURPOSES.includes(value as PaymentPurpose);
}

export function paymentAmountCentavos(input: {
  purpose: PaymentPurpose;
  depositPesos: number;
  totalPesos: number;
  paidCentavos: number;
}): number {
  const deposit = Math.round(input.depositPesos * 100);
  const total = Math.round(input.totalPesos * 100);

  if (input.purpose === 'initial_deposit') return deposit;
  if (input.purpose === 'full_payment') return total;
  return Math.max(0, total - input.paidCentavos);
}

export function paymentPurposeLabel(purpose: PaymentPurpose): string {
  if (purpose === 'full_payment') return 'Full payment for';
  if (purpose === 'remaining_balance') return 'Remaining balance for';
  return 'Reservation payment for';
}
