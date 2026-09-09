import { supabase } from '@/src/lib/supabase';
import { OffsetPageResult } from '@/src/types/pagination';
import { Database } from '@/src/types/database.types';
import { CATEGORY_SELECT, WithCategoryEmbed } from '@/src/utils/categoryDisplay';

export type WishlistProduct = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;

export async function getWishlistPage(
  userId: string,
  offset = 0,
  limit = 30
): Promise<OffsetPageResult<WishlistProduct>> {
  const { data, error } = await supabase
    .from('wishlists')
    .select(`id, created_at, products!inner(*, ${CATEGORY_SELECT})`)
    .eq('user_id', userId)
    .eq('products.deleted', false)
    .eq('products.visibility', 'public')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const pageRows = raw.slice(0, limit);

  const items = pageRows
    .map((row: any) => row.products)
    .filter(Boolean) as WishlistProduct[];

  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}
