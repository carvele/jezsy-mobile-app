import { ColorDetailItem } from './aiAttributes';

export interface AddWardrobeItemInput {
  userId: string;
  category: string;
  garmentType: string;
  subCategory?: string | null;
  imageUrl: string;
  color?: string | null;
  colorTags?: string[] | null;
  whereWornOften?: string | null;
  description?: string | null;
  userNotes?: string | null;
  pattern?: string | null;
  material?: string | null;
  fit?: string | null;
  lengthType?: string | null;
  sleeveType?: string | null;
  neckline?: string | null;
  silhouette?: string | null;
  occasions?: string[] | null;
  seasons?: string[] | null;
  colorDetails?: ColorDetailItem[] | null;
  isCustomCategory?: boolean | null;
  aiAttributes?: Record<string, unknown> | null;
  aiConfidence?: number | null;
  userCorrections?: Record<string, unknown> | null;
  embedding?: unknown | null;
}

export interface CapsuleItemInput {
  capsuleId: string;
  wardrobeItemId: string;
}

export interface WardrobeItemDto {
  id: string;
  user_id: string | null;
  category: string | null;
  garment_type: string | null;
  sub_category: string | null;
  image_url: string | null;
  color?: string | null;
  color_tags: string[] | null;
  where_worn_often?: string | null;
  wear_count: number;
  last_worn_at: string | null;
  created_at: string;
  deleted: boolean | null;
  description?: string | null;
  user_notes?: string | null;
  pattern?: string | null;
  material?: string | null;
  fit?: string | null;
  length_type?: string | null;
  sleeve_type?: string | null;
  neckline?: string | null;
  silhouette?: string | null;
  occasions?: string[] | null;
  seasons?: string[] | null;
  color_details?: ColorDetailItem[] | null;
  is_custom_category?: boolean | null;
  ai_attributes?: Record<string, unknown> | null;
  ai_confidence?: number | null;
  user_corrections?: Record<string, unknown> | null;
  embedding?: unknown | null;
}
