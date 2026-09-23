import { PlannedOutfitItemSnapshot } from '../types/planner';

/**
 * Raw item shape accepted from Saved Outfits, Style Advisor, Mannequin, or catalog objects.
 */
export interface RawPlannerCandidateItem {
  id?: string | null;
  wardrobe_item_id?: string | null;
  product_id?: string | null;
  name?: string | null;
  category?: string | null;
  sub_category?: string | null;
  color_tags?: string[] | null;
  image_url?: string | null;
  images?: string[] | null;
  [key: string]: any;
}

export interface SnapshotAdapterOptions {
  /**
   * Optional authoritative wardrobe inventory (either array of items or Set of active wardrobe IDs).
   * When provided, if an item only carries `id` without `wardrobe_item_id`, it is accepted
   * ONLY if its ID exists in this authoritative inventory.
   */
  authoritativeInventory?: { id: string }[] | Set<string> | Map<string, any>;
}

export interface SnapshotBuildResult {
  snapshots: PlannedOutfitItemSnapshot[];
  rejectedItems: {
    item: RawPlannerCandidateItem;
    reason: 'missing_wardrobe_id' | 'catalog_only_product' | 'unconfirmed_id';
  }[];
}

/**
 * Canonical adapter to build immutable PlannedOutfitItemSnapshot[] from any outfit source.
 * Strict rules:
 * 1. `wardrobe_item_id` preferred when present.
 * 2. `id` only accepted if authoritative inventory confirms it (or when authoritative inventory is not provided,
 *     ensures it is not a catalog-only item).
 * 3. `product_id` alone is rejected as catalog-only.
 * 4. Deduplicates items by wardrobe ID while strictly preserving source ensemble order.
 * 5. Extracts standard snapshot fields: id, name, category, sub_category, color_tags, image_url.
 */
export function buildPlannerItemSnapshotsDetailed(
  rawItems: RawPlannerCandidateItem[],
  options?: SnapshotAdapterOptions
): SnapshotBuildResult {
  const snapshots: PlannedOutfitItemSnapshot[] = [];
  const rejectedItems: SnapshotBuildResult['rejectedItems'] = [];
  const seenIds = new Set<string>();

  const inventorySet: Set<string> | null = options?.authoritativeInventory
    ? options.authoritativeInventory instanceof Set
      ? options.authoritativeInventory
      : options.authoritativeInventory instanceof Map
      ? new Set(options.authoritativeInventory.keys())
      : new Set(options.authoritativeInventory.map((i) => i.id))
    : null;

  for (const item of rawItems || []) {
    if (!item) continue;

    // Rule 3: product_id alone without wardrobe identity is strictly rejected
    if (item.product_id && !item.wardrobe_item_id && !item.id) {
      rejectedItems.push({ item, reason: 'catalog_only_product' });
      continue;
    }

    let resolvedWardrobeId: string | null = null;

    // Rule 1: wardrobe_item_id preferred when present
    if (item.wardrobe_item_id && typeof item.wardrobe_item_id === 'string' && item.wardrobe_item_id.trim() !== '') {
      resolvedWardrobeId = item.wardrobe_item_id.trim();
    } else if (item.id && typeof item.id === 'string' && item.id.trim() !== '') {
      // Rule 2: id only
      const candidateId = item.id.trim();
      // If item also has product_id and no wardrobe_item_id, verify candidateId is not merely product_id
      if (item.product_id && item.product_id === candidateId && !inventorySet?.has(candidateId)) {
        rejectedItems.push({ item, reason: 'catalog_only_product' });
        continue;
      }

      if (inventorySet) {
        if (inventorySet.has(candidateId)) {
          resolvedWardrobeId = candidateId;
        } else {
          rejectedItems.push({ item, reason: 'unconfirmed_id' });
          continue;
        }
      } else {
        resolvedWardrobeId = candidateId;
      }
    }

    if (!resolvedWardrobeId) {
      rejectedItems.push({ item, reason: 'missing_wardrobe_id' });
      continue;
    }

    // Deduplicate: preserve first occurrence in source order
    if (seenIds.has(resolvedWardrobeId)) {
      continue;
    }
    seenIds.add(resolvedWardrobeId);

    // Resolve display image
    const imageUrl =
      item.image_url ||
      (Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null) ||
      null;

    snapshots.push({
      id: resolvedWardrobeId,
      name: (item.name || 'Wardrobe Item').trim(),
      category: (item.category || 'Clothing').trim(),
      sub_category: item.sub_category || null,
      color_tags: Array.isArray(item.color_tags) ? item.color_tags : null,
      image_url: imageUrl,
    });
  }

  return { snapshots, rejectedItems };
}

/**
 * Convenience wrapper returning PlannedOutfitItemSnapshot[] directly.
 */
export function buildPlannerItemSnapshots(
  rawItems: RawPlannerCandidateItem[],
  options?: SnapshotAdapterOptions
): PlannedOutfitItemSnapshot[] {
  return buildPlannerItemSnapshotsDetailed(rawItems, options).snapshots;
}

/**
 * Preflight helper for Saved Outfits: validates that all required wardrobe item IDs
 * exist in the authoritative wardrobe inventory.
 */
export function validateSavedOutfitAvailability(
  itemIds: string[],
  authoritativeInventory: { id: string }[] | Set<string> | Map<string, any>
): { isValid: boolean; missingIds: string[] } {
  const inventorySet =
    authoritativeInventory instanceof Set
      ? authoritativeInventory
      : authoritativeInventory instanceof Map
      ? new Set(authoritativeInventory.keys())
      : new Set(authoritativeInventory.map((i) => i.id));

  const missingIds = itemIds.filter((id) => !inventorySet.has(id));
  return {
    isValid: missingIds.length === 0,
    missingIds,
  };
}
