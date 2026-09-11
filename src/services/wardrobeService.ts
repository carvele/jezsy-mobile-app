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
    query = query.or(`garment_type.ilike.%${q}%,category.ilike.%${q}%,sub_category.ilike.%${q}%`);
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
    const { error } = await supabase.from('wardrobe_items').insert({
      user_id: input.userId,
      category: input.category,
      garment_type: input.garmentType,
      sub_category: input.subCategory ?? null,
      image_url: input.imageUrl,
      color_tags: input.colorTags ?? null,
    });

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

export const wardrobeService = {
  getItemsPage: getWardrobeItemsPage,
  getOutfitsPage: getWardrobeOutfitsPage,
  getCapsulesPage: getWardrobeCapsulesPage,
  addItem,
  addCapsuleItem,
  removeCapsuleItem,
  deleteCapsule,
};
