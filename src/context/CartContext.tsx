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
}

interface CartContextData {
  items: CartItem[];
  addToCart: (product: Product, quantity: number, size?: string, color?: string) => Promise<void>;
  removeFromCart: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  totalAmount: number;
  itemCount: number;
}

const CartContext = createContext<CartContextData>({
  items: [],
  addToCart: async () => {},
  removeFromCart: async () => {},
  updateQuantity: async () => {},
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

  const addToCart = useCallback(async (product: Product, quantity: number, size?: string, color?: string) => {
    setItems((prev) => {
      const itemId = `${product.id}-${size || ''}-${color || ''}`;
      const existing = prev.find(i => i.id === itemId);
      let newItems;
      
      if (existing) {
        newItems = prev.map(i => 
          i.id === itemId ? { ...i, quantity: i.quantity + quantity } : i
        );
      } else {
        newItems = [...prev, {
          id: itemId,
          product,
          quantity,
          selectedSize: size,
          selectedColor: color
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
      const newItems = prev.map(i => i.id === itemId ? { ...i, quantity: Math.max(1, quantity) } : i);
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
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, totalAmount, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
