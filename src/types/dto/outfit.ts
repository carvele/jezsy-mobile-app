export interface OutfitItemDto {
  slot: string;
  name: string;
  image_url?: string | null;
  product_id?: string | null;
  wardrobe_item_id?: string | null;
  color_tags?: string[] | null;
  owned?: boolean;
  garment_type?: string | null;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  z_index?: number;
  canvas_bg?: string | null;
  drag_x?: number;
  drag_y?: number;
}

export interface SaveOutfitInput {
  userId: string;
  name: string;
  items: OutfitItemDto[];
}

export interface SaveOutfitResult {
  id: string;
}
