import {
  addItem,
  updateItem,
  addCapsuleItem,
  removeCapsuleItem,
  deleteCapsule,
  buildSearchOrFilter,
  getWardrobeItemsPage,
  itemExists,
  logItemsWorn,
  removeWardrobeImage,
  saveItemVerified,
} from '../wardrobeService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    storage: { from: jest.fn() },
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

    it('fails loudly instead of dropping ai_attributes when that column is missing', async () => {
      const mockQuery: any = {
        insert: jest
          .fn()
          .mockResolvedValue({ error: { code: 'PGRST204', message: "Could not find the 'ai_attributes' column of 'wardrobe_items' in the schema cache" } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addItem({
        userId: 'user-1',
        category: 'Clothing',
        garmentType: 'Bottom',
        imageUrl: 'https://example.com/shorts.jpg',
        description: 'Black running shorts',
        color: 'Black, White',
        whereWornOften: 'Running',
      });

      expect(result.ok).toBe(false);
      expect(mockQuery.insert).toHaveBeenCalledTimes(1);
      expect(mockQuery.insert.mock.calls[0][0].ai_attributes).toEqual(
        expect.objectContaining({ rawColor: 'Black, White', whereWornOften: 'Running' })
      );
    });

    it('drops only the optional column the database names (embedding) and keeps ai_attributes and user facts', async () => {
      const mockQuery: any = {
        insert: jest
          .fn()
          .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'embedding' column of 'wardrobe_items' in the schema cache" } })
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
        color: 'Black',
        whereWornOften: 'Running',
        seasons: ['Summer'],
        embedding: [0.1, 0.2],
      });

      expect(result.ok).toBe(true);
      expect(mockQuery.insert).toHaveBeenCalledTimes(2);
      const retried = mockQuery.insert.mock.calls[1][0];
      expect(retried.embedding).toBeUndefined();
      expect(retried.description).toBe('Black running shorts');
      expect(retried.user_notes).toBe('Worn for 5k runs');
      expect(retried.occasions).toEqual(['Running']);
      expect(retried.seasons).toEqual(['Summer']);
      expect(retried.ai_attributes).toEqual(expect.objectContaining({ rawColor: 'Black', whereWornOften: 'Running' }));
    });

    it('does not retry on an unrelated error that merely mentions "column"', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: { code: '23514', message: 'new row violates check constraint on column category' } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await addItem({ userId: 'user-1', category: 'x', garmentType: 'Top', imageUrl: 'https://e.com/a.jpg' });
      expect(result.ok).toBe(false);
      expect(mockQuery.insert).toHaveBeenCalledTimes(1);
    });

    it('sends the client id so a retry of the same save is idempotent', async () => {
      const mockQuery: any = { insert: jest.fn().mockResolvedValue({ error: null }) };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await addItem({ id: 'client-uuid-1', userId: 'user-1', category: 'Top', garmentType: 'Top', imageUrl: 'https://e.com/a.jpg' });
      expect(mockQuery.insert.mock.calls[0][0].id).toBe('client-uuid-1');
    });

    it('treats a duplicate key on the same client id as an already-saved item', async () => {
      const chain: any = {
        insert: jest.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint "wardrobe_items_pkey"' } }),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'client-uuid-1' }, error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await addItem({ id: 'client-uuid-1', userId: 'user-1', category: 'Top', garmentType: 'Top', imageUrl: 'https://e.com/a.jpg' });
      expect(result.ok).toBe(true);
      expect(chain.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveItemVerified', () => {
    const input = { id: 'client-uuid-2', userId: 'user-1', category: 'Top', garmentType: 'Top', imageUrl: 'https://e.com/a.jpg' };

    function chainFor(insertImpl: jest.Mock, existsData: any, existsError: any = null): any {
      return {
        insert: insertImpl,
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: existsData, error: existsError }),
      };
    }

    it('reports saved when the insert succeeds', async () => {
      (supabase.from as jest.Mock).mockReturnValue(chainFor(jest.fn().mockResolvedValue({ error: null }), null));
      expect(await saveItemVerified(input)).toEqual({ status: 'saved' });
    });

    it('a timeout whose insert actually succeeded is reported as saved, so no retry can duplicate it', async () => {
      const slowInsert = jest.fn().mockReturnValue(new Promise(() => {}));
      (supabase.from as jest.Mock).mockReturnValue(chainFor(slowInsert, { id: 'client-uuid-2' }));
      expect(await saveItemVerified(input, 20)).toEqual({ status: 'saved' });
    });

    it('a definitive failure (row absent) is reported as failed so the caller can clean up the image', async () => {
      const insert = jest.fn().mockResolvedValue({ error: { code: '42501', message: 'RLS' } });
      (supabase.from as jest.Mock).mockReturnValue(chainFor(insert, null));
      const outcome = await saveItemVerified(input);
      expect(outcome.status).toBe('failed');
    });

    it('when the existence check cannot tell, the outcome is unknown and nothing should be cleaned up', async () => {
      const slowInsert = jest.fn().mockReturnValue(new Promise(() => {}));
      (supabase.from as jest.Mock).mockReturnValue(chainFor(slowInsert, null, { message: 'network' }));
      const outcome = await saveItemVerified(input, 20);
      expect(outcome.status).toBe('unknown');
    });
  });

  describe('itemExists and image cleanup', () => {
    it('itemExists is scoped to the user and distinguishes absent from unknown', async () => {
      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'x' } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(chain);
      expect(await itemExists('id-1', 'user-1')).toBe(false);
      expect(await itemExists('id-1', 'user-1')).toBeNull();
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    });

    it('removes an orphaned upload from the wardrobe-images bucket', async () => {
      const remove = jest.fn().mockResolvedValue({ error: null });
      (supabase.storage.from as jest.Mock).mockReturnValue({ remove });
      expect(await removeWardrobeImage('user-1/abc.jpg')).toBe(true);
      expect(supabase.storage.from).toHaveBeenCalledWith('wardrobe-images');
      expect(remove).toHaveBeenCalledWith(['user-1/abc.jpg']);
    });

    it('cleanup failure is reported, not thrown', async () => {
      (supabase.storage.from as jest.Mock).mockReturnValue({ remove: jest.fn().mockRejectedValue(new Error('offline')) });
      expect(await removeWardrobeImage('user-1/abc.jpg')).toBe(false);
    });
  });

  describe('logItemsWorn', () => {
    it('uses the atomic increment_wear_count RPC for every item and never writes wear_count directly', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: {}, error: null });
      const out = await logItemsWorn(['a', 'b', 'a']);
      expect(supabase.rpc).toHaveBeenCalledTimes(2);
      expect(supabase.rpc).toHaveBeenCalledWith('increment_wear_count', { p_item_id: 'a' });
      expect(supabase.rpc).toHaveBeenCalledWith('increment_wear_count', { p_item_id: 'b' });
      expect(supabase.from).not.toHaveBeenCalled();
      expect(out).toEqual({ succeeded: ['a', 'b'], failed: [] });
    });

    it('reports failures from the RPC result instead of swallowing them', async () => {
      (supabase.rpc as jest.Mock)
        .mockResolvedValueOnce({ data: {}, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'wardrobe item not found or not owned by caller' } })
        .mockRejectedValueOnce(new Error('offline'));
      const out = await logItemsWorn(['a', 'b', 'c']);
      expect(out.succeeded).toEqual(['a']);
      expect(out.failed).toEqual(['b', 'c']);
    });
  });

  describe('wardrobe search', () => {
    it('produces a normal filter for plain text', () => {
      expect(buildSearchOrFilter('blazer')).toBe(
        'garment_type.ilike.%blazer%,category.ilike.%blazer%,sub_category.ilike.%blazer%,description.ilike.%blazer%'
      );
    });

    it.each([
      ['a comma', 'skirt, maxi', 'skirt maxi'],
      ['open parenthesis', 'jacket (blue', 'jacket blue'],
      ['close parenthesis', 'blue) jacket', 'blue jacket'],
      ['both parentheses', 'top(1)', 'top 1'],
      ['quotes and backslash', 'a"b\\c\'d', 'a b c d'],
      ['LIKE wildcards', '100%_cotton', '100 cotton'],
      ['PostgREST operator syntax', 'x),user_id.neq.abc,(y', 'x user id.neq.abc y'],
    ])('neutralises %s', (_label, input, expectedTerm) => {
      const filter = buildSearchOrFilter(input) as string;
      // Exactly the four intended clauses, so no clause can be injected.
      expect(filter.split(',')).toHaveLength(4);
      expect(filter).not.toMatch(/[()"]/);
      expect(filter).toContain(`garment_type.ilike.%${expectedTerm}%`);
    });

    it('returns null when nothing searchable remains', () => {
      expect(buildSearchOrFilter('')).toBeNull();
      expect(buildSearchOrFilter('  ,()  ')).toBeNull();
      expect(buildSearchOrFilter(undefined)).toBeNull();
    });

    it('bounds the search term length', () => {
      const filter = buildSearchOrFilter('a'.repeat(500)) as string;
      expect(filter).toContain(`garment_type.ilike.%${'a'.repeat(60)}%`);
      expect(filter).not.toContain('a'.repeat(61));
    });

    it('keeps user_id and deleted filters while applying a sanitised search', async () => {
      const chain: any = {};
      for (const m of ['select', 'eq', 'or', 'order', 'gt', 'lt']) chain[m] = jest.fn().mockReturnValue(chain);
      chain.range = jest.fn().mockResolvedValue({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await getWardrobeItemsPage('user-1', 0, { search: 'skirt, (maxi' });
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(chain.eq).toHaveBeenCalledWith('deleted', false);
      const orArg = chain.or.mock.calls[0][0] as string;
      expect(orArg.split(',')).toHaveLength(4);
      expect(orArg).not.toMatch(/[()]/);
    });

    it('does not select the embedding vector for list loads', async () => {
      const chain: any = {};
      for (const m of ['select', 'eq', 'or', 'order']) chain[m] = jest.fn().mockReturnValue(chain);
      chain.range = jest.fn().mockResolvedValue({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await getWardrobeItemsPage('user-1', 0, {});
      const cols = chain.select.mock.calls[0][0] as string;
      expect(cols).not.toContain('embedding');
      expect(cols).toContain('ai_attributes');
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

    it('surfaces a schema error instead of retrying without ai_attributes', async () => {
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
        single: jest
          .fn()
          .mockResolvedValueOnce({ data: existingItem, error: null }) // Initial fetch
          .mockResolvedValueOnce({ data: null, error: { code: 'PGRST204', message: "Could not find the 'ai_attributes' column" } }),
        update: jest.fn().mockReturnThis(),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockChain);

      const result = await updateItem('item-1', 'user-1', {
        description: 'Updated running shorts',
        userNotes: 'My favorite shorts',
      });

      expect(result.ok).toBe(false);
      expect(mockChain.update).toHaveBeenCalledTimes(1);
      expect(mockChain.update.mock.calls[0][0].ai_attributes).toBeDefined();
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
