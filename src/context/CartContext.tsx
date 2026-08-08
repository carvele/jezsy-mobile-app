import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Database } from '@/src/types/database.types';

type Product = Database['public']['Tables']['products']['Row'];

export interface CartItem {
  id: string; // Unique ID for the cart item (usually combination of productId + size + color)
  product: Product;
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
  /**
   * Per-size availability captured when the item was added, from
   * inventory.available for this exact (product, size).
   *
   * NOT product.stock -- that column is a derived SUM across every size
   * (see the sync_product_stock trigger), so capping on it let a customer
   * put 30 of a size that only had 6 into the bag. Undefined on items added
   * before this field existed, and on products with no tracked inventory;
   * both read as uncapped here.
   *
   * This is a UX affordance only. The real ceiling is enforced server-side
   * by the inventory-hold trigger on reservation_items -- this just avoids
   * letting someone build a bag the reservation will reject.
   */
  maxQuantity?: number;
}

interface CartContextData {
  items: CartItem[];
  addToCart: (product: Product, quantity: number, size?: string, color?: string, maxQuantity?: number) => Promise<void>;
  removeFromCart: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  updateVariant: (itemId: string, size?: string, color?: string, maxQuantity?: number) => Promise<void>;
  clearCart: () => Promise<void>;
  totalAmount: number;
  itemCount: number;
}

const CartContext = createContext<CartContextData>({
  items: [],
  addToCart: async () => {},
  removeFromCart: async () => {},
  updateQuantity: async () => {},
  updateVariant: async () => {},
  clearCart: async () => {},
  totalAmount: 0,
  itemCount: 0,
});

const CART_STORAGE_KEY = '@jezsy_cart';

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const loadCart = async () => {
      try {
        const stored = await AsyncStorage.getItem(CART_STORAGE_KEY);
        if (stored) {
          setItems(JSON.parse(stored));
        }
      } catch (err) {
        console.error('Failed to load cart', err);
      }
    };
    loadCart();
  }, []);

  const addToCart = useCallback(async (product: Product, quantity: number, size?: string, color?: string, maxQuantity?: number) => {
    setItems((prev) => {
      const itemId = `${product.id}-${size || ''}-${color || ''}`;
      const existing = prev.find(i => i.id === itemId);
      // Untracked stock reads as unlimited, matching src/utils/stock.ts's rule
      // and the server-side hold trigger, which also skips variants with no
      // inventory row rather than treating them as sold out.
      const maxQty = maxQuantity ?? Infinity;
      let newItems;

      if (existing) {
        newItems = prev.map(i =>
          i.id === itemId
            ? { ...i, quantity: Math.min(i.quantity + quantity, maxQty), maxQuantity }
            : i
        );
      } else {
        newItems = [...prev, {
          id: itemId,
          product,
          quantity: Math.min(quantity, maxQty),
          selectedSize: size,
          selectedColor: color,
          maxQuantity,
        }];
      }

      AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(newItems)).catch((e: any) => console.error(e));
      return newItems;
    });
  }, []);

  const removeFromCart = useCallback(async (itemId: string) => {
    setItems((prev) => {
      const newItems = prev.filter(i => i.id !== itemId);
      AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(newItems)).catch((e: any) => console.error(e));
      return newItems;
    });
  }, []);

  const updateQuantity = useCallback(async (itemId: string, quantity: number) => {
    setItems((prev) => {
      const newItems = prev.map(i => {
        if (i.id !== itemId) return i;
        const maxQty = i.maxQuantity ?? Infinity;
        return { ...i, quantity: Math.min(Math.max(1, quantity), maxQty) };
      });
      AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(newItems)).catch((e: any) => console.error(e));
      return newItems;
    });
  }, []);

  // Re-keys an item onto the (productId-size-color) id its new selection maps
  // to. If that id already has its own line -- the customer picked a variant
  // already in the bag -- the two merge, capped to stock, instead of leaving
  // two rows for the same product/size/color.
  const updateVariant = useCallback(async (itemId: string, size?: string, color?: string, maxQuantity?: number) => {
    setItems((prev) => {
      const item = prev.find(i => i.id === itemId);
      if (!item) return prev;

      const newItemId = `${item.product.id}-${size || ''}-${color || ''}`;
      if (newItemId === itemId) return prev;

      // The cap belongs to the size being switched TO, so the caller supplies
      // it -- the old item's maxQuantity described the old size and would be
      // wrong here.
      const maxQty = maxQuantity ?? Infinity;
      const existing = prev.find(i => i.id === newItemId);
      let newItems;

      if (existing) {
        newItems = prev
          .filter(i => i.id !== itemId)
          .map(i =>
            i.id === newItemId
              ? { ...i, quantity: Math.min(i.quantity + item.quantity, maxQty), maxQuantity }
              : i
          );
      } else {
        newItems = prev.map(i =>
          i.id === itemId
            ? { ...i, id: newItemId, selectedSize: size, selectedColor: color, quantity: Math.min(i.quantity, maxQty), maxQuantity }
            : i
        );
      }

      AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(newItems)).catch((e: any) => console.error(e));
      return newItems;
    });
  }, []);

  const clearCart = useCallback(async () => {
    setItems([]);
    await AsyncStorage.removeItem(CART_STORAGE_KEY);
  }, []);

  const totalAmount = items.reduce((sum, item) => {
    const { on_sale, sale_price, price } = item.product;
    const unitPrice = on_sale && sale_price ? sale_price : (price || 0);
    return sum + unitPrice * item.quantity;
  }, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, updateVariant, clearCart, totalAmount, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
