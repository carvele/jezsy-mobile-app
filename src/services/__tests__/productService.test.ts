import { productService, ProductError } from '../productService';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('@/src/services/offlineSync', () => ({
  cacheProductCatalog: jest.fn().mockResolvedValue(undefined),
  getCachedCatalog: jest.fn().mockResolvedValue([]),
}));

describe('productService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchHomeCatalog', () => {
    it('successfully fetches home catalog products and secondary enrichments', async () => {
      const mockProducts = [
        { id: 'p1', name: 'Linen Dress', is_featured: true, price: 1500, stock: 5 },
        { id: 'p2', name: 'Silk Blouse', is_featured: false, price: 1200, stock: 2 },
      ];
      const mockTrending = [
        { id: 'p1', name: 'Linen Dress', price: 1500 },
      ];
      const mockCategories = [
        { id: 'c1', name: 'Dresses', sort_order: 1 },
      ];

      const chainProducts: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: mockProducts, error: null }),
      };

      const chainCategories: any = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: mockCategories, error: null }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'products') return chainProducts;
        if (table === 'categories') return chainCategories;
        throw new Error(`Unexpected table ${table}`);
      });

      const chainTrending: any = {
        select: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: mockTrending, error: null }),
      };
      (supabase.rpc as jest.Mock).mockReturnValue(chainTrending);

      const result = await productService.fetchHomeCatalog();

      expect(result.products).toEqual(mockProducts);
      expect(result.trendingProducts).toEqual(mockTrending);
      expect(result.categories).toEqual(mockCategories);
    });

    it('PROD-LOAD-002: secondary trending and category failures do not fail catalog products', async () => {
      const mockProducts = [
        { id: 'p1', name: 'Linen Dress', is_featured: true, price: 1500, stock: 5, rating: 5, review_count: 10 },
      ];

      const chainProducts: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: mockProducts, error: null }),
      };

      const chainCategories: any = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: null, error: { message: 'categories error' } }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'products') return chainProducts;
        if (table === 'categories') return chainCategories;
        throw new Error(`Unexpected table ${table}`);
      });

      const chainTrending: any = {
        select: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockRejectedValue(new Error('RPC get_trending_products timeout')),
      };
      (supabase.rpc as jest.Mock).mockReturnValue(chainTrending);

      const result = await productService.fetchHomeCatalog();

      // Primary products must succeed
      expect(result.products).toEqual(mockProducts);
      // Fallback trending derived from products
      expect(result.trendingProducts).toEqual(mockProducts);
      // Categories degrades to empty array
      expect(result.categories).toEqual([]);
    });

    it('PROD-LOAD-003: zero products returns empty array without error', async () => {
      const chainProducts: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      const chainCategories: any = {
        select: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'products') return chainProducts;
        if (table === 'categories') return chainCategories;
        throw new Error(`Unexpected table ${table}`);
      });
      (supabase.rpc as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const result = await productService.fetchHomeCatalog();
      expect(result.products).toEqual([]);
      expect(result.trendingProducts).toEqual([]);
    });

    it('PROD-LOAD-006: abort signal cancels the request and throws CANCELLED ProductError', async () => {
      const controller = new AbortController();
      controller.abort();

      const chain: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockImplementation((signal: AbortSignal) => {
          return new Promise((_, reject) => {
            if (signal.aborted) {
              const err = new Error('The user aborted a request.');
              err.name = 'AbortError';
              reject(err);
            }
          });
        }),
      };
      (supabase.from as jest.Mock).mockReturnValue(chain);
      (supabase.rpc as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockReturnValue(new Promise(() => {})),
      });

      await expect(productService.fetchHomeCatalog({ signal: controller.signal }))
        .rejects.toMatchObject({ code: 'CANCELLED', isCancelled: true });
    });
  });

  describe('fetchProductDetail', () => {
    it('PROD-LOAD-004: resolves core product and inventory variants immediately', async () => {
      const mockProduct = { id: 'p1', name: 'Linen Dress', price: 1500 };
      const mockVariants = [{ id: 'v1', size: 'M', color: 'Beige', available: 3 }];

      const chainProducts: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockProduct, error: null }),
      };
      const chainVariants: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: mockVariants, error: null }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'products') return chainProducts;
        if (table === 'product_variants') return chainVariants;
        throw new Error(`Unexpected table ${table}`);
      });

      const result = await productService.fetchProductDetail('p1');
      expect(result.product).toEqual(mockProduct);
      expect(result.inventory).toEqual(mockVariants);
    });

    it('PROD-LOAD-005: maps PGRST116 specifically to NOT_FOUND ProductError', async () => {
      const chainProducts: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
        }),
      };
      const chainVariants: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'products') return chainProducts;
        if (table === 'product_variants') return chainVariants;
        throw new Error(`Unexpected table ${table}`);
      });

      try {
        await productService.fetchProductDetail('nonexistent-id');
        fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProductError);
        expect(err.code).toBe('NOT_FOUND');
        expect(err.isNotFound).toBe(true);
      }
    });

    it('PROD-LOAD-005: maps network and unexpected errors to NETWORK ProductError (not not-found)', async () => {
      const chainProducts: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: '500', message: 'Internal Server Error' },
        }),
      };
      const chainVariants: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        abortSignal: jest.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'products') return chainProducts;
        if (table === 'product_variants') return chainVariants;
        throw new Error(`Unexpected table ${table}`);
      });

      try {
        await productService.fetchProductDetail('p1');
        fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProductError);
        expect(err.code).toBe('NETWORK');
        expect(err.isNotFound).toBe(false);
      }
    });
  });

  describe('fetchProductSecondaryMetrics', () => {
    it('degrades gracefully when secondary RPCs fail or reject', async () => {
      (supabase.rpc as jest.Mock).mockImplementation((fn: string) => ({
        abortSignal: jest.fn().mockRejectedValue(new Error(`RPC ${fn} failed`)),
      }));

      const result = await productService.fetchProductSecondaryMetrics('p1');
      expect(result.soldCount).toBeNull();
      expect(result.lovedByCount).toBe(0);
      expect(result.lovedByUsers).toEqual([]);
      expect(result.stylistRecommendation).toBeNull();
    });
  });
});
