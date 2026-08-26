import { Database } from '@/src/types/database.types';

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
    yPercent: 0.05,
    scale: 0.60,
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
  const gType = wardrobeItem.garment_type || 'Top';
  const defaults = CATEGORY_PLACEMENT_DEFAULTS[gType] || DEFAULT_FALLBACK_PLACEMENT;

  return {
    id: `item_${wardrobeItem.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    wardrobe_item_id: wardrobeItem.id,
    image_url: wardrobeItem.image_url || '',
    name: wardrobeItem.sub_category || wardrobeItem.category || gType,
    garment_type: gType,
    x: 0, // centered
    y: defaults.yPercent,
    scale: defaults.scale,
    rotation: 0,
    zIndex: Math.max(defaults.zIndex, currentMaxZIndex + 1),
  };
}
