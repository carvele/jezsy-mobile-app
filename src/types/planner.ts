/**
 * Types and DTOs for Phase H1 Outfit Planner Core.
 */

export type PlannedOutfitStatus =
  | 'planned'
  | 'worn'
  | 'skipped'
  | 'cancelled'
  | 'unconfirmed';

export type PlannerSlot = 'all_day' | 'day' | 'evening' | 'workout';

export type PlannedOutfitSourceType =
  | 'manual'
  | 'saved_outfit'
  | 'style_advisor'
  | 'mannequin'
  | 'capsule'
  | 'trip';

export interface PlanLaterPayload {
  items: PlannedOutfitItemSnapshot[];
  sourceType: PlannedOutfitSourceType;
  sourceRefId?: string | null;
  occasion?: string | null;
  name?: string | null;
}

export interface PlannedOutfitItemSnapshot {
  id: string;
  name: string;
  category: string;
  sub_category?: string | null;
  color_tags?: string[] | null;
  image_url?: string | null;
}

export interface PlannedOutfit {
  id: string;
  user_id: string;
  planned_date: string; // ISO calendar day YYYY-MM-DD
  slot: PlannerSlot;
  plan_timezone: string; // IANA timezone e.g. 'Asia/Manila'
  saved_outfit_id?: string | null;
  items: PlannedOutfitItemSnapshot[];
  occasion?: string | null;
  climate_context?: string[] | null;
  notes?: string | null;
  status: PlannedOutfitStatus;
  worn_at?: string | null;
  confirmed_at?: string | null;
  source_type: PlannedOutfitSourceType;
  source_ref_id?: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

export interface CreatePlannedOutfitInput {
  plannedDate: string; // YYYY-MM-DD
  slot?: PlannerSlot;
  planTimezone: string;
  items: PlannedOutfitItemSnapshot[];
  occasion?: string;
  climateContext?: string[];
  notes?: string;
  savedOutfitId?: string;
  sourceType?: PlannedOutfitSourceType;
  sourceRefId?: string;
}

export interface UpdatePlannedOutfitMetadataInput {
  planId: string;
  expectedRevision: number;
  slot?: PlannerSlot;
  notes?: string;
  climateContext?: string[];
}

export interface ReschedulePlannedOutfitInput {
  planId: string;
  expectedRevision: number;
  newDate: string; // YYYY-MM-DD
  newSlot?: PlannerSlot;
}

export interface ConfirmWearResult {
  plan_id: string;
  saved_outfit_id?: string | null;
  item_ids: string[];
  worn_items: PlannedOutfitItemSnapshot[];
  occasion?: string | null;
  effective_wear_at: string;
  confirmed_at: string;
  new_revision: number;
}
