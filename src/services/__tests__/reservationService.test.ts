import { reservationService, getMyUnratedItems } from '../reservationService';
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

    it('successfully reserves an item with canonical inventory_id and preserved size', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: {
          display_id: 'RES-2026-002',
          rental_price: 99,
          idempotency_key: '550e8400-e29b-41d4-a716-446655440001',
          items: [
            {
              product_id: 'af0e3580-f2ec-452b-b3fb-2ffda346fba0',
              size: 'One Size',
              color: 'Pink',
              quantity: 1,
              inventory_id: '1e309178-2afd-42f4-9218-24ad753c1fba',
            },
          ],
        },
        error: null,
      });

      const result = await reservationService.reserve({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
        items: [
          {
            product_id: 'af0e3580-f2ec-452b-b3fb-2ffda346fba0',
            size: 'One Size',
            color: 'Pink',
            quantity: 1,
            inventory_id: '1e309178-2afd-42f4-9218-24ad753c1fba',
          },
        ],
        date: null,
        appointmentTime: null,
        paymentOption: 'deposit',
        pickupTermsVersion: 'v2026-09-pickup',
      });

      expect(supabase.rpc).toHaveBeenCalledWith('create_reservation_multi_idempotent', {
        _idempotency_key: '550e8400-e29b-41d4-a716-446655440001',
        _items: [
          {
            product_id: 'af0e3580-f2ec-452b-b3fb-2ffda346fba0',
            size: 'One Size',
            color: 'Pink',
            quantity: 1,
            inventory_id: '1e309178-2afd-42f4-9218-24ad753c1fba',
          },
        ],
        _date: null,
        _appointment_time: null,
        _receipt_path: undefined,
        _payment_option: 'deposit',
        _customer_id: undefined,
        _pickup_terms_version: 'v2026-09-pickup',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.display_id).toBe('RES-2026-002');
        expect(result.data.rental_price).toBe(99);
      }
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

  describe('getMyUnratedItems', () => {
    it('returns unrated items sorted with the latest order on top', async () => {
      const mockItemsData = [
        {
          id: 'item-old',
          reservation_id: 'res-old',
          product_id: 'prod-old',
          product_name: 'Old Dress',
          image_url: 'https://example.com/old.jpg',
          size: 'M',
          color: 'Red',
          created_at: '2026-09-01T10:00:00Z',
          reservations: {
            display_id: 'RES-001',
            date: '2026-09-01',
            created_at: '2026-09-01T10:00:00Z',
            completed_at: '2026-09-02T12:00:00Z',
            customer_id: 'user-1',
            status: 'completed',
            deleted: false,
          },
        },
        {
          id: 'item-new',
          reservation_id: 'res-new',
          product_id: 'prod-new',
          product_name: 'New Gown',
          image_url: 'https://example.com/new.jpg',
          size: 'L',
          color: 'Blue',
          created_at: '2026-09-20T15:00:00Z',
          reservations: {
            display_id: 'RES-002',
            date: '2026-09-20',
            created_at: '2026-09-20T15:00:00Z',
            completed_at: '2026-09-21T09:00:00Z',
            customer_id: 'user-1',
            status: 'completed',
            deleted: false,
          },
        },
        {
          id: 'item-reviewed',
          reservation_id: 'res-rev',
          product_id: 'prod-rev',
          product_name: 'Reviewed Item',
          image_url: null,
          size: 'S',
          color: 'Black',
          created_at: '2026-09-21T11:00:00Z',
          reservations: {
            display_id: 'RES-003',
            date: '2026-09-21',
            created_at: '2026-09-21T11:00:00Z',
            completed_at: '2026-09-21T11:30:00Z',
            customer_id: 'user-1',
            status: 'completed',
            deleted: false,
          },
        },
      ];

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'reservation_items') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: mockItemsData, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'reviews') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ reservation_item_id: 'item-reviewed', product_id: 'prod-rev' }],
                error: null,
              }),
            }),
          };
        }
        return {};
      });

      const unrated = await getMyUnratedItems('user-1');

      expect(unrated).toHaveLength(2);
      // Newest order completed_at (2026-09-21T09:00:00Z) should be first
      expect(unrated[0].reservationItemId).toBe('item-new');
      expect(unrated[0].displayId).toBe('RES-002');
      // Older order completed_at (2026-09-02T12:00:00Z) should be second
      expect(unrated[1].reservationItemId).toBe('item-old');
      expect(unrated[1].displayId).toBe('RES-001');
    });
  });
});
