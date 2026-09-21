import { outfitService, outfitSignature } from '../outfitService';
import { outfitFeedbackService } from '../outfitFeedbackService';
import { supabase } from '@/src/lib/supabase';
import { describeWearLogResult } from '../../utils/wearLog';
import { runStylistRequest } from '../../utils/stylistRun';
import { SupabaseEdgeAIStylistProvider, resetAIStylistProviderState } from '../aiStylistProvider';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

const ID_A = '11111111-1111-4111-8111-111111111111';

function lookupChain(rows: unknown[] | null, error: unknown = null) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order']) chain[m] = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue({ data: rows, error });
  return chain;
}

function insertChain(id: string) {
  const chain: any = {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { id }, error: null }),
  };
  return chain;
}

describe('Send to Mannequin / Save do not create duplicate outfits', () => {
  const items = [
    { slot: 'top', name: 'Shirt', wardrobe_item_id: 'w-1' },
    { slot: 'bottom', name: 'Jeans', wardrobe_item_id: 'w-2' },
  ];

  beforeEach(() => jest.clearAllMocks());

  test('the signature ignores order and presentation fields', () => {
    expect(outfitSignature(items)).toBe(outfitSignature([...items].reverse()));
    expect(outfitSignature(items)).not.toBe(outfitSignature([items[0]]));
  });

  test('an existing look with the same items is reused and nothing is inserted', async () => {
    const lookup = lookupChain([
      { id: 'other', items: [{ wardrobe_item_id: 'w-9' }] },
      { id: 'existing-look', items: [...items].reverse() },
    ]);
    (supabase.from as jest.Mock).mockReturnValue(lookup);

    const result = await outfitService.saveOutfitOnce({ userId: 'user-1', name: 'Work look', items });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 'existing-look', reused: true });
    expect(lookup.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(lookup.eq).toHaveBeenCalledWith('deleted', false);
    expect((supabase.from as jest.Mock).mock.calls.filter(([t]) => t === 'saved_outfits')).toHaveLength(1);
  });

  test('tapping twice creates exactly one outfit', async () => {
    const stored: any[] = [];
    (supabase.from as jest.Mock).mockImplementation(() => {
      const chain: any = {};
      for (const m of ['select', 'eq', 'order']) chain[m] = jest.fn().mockReturnValue(chain);
      chain.limit = jest.fn().mockImplementation(async () => ({ data: [...stored], error: null }));
      chain.insert = jest.fn().mockImplementation((row: any) => {
        stored.push({ id: `outfit-${stored.length + 1}`, items: row.items });
        return chain;
      });
      chain.single = jest.fn().mockImplementation(async () => ({ data: { id: stored[stored.length - 1].id }, error: null }));
      return chain;
    });

    const first = await outfitService.saveOutfitOnce({ userId: 'user-1', name: 'Work look', items });
    const second = await outfitService.saveOutfitOnce({ userId: 'user-1', name: 'Work look', items });

    expect(stored).toHaveLength(1);
    expect(first.ok && second.ok && first.data.id === second.data.id).toBe(true);
    if (second.ok) expect(second.data.reused).toBe(true);
  });

  test('a different set of items is saved as a new outfit', async () => {
    const lookup = lookupChain([{ id: 'existing', items: [{ wardrobe_item_id: 'w-1' }] }]);
    const insert = insertChain('new-look');
    (supabase.from as jest.Mock).mockReturnValueOnce(lookup).mockReturnValueOnce(insert);

    const result = await outfitService.saveOutfitOnce({ userId: 'user-1', name: 'Work look', items });
    expect(result.ok && result.data).toEqual({ id: 'new-look', reused: false });
    expect(insert.insert).toHaveBeenCalledTimes(1);
  });

  test('a failed lookup does not block saving', async () => {
    const lookup = lookupChain(null, { message: 'network' });
    const insert = insertChain('new-look');
    (supabase.from as jest.Mock).mockReturnValueOnce(lookup).mockReturnValueOnce(insert);

    const result = await outfitService.saveOutfitOnce({ userId: 'user-1', name: 'Work look', items });
    expect(result.ok).toBe(true);
    expect(insert.insert).toHaveBeenCalledTimes(1);
  });
});

describe('wear log feedback never claims success it did not get', () => {
  test('all recorded', () => {
    const s = describeWearLogResult({ succeeded: ['a', 'b'], failed: [] }, 2);
    expect(s).toMatchObject({ recorded: true, kind: 'success' });
    expect(s.message).toMatch(/recorded as worn/i);
  });

  test('every RPC failed: an error, and no "Recorded as worn!"', () => {
    const s = describeWearLogResult({ succeeded: [], failed: ['a', 'b'] }, 2);
    expect(s).toMatchObject({ recorded: false, kind: 'error' });
    expect(s.message).not.toMatch(/recorded as worn/i);
  });

  test('partial failure is reported as partial', () => {
    const s = describeWearLogResult({ succeeded: ['a'], failed: ['b'] }, 2);
    expect(s).toMatchObject({ recorded: true, kind: 'info' });
    expect(s.message).toMatch(/1 of 2/);
  });

  test('an empty outfit records nothing', () => {
    expect(describeWearLogResult({ succeeded: [], failed: [] }, 0).recorded).toBe(false);
  });
});

describe('dead outfit_feedback insert is gone', () => {
  test('logging feedback never touches the database', async () => {
    (supabase.from as jest.Mock).mockClear();
    await outfitFeedbackService.logFeedback({ userId: 'user-1', feedbackType: 'worn' } as any, []);
    await outfitFeedbackService.logFeedback({ userId: 'user-1', feedbackType: 'rejected', wardrobeItemIds: ['a'] } as any, []);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('Mannequin confirm handling', () => {
  function callbacks(run: (isCurrent: () => boolean) => Promise<any>) {
    return {
      onStart: jest.fn(),
      run,
      onSuccess: jest.fn(),
      onError: jest.fn(),
      onSettled: jest.fn(),
    };
  }

  test('a failing analysis reports an error, settles, and never opens the critique', async () => {
    const cb = callbacks(async () => {
      throw new Error('boom');
    });
    await expect(runStylistRequest({ current: 0 }, cb)).resolves.toBeUndefined();
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onSuccess).not.toHaveBeenCalled();
    expect(cb.onSettled).toHaveBeenCalledTimes(1);
  });

  test('success delivers the result', async () => {
    const cb = callbacks(async () => 'critique');
    await runStylistRequest({ current: 0 }, cb);
    expect(cb.onSuccess).toHaveBeenCalledWith('critique');
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onSettled).toHaveBeenCalled();
  });

  test('a cancelled or superseded request stays silent, even when it later fails', async () => {
    const ref = { current: 0 };
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cb = callbacks(async () => {
      await gate;
      throw new Error('late failure');
    });
    const pending = runStylistRequest(ref, cb);
    ref.current += 1; // the user cancelled, or started another request
    release();
    await pending;
    expect(cb.onError).not.toHaveBeenCalled();
    expect(cb.onSuccess).not.toHaveBeenCalled();
    expect(cb.onSettled).not.toHaveBeenCalled();
  });

  test('returning undefined abandons the run without touching the UI', async () => {
    const cb = callbacks(async () => undefined);
    await runStylistRequest({ current: 0 }, cb);
    expect(cb.onSuccess).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
  });
});

describe('SupabaseEdgeAIStylistProvider', () => {
  const packet: any = {
    request: { analysisId: 'a', rawContext: 'Wedding', structuredContext: { rawOccasion: 'Wedding', rawAdditionalContext: '' } },
    outfit: { items: [] },
  };
  const invoke = () => supabase.functions.invoke as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetAIStylistProviderState();
  });

  test('a server "no LLM configured" answer is remembered so later critiques skip the network call', async () => {
    invoke().mockResolvedValue({ data: { success: false, fallbackRequired: true, reason: 'LLM_MODEL_NOT_CONFIGURED' }, error: null });
    const provider = new SupabaseEdgeAIStylistProvider();

    const first = await provider.analyze(packet);
    const second = await provider.analyze(packet);

    expect(first).toMatchObject({ success: false, analysisMode: 'ruleBasedFallback', fallbackReason: 'LLM_MODEL_NOT_CONFIGURED' });
    expect(second.success).toBe(false);
    expect(invoke()).toHaveBeenCalledTimes(1);
  });

  test('a rejected (401) call is reported honestly and is not cached as "not configured"', async () => {
    invoke().mockResolvedValue({ data: null, error: { message: 'non-2xx', context: { status: 401 } } });
    const provider = new SupabaseEdgeAIStylistProvider();
    const res = await provider.analyze(packet);
    expect(res.analysisMode).toBe('ruleBasedFallback');
    expect(res.fallbackReason).toMatch(/sign in/i);
    await provider.analyze(packet);
    expect(invoke()).toHaveBeenCalledTimes(2);
  });

  test('a malformed server payload becomes a rule-based fallback, never a hybrid result', async () => {
    invoke().mockResolvedValue({ data: { success: true, data: { assessment: { evil: true } } }, error: null });
    const res = await new SupabaseEdgeAIStylistProvider().analyze(packet);
    expect(res.success).toBe(false);
    expect(res.analysisMode).toBe('ruleBasedFallback');
    expect(res.fallbackReason).toMatch(/Validation failed/);
  });

  test('a thrown network error becomes a fallback', async () => {
    invoke().mockRejectedValue(new Error('offline'));
    const res = await new SupabaseEdgeAIStylistProvider().analyze(packet);
    expect(res.success).toBe(false);
    expect(res.analysisMode).toBe('ruleBasedFallback');
  });

  test('a valid response is labelled hybridLLM with the real provider and model', async () => {
    invoke().mockResolvedValue({
      data: {
        success: true,
        provider: 'openrouter',
        model: 'vendor/model-x:free',
        data: {
          assessment: 'Not appropriate for this occasion',
          headline: 'Shorts do not suit a wedding',
          whyJezsySaysThis: 'Running shorts clash with the formal wedding dress code of the day.',
          stylistTake: 'Swap the shorts for tailored trousers.',
          improvements: [{ reason: 'Use trousers', existingWardrobeItemIds: [ID_A, '99999999-9999-4999-8999-999999999999'] }],
        },
      },
      error: null,
    });
    const res = await new SupabaseEdgeAIStylistProvider().analyze(packet, { [ID_A]: { id: ID_A } as any });
    expect(res).toMatchObject({ success: true, analysisMode: 'hybridLLM', provider: 'openrouter', model: 'vendor/model-x:free' });
    expect(res.data?.improvements?.[0].existingWardrobeItemIds).toEqual([ID_A]);
  });
});
