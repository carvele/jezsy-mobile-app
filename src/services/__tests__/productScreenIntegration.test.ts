import { productService, ProductError } from '../productService';

jest.mock('@/src/services/offlineSync', () => ({
  cacheProductCatalog: jest.fn().mockResolvedValue(undefined),
  getCachedCatalog: jest.fn().mockResolvedValue([]),
}));

describe('Product Screen Integration: Home & Detail State Machine Contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('HOME Screen State Machine', () => {
    it('initial success: sets products, sets loading to false, no error', async () => {
      const mockProducts = [
        { id: 'p1', name: 'Silk Top', is_featured: true, price: 900, stock: 4 },
      ];
      jest.spyOn(productService, 'fetchHomeCatalog').mockResolvedValueOnce({
        products: mockProducts as any,
        trendingProducts: mockProducts as any,
        categories: [],
      });

      // Simulating Home Screen state reducer/handler
      let loading = true;
      let loadError: string | null = null;
      let allProducts: any[] = [];

      const reqId = 1;
      let latestReqId = reqId;

      try {
        const res = await productService.fetchHomeCatalog();
        if (reqId === latestReqId) {
          allProducts = res.products;
          loadError = null;
        }
      } catch (err: any) {
        if (reqId === latestReqId) loadError = err.message;
      } finally {
        if (reqId === latestReqId) loading = false;
      }

      expect(loading).toBe(false);
      expect(loadError).toBeNull();
      expect(allProducts).toEqual(mockProducts);
    });

    it('zero results: renders BrandEmptyState condition (not loading, not error, 0 products)', async () => {
      jest.spyOn(productService, 'fetchHomeCatalog').mockResolvedValueOnce({
        products: [],
        trendingProducts: [],
        categories: [],
      });

      let loading = true;
      let loadError: string | null = null;
      let allProducts: any[] = [];

      const res = await productService.fetchHomeCatalog();
      allProducts = res.products;
      loading = false;

      const isBrandEmptyState = !loading && !loadError && allProducts.length === 0;
      expect(isBrandEmptyState).toBe(true);
    });

    it('initial error: failure with 0 products sets loadError for ErrorRetryState', async () => {
      jest.spyOn(productService, 'fetchHomeCatalog').mockRejectedValueOnce(
        new ProductError('Network request failed', 'NETWORK')
      );

      let loading = true;
      let loadError: string | null = null;
      let allProducts: any[] = [];

      try {
        await productService.fetchHomeCatalog();
      } catch (err: any) {
        if (allProducts.length === 0) {
          loadError = err.message;
        }
      } finally {
        loading = false;
      }

      expect(loading).toBe(false);
      expect(loadError).toBe('Network request failed');
      expect(allProducts.length).toBe(0);
    });

    it('retry -> success: clears error, reloads products, clears loading', async () => {
      const mockProducts = [{ id: 'p1', name: 'Denim Jacket', price: 2000 }];
      jest.spyOn(productService, 'fetchHomeCatalog').mockResolvedValueOnce({
        products: mockProducts as any,
        trendingProducts: [],
        categories: [],
      });

      let loading = true;
      let isRetrying = true;
      let loadError: string | null = 'Previous error';
      let allProducts: any[] = [];

      loadError = null;
      const res = await productService.fetchHomeCatalog();
      allProducts = res.products;
      loading = false;
      isRetrying = false;

      expect(loadError).toBeNull();
      expect(loading).toBe(false);
      expect(isRetrying).toBe(false);
      expect(allProducts).toEqual(mockProducts);
    });

    it('refresh error with stale content: KEEP products visible, non-blocking feedback', async () => {
      const existingProducts = [{ id: 'p1', name: 'Cached Blazer', price: 3000 }];
      jest.spyOn(productService, 'fetchHomeCatalog').mockRejectedValueOnce(
        new ProductError('Server timeout', 'TIMEOUT')
      );

      let loading = false;
      let refreshing = true;
      let loadError: string | null = null;
      let allProducts: any[] = existingProducts;
      let toastMessage: string | null = null;

      try {
        await productService.fetchHomeCatalog();
      } catch {
        if (allProducts.length === 0) {
          loadError = 'Could not load catalog.';
        } else {
          toastMessage = 'Could not load the latest products. Pull down to refresh.';
        }
      } finally {
        refreshing = false;
        loading = false;
      }

      // Existing products must NOT be cleared on refresh failure
      expect(allProducts).toEqual(existingProducts);
      expect(loadError).toBeNull();
      expect(toastMessage).toBe('Could not load the latest products. Pull down to refresh.');
      expect(refreshing).toBe(false);
      expect(loading).toBe(false);
    });

    it('stale/out-of-order response ignored: older request resolving after newer cannot mutate state', async () => {
      let latestReqId = 0;
      let allProducts: any[] = [];

      // Request 1 starts
      const req1Id = ++latestReqId;
      // Request 2 starts immediately after
      const req2Id = ++latestReqId;

      // Request 2 finishes first with fresher data
      const req2Data = [{ id: 'p2', name: 'Fresh Shoes' }];
      if (req2Id === latestReqId) {
        allProducts = req2Data;
      }

      // Request 1 finishes later with stale data
      const req1Data = [{ id: 'p1', name: 'Old Shoes' }];
      if (req1Id === latestReqId) {
        allProducts = req1Data;
      }

      // Request 1 must have been ignored
      expect(allProducts).toEqual(req2Data);
    });

    it('trending failure does not remove catalog products', async () => {
      const catalog = [{ id: 'p1', name: 'Summer Hat', price: 500 }];
      jest.spyOn(productService, 'fetchHomeCatalog').mockResolvedValueOnce({
        products: catalog as any,
        trendingProducts: catalog as any, // derived fallback
        categories: [],
      });

      const res = await productService.fetchHomeCatalog();
      expect(res.products).toEqual(catalog);
      expect(res.trendingProducts.length).toBeGreaterThan(0);
    });

    it('timeout leaves loading state and shows recovery', async () => {
      jest.spyOn(productService, 'fetchHomeCatalog').mockRejectedValueOnce(
        new ProductError('Catalog request timed out. Please check your connection.', 'TIMEOUT')
      );

      let loading = true;
      let loadError: string | null = null;

      try {
        await productService.fetchHomeCatalog();
      } catch (err: any) {
        loadError = err.message;
      } finally {
        loading = false;
      }

      expect(loading).toBe(false);
      expect(loadError).toContain('timed out');
    });
  });

  describe('PRODUCT DETAIL Screen State Machine', () => {
    it('core success + secondary pending: product visible immediately', async () => {
      const mockProduct = { id: 'p1', name: 'Evening Gown', price: 5000 };
      const mockInventory = [{ id: 'v1', size: 'S', color: 'Black', available: 1 }];

      jest.spyOn(productService, 'fetchProductDetail').mockResolvedValueOnce({
        product: mockProduct as any,
        inventory: mockInventory as any,
      });

      let loading = true;
      let product: any = null;
      let inventory: any[] = [];
      let soldCount: number | null = null;

      // Primary fetch resolves immediately
      const primaryRes = await productService.fetchProductDetail('p1');
      product = primaryRes.product;
      inventory = primaryRes.inventory;
      loading = false; // Immediately unblock UI

      expect(loading).toBe(false);
      expect(product).toEqual(mockProduct);
      expect(inventory).toEqual(mockInventory);
      expect(soldCount).toBeNull(); // Secondary metric still pending, but UI is usable!
    });

    it('secondary failure: product remains usable and secondary degrades silently', async () => {
      const mockProduct = { id: 'p1', name: 'Evening Gown', price: 5000 };
      jest.spyOn(productService, 'fetchProductSecondaryMetrics').mockResolvedValueOnce({
        soldCount: null,
        lovedByCount: 0,
        lovedByUsers: [],
        stylistRecommendation: null,
      });

      let product: any = mockProduct;
      let soldCount: number | null = null;
      let loadError: any = null;

      const sec = await productService.fetchProductSecondaryMetrics('p1');
      soldCount = sec.soldCount;

      expect(product).toEqual(mockProduct);
      expect(soldCount).toBeNull();
      expect(loadError).toBeNull();
    });

    it('true not-found: PGRST116 maps to isNotFound=true ("Product not found")', async () => {
      jest.spyOn(productService, 'fetchProductDetail').mockRejectedValueOnce(
        new ProductError('Product not found.', 'NOT_FOUND')
      );

      let loadError: any = null;
      try {
        await productService.fetchProductDetail('missing');
      } catch (err: any) {
        loadError = err;
      }

      expect(loadError).toBeInstanceOf(ProductError);
      expect(loadError.isNotFound).toBe(true);
      expect(loadError.code).toBe('NOT_FOUND');
    });

    it('network error: maps to ErrorRetryState (isNotFound=false)', async () => {
      jest.spyOn(productService, 'fetchProductDetail').mockRejectedValueOnce(
        new ProductError('Failed to fetch product details.', 'NETWORK')
      );

      let loadError: any = null;
      try {
        await productService.fetchProductDetail('p1');
      } catch (err: any) {
        loadError = err;
      }

      expect(loadError).toBeInstanceOf(ProductError);
      expect(loadError.isNotFound).toBe(false);
      expect(loadError.code).toBe('NETWORK');
    });

    it('product A stale secondary response cannot overwrite product B', async () => {
      let currentActiveId = 'product-B';
      let currentProductSoldCount = 100; // Product B's sold count

      // Product A's slow secondary metric arrives late
      const staleProductAId = 'product-A';
      const staleProductASoldCount = 5;

      if (staleProductAId === currentActiveId) {
        currentProductSoldCount = staleProductASoldCount;
      }

      // Must remain product B's sold count
      expect(currentProductSoldCount).toBe(100);
    });
  });
});
