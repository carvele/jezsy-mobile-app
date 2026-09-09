export type CheckoutDecision =
  | { kind: 'reuse'; checkoutUrl: string }
  | { kind: 'paid' }
  | { kind: 'inactive' }
  | { kind: 'amount_changed' }
  | { kind: 'invalid' };

export function decideExistingCheckout(input: {
  providerStatus?: string;
  paymentStatuses?: string[];
  storedAmount: number;
  requestedAmount: number;
  checkoutUrl?: string;
}): CheckoutDecision {
  if (input.providerStatus === 'completed' || input.paymentStatuses?.includes('paid')) {
    return { kind: 'paid' };
  }
  if (input.providerStatus !== 'active') return { kind: 'inactive' };
  if (input.storedAmount !== input.requestedAmount) return { kind: 'amount_changed' };
  if (!input.checkoutUrl) return { kind: 'invalid' };
  return { kind: 'reuse', checkoutUrl: input.checkoutUrl };
}
