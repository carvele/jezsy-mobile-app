import { outfitService } from '../outfitService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('outfitService', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    captureSpy = jest.spyOn(errorReporting, 'capture').mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  describe('saveOutfit', () => {
    it('successfully saves an outfit and returns its ID', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { id: 'outfit-99' }, error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await outfitService.saveOutfit({
        userId: 'user-1',
        name: 'Summer Look',
        items: [
          {
            slot: 'top',
            name: 'White Linen Shirt',
            image_url: 'https://example.com/top.jpg',
            drag_x: 10,
            drag_y: 20,
          },
        ],
      });

      expect(supabase.from).toHaveBeenCalledWith('saved_outfits');
      expect(mockQuery.insert).toHaveBeenCalledWith({
        user_id: 'user-1',
        name: 'Summer Look',
        items: [
          {
            slot: 'top',
            name: 'White Linen Shirt',
            image_url: 'https://example.com/top.jpg',
            drag_x: 10,
            drag_y: 20,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('outfit-99');
      }
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('returns failure when database insert fails', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed', code: 'PGRST100' } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await outfitService.saveOutfit({
        userId: 'user-1',
        name: 'Failed Look',
        items: [],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PGRST100');
        expect(result.error.domain).toBe('outfit');
      }
      expect(captureSpy).toHaveBeenCalled();
    });
  });

  describe('saveOutfitItems', () => {
    it('successfully saves relational outfit items mirror', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await outfitService.saveOutfitItems('outfit-99', [
        {
          slot: 'bottom',
          name: 'Blue Jeans',
          image_url: 'https://example.com/jeans.jpg',
          product_id: 'prod-1',
          owned: true,
        },
      ]);

      expect(supabase.from).toHaveBeenCalledWith('outfit_items');
      expect(mockQuery.insert).toHaveBeenCalledWith([
        {
          outfit_id: 'outfit-99',
          product_id: 'prod-1',
          slot: 'bottom',
          image_url: 'https://example.com/jeans.jpg',
          name: 'Blue Jeans',
          color_tags: null,
          owned: true,
        },
      ]);
      expect(result.ok).toBe(true);
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('captures error when relational insert fails', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: { message: 'FK violation', code: '23503' } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await outfitService.saveOutfitItems('outfit-99', []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('23503');
      }
      expect(captureSpy).toHaveBeenCalled();
    });
  });
});
