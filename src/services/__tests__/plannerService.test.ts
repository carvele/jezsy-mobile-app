import {
  createPlannedOutfit,
  updatePlannedOutfitMetadata,
  reschedulePlannedOutfit,
  confirmPlannedOutfitWorn,
  skipPlannedOutfit,
  cancelPlannedOutfit,
  getPlannedOutfitsRange,
} from '../plannerService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';
import { styleDnaSyncManager } from '../styling/styleDnaSyncManager';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

jest.mock('../styling/styleDnaSyncManager', () => ({
  styleDnaSyncManager: {
    recordWearOutfit: jest.fn().mockResolvedValue({}),
  },
}));

describe('plannerService (Phase H1 Core)', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    captureSpy = jest.spyOn(errorReporting, 'capture').mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  const validSnapshotItems = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Navy Blazer',
      category: 'Outerwear',
      sub_category: 'Blazer',
      color_tags: ['navy'],
      image_url: 'https://example.com/blazer.jpg',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'White Shirt',
      category: 'Top',
      sub_category: 'Shirt',
      color_tags: ['white'],
      image_url: 'https://example.com/shirt.jpg',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Grey Chinos',
      category: 'Bottom',
      sub_category: 'Chinos',
      color_tags: ['grey'],
      image_url: 'https://example.com/chinos.jpg',
    },
  ];

  describe('createPlannedOutfit', () => {
    it('creates a planned outfit via canonical RPC', async () => {
      const mockPlan = {
        id: 'plan-123',
        user_id: 'user-abc',
        planned_date: '2026-10-01',
        slot: 'all_day',
        plan_timezone: 'Asia/Manila',
        items: validSnapshotItems,
        occasion: 'Work',
        climate_context: ['Sunny'],
        notes: 'Client presentation',
        status: 'planned',
        revision: 1,
      };

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockPlan, error: null });

      const result = await createPlannedOutfit({
        plannedDate: '2026-10-01',
        slot: 'all_day',
        planTimezone: 'Asia/Manila',
        items: validSnapshotItems,
        occasion: 'Work',
        climateContext: ['Sunny'],
        notes: 'Client presentation',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('plan-123');
        expect(result.data.status).toBe('planned');
        expect(result.data.revision).toBe(1);
      }

      expect(supabase.rpc).toHaveBeenCalledWith('create_planned_outfit', {
        p_planned_date: '2026-10-01',
        p_slot: 'all_day',
        p_plan_timezone: 'Asia/Manila',
        p_items: validSnapshotItems,
        p_occasion: 'Work',
        p_climate_context: ['Sunny'],
        p_notes: 'Client presentation',
        p_saved_outfit_id: null,
        p_source_type: 'manual',
        p_source_ref_id: null,
      });
    });

    it('handles slot collision error from database RPC', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'Slot collision: an active plan already exists for this date.' },
      });

      const result = await createPlannedOutfit({
        plannedDate: '2026-10-01',
        slot: 'all_day',
        planTimezone: 'Asia/Manila',
        items: validSnapshotItems,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('P0001');
        expect(result.error.message).toContain('Slot collision');
      }
      expect(captureSpy).toHaveBeenCalled();
    });

    it('handles invalid timezone rejection', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'Invalid timezone: Fake/Timezone is not a recognized IANA timezone.' },
      });

      const result = await createPlannedOutfit({
        plannedDate: '2026-10-01',
        slot: 'all_day',
        planTimezone: 'Fake/Timezone',
        items: validSnapshotItems,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid timezone');
      }
    });
  });

  describe('updatePlannedOutfitMetadata', () => {
    it('updates metadata with expected revision check', async () => {
      const mockUpdated = {
        id: 'plan-123',
        slot: 'evening',
        notes: 'Updated dinner plan',
        revision: 2,
      };

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockUpdated, error: null });

      const result = await updatePlannedOutfitMetadata({
        planId: 'plan-123',
        expectedRevision: 1,
        slot: 'evening',
        notes: 'Updated dinner plan',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.revision).toBe(2);
        expect(result.data.slot).toBe('evening');
      }

      expect(supabase.rpc).toHaveBeenCalledWith('update_planned_outfit_metadata', {
        p_plan_id: 'plan-123',
        p_expected_revision: 1,
        p_slot: 'evening',
        p_notes: 'Updated dinner plan',
        p_climate_context: null,
      });
    });

    it('rejects stale revision with OCC conflict', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'OCC_CONFLICT: plan was modified concurrently' },
      });

      const result = await updatePlannedOutfitMetadata({
        planId: 'plan-123',
        expectedRevision: 1,
        notes: 'Conflicting update',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('OCC_CONFLICT');
      }
    });
  });

  describe('reschedulePlannedOutfit', () => {
    it('reschedules a plan to a new date and increments revision', async () => {
      const mockRescheduled = {
        id: 'plan-123',
        planned_date: '2026-10-05',
        slot: 'day',
        revision: 3,
        status: 'planned',
      };

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockRescheduled, error: null });

      const result = await reschedulePlannedOutfit({
        planId: 'plan-123',
        expectedRevision: 2,
        newDate: '2026-10-05',
        newSlot: 'day',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.planned_date).toBe('2026-10-05');
        expect(result.data.slot).toBe('day');
        expect(result.data.revision).toBe(3);
      }
    });
  });

  describe('confirmPlannedOutfitWorn', () => {
    it('confirms wear, stamps effective wear time, and enqueues Style DNA telemetry', async () => {
      const mockWearResult = {
        plan_id: 'plan-123',
        saved_outfit_id: 'saved-456',
        item_ids: [
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
        ],
        worn_items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Navy Blazer',
            category: 'Outerwear',
            color_tags: ['navy'],
          },
          {
            id: '22222222-2222-2222-2222-222222222222',
            name: 'White Shirt',
            category: 'Top',
            color_tags: ['white'],
          },
        ],
        occasion: 'Work',
        effective_wear_at: '2026-09-23T04:00:00.000Z',
        confirmed_at: '2026-09-24T01:30:00.000Z',
        new_revision: 2,
      };

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockWearResult, error: null });

      const result = await confirmPlannedOutfitWorn('user-abc', 'plan-123', 1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.new_revision).toBe(2);
        expect(result.data.item_ids).toHaveLength(2);
        expect(result.data.effective_wear_at).toBe('2026-09-23T04:00:00.000Z');
      }

      expect(styleDnaSyncManager.recordWearOutfit).toHaveBeenCalledWith(
        'user-abc',
        'saved-456',
        mockWearResult.item_ids,
        expect.objectContaining({
          palette: expect.arrayContaining(['navy', 'white']),
          formality: ['Work'],
        }),
        '2026-09-23T04:00:00.000Z'
      );
    });

    it('rejects confirmation for future planned dates', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: 'P0002', message: 'Cannot confirm wear for future planned date' },
      });

      const result = await confirmPlannedOutfitWorn('user-abc', 'plan-future', 1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('P0002');
        expect(result.error.message).toContain('future planned date');
      }
      expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    });

    it('enforces REPAIR_REQUIRED when snapshot items are deleted or unavailable', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: {
          code: 'P0003',
          message: 'REPAIR_REQUIRED: One or more garments in this look have been deleted or are unavailable.',
        },
      });

      const result = await confirmPlannedOutfitWorn('user-abc', 'plan-deleted-item', 1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('P0003');
        expect(result.error.message).toContain('REPAIR_REQUIRED');
      }
      expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    });

    it('rejects confirming already worn, skipped, or cancelled plans (terminal state invariant)', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'Invalid transition: cannot confirm wear from status cancelled' },
      });

      const result = await confirmPlannedOutfitWorn('user-abc', 'plan-cancelled', 1);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid transition');
      }
    });
  });

  describe('skipPlannedOutfit', () => {
    it('marks an active plan as skipped', async () => {
      const mockSkipped = {
        id: 'plan-123',
        status: 'skipped',
        revision: 2,
      };

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockSkipped, error: null });

      const result = await skipPlannedOutfit('plan-123', 1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('skipped');
        expect(result.data.revision).toBe(2);
      }
      expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    });
  });

  describe('cancelPlannedOutfit', () => {
    it('cancels a plan preserving historical row', async () => {
      const mockCancelled = {
        id: 'plan-123',
        status: 'cancelled',
        revision: 2,
      };

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockCancelled, error: null });

      const result = await cancelPlannedOutfit('plan-123', 1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe('cancelled');
        expect(result.data.revision).toBe(2);
      }
    });
  });

  describe('getPlannedOutfitsRange', () => {
    it('fetches planned outfits in range and handles lazy unconfirmed reconciliation', async () => {
      const mockPlans = [
        {
          id: 'plan-old',
          planned_date: '2026-09-20',
          status: 'unconfirmed',
          revision: 2,
        },
        {
          id: 'plan-current',
          planned_date: '2026-09-24',
          status: 'planned',
          revision: 1,
        },
      ];

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockPlans, error: null });

      const result = await getPlannedOutfitsRange('2026-09-20', '2026-09-26');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].status).toBe('unconfirmed');
        expect(result.data[1].status).toBe('planned');
      }

      expect(supabase.rpc).toHaveBeenCalledWith('get_planned_outfits_range', {
        p_start_date: '2026-09-20',
        p_end_date: '2026-09-26',
      });
    });
  });
});
