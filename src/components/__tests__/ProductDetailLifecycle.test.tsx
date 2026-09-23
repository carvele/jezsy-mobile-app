import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { resolveSelectedInventoryVariant } from '@/app/product/[id]';
import ProductDetailScreen from '@/app/product/[id]';
import { supabase } from '@/src/lib/supabase';

// Mock all external dependencies
jest.mock('expo-asset', () => ({
  Asset: { fromModule: jest.fn().mockReturnValue({ uri: 'mock-asset' }) },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'prod-123' }),
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
  useFocusEffect: (cb: any) => {
    React.useEffect(() => {
      cb();
    }, [cb]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/src/hooks/useSafeBack', () => ({
  useSafeBack: () => jest.fn(),
}));

jest.mock('@/src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-123' },
    profile: { role: 'customer' },
  }),
}));

jest.mock('@/src/context/WishlistContext', () => ({
  useWishlist: () => ({
    isInWishlist: jest.fn().mockReturnValue(false),
    toggleWishlist: jest.fn(),
  }),
}));

jest.mock('@/src/context/CartContext', () => ({
  useCart: () => ({
    addToCart: jest.fn(),
  }),
}));

jest.mock('@/src/context/MessagesContext', () => ({
  useMessages: () => ({
    getOrCreateConversation: jest.fn(),
  }),
}));

jest.mock('@/src/services/virtualStylistService', () => ({
  getStylistRecommendation: jest.fn().mockResolvedValue({
    sizeRecommendation: { size: 'One Size' },
  }),
}));

jest.mock('@/src/utils/recentlyViewed', () => ({
  addRecentlyViewed: jest.fn(),
}));

jest.mock('@/src/features/systemTour/tourEvents', () => ({
  emitTourEvent: jest.fn(),
}));

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('expo-blur', () => ({
  BlurView: ({ children }: any) => children,
}));

jest.mock('@/src/components/ReviewsList', () => ({
  ReviewsList: () => null,
}));

jest.mock('@/src/components/RelatedProducts', () => ({
  RelatedProducts: () => null,
}));

jest.mock('@/src/components/RecentlyViewed', () => ({
  RecentlyViewed: () => null,
}));

jest.mock('@/components/CompleteTheLookSection', () => ({
  __esModule: true,
  default: () => null,
  CompleteTheLookSection: () => null,
}));
jest.mock('@/components/StyledLooksSection', () => ({
  __esModule: true,
  default: () => null,
  StyledLooksSection: () => null,
}));
jest.mock('@/src/components/StylistSummary', () => ({
  StylistSummary: () => null,
}));
jest.mock('@/src/components/SizeChartModal', () => ({
  SizeChartModal: () => null,
}));
jest.mock('@/src/components/ImageViewerModal', () => ({
  ImageViewerModal: () => null,
}));
jest.mock('@/src/components/SoftAuthModal', () => ({
  SoftAuthModal: () => null,
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ProductDetailScreen Hook Ordering & Lifecycle (React #310 Prevention)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveSelectedInventoryVariant pure resolver', () => {
    it('returns null for empty variants', () => {
      expect(resolveSelectedInventoryVariant([], 'M', 'Pink')).toBeNull();
    });

    it('resolves exact size and color match', () => {
      const variants: any[] = [
        { id: 'v1', size: 'S', color: 'Pink' },
        { id: 'v2', size: 'M', color: 'Pink' },
      ];
      expect(resolveSelectedInventoryVariant(variants, 'M', 'Pink')).toEqual(variants[1]);
    });

    it('resolves single 1-of-1 variant when size/color not fully matching', () => {
      const variants: any[] = [{ id: 'v-single', size: 'One Size', color: 'Pink' }];
      expect(resolveSelectedInventoryVariant(variants, null, 'Pink')).toEqual(variants[0]);
    });

    it('resolves multi-color product variant matching color', () => {
      const variants: any[] = [
        { id: 'v-blue', size: 'M', color: 'Blue' },
        { id: 'v-yellow', size: 'M', color: 'Yellow' },
      ];
      expect(resolveSelectedInventoryVariant(variants, 'M', 'yellow')).toEqual(variants[1]);
    });
  });

  describe('ProductDetailScreen loading to loaded transition', () => {
    it('transitions from loading (Render 1) to loaded (Render 2) with ZERO React #310 hook-order errors', async () => {
      let resolveProduct: (value: any) => void;
      const productPromise = new Promise((res) => {
        resolveProduct = res;
      });

      const mockProduct = {
        id: 'prod-123',
        name: 'Majestic Pink Rhinestone Brooch',
        price: 99,
        stock: 10,
        status: 'In Boutique',
        visibility: 'public',
        deleted: false,
        sizes: ['One Size'],
        color: 'Pink',
        image_url: 'https://example.com/brooch.jpg',
      };

      const mockVariants = [
        {
          id: '1e309178-2afd-42f4-9218-24ad753c1fba',
          product_doc_id: 'prod-123',
          size: 'One Size',
          color: 'Pink',
          available: 10,
          is_available: true,
          deleted: false,
        },
      ];

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'products') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockReturnValue(productPromise),
              }),
            }),
          };
        }
        if (table === 'product_variants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: mockVariants, error: null }),
            }),
          };
        }
        if (table === 'stock_notify_requests') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
        };
      });

      (supabase.rpc as jest.Mock).mockResolvedValue({ data: 0, error: null });

      let renderer: ReactTestRenderer.ReactTestRenderer;

      // Render 1: Loading state (product data pending)
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(<ProductDetailScreen />);
      });

      // Verification of loading render
      expect(renderer!.toJSON()).toBeTruthy();

      // Render 2: Resolve product data -> transition to loaded
      await ReactTestRenderer.act(async () => {
        resolveProduct!({ data: mockProduct, error: null });
        // Let promises flush
        await new Promise((r) => setTimeout(r, 10));
      });

      // If hooks were conditional or added after early return, this step
      // would throw: "Rendered more hooks than during the previous render" (React #310).
      expect(renderer!.toJSON()).toBeTruthy();
    });
  });
});
