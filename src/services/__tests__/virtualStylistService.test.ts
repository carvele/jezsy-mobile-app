import { getRecommendedSize, getStylistRecommendation } from '../virtualStylistService';
import { supabase } from '@/src/lib/supabase';
import { recommendSize } from '@/src/utils/sizeRecommender';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// recommendSize has its own dedicated test suite (sizeRecommender.test.ts);
// here it's mocked so these tests isolate the size/color resolution wiring
// the plan actually asks for, not the sizing heuristic itself.
jest.mock('@/src/utils/sizeRecommender', () => ({
  ...jest.requireActual('@/src/utils/sizeRecommender'),
  recommendSize: jest.fn(),
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

const inventoryRow = (color: string, size: string, available: number) => ({
  id: `${color}-${size}`,
  color,
  size,
  available,
  deleted: false,
  hex_color: null,
});

describe('virtualStylistService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getRecommendedSize', () => {
    it('returns null when the user has no stored measurements', async () => {
      mockTables({
        profiles: { data: { fit_preference: 'regular' } },
        user_measurements: { data: null },
        products: { data: { measurements: { M: { bust: 90 } }, category: 'Tops', category_id: null, name: 'Tee' } },
      });
      const result = await getRecommendedSize('user-1', 'product-1');
      expect(result).toBeNull();
      expect(recommendSize).not.toHaveBeenCalled();
    });

    it('passes the product\'s legacy category text column through to recommendSize', async () => {
      (recommendSize as jest.Mock).mockReturnValue('M');
      mockTables({
        profiles: { data: { fit_preference: 'tight' } },
        user_measurements: { data: { measurements: { bust: 88 } } },
        products: { data: { measurements: { M: { bust: 90 } }, category: 'Tops', category_id: null, name: 'Tee' } },
      });

      const result = await getRecommendedSize('user-1', 'product-1');

      expect(recommendSize).toHaveBeenCalledWith({ bust: 88 }, { M: { bust: 90 } }, 'tight', 'Tops');
      expect(result).toEqual({ size: 'M', userMeasurements: { bust: 88 }, fitPreference: 'tight' });
    });
  });

  describe('getStylistRecommendation (SKU resolution integrity)', () => {
    it('separates the best color overall from the color actually in stock in the recommended size', async () => {
      // Best size is Medium, best color is Navy -- but Medium+Navy is out of
      // stock. Medium+Burgundy is in stock. Navy should still win on color
      // score alone; Burgundy should be the one actually recommended to buy.
      (recommendSize as jest.Mock).mockReturnValue('M');
      mockTables({
        profiles: { data: { fit_preference: 'regular' } },
        user_measurements: { data: { measurements: { bust: 90 } } },
        products: { data: { measurements: { M: { bust: 90 } }, category: 'Tops', category_id: null, name: 'Tee' } },
        inventory: {
          data: [
            inventoryRow('Navy', 'M', 0), // out of stock in the recommended size
            inventoryRow('Navy', 'L', 4), // in stock, but not the recommended size
            inventoryRow('Burgundy', 'M', 3), // in stock in the recommended size
          ],
        },
        user_color_profiles: {
          data: { undertone: 'unknown', preferred_colors: ['navy'], avoided_colors: [] },
        },
        wardrobe_items: { data: [] },
      });

      const result = await getStylistRecommendation('user-1', 'product-1');

      expect(result.sizeRecommendation?.size).toBe('M');
      expect(result.topColorRecommendation?.colorKey).toBe('navy');
      expect(result.resolvedColorRecommendation?.colorKey).toBe('burgundy');
      expect(result.resolvedVariant).toMatchObject({ color: 'Burgundy', size: 'M' });
    });

    it('resolves to null variant/color when no size recommendation exists, never guessing a fabricated combination', async () => {
      mockTables({
        profiles: { data: { fit_preference: 'regular' } },
        user_measurements: { data: null },
        products: { data: { measurements: { M: { bust: 90 } }, category: 'Tops', category_id: null, name: 'Tee' } },
        inventory: { data: [inventoryRow('Navy', 'M', 5)] },
        user_color_profiles: { data: null },
        wardrobe_items: { data: [] },
      });

      const result = await getStylistRecommendation('user-1', 'product-1');

      expect(result.sizeRecommendation).toBeNull();
      expect(result.resolvedColorRecommendation).toBeNull();
      expect(result.resolvedVariant).toBeNull();
      // topColorRecommendation is independent of size availability -- it can still resolve.
      expect(result.topColorRecommendation?.colorKey).toBe('navy');
    });
  });
});
