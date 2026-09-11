import { reservationService } from '../reservationService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

describe('reservationService', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    captureSpy = jest.spyOn(errorReporting, 'capture').mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  describe('reserve', () => {
    it('successfully calls create_reservation_multi_idempotent RPC and returns result', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: {
          display_id: 'RES-2026-001',
          rental_price: 1500,
          idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
        },
        error: null,
      });

      const result = await reservationService.reserve({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        items: [{ product_id: 'prod-1', size: 'M', color: 'Blue', quantity: 1 }],
        date: '2026-09-15',
        appointmentTime: '14:00',
        paymentOption: 'deposit',
      });

      expect(supabase.rpc).toHaveBeenCalledWith('create_reservation_multi_idempotent', {
        _idempotency_key: '550e8400-e29b-41d4-a716-446655440000',
        _items: [{ product_id: 'prod-1', size: 'M', color: 'Blue', quantity: 1 }],
        _date: '2026-09-15',
        _appointment_time: '14:00',
        _receipt_path: undefined,
        _payment_option: 'deposit',
        _customer_id: undefined,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.display_id).toBe('RES-2026-001');
        expect(result.data.rental_price).toBe(1500);
      }
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('maps authentication required error to ERR_AUTH_REQUIRED', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Authentication required.' },
      });

      const result = await reservationService.reserve({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        items: [{ product_id: 'prod-1', size: 'M', color: 'Blue', quantity: 1 }],
        date: '2026-09-15',
        appointmentTime: '14:00',
        paymentOption: 'deposit',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_AUTH_REQUIRED');
      }
      expect(captureSpy).toHaveBeenCalled();
    });

    it('maps idempotency reuse error to ERR_IDEMPOTENCY_CONFLICT', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Idempotency key reuse with different reservation details.' },
      });

      const result = await reservationService.reserve({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        items: [{ product_id: 'prod-1', size: 'M', color: 'Blue', quantity: 1 }],
        date: '2026-09-15',
        appointmentTime: '14:00',
        paymentOption: 'deposit',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_IDEMPOTENCY_CONFLICT');
      }
      expect(captureSpy).toHaveBeenCalled();
    });

    it('maps invalid payment option error to ERR_INVALID_PAYMENT_OPTION', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Payment option must be deposit or full.' },
      });

      const result = await reservationService.reserve({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        items: [{ product_id: 'prod-1', size: 'M', color: 'Blue', quantity: 1 }],
        date: '2026-09-15',
        appointmentTime: '14:00',
        paymentOption: 'invalid',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_INVALID_PAYMENT_OPTION');
      }
      expect(captureSpy).toHaveBeenCalled();
    });
  });
});
