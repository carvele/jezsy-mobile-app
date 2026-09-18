import {
  addItem,
  updateItem,
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

    it('successfully executes rich insert preserving color, whereWornOften, description, userNotes, occasions, and ai_attributes', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addItem({
        userId: 'user-1',
        category: 'Clothing',
        garmentType: 'Bottom',
        subCategory: 'Activewear / Shorts',
        imageUrl: 'https://example.com/shorts.jpg',
        color: 'Black, White',
        whereWornOften: 'Running and exercising',
        description: 'Black 2-in-1 athletic running shorts (Nike)',
        userNotes: 'I love wearing this when exercising and running.',
        occasions: ['Running', 'exercising'],
        seasons: ['All Season'],
        embedding: [0.11, 0.22, 0.33],
      });

      expect(result.ok).toBe(true);
      expect(mockQuery.insert).toHaveBeenCalledWith({
        user_id: 'user-1',
        category: 'Clothing',
        garment_type: 'Bottom',
        sub_category: 'Activewear / Shorts',
        image_url: 'https://example.com/shorts.jpg',
        color_tags: ['Black, White'],
        description: 'Black 2-in-1 athletic running shorts (Nike)',
        user_notes: 'I love wearing this when exercising and running.',
        occasions: ['Running', 'exercising'],
        seasons: ['All Season'],
        embedding: [0.11, 0.22, 0.33],
        ai_attributes: {
          rawColor: 'Black, White',
          whereWornOften: 'Running and exercising',
          description: 'Black 2-in-1 athletic running shorts (Nike)',
          userNotes: 'I love wearing this when exercising and running.',
        },
      });
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('preserves user-entered extra model attributes inside ai_attributes instead of invalid top-level columns', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addItem({
        userId: 'user-1',
        category: 'Clothing',
        garmentType: 'Bottom',
        imageUrl: 'https://example.com/shorts.jpg',
        material: 'Polyester',
        fit: 'Athletic',
        aiAttributes: { customTag: 'trail' },
      });

      expect(result.ok).toBe(true);
      const inserted = mockQuery.insert.mock.calls[0][0];
      expect(inserted.material).toBeUndefined();
      expect(inserted.fit).toBeUndefined();
      expect(inserted.ai_attributes).toEqual(expect.objectContaining({
        material: 'Polyester',
        fit: 'Athletic',
        customTag: 'trail',
      }));
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

    it('fallback does not silently drop supported rich fields (description, user_notes, occasions, seasons)', async () => {
      const mockQuery: any = {
        insert: jest
          .fn()
          .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'ai_attributes' column" } })
          .mockResolvedValueOnce({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addItem({
        userId: 'user-1',
        category: 'Clothing',
        garmentType: 'Bottom',
        imageUrl: 'https://example.com/shorts.jpg',
        description: 'Black running shorts',
        userNotes: 'Worn for 5k runs',
        whereWornOften: 'Running',
        seasons: ['Summer'],
      });

      expect(result.ok).toBe(true);
      expect(mockQuery.insert).toHaveBeenCalledTimes(2);
      const fallbackCall = mockQuery.insert.mock.calls[1][0];
      expect(fallbackCall.description).toBe('Black running shorts');
      expect(fallbackCall.user_notes).toBe('Worn for 5k runs');
      expect(fallbackCall.occasions).toEqual(['Running']);
      expect(fallbackCall.seasons).toEqual(['Summer']);
      expect(fallbackCall.ai_attributes).toBeUndefined();
    });
  });

  describe('updateItem', () => {
    it('successfully updates color and re-tokenizes color_tags while preserving rawColor and unrelated metadata', async () => {
      const existingItem = {
        id: 'item-1',
        user_id: 'user-1',
        category: 'Clothing',
        sub_category: 'Activewear / Shorts',
        garment_type: 'Bottom',
        color_tags: ['Black'],
        description: 'Running shorts',
        user_notes: 'Bought for gym',
        ai_attributes: {
          rawColor: 'Black',
          whereWornOften: 'Gym, running',
          description: 'Running shorts',
          userNotes: 'Bought for gym',
          visualEmbedding: [0.12, 0.45],
        },
      };

      const updatedRecord = {
        ...existingItem,
        color_tags: ['Navy Blue', 'White'],
        ai_attributes: {
          ...existingItem.ai_attributes,
          rawColor: 'Navy Blue, White',
        },
      };

      const mockSelectChain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValueOnce({ data: existingItem, error: null }),
        update: jest.fn().mockReturnThis(),
      };
      mockSelectChain.update.mockReturnValue(mockSelectChain);
      mockSelectChain.single.mockResolvedValueOnce({ data: updatedRecord, error: null });

      (supabase.from as jest.Mock).mockReturnValue(mockSelectChain);

      const result = await updateItem('item-1', 'user-1', {
        color: 'Navy Blue, White',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(mockSelectChain.update).toHaveBeenCalledWith(
          expect.objectContaining({
            color_tags: ['Navy Blue', 'White'],
            ai_attributes: expect.objectContaining({
              rawColor: 'Navy Blue, White',
              visualEmbedding: [0.12, 0.45],
            }),
          })
        );
      }
    });

    it('recalculates garment_type from Bottom to Top when subcategory changes to Formal Blouse', async () => {
      const existingItem = {
        id: 'item-1',
        user_id: 'user-1',
        category: 'Clothing',
        sub_category: 'Activewear / Shorts',
        garment_type: 'Bottom',
        description: 'Running shorts',
      };

      const mockChain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValueOnce({ data: existingItem, error: null }),
        update: jest.fn().mockReturnThis(),
      };
      mockChain.update.mockReturnValue(mockChain);
      mockChain.single.mockResolvedValueOnce({
        data: { ...existingItem, sub_category: 'Formal Blouse', garment_type: 'Top' },
        error: null,
      });

      (supabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await updateItem('item-1', 'user-1', {
        subCategory: 'Formal Blouse',
        description: 'White silk blouse',
      });

      expect(result.ok).toBe(true);
      expect(mockChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          garment_type: 'Top',
          sub_category: 'Formal Blouse',
          description: 'White silk blouse',
        })
      );
    });

    it('recalculates garment_type from Top to Bottom when subcategory changes to Running Shorts', async () => {
      const existingItem = {
        id: 'item-2',
        user_id: 'user-1',
        category: 'Clothing',
        sub_category: 'Blouse',
        garment_type: 'Top',
        description: 'White blouse',
      };

      const mockChain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValueOnce({ data: existingItem, error: null }),
        update: jest.fn().mockReturnThis(),
      };
      mockChain.update.mockReturnValue(mockChain);
      mockChain.single.mockResolvedValueOnce({
        data: { ...existingItem, sub_category: 'Running Shorts', garment_type: 'Bottom' },
        error: null,
      });

      (supabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await updateItem('item-2', 'user-1', {
        subCategory: 'Running Shorts',
        description: 'Black running shorts',
      });

      expect(result.ok).toBe(true);
      expect(mockChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          garment_type: 'Bottom',
          sub_category: 'Running Shorts',
          description: 'Black running shorts',
        })
      );
    });

    it('rejects update when item is not found or unauthorized', async () => {
      const mockChain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValueOnce({ data: null, error: { message: 'Row not found', code: 'PGRST116' } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await updateItem('item-foreign', 'user-1', {
        category: 'Shoes',
      });

      expect(result.ok).toBe(false);
      expect(captureSpy).toHaveBeenCalled();
    });

    it('falls back to baseline supported columns when ai_attributes triggers PGRST204 schema error', async () => {
      const existingItem = {
        id: 'item-1',
        user_id: 'user-1',
        category: 'Clothing',
        sub_category: 'Activewear / Shorts',
        garment_type: 'Bottom',
        description: 'Running shorts',
      };

      const baseUpdated = {
        ...existingItem,
        description: 'Updated running shorts',
        user_notes: 'My favorite shorts',
      };

      const mockChain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValueOnce({ data: existingItem, error: null }) // Initial fetch
          .mockResolvedValueOnce({ data: null, error: { code: 'PGRST204', message: "Could not find the 'ai_attributes' column" } }) // Rich update fails
          .mockResolvedValueOnce({ data: baseUpdated, error: null }), // Fallback update succeeds
        update: jest.fn().mockReturnThis(),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await updateItem('item-1', 'user-1', {
        description: 'Updated running shorts',
        userNotes: 'My favorite shorts',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.description).toBe('Updated running shorts');
      }
      // Verify retry called with base columns without ai_attributes or occasions
      expect(mockChain.update).toHaveBeenLastCalledWith(
        expect.not.objectContaining({
          ai_attributes: expect.anything(),
          occasions: expect.anything(),
        })
      );
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

  describe('legacy items compatibility', () => {
    it('safely handles legacy item without ai_attributes or description', async () => {
      const legacyItem = {
        id: 'legacy-1',
        user_id: 'user-1',
        category: 'Clothing',
        sub_category: 'Shorts',
        garment_type: 'Bottom',
        color_tags: ['Black'],
        description: null,
        user_notes: null,
        ai_attributes: null,
        occasions: null,
      };

      const mockChain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValueOnce({ data: legacyItem, error: null }),
        update: jest.fn().mockReturnThis(),
      };
      mockChain.update.mockReturnValue(mockChain);
      mockChain.single.mockResolvedValueOnce({
        data: {
          ...legacyItem,
          description: 'Updated description',
          ai_attributes: { description: 'Updated description' },
        },
        error: null,
      });

      (supabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await updateItem('legacy-1', 'user-1', {
        description: 'Updated description',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(mockChain.update).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'Updated description',
            ai_attributes: expect.objectContaining({
              description: 'Updated description',
            }),
          })
        );
      }
    });
  });
});
