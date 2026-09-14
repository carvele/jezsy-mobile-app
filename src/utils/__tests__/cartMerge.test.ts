import {
  CartItem,
  migrateLegacyCartItem,
  normalizeCartItems,
  mergeCarts,
  VariantLookupItem,
} from '../cartMerge';

const mockProduct = (id: string, name: string): any => ({
  id,
  name,
  price: 500,
  sale_price: null,
  on_sale: false,
  image_url: null,
  visibility: 'public',
  deleted: false,
});

describe('cartMerge', () => {
  describe('migrateLegacyCartItem', () => {
    it('preserves items that already have a canonical variantId', () => {
      const canonical = {
        id: 'var-123',
        variantId: 'var-123',
        product: mockProduct('prod-1', 'Silk Dress'),
        quantity: 2,
        selectedSize: 'M',
        selectedColor: 'Blue',
      };

      const result = migrateLegacyCartItem(canonical);
      expect(result).toEqual(canonical);
    });

    it('resolves legacy item variantId from variant lookup table', () => {
      const legacy = {
        id: 'legacy-key-1',
        product: mockProduct('prod-1', 'Silk Dress'),
        quantity: 1,
        selectedSize: 'S',
        selectedColor: 'Red',
      };

      const lookup: VariantLookupItem[] = [
        { id: 'var-s-red', product_doc_id: 'prod-1', size: 'S', color: 'Red' },
        { id: 'var-m-red', product_doc_id: 'prod-1', size: 'M', color: 'Red' },
      ];

      const result = migrateLegacyCartItem(legacy, lookup);
      expect(result).not.toBeNull();
      expect(result?.variantId).toBe('var-s-red');
      expect(result?.id).toBe('var-s-red');
    });

    it('falls back to surrogate key when lookup fails', () => {
      const legacy = {
        id: 'prod-1-M-Blue',
        product: mockProduct('prod-1', 'Silk Dress'),
        quantity: 1,
        selectedSize: 'M',
        selectedColor: 'Blue',
      };

      const result = migrateLegacyCartItem(legacy, []);
      expect(result).not.toBeNull();
      expect(result?.variantId).toBe('prod-1-M-Blue');
    });

    it('rejects invalid or non-positive quantity items', () => {
      expect(migrateLegacyCartItem(null)).toBeNull();
      expect(migrateLegacyCartItem({ product: null, quantity: 1 })).toBeNull();
      expect(migrateLegacyCartItem({ product: mockProduct('p1', 'Tee'), quantity: 0 })).toBeNull();
      expect(migrateLegacyCartItem({ product: mockProduct('p1', 'Tee'), quantity: -5 })).toBeNull();
    });
  });

  describe('normalizeCartItems', () => {
    it('normalizes a mixed list of legacy and modern items', () => {
      const mixed = [
        {
          id: 'v1',
          variantId: 'v1',
          product: mockProduct('p1', 'Item 1'),
          quantity: 2,
        },
        {
          id: 'p2-L-Green',
          product: mockProduct('p2', 'Item 2'),
          quantity: 1,
          selectedSize: 'L',
          selectedColor: 'Green',
        },
        null,
      ];

      const lookup: VariantLookupItem[] = [
        { id: 'v2-resolved', product_doc_id: 'p2', size: 'L', color: 'Green' },
      ];

      const normalized = normalizeCartItems(mixed, lookup);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].variantId).toBe('v1');
      expect(normalized[1].variantId).toBe('v2-resolved');
    });
  });

  describe('mergeCarts', () => {
    it('merges overlapping items by variantId and sums quantities', () => {
      const guestCart: CartItem[] = [
        {
          id: 'var-1',
          variantId: 'var-1',
          product: mockProduct('p1', 'Silk Shirt'),
          quantity: 2,
        },
        {
          id: 'var-2',
          variantId: 'var-2',
          product: mockProduct('p2', 'Linen Pants'),
          quantity: 1,
        },
      ];

      const accountCart: CartItem[] = [
        {
          id: 'var-1',
          variantId: 'var-1',
          product: mockProduct('p1', 'Silk Shirt'),
          quantity: 3,
        },
        {
          id: 'var-3',
          variantId: 'var-3',
          product: mockProduct('p3', 'Scarf'),
          quantity: 1,
        },
      ];

      const merged = mergeCarts(guestCart, accountCart);
      expect(merged).toHaveLength(3);

      const var1 = merged.find((i) => i.variantId === 'var-1');
      expect(var1?.quantity).toBe(5); // 3 + 2

      const var2 = merged.find((i) => i.variantId === 'var-2');
      expect(var2?.quantity).toBe(1);

      const var3 = merged.find((i) => i.variantId === 'var-3');
      expect(var3?.quantity).toBe(1);
    });

    it('clamps quantity to maxQuantity when available', () => {
      const guestCart: CartItem[] = [
        {
          id: 'var-1',
          variantId: 'var-1',
          product: mockProduct('p1', 'Silk Shirt'),
          quantity: 5,
          maxQuantity: 6,
        },
      ];

      const accountCart: CartItem[] = [
        {
          id: 'var-1',
          variantId: 'var-1',
          product: mockProduct('p1', 'Silk Shirt'),
          quantity: 4,
          maxQuantity: 6,
        },
      ];

      const merged = mergeCarts(guestCart, accountCart);
      expect(merged[0].quantity).toBe(6); // Clamped from 9 to 6
    });

    it('filters out unavailable / sold-out variants when availableVariantIds set is supplied', () => {
      const guestCart: CartItem[] = [
        {
          id: 'var-available',
          variantId: 'var-available',
          product: mockProduct('p1', 'Silk Shirt'),
          quantity: 1,
        },
        {
          id: 'var-sold-out',
          variantId: 'var-sold-out',
          product: mockProduct('p2', 'Sold Out Jacket'),
          quantity: 1,
        },
      ];

      const availableSet = new Set(['var-available']);
      const merged = mergeCarts(guestCart, [], { availableVariantIds: availableSet });

      expect(merged).toHaveLength(1);
      expect(merged[0].variantId).toBe('var-available');
    });
  });
});
