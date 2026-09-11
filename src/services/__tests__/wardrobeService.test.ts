import {
  addItem,
  addCapsuleItem,
  removeCapsuleItem,
  deleteCapsule,
} from '../wardrobeService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('wardrobeService', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    captureSpy = jest.spyOn(errorReporting, 'capture').mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  describe('addItem', () => {
    it('successfully adds an item to wardrobe', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addItem({
        userId: 'user-1',
        category: 'tops',
        garmentType: 't-shirt',
        subCategory: 'crewneck',
        imageUrl: 'https://example.com/tee.jpg',
        colorTags: ['white', 'black'],
      });

      expect(supabase.from).toHaveBeenCalledWith('wardrobe_items');
      expect(mockQuery.insert).toHaveBeenCalledWith({
        user_id: 'user-1',
        category: 'tops',
        garment_type: 't-shirt',
        sub_category: 'crewneck',
        image_url: 'https://example.com/tee.jpg',
        color_tags: ['white', 'black'],
      });
      expect(result.ok).toBe(true);
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('handles insert failure and captures error', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: { message: 'Insert failed', code: '42501' } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addItem({
        userId: 'user-1',
        category: 'tops',
        garmentType: 't-shirt',
        imageUrl: 'https://example.com/tee.jpg',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('42501');
      }
      expect(captureSpy).toHaveBeenCalled();
    });
  });

  describe('capsule operations', () => {
    it('adds item to capsule successfully', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addCapsuleItem({
        capsuleId: 'cap-1',
        wardrobeItemId: 'item-1',
      });

      expect(supabase.from).toHaveBeenCalledWith('capsule_items');
      expect(mockQuery.insert).toHaveBeenCalledWith({
        capsule_id: 'cap-1',
        wardrobe_item_id: 'item-1',
      });
      expect(result.ok).toBe(true);
    });

    it('removes item from capsule successfully', async () => {
      const mockQuery: any = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      // For the chained eq calls: .eq('capsule_id', ...).eq('wardrobe_item_id', ...)
      mockQuery.eq.mockReturnValueOnce(mockQuery).mockResolvedValueOnce({ error: null });
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await removeCapsuleItem({
        capsuleId: 'cap-1',
        wardrobeItemId: 'item-1',
      });

      expect(supabase.from).toHaveBeenCalledWith('capsule_items');
      expect(result.ok).toBe(true);
    });

    it('deletes a capsule collection successfully', async () => {
      const mockQuery: any = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await deleteCapsule('cap-1');

      expect(supabase.from).toHaveBeenCalledWith('capsules');
      expect(mockQuery.delete).toHaveBeenCalled();
      expect(mockQuery.eq).toHaveBeenCalledWith('id', 'cap-1');
      expect(result.ok).toBe(true);
    });
  });
});
