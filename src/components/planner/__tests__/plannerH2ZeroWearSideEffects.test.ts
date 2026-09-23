import { supabase } from '@/src/lib/supabase';
import {
  createPlannedOutfit,
  reschedulePlannedOutfit,
  updatePlannedOutfitMetadata,
  cancelPlannedOutfit,
  getPlannedOutfitsRange,
} from '@/src/services/plannerService';
import { styleDnaSyncManager } from '@/src/services/styling/styleDnaSyncManager';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test_user_wear_check' } },
        error: null,
      }),
    },
  },
}));

jest.mock('@/src/services/styling/styleDnaSyncManager', () => ({
  styleDnaSyncManager: {
    recordWearOutfit: jest.fn(),
    recordEvent: jest.fn(),
  },
}));

describe('Phase H2 Invariant: Zero Wear Side Effects', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createPlannedOutfit produces exactly zero wear mutations and zero Style DNA wear events', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 'plan_zero_wear_1',
        user_id: 'test_user_wear_check',
        planned_date: '2026-09-24',
        slot: 'evening',
        status: 'planned',
        source_type: 'saved_outfit',
        source_ref_id: 'outfit_1',
        plan_timezone: 'Asia/Manila',
        notes: null,
        climate_context: null,
        items: [],
        created_at: '2026-09-24T00:00:00Z',
        updated_at: '2026-09-24T00:00:00Z',
        revision: 1,
      },
      error: null,
    });

    const result = await createPlannedOutfit({
      plannedDate: '2026-09-24',
      slot: 'evening',
      sourceType: 'saved_outfit',
      sourceRefId: 'outfit_1',
      planTimezone: 'Asia/Manila',
      items: [
        {
          id: 'item_1',
          name: 'Top Shirt',
          category: 'Top',
          image_url: 'https://example.com/top.png',
        },
      ],
    });

    expect(result.ok).toBe(true);
    // RPC called is solely create_planned_outfit
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('create_planned_outfit', expect.any(Object));

    // Zero record_item_wear calls
    expect(supabase.rpc).not.toHaveBeenCalledWith('record_item_wear', expect.any(Object));

    // Zero direct table mutations (from())
    expect(supabase.from).not.toHaveBeenCalled();

    // Zero Style DNA wear events
    expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordEvent).not.toHaveBeenCalled();
  });

  it('reschedulePlannedOutfit produces exactly zero wear mutations and zero Style DNA wear events', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 'plan_zero_wear_1',
        user_id: 'test_user_wear_check',
        planned_date: '2026-09-25',
        slot: 'day',
        status: 'planned',
        source_type: 'saved_outfit',
        source_ref_id: 'outfit_1',
        plan_timezone: 'Asia/Manila',
        notes: null,
        climate_context: null,
        items: [],
        created_at: '2026-09-24T00:00:00Z',
        updated_at: '2026-09-24T00:00:00Z',
        revision: 2,
      },
      error: null,
    });

    const result = await reschedulePlannedOutfit({
      planId: 'plan_zero_wear_1',
      expectedRevision: 1,
      newDate: '2026-09-25',
      newSlot: 'day',
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('reschedule_planned_outfit', expect.any(Object));

    expect(supabase.rpc).not.toHaveBeenCalledWith('record_item_wear', expect.any(Object));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordEvent).not.toHaveBeenCalled();
  });

  it('updatePlannedOutfitMetadata produces exactly zero wear mutations and zero Style DNA wear events', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 'plan_zero_wear_1',
        user_id: 'test_user_wear_check',
        planned_date: '2026-09-25',
        slot: 'day',
        status: 'planned',
        source_type: 'saved_outfit',
        source_ref_id: 'outfit_1',
        plan_timezone: 'Asia/Manila',
        notes: 'Updated notes only',
        climate_context: null,
        items: [],
        created_at: '2026-09-24T00:00:00Z',
        updated_at: '2026-09-24T00:00:00Z',
        revision: 3,
      },
      error: null,
    });

    const result = await updatePlannedOutfitMetadata({
      planId: 'plan_zero_wear_1',
      expectedRevision: 2,
      notes: 'Updated notes only',
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('update_planned_outfit_metadata', expect.any(Object));

    expect(supabase.rpc).not.toHaveBeenCalledWith('record_item_wear', expect.any(Object));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordEvent).not.toHaveBeenCalled();
  });

  it('cancelPlannedOutfit produces exactly zero wear mutations and zero Style DNA wear events', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 'plan_zero_wear_1',
        user_id: 'test_user_wear_check',
        planned_date: '2026-09-25',
        slot: 'day',
        status: 'cancelled',
        source_type: 'saved_outfit',
        source_ref_id: 'outfit_1',
        plan_timezone: 'Asia/Manila',
        notes: null,
        climate_context: null,
        items: [],
        created_at: '2026-09-24T00:00:00Z',
        updated_at: '2026-09-24T00:00:00Z',
        revision: 4,
      },
      error: null,
    });

    const result = await cancelPlannedOutfit('plan_zero_wear_1', 3);

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('cancel_planned_outfit', expect.any(Object));

    expect(supabase.rpc).not.toHaveBeenCalledWith('record_item_wear', expect.any(Object));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordEvent).not.toHaveBeenCalled();
  });

  it('getPlannedOutfitsRange produces zero wear mutations and zero Style DNA wear events', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const result = await getPlannedOutfitsRange('2026-09-20', '2026-09-27');
    expect(result.ok).toBe(true);

    expect(supabase.rpc).toHaveBeenCalledWith('get_planned_outfits_range', expect.any(Object));
    expect(supabase.rpc).not.toHaveBeenCalledWith('record_item_wear', expect.any(Object));
    expect(supabase.from).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordWearOutfit).not.toHaveBeenCalled();
    expect(styleDnaSyncManager.recordEvent).not.toHaveBeenCalled();
  });
});
