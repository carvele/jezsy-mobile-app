import { supabase } from '@/src/lib/supabase';
import { OffsetPageResult } from '@/src/types/pagination';
import { Database } from '@/src/types/database.types';
import { AddWardrobeItemInput, CapsuleItemInput } from '@/src/types/dto/wardrobeItem';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';
import { resolveEffectiveGarmentBucket } from '../utils/garmentSemanticClassifier';

export type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];
export type SavedOutfit = Database['public']['Tables']['saved_outfits']['Row'];

export type Capsule = {
  id: string;
  name: string;
  description: string | null;
  target_count: number;
  item_count: number;
};

export type WardrobeFilter = {
  garmentType?: string | null;
  search?: string;
  wearFilter?: 'all' | 'never' | 'neglected';
};

const NEGLECT_MS = 60 * 86_400_000;

export async function getWardrobeItemsPage(
  userId: string,
  offset = 0,
  filters: WardrobeFilter = {},
  limit = 50
): Promise<OffsetPageResult<WardrobeItem>> {
  let query = supabase
    .from('wardrobe_items')
    .select('*')
    .eq('user_id', userId)
    .eq('deleted', false);

  if (filters.garmentType) {
    query = query.eq('garment_type', filters.garmentType);
  }

  if (filters.wearFilter === 'never') {
    query = query.eq('wear_count', 0);
  } else if (filters.wearFilter === 'neglected') {
    const cutoff = new Date(Date.now() - NEGLECT_MS).toISOString();
    query = query.gt('wear_count', 0).lt('last_worn_at', cutoff);
  }

  const q = filters.search?.trim();
  if (q) {
    query = query.or(`garment_type.ilike.%${q}%,category.ilike.%${q}%,sub_category.ilike.%${q}%,description.ilike.%${q}%`);
  }

  query = query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  const { data, error } = await query;
  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const items = raw.slice(0, limit);

  // Self-heal legacy items where garment_type was set to 'Top' but evidence proves otherwise
  for (const item of items) {
    const effective = resolveEffectiveGarmentBucket(item);
    if (effective !== item.garment_type && (item.garment_type === 'Top' || !item.garment_type)) {
      item.garment_type = effective;
      supabase
        .from('wardrobe_items')
        .update({ garment_type: effective })
        .eq('id', item.id)
        .then(() => {});
    }
  }

  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}

export async function getWardrobeOutfitsPage(
  userId: string,
  offset = 0,
  limit = 25
): Promise<OffsetPageResult<SavedOutfit>> {
  const { data, error } = await supabase
    .from('saved_outfits')
    .select('*')
    .eq('user_id', userId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const items = raw.slice(0, limit);

  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}

export async function getWardrobeCapsulesPage(
  userId: string,
  offset = 0,
  limit = 25
): Promise<OffsetPageResult<Capsule>> {
  const { data, error } = await supabase
    .from('capsules')
    .select('*, capsule_items(wardrobe_items!inner(deleted))')
    .eq('user_id', userId)
    .eq('capsule_items.wardrobe_items.deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const pageItems = raw.slice(0, limit);

  const mappedCapsules: Capsule[] = pageItems.map((c: any) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    target_count: c.target_count || 30,
    item_count: c.capsule_items?.length || 0,
  }));

  return {
    items: mappedCapsules,
    hasMore,
    nextOffset: offset + mappedCapsules.length,
  };
}

/**
 * Adds a new item to the user's wardrobe.
 */
export async function addItem(input: AddWardrobeItemInput): Promise<DomainResult<void>> {
  try {
    const effectiveColorTags = input.colorTags && input.colorTags.length > 0
      ? input.colorTags
      : input.color
      ? [input.color]
      : null;

    const effectiveOccasions = input.occasions && input.occasions.length > 0
      ? input.occasions
      : input.whereWornOften
      ? [input.whereWornOften]
      : null;

    const insertPayload: Record<string, any> = {
      user_id: input.userId,
      category: input.category,
      garment_type: input.garmentType,
      sub_category: input.subCategory ?? null,
      image_url: input.imageUrl,
      color_tags: effectiveColorTags,
    };

    if (input.description) insertPayload.description = input.description;
    if (input.userNotes) insertPayload.user_notes = input.userNotes;
    if (input.pattern) insertPayload.pattern = input.pattern;
    if (input.material) insertPayload.material = input.material;
    if (input.fit) insertPayload.fit = input.fit;
    if (input.lengthType) insertPayload.length_type = input.lengthType;
    if (input.sleeveType) insertPayload.sleeve_type = input.sleeveType;
    if (input.neckline) insertPayload.neckline = input.neckline;
    if (input.silhouette) insertPayload.silhouette = input.silhouette;
    if (effectiveOccasions) insertPayload.occasions = effectiveOccasions;
    if (input.seasons && input.seasons.length > 0) insertPayload.seasons = input.seasons;
    if (input.colorDetails && input.colorDetails.length > 0) insertPayload.color_details = input.colorDetails;
    if (input.isCustomCategory !== undefined) insertPayload.is_custom_category = input.isCustomCategory;

    const hasAiAttrs = Boolean(
      input.aiAttributes ||
      input.color ||
      input.whereWornOften ||
      input.description !== undefined ||
      input.userNotes !== undefined
    );
    if (hasAiAttrs) {
      const aiAttrs: Record<string, any> = {
        ...(input.aiAttributes || {}),
      };
      if (input.color || (input.aiAttributes as any)?.rawColor) {
        aiAttrs.rawColor = input.color || (input.aiAttributes as any)?.rawColor;
      }
      if (input.whereWornOften || (input.aiAttributes as any)?.whereWornOften) {
        aiAttrs.whereWornOften = input.whereWornOften || (input.aiAttributes as any)?.whereWornOften;
      }
      if (input.description !== undefined || (input.aiAttributes as any)?.description !== undefined) {
        aiAttrs.description = input.description ?? (input.aiAttributes as any)?.description;
      }
      if (input.userNotes !== undefined || (input.aiAttributes as any)?.userNotes !== undefined) {
        aiAttrs.userNotes = input.userNotes ?? (input.aiAttributes as any)?.userNotes;
      }
      insertPayload.ai_attributes = aiAttrs;
    }

    if (input.aiConfidence !== undefined) insertPayload.ai_confidence = input.aiConfidence;
    if (input.userCorrections) insertPayload.user_corrections = input.userCorrections;
    if (input.embedding) insertPayload.embedding = input.embedding;

    let { error } = await (supabase.from('wardrobe_items') as any).insert(insertPayload);

    // Fallback: If newer columns (e.g. ai_attributes) are pending in schema cache or unapplied migration, retry with base columns
    if (error && (error.code === 'PGRST204' || error.message?.includes('schema cache') || error.message?.includes('column'))) {
      const basePayload: Record<string, any> = {
        user_id: input.userId,
        category: input.category,
        garment_type: input.garmentType,
        sub_category: input.subCategory ?? null,
        image_url: input.imageUrl,
        color_tags: input.colorTags ?? null,
      };
      const retry = await (supabase.from('wardrobe_items') as any).insert(basePayload);
      if (!retry.error) {
        return domainOk(undefined);
      }
      error = retry.error;
    }

    if (error) {
      throw error;
    }

    return domainOk(undefined);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_WARDROBE_ITEM_ADD_FAILED',
      message: err?.message || 'Failed to add wardrobe item',
      domain: 'wardrobe',
      context: { operation: 'addItem', userId: input.userId },
      cause: err,
    });

    errorReporting.capture(domainError, {
      domain: 'wardrobe',
      operation: 'addItem',
    });

    return domainFail(domainError);
  }
}

/**
 * Adds a wardrobe item to a capsule collection.
 */
export async function addCapsuleItem(input: CapsuleItemInput): Promise<DomainResult<void>> {
  try {
    const { error } = await supabase.from('capsule_items').insert({
      capsule_id: input.capsuleId,
      wardrobe_item_id: input.wardrobeItemId,
    });

    if (error) {
      throw error;
    }

    return domainOk(undefined);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_CAPSULE_ITEM_ADD_FAILED',
      message: err?.message || 'Failed to add item to capsule',
      domain: 'wardrobe',
      context: { operation: 'addCapsuleItem', capsuleId: input.capsuleId, wardrobeItemId: input.wardrobeItemId },
      cause: err,
    });

    errorReporting.capture(domainError, {
      domain: 'wardrobe',
      operation: 'addCapsuleItem',
    });

    return domainFail(domainError);
  }
}

/**
 * Removes a wardrobe item from a capsule collection.
 */
export async function removeCapsuleItem(input: CapsuleItemInput): Promise<DomainResult<void>> {
  try {
    const { error } = await supabase
      .from('capsule_items')
      .delete()
      .eq('capsule_id', input.capsuleId)
      .eq('wardrobe_item_id', input.wardrobeItemId);

    if (error) {
      throw error;
    }

    return domainOk(undefined);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_CAPSULE_ITEM_REMOVE_FAILED',
      message: err?.message || 'Failed to remove item from capsule',
      domain: 'wardrobe',
      context: { operation: 'removeCapsuleItem', capsuleId: input.capsuleId, wardrobeItemId: input.wardrobeItemId },
      cause: err,
    });

    errorReporting.capture(domainError, {
      domain: 'wardrobe',
      operation: 'removeCapsuleItem',
    });

    return domainFail(domainError);
  }
}

/**
 * Deletes a capsule collection.
 */
export async function deleteCapsule(capsuleId: string): Promise<DomainResult<void>> {
  try {
    const { error } = await supabase.from('capsules').delete().eq('id', capsuleId);

    if (error) {
      throw error;
    }

    return domainOk(undefined);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_CAPSULE_DELETE_FAILED',
      message: err?.message || 'Failed to delete capsule',
      domain: 'wardrobe',
      context: { operation: 'deleteCapsule', capsuleId },
      cause: err,
    });

    errorReporting.capture(domainError, {
      domain: 'wardrobe',
      operation: 'deleteCapsule',
    });

    return domainFail(domainError);
  }
}

/**
 * Updates a capsule's personal item-count goal. Not an enforced cap --
 * capsule_items has no limit check -- just the number shown on the
 * progress bar, editable after creation for when the user under- or
 * over-estimated it at creation time.
 */
export async function updateCapsuleGoal(capsuleId: string, targetCount: number): Promise<DomainResult<void>> {
  try {
    const { error } = await supabase
      .from('capsules')
      .update({ target_count: targetCount })
      .eq('id', capsuleId);

    if (error) {
      throw error;
    }

    return domainOk(undefined);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_CAPSULE_GOAL_UPDATE_FAILED',
      message: err?.message || 'Failed to update capsule goal',
      domain: 'wardrobe',
      context: { operation: 'updateCapsuleGoal', capsuleId, targetCount },
      cause: err,
    });

    errorReporting.capture(domainError, {
      domain: 'wardrobe',
      operation: 'updateCapsuleGoal',
    });

    return domainFail(domainError);
  }
}

export const wardrobeService = {
  getItemsPage: getWardrobeItemsPage,
  getOutfitsPage: getWardrobeOutfitsPage,
  getCapsulesPage: getWardrobeCapsulesPage,
  addItem,
  addCapsuleItem,
  removeCapsuleItem,
  deleteCapsule,
  updateCapsuleGoal,
};
