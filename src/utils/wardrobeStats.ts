import { Database } from '@/src/types/database.types';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export interface WardrobeStats {
  total: number;
  neverWorn: number;
  neglected: number;
  mostWorn: WardrobeItem | null;
  totalWears: number;
}

const NEGLECT_DAYS = 60;

// 0..1, higher means the item has been ignored longer.
function neglect(item: WardrobeItem): number {
  if (!item.wear_count) return 1;
  if (!item.last_worn_at) return 0.6;
  const days = (Date.now() - new Date(item.last_worn_at).getTime()) / 86_400_000;
  return Math.max(0, Math.min(1, days / NEGLECT_DAYS));
}

/**
 * Aggregates wear and neglect data recorded across wardrobe items.
 */
export function computeStats(items: WardrobeItem[]): WardrobeStats {
  const neverWorn = items.filter((i) => !i.wear_count).length;
  const neglected = items.filter((i) => i.wear_count > 0 && neglect(i) >= 1).length;
  const mostWorn = items.reduce<WardrobeItem | null>(
    (best, i) => (!best || (i.wear_count || 0) > (best.wear_count || 0) ? i : best),
    null
  );
  const totalWears = items.reduce((sum, i) => sum + (i.wear_count || 0), 0);

  return {
    total: items.length,
    neverWorn,
    neglected,
    mostWorn,
    totalWears,
  };
}
