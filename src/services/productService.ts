import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { CATEGORY_SELECT, WithCategoryEmbed } from '@/src/utils/categoryDisplay';
import { isInStock } from '@/src/utils/stock';
import { getStylistRecommendation, StylistRecommendation } from '@/src/services/virtualStylistService';

export const DEFAULT_REQUEST_TIMEOUT_MS = 12000;

export type Product = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;
export type Category = Database['public']['Tables']['categories']['Row'];
export type ProductVariant = Database['public']['Views']['product_variants']['Row'];

export type ProductErrorCode = 'TIMEOUT' | 'NOT_FOUND' | 'NETWORK' | 'CANCELLED' | 'UNKNOWN';

export class ProductError extends Error {
  code: ProductErrorCode;
  isTimeout: boolean;
  isNotFound: boolean;
  isCancelled: boolean;

  constructor(message: string, code: ProductErrorCode = 'UNKNOWN') {
    super(message);
    this.name = 'ProductError';
    this.code = code;
    this.isTimeout = code === 'TIMEOUT';
    this.isNotFound = code === 'NOT_FOUND';
    this.isCancelled = code === 'CANCELLED';
  }
}

/**
 * Creates an internal AbortController bound to an optional parent signal and timeout.
 */
function createBoundedSignal(parentSignal?: AbortSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort();
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort);
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  return {
    signal: controller.signal,
    cleanup,
    isTimedOut: () => timedOut,
  };
}

export interface FetchCatalogResult {
  products: Product[];
  trendingProducts: Product[];
  categories: Category[];
}

export interface FetchProductDetailResult {
  product: Product;
  inventory: ProductVariant[];
}

export interface FetchSecondaryMetricsResult {
  soldCount: number | null;
  lovedByCount: number;
  lovedByUsers: any[];
  stylistRecommendation: StylistRecommendation | null;
}

/**
 * Canonical product service providing bounded requests, lifecycle protection,
 * and decoupling of primary product data from secondary merchandising/social proof.
 */
export const productService = {
  /**
   * PRIMARY: Fetches the public storefront product catalog.
   * SECONDARY: Decoupled trending products and categories enrichment.
   * PROD-LOAD-002: Secondary failures never fail the primary catalog.
   * PROD-LOAD-006: 12-second bounded timeout with AbortController.
   */
  async fetchHomeCatalog(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    limit?: number;
  }): Promise<FetchCatalogResult> {
    const { signal, cleanup, isTimedOut } = createBoundedSignal(options?.signal, options?.timeoutMs);
    const limit = options?.limit ?? 20;

    try {
      // 1. Primary Product Query - Must succeed or throw
      const primaryQuery = supabase
        .from('products')
        .select(`*, ${CATEGORY_SELECT}`)
        .eq('visibility', 'public')
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(limit)
        .abortSignal(signal);

      // 2. Secondary Queries - Fire concurrently but settled independently
      const trendingQuery = (supabase.rpc as any)('get_trending_products', { limit_count: 8 })
        .select(`*, ${CATEGORY_SELECT}`)
        .abortSignal(signal);

      const categoriesQuery = supabase
        .from('categories')
        .select('*')
        .is('parent_id', null)
        .order('sort_order', { ascending: true })
        .abortSignal(signal);

      const [productsRes, secondaryRes] = await Promise.all([
        primaryQuery,
        Promise.allSettled([trendingQuery, categoriesQuery]),
      ]);

      if (productsRes.error) {
        throw new ProductError(productsRes.error.message, 'NETWORK');
      }

      const products = (productsRes.data as unknown as Product[]) ?? [];

      // Cache successful products for offline recovery without eager module loading
      if (products.length > 0) {
        import('@/src/services/offlineSync')
          .then(({ cacheProductCatalog }) => cacheProductCatalog(products as any))
          .catch(() => {});
      }

      // Process secondary results safely without failing the catalog
      let trendingProducts: Product[] = [];
      let categories: Category[] = [];

      const [trendingSettled, categoriesSettled] = secondaryRes;

      if (trendingSettled.status === 'fulfilled' && trendingSettled.value?.data) {
        trendingProducts = (trendingSettled.value.data as any[]).slice(0, 4);
      } else {
        // Fallback: derive trending from primary products by popularity heuristics
        const byPopularity = [...products].sort((a, b) => {
          const stockDiff = Number(isInStock(b)) - Number(isInStock(a));
          if (stockDiff !== 0) return stockDiff;
          const reviewDiff = (b.review_count || 0) - (a.review_count || 0);
          if (reviewDiff !== 0) return reviewDiff;
          return (b.rating || 0) - (a.rating || 0);
        });
        trendingProducts = byPopularity.slice(0, 4);
      }

      if (categoriesSettled.status === 'fulfilled' && categoriesSettled.value?.data) {
        categories = (categoriesSettled.value.data as unknown as Category[]) ?? [];
      }

      return {
        products,
        trendingProducts,
        categories,
      };
    } catch (err: any) {
      if (isTimedOut()) {
        throw new ProductError('Catalog request timed out. Please check your connection.', 'TIMEOUT');
      }
      if (options?.signal?.aborted || err?.name === 'AbortError') {
        throw new ProductError('Request cancelled.', 'CANCELLED');
      }
      if (err instanceof ProductError) throw err;
      throw new ProductError(err?.message || 'Could not load product catalog.', 'NETWORK');
    } finally {
      cleanup();
    }
  },

  /**
   * PRIMARY: Fetches core product and inventory variants for [id].
   * PROD-LOAD-004: Resolves immediately (~100-200ms) without waiting for social/stylist metrics.
   * PROD-LOAD-005: Distinguishes between genuine 404 (PGRST116) and network/server errors.
   */
  async fetchProductDetail(
    id: string,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<FetchProductDetailResult> {
    const { signal, cleanup, isTimedOut } = createBoundedSignal(options?.signal, options?.timeoutMs);

    try {
      const [productRes, invRes] = await Promise.all([
        supabase
          .from('products')
          .select(`*, ${CATEGORY_SELECT}`)
          .eq('id', id)
          .abortSignal(signal)
          .single(),
        supabase
          .from('product_variants')
          .select('*')
          .eq('product_doc_id', id)
          .abortSignal(signal),
      ]);

      if (productRes.error) {
        // PGRST116 = 0 rows returned for single() -> genuine NOT FOUND
        if (productRes.error.code === 'PGRST116') {
          throw new ProductError('Product not found.', 'NOT_FOUND');
        }
        throw new ProductError(productRes.error.message, 'NETWORK');
      }

      if (!productRes.data) {
        throw new ProductError('Product not found.', 'NOT_FOUND');
      }

      const product = productRes.data as unknown as Product;
      const inventory = (invRes.data as unknown as ProductVariant[]) ?? [];

      return { product, inventory };
    } catch (err: any) {
      if (isTimedOut()) {
        throw new ProductError('Product request timed out. Please check your connection.', 'TIMEOUT');
      }
      if (options?.signal?.aborted || err?.name === 'AbortError') {
        throw new ProductError('Request cancelled.', 'CANCELLED');
      }
      if (err instanceof ProductError) throw err;
      throw new ProductError(err?.message || 'Failed to fetch product details.', 'NETWORK');
    } finally {
      cleanup();
    }
  },

  /**
   * SECONDARY: Asynchronously fetches secondary metrics (sold count, loved count, stylist recommendation).
   * Runs in the background with lifecycle protection; failure degrades gracefully without breaking UI.
   */
  async fetchProductSecondaryMetrics(
    id: string,
    userId?: string | null,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      measurements?: any;
    }
  ): Promise<FetchSecondaryMetricsResult> {
    const { signal, cleanup } = createBoundedSignal(options?.signal, options?.timeoutMs ?? 8000);

    try {
      const soldQuery = supabase
        .rpc('get_product_sold_count', { p_product_id: id })
        .abortSignal(signal);

      const lovedQuery = supabase
        .rpc('get_product_loved_by', { p_product_id: id })
        .abortSignal(signal);

      const stylistQuery =
        userId && options?.measurements
          ? getStylistRecommendation(userId, id)
          : Promise.resolve(null);

      const [soldSettled, lovedSettled, stylistSettled] = await Promise.allSettled([
        soldQuery,
        lovedQuery,
        stylistQuery,
      ]);

      let soldCount: number | null = null;
      if (soldSettled.status === 'fulfilled' && typeof soldSettled.value?.data === 'number') {
        soldCount = soldSettled.value.data;
      }

      let lovedByCount = 0;
      let lovedByUsers: any[] = [];
      if (lovedSettled.status === 'fulfilled' && lovedSettled.value?.data?.[0]) {
        lovedByCount = lovedSettled.value.data[0].total_count || 0;
        lovedByUsers = (lovedSettled.value.data[0].public_users as any[]) || [];
      }

      let stylistRecommendation: StylistRecommendation | null = null;
      if (stylistSettled.status === 'fulfilled' && stylistSettled.value) {
        stylistRecommendation = stylistSettled.value;
      }

      return {
        soldCount,
        lovedByCount,
        lovedByUsers,
        stylistRecommendation,
      };
    } catch {
      return {
        soldCount: null,
        lovedByCount: 0,
        lovedByUsers: [],
        stylistRecommendation: null,
      };
    } finally {
      cleanup();
    }
  },
};
