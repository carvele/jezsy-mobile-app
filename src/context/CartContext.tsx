import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Database } from '@/src/types/database.types';
import { useAuth } from '@/src/context/AuthContext';
import { cartStorageKey, LEGACY_CART_STORAGE_KEYS } from '@/src/utils/cartStorage';
import { CartItem, normalizeCartItems, mergeCarts } from '@/src/utils/cartMerge';

export type { CartItem } from '@/src/utils/cartMerge';

type Product = Database['public']['Tables']['products']['Row'];

interface CartContextData {
  items: CartItem[];
  addToCart: (
    product: Product,
    variantId: string,
    quantity: number,
    size?: string,
    color?: string,
    maxQuantity?: number,
  ) => Promise<void>;
  removeFromCart: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  updateVariant: (
    oldItemId: string,
    newVariantId: string,
    size?: string,
    color?: string,
    maxQuantity?: number,
  ) => Promise<void>;
  removeItems: (itemIds: string[]) => Promise<void>;
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
  removeItems: async () => {},
  clearCart: async () => {},
  totalAmount: 0,
  itemCount: 0,
});

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const userId = user?.id ?? null;
  const storageKey = useMemo(() => cartStorageKey(userId), [userId]);

  useEffect(() => {
    let cancelled = false;

    const loadCart = async () => {
      if (isAuthLoading) {
        setItems([]);
        return;
      }

      try {
        if (userId) {
          // User is authenticated: check for guest cart to merge
          const guestKey = cartStorageKey(null);
          const guestRaw = await AsyncStorage.getItem(guestKey);
          const userRaw = await AsyncStorage.getItem(storageKey);

          const guestItems = guestRaw ? normalizeCartItems(JSON.parse(guestRaw)) : [];
          const userItems = userRaw ? normalizeCartItems(JSON.parse(userRaw)) : [];

          if (guestItems.length > 0) {
            const merged = mergeCarts(guestItems, userItems);
            // Atomically persist merged cart to user storage
            await AsyncStorage.setItem(storageKey, JSON.stringify(merged));
            // Only after successful write, remove guest cart
            await AsyncStorage.removeItem(guestKey);
            if (!cancelled) setItems(merged);
          } else {
            if (!cancelled) setItems(userItems);
          }
        } else {
          // Guest user: load guest cart
          let stored = await AsyncStorage.getItem(storageKey);
          if (!stored) {
            stored = await AsyncStorage.getItem(LEGACY_CART_STORAGE_KEYS[0]);
            if (stored) await AsyncStorage.setItem(storageKey, stored);
          }
          await AsyncStorage.multiRemove([...LEGACY_CART_STORAGE_KEYS]);
          if (!cancelled) setItems(stored ? normalizeCartItems(JSON.parse(stored)) : []);
        }
      } catch (err) {
        console.error('Failed to load cart', err);
        if (!cancelled) setItems([]);
      }
    };

    void loadCart();
    return () => {
      cancelled = true;
    };
  }, [isAuthLoading, storageKey, userId]);

  const addToCart = useCallback(
    async (
      product: Product,
      variantId: string,
      quantity: number,
      size?: string,
      color?: string,
      maxQuantity?: number,
    ) => {
      setItems((prev) => {
        const existing = prev.find((i) => i.variantId === variantId);
        const maxQty = maxQuantity ?? Infinity;
        let newItems: CartItem[];

        if (existing) {
          newItems = prev.map((i) =>
            i.variantId === variantId
              ? { ...i, quantity: Math.min(i.quantity + quantity, maxQty), maxQuantity }
              : i,
          );
        } else {
          newItems = [
            ...prev,
            {
              id: variantId,
              variantId,
              product,
              quantity: Math.min(quantity, maxQty),
              selectedSize: size,
              selectedColor: color,
              maxQuantity,
            },
          ];
        }

        AsyncStorage.setItem(storageKey, JSON.stringify(newItems)).catch((e: any) =>
          console.error('Failed to save cart:', e),
        );
        return newItems;
      });
    },
    [storageKey],
  );

  const removeFromCart = useCallback(
    async (itemId: string) => {
      setItems((prev) => {
        const newItems = prev.filter((i) => i.id !== itemId && i.variantId !== itemId);
        AsyncStorage.setItem(storageKey, JSON.stringify(newItems)).catch((e: any) =>
          console.error('Failed to save cart:', e),
        );
        return newItems;
      });
    },
    [storageKey],
  );

  const updateQuantity = useCallback(
    async (itemId: string, quantity: number) => {
      setItems((prev) => {
        const newItems = prev.map((i) => {
          if (i.id !== itemId && i.variantId !== itemId) return i;
          const maxQty = i.maxQuantity ?? Infinity;
          return { ...i, quantity: Math.min(Math.max(1, quantity), maxQty) };
        });
        AsyncStorage.setItem(storageKey, JSON.stringify(newItems)).catch((e: any) =>
          console.error('Failed to save cart:', e),
        );
        return newItems;
      });
    },
    [storageKey],
  );

  const updateVariant = useCallback(
    async (
      oldItemId: string,
      newVariantId: string,
      size?: string,
      color?: string,
      maxQuantity?: number,
    ) => {
      setItems((prev) => {
        const item = prev.find((i) => i.id === oldItemId || i.variantId === oldItemId);
        if (!item) return prev;

        if (newVariantId === item.variantId) return prev;

        const maxQty = maxQuantity ?? Infinity;
        const existing = prev.find((i) => i.variantId === newVariantId);
        let newItems: CartItem[];

        if (existing) {
          newItems = prev
            .filter((i) => i.id !== oldItemId && i.variantId !== oldItemId)
            .map((i) =>
              i.variantId === newVariantId
                ? { ...i, quantity: Math.min(i.quantity + item.quantity, maxQty), maxQuantity }
                : i,
            );
        } else {
          newItems = prev.map((i) =>
            i.id === oldItemId || i.variantId === oldItemId
              ? {
                  ...i,
                  id: newVariantId,
                  variantId: newVariantId,
                  selectedSize: size,
                  selectedColor: color,
                  quantity: Math.min(i.quantity, maxQty),
                  maxQuantity,
                }
              : i,
          );
        }

        AsyncStorage.setItem(storageKey, JSON.stringify(newItems)).catch((e: any) =>
          console.error('Failed to save cart:', e),
        );
        return newItems;
      });
    },
    [storageKey],
  );

  const removeItems = useCallback(
    async (itemIds: string[]) => {
      setItems((prev) => {
        const remaining = prev.filter((i) => !itemIds.includes(i.id) && !itemIds.includes(i.variantId));
        AsyncStorage.setItem(storageKey, JSON.stringify(remaining)).catch((e: any) =>
          console.error('Failed to save cart:', e),
        );
        return remaining;
      });
    },
    [storageKey],
  );

  const clearCart = useCallback(async () => {
    setItems([]);
    await AsyncStorage.removeItem(storageKey);
  }, [storageKey]);

  const totalAmount = items.reduce((sum, item) => {
    const { on_sale, sale_price, price } = item.product;
    const unitPrice = on_sale && sale_price ? sale_price : (price || 0);
    return sum + unitPrice * item.quantity;
  }, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        updateQuantity,
        updateVariant,
        removeItems,
        clearCart,
        totalAmount,
        itemCount,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
