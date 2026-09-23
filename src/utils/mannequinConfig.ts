import { Database } from '@/src/types/database.types';
import {
  resolveEffectiveGarmentBucket,
  resolveAccessorySubtype,
} from './garmentSemanticClassifier';

export type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export interface MannequinCanvasItem {
  id: string; // unique instance ID on the canvas
  wardrobe_item_id: string;
  image_url: string;
  name: string;
  garment_type: string;
  x: number; // horizontal offset from center in canvas width ratio [-0.5, 0.5]
  y: number; // vertical offset from top in canvas height ratio [0, 1]
  scale: number; // relative scaling factor (1.0 = baseline)
  rotation: number; // in degrees
  zIndex: number; // stacking order
}

export interface SavedCanvasLayoutItem {
  wardrobe_item_id: string;
  image_url?: string;
  name?: string;
  garment_type?: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  z_index: number;
}

export interface CategoryPlacementDefault {
  xPercent?: number;
  yPercent: number; // relative vertical starting position (0 to 1)
  scale: number;
  zIndex: number;
  widthPercent: number; // relative width of garment bounding box
}

export const CATEGORY_PLACEMENT_DEFAULTS: Record<string, CategoryPlacementDefault> = {
  Top: {
    yPercent: 0.16,
    scale: 1.0,
    zIndex: 3,
    widthPercent: 0.34,
  },
  Bottom: {
    yPercent: 0.44,
    scale: 1.0,
    zIndex: 2,
    widthPercent: 0.32,
  },
  Dress: {
    yPercent: 0.16,
    scale: 1.0,
    zIndex: 3,
    widthPercent: 0.36,
  },
  Outerwear: {
    yPercent: 0.14,
    scale: 1.05,
    zIndex: 5,
    widthPercent: 0.38,
  },
  Shoes: {
    yPercent: 0.78,
    scale: 0.80,
    zIndex: 1,
    widthPercent: 0.26,
  },
  Accessory: {
    yPercent: 0.88,
    scale: 0.55,
    zIndex: 6,
    widthPercent: 0.20,
  },
};

export const DEFAULT_FALLBACK_PLACEMENT: CategoryPlacementDefault = {
  yPercent: 0.28,
  scale: 1.0,
  zIndex: 3,
  widthPercent: 0.32,
};

export function createMannequinItem(
  wardrobeItem: WardrobeItem,
  currentMaxZIndex: number = 0
): MannequinCanvasItem {
  const gType = resolveEffectiveGarmentBucket(wardrobeItem) || 'Top';
  const sub = resolveAccessorySubtype(wardrobeItem);
  const defaults = CATEGORY_PLACEMENT_DEFAULTS[gType] || DEFAULT_FALLBACK_PLACEMENT;

  let x = defaults.xPercent ?? 0;
  let y = defaults.yPercent;
  let scale = defaults.scale;
  let zIndex = defaults.zIndex;

  if (gType === 'Accessory') {
    // Check if asset has transparent background / alpha channel
    const hasAlpha =
      (wardrobeItem as any)?.ai_attributes?.hasAlpha === true ||
      (wardrobeItem as any)?.has_transparent_background === true ||
      Boolean(wardrobeItem.image_url && /\.png(\?|$)/i.test(wardrobeItem.image_url));

    if (sub === 'bag') {
      x = 0.26;
      y = 0.48;
      scale = 0.75;
      zIndex = 6;
    } else if (sub === 'belt') {
      x = 0;
      y = 0.42;
      scale = 0.85;
      zIndex = 4;
    } else if (hasAlpha) {
      if (sub === 'headwear' || sub === 'eyewear') {
        x = 0;
        y = 0.05;
        scale = 0.55;
        zIndex = 6;
      } else if (sub === 'scarf') {
        x = 0;
        y = 0.15;
        scale = 0.65;
        zIndex = 6;
      } else if (sub === 'watch' || sub === 'jewelry') {
        x = 0.20;
        y = 0.50;
        scale = 0.50;
        zIndex = 6;
      } else {
        x = 0;
        y = 0.88;
        scale = 0.55;
        zIndex = 6;
      }
    } else {
      // Opaque accessory -> safe flat-lay / shelf placement
      x = 0;
      y = 0.88;
      scale = 0.55;
      zIndex = 6;
    }
  }

  return {
    id: `item_${wardrobeItem.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    wardrobe_item_id: wardrobeItem.id,
    image_url: wardrobeItem.image_url || '',
    name: wardrobeItem.sub_category || wardrobeItem.category || gType,
    garment_type: gType,
    x,
    y,
    scale,
    rotation: 0,
    zIndex: Math.max(zIndex, currentMaxZIndex + 1),
  };
}

/**
 * Adds a new mannequin item to the canvas while strictly guaranteeing the invariant:
 * at most one canvas layer per wardrobe_item_id. If an item for the same wardrobe
 * item already exists, the current list is returned unchanged.
 */
export function addMannequinItemSafely(
  currentItems: MannequinCanvasItem[],
  newItem: MannequinCanvasItem
): MannequinCanvasItem[] {
  if (currentItems.some((i) => i.wardrobe_item_id === newItem.wardrobe_item_id)) {
    return currentItems;
  }
  const maxZ = currentItems.reduce((max, i) => Math.max(max, i.zIndex), 0);
  const placedItem = { ...newItem, zIndex: Math.max(newItem.zIndex, maxZ + 1) };
  return [...currentItems, placedItem];
}

