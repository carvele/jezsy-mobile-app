import { isAllowedCheckoutUrl, isPaymentReturnUrl } from '@/src/lib/payments';

describe('payment URL validation', () => {
  it('accepts only the PayMongo hosted checkout origin', () => {
    expect(isAllowedCheckoutUrl('https://checkout.paymongo.com/cs_test#fragment')).toBe(true);
    expect(isAllowedCheckoutUrl('http://checkout.paymongo.com/cs_test')).toBe(false);
    expect(isAllowedCheckoutUrl('https://checkout.paymongo.com.evil.example/cs_test')).toBe(false);
    expect(isAllowedCheckoutUrl('https://evil.example/payment')).toBe(false);
  });

  it('accepts only the app payment return route', () => {
    expect(isPaymentReturnUrl('jezsymobileapp://payment-return?payment_id=123')).toBe(true);
    expect(isPaymentReturnUrl('jezsymobileapp://other-route?payment_id=123')).toBe(false);
    expect(isPaymentReturnUrl('https://checkout.paymongo.com/payment-return')).toBe(false);
  });
});
