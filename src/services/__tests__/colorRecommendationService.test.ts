import { getRecommendedColors } from '../colorRecommendationService';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

function makeQuery(result: any) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

function mockTables(tables: Record<string, any>) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (!(table in tables)) throw new Error(`unexpected table in test: ${table}`);
    return makeQuery(tables[table]);
  });
}

const inventoryRow = (color: string, size = 'M', available = 5) => ({
  id: `${color}-${size}`,
  color,
  size,
  available,
  deleted: false,
  hex_color: null,
});

describe('colorRecommendationService.getRecommendedColors', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renormalizes weights over active signals -- a preference-only user is not diluted by inactive signals', async () => {
    mockTables({
      inventory: { data: [inventoryRow('Navy'), inventoryRow('Red')] },
      user_color_profiles: {
        data: { undertone: 'unknown', preferred_colors: ['navy'], avoided_colors: [] },
      },
      wardrobe_items: { data: [] },
    });

    const { recommendations, personalizationMode } = await getRecommendedColors('user-1', 'product-1');

    expect(personalizationMode).toBe('partial'); // exactly one active signal
    const navy = recommendations.find((r) => r.colorKey === 'navy')!;
    const red = recommendations.find((r) => r.colorKey === 'red')!;

    // Only the preference signal is active (signalCount = 1), so the +25
    // preference bonus is divided by 1, not by 4 -- dividing by the full
    // signal set would give 50 + 25/4 = 56, not the correct 75.
    expect(navy.score).toBe(75);
    expect(navy.matchTier).toBe('Best Match');
    expect(red.score).toBe(50);
    expect(red.matchTier).toBe('Good Match');
  });

  it('is deterministic in generic mode: zero signals ties every color at baseline, breaking ties alphabetically', async () => {
    mockTables({
      inventory: {
        data: [inventoryRow('Red'), inventoryRow('Blue'), inventoryRow('Amber')],
      },
      user_color_profiles: { data: null },
      wardrobe_items: { data: [] },
    });

    const { recommendations, personalizationMode } = await getRecommendedColors('user-1', 'product-1');

    expect(personalizationMode).toBe('generic');
    expect(recommendations.every((r) => r.score === 50)).toBe(true);
    expect(recommendations.map((r) => r.colorKey)).toEqual(['amber', 'blue', 'red']);
  });

  it('applies the avoided-color penalty unconditionally, not diluted by renormalization', async () => {
    mockTables({
      inventory: { data: [inventoryRow('Neon Pink'), inventoryRow('Navy')] },
      user_color_profiles: {
        data: { undertone: 'unknown', preferred_colors: [], avoided_colors: ['neon pink'] },
      },
      wardrobe_items: { data: [] },
    });

    const { recommendations } = await getRecommendedColors('user-1', 'product-1');
    const avoided = recommendations.find((r) => r.colorKey === 'neon pink')!;
    const other = recommendations.find((r) => r.colorKey === 'navy')!;

    expect(avoided.score).toBeLessThan(other.score);
    expect(avoided.score).toBe(20); // 50 - 30 avoided penalty, no active signals otherwise
  });

  it('works for an anonymous/unauthenticated viewer (no userId) -- falls back to generic mode', async () => {
    mockTables({ inventory: { data: [inventoryRow('Navy')] } });

    const { recommendations, personalizationMode } = await getRecommendedColors(null, 'product-1');
    expect(personalizationMode).toBe('generic');
    expect(recommendations).toHaveLength(1);
  });
});
