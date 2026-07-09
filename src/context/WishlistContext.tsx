import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

type WishlistContextType = {
  wishlistIds: Set<string>;
  isInWishlist: (productId: string) => boolean;
  toggleWishlist: (productId: string) => Promise<void>;
  isLoading: boolean;
};

const WishlistContext = createContext<WishlistContextType>({
  wishlistIds: new Set(),
  isInWishlist: () => false,
  toggleWishlist: async () => {},
  isLoading: false,
});

export const WishlistProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const fetchWishlist = useCallback(async () => {
    if (!user?.id) { setWishlistIds(new Set()); return; }
    try {
      const { data, error } = await supabase
        .from('wishlists')
        .select('product_id')
        .eq('user_id', user.id);
      if (!error && data) {
        setWishlistIds(new Set(data.map((w) => w.product_id)));
      }
    } catch (err) {
      console.error('Error fetching wishlist:', err);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchWishlist();
  }, [fetchWishlist]);

  const isInWishlist = useCallback(
    (productId: string) => wishlistIds.has(productId),
    [wishlistIds],
  );

  const toggleWishlist = useCallback(async (productId: string) => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in to save items to your wishlist.');
      return;
    }

    const alreadySaved = wishlistIds.has(productId);

    // Optimistic update
    setWishlistIds((prev) => {
      const next = new Set(prev);
      if (alreadySaved) { next.delete(productId); } else { next.add(productId); }
      return next;
    });

    setIsLoading(true);
    try {
      if (alreadySaved) {
        const { error } = await supabase
          .from('wishlists')
          .delete()
          .eq('user_id', user.id)
          .eq('product_id', productId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('wishlists')
          .upsert(
            { user_id: user.id, product_id: productId },
            { onConflict: 'user_id,product_id' }
          );
        if (error) throw error;
      }
    } catch (err) {
      // Revert optimistic update on failure
      setWishlistIds((prev) => {
        const next = new Set(prev);
        if (alreadySaved) { next.add(productId); } else { next.delete(productId); }
        return next;
      });
      console.error('Error toggling wishlist:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, wishlistIds]);

  return (
    <WishlistContext.Provider value={{ wishlistIds, isInWishlist, toggleWishlist, isLoading }}>
      {children}
    </WishlistContext.Provider>
  );
};

export const useWishlist = () => useContext(WishlistContext);
