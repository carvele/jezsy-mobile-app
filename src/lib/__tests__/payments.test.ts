import { supabase } from '@/src/lib/supabase';
import {
  startReservationPayment,
  isAllowedCheckoutUrl,
  isPaymentReturnUrl,
} from '../payments';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
    from: jest.fn(),
  },
}));

describe('payments client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isAllowedCheckoutUrl', () => {
    it('allows valid paymongo checkout urls', () => {
      expect(isAllowedCheckoutUrl('https://checkout.paymongo.com/cs_12345')).toBe(true);
    });

    it('rejects non-paymongo urls or non-https', () => {
      expect(isAllowedCheckoutUrl('http://checkout.paymongo.com/cs_12345')).toBe(false);
      expect(isAllowedCheckoutUrl('https://evil.com/cs_12345')).toBe(false);
      expect(isAllowedCheckoutUrl('not-a-url')).toBe(false);
    });
  });

  describe('isPaymentReturnUrl', () => {
    it('recognizes valid payment return urls', () => {
      expect(isPaymentReturnUrl('jezsymobileapp://payment-return?payment_id=123')).toBe(true);
      expect(isPaymentReturnUrl('jezsymobileapp://payment-return')).toBe(true);
    });

    it('rejects invalid schemes or hosts', () => {
      expect(isPaymentReturnUrl('https://example.com/payment-return')).toBe(false);
      expect(isPaymentReturnUrl('jezsymobileapp://other-path')).toBe(false);
    });
  });

  describe('startReservationPayment', () => {
    it('returns paymentId and checkoutUrl on success', () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
        data: { payment_id: 'pay_123', checkout_url: 'https://checkout.paymongo.com/cs_123' },
        error: null,
      });

      return expect(
        startReservationPayment('res_123', 'remaining_balance'),
      ).resolves.toEqual({
        paymentId: 'pay_123',
        checkoutUrl: 'https://checkout.paymongo.com/cs_123',
      });
    });

    it('extracts human-readable error from error.context when edge function fails', async () => {
      const mockError = {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: jest.fn().mockResolvedValue({
            error: 'An earlier payment is still active or processing. Please wait before trying again.',
          }),
        },
      };

      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: mockError,
      });

      await expect(
        startReservationPayment('res_123', 'remaining_balance'),
      ).rejects.toThrow('An earlier payment is still active or processing. Please wait before trying again.');
    });

    it('falls back to error.message if error.context.json() fails', async () => {
      const mockError = {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
        },
      };

      (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: mockError,
      });

      await expect(
        startReservationPayment('res_123', 'remaining_balance'),
      ).rejects.toThrow('Edge Function returned a non-2xx status code');
    });
  });
});
