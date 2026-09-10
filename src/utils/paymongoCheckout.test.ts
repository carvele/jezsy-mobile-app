import { decideExistingCheckout } from './paymongoCheckout';

describe('decideExistingCheckout', () => {
  const base = {
    storedAmount: 50000,
    requestedAmount: 50000,
    storedPurpose: 'initial_deposit',
    requestedPurpose: 'initial_deposit',
  };

  test('reuses an active session only when its amount and URL are valid', () => {
    expect(decideExistingCheckout({
      ...base,
      providerStatus: 'active',
      checkoutUrl: 'https://checkout.example/session',
    })).toEqual({ kind: 'reuse', checkoutUrl: 'https://checkout.example/session' });
  });

  test('blocks a completed or paid session while its webhook settles', () => {
    expect(decideExistingCheckout({ ...base, providerStatus: 'completed' })).toEqual({ kind: 'paid' });
    expect(decideExistingCheckout({ ...base, paymentStatuses: ['paid'] })).toEqual({ kind: 'paid' });
  });

  test('does not reuse an active session after the amount changes', () => {
    expect(decideExistingCheckout({
      ...base,
      providerStatus: 'active',
      requestedAmount: 60000,
      checkoutUrl: 'https://checkout.example/session',
    })).toEqual({ kind: 'amount_changed' });
  });

  test('does not reuse an active session for a different payment purpose', () => {
    expect(decideExistingCheckout({
      ...base,
      providerStatus: 'active',
      requestedPurpose: 'full_payment',
      checkoutUrl: 'https://checkout.example/session',
    })).toEqual({ kind: 'amount_changed' });
  });

  test('rejects an active session without a checkout URL', () => {
    expect(decideExistingCheckout({ ...base, providerStatus: 'active' })).toEqual({ kind: 'invalid' });
  });

  test('allows a fresh attempt only after the provider session is inactive', () => {
    expect(decideExistingCheckout({ ...base, providerStatus: 'expired' })).toEqual({ kind: 'inactive' });
  });
});
