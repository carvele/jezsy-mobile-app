/**
 * Pure domain service for Mannequin Smart Shuffle (Phase C).
 * Handles candidate generation, pinned-item validation, identity separation,
 * session anti-repeat selection, and exact transform preservation.
 */

import { WardrobeItem, StylingIntent, CandidateOutfit } from '@/src/types/styleAdvisor';
import { MannequinCanvasItem, CATEGORY_PLACEMENT_DEFAULTS, createMannequinItem } from '@/src/utils/mannequinConfig';
import { UserStyleProfileDto } from '@/src/types/dto/styleProfile';
import { generateCandidateOutfits, ScoringProfile } from './candidateGenerator';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';

export interface PinnedPartitionResult {
  valid: boolean;
  reason?: string;
  generatorPinnedIds: string[];
  canvasOnlyPinnedIds: string[];
}

export interface SmartShuffleInput {
  wardrobe: WardrobeItem[];
  currentCanvasItems: MannequinCanvasItem[];
  pinnedWardrobeItemIds: Set<string>; // Validated wardrobe IDs only
  recentKeys: string[];              // Bounded session ring buffer
  profile?: UserStyleProfileDto | null;
  scoringProfile?: ScoringProfile;
}

export type SmartShuffleOutcome =
  | {
      success: true;
      newCanvasItems: MannequinCanvasItem[];
      outfitKey: string;
      retainedCount: number;
      addedCount: number;
    }
  | {
      success: false;
      errorType: 'EMPTY_WARDROBE' | 'PIN_CONFLICT' | 'NO_CANDIDATES';
      message: string;
    };

/**
 * Validates pinned items against canonical generator slot cardinality.
 * Top: max 1, Bottom: max 1, Dress: max 1 (Dress exclusive with Top/Bottom),
 * Shoes: max 1, Outerwear: max 1.
 * Accessories are partitioned into canvasOnlyPinnedIds and not sent to the generator.
 */
export function validateAndPartitionPinnedSet(
  pinnedWardrobeItemIds: Set<string>,
  wardrobeMap: Map<string, WardrobeItem>
): PinnedPartitionResult {
  if (pinnedWardrobeItemIds.size === 0) {
    return { valid: true, generatorPinnedIds: [], canvasOnlyPinnedIds: [] };
  }

  const generatorPinnedIds: string[] = [];
  const canvasOnlyPinnedIds: string[] = [];

  let topCount = 0;
  let bottomCount = 0;
  let dressCount = 0;
  let shoesCount = 0;
  let outerwearCount = 0;

  for (const id of pinnedWardrobeItemIds) {
    const item = wardrobeMap.get(id);
    if (!item) {
      return {
        valid: false,
        reason: 'One or more pinned garments could not be found in your wardrobe.',
        generatorPinnedIds: [],
        canvasOnlyPinnedIds: [],
      };
    }

    const bucket = resolveEffectiveGarmentBucket(item);

    if (bucket === 'Accessory') {
      canvasOnlyPinnedIds.push(id);
      continue;
    }

    if (bucket === 'Top') {
      topCount++;
      generatorPinnedIds.push(id);
    } else if (bucket === 'Bottom') {
      bottomCount++;
      generatorPinnedIds.push(id);
    } else if (bucket === 'Dress') {
      dressCount++;
      generatorPinnedIds.push(id);
    } else if (bucket === 'Shoes') {
      shoesCount++;
      generatorPinnedIds.push(id);
    } else if (bucket === 'Outerwear') {
      outerwearCount++;
      generatorPinnedIds.push(id);
    } else {
      // Unknown category: retain on canvas only
      canvasOnlyPinnedIds.push(id);
    }
  }

  if (topCount > 1) {
    return {
      valid: false,
      reason: 'Multiple tops are pinned. Please unpin one top to shuffle.',
      generatorPinnedIds: [],
      canvasOnlyPinnedIds: [],
    };
  }

  if (bottomCount > 1) {
    return {
      valid: false,
      reason: 'Multiple bottoms are pinned. Please unpin one bottom to shuffle.',
      generatorPinnedIds: [],
      canvasOnlyPinnedIds: [],
    };
  }

  if (dressCount > 1) {
    return {
      valid: false,
      reason: 'Multiple dresses are pinned. Please unpin one dress to shuffle.',
      generatorPinnedIds: [],
      canvasOnlyPinnedIds: [],
    };
  }

  if (dressCount > 0 && (topCount > 0 || bottomCount > 0)) {
    return {
      valid: false,
      reason: 'A dress cannot be combined with tops or bottoms. Please unpin one.',
      generatorPinnedIds: [],
      canvasOnlyPinnedIds: [],
    };
  }

  if (shoesCount > 1) {
    return {
      valid: false,
      reason: 'Multiple pairs of shoes are pinned. Please unpin one pair to shuffle.',
      generatorPinnedIds: [],
      canvasOnlyPinnedIds: [],
    };
  }

  if (outerwearCount > 1) {
    return {
      valid: false,
      reason: 'Multiple outerwear pieces are pinned. Please unpin one to shuffle.',
      generatorPinnedIds: [],
      canvasOnlyPinnedIds: [],
    };
  }

  return {
    valid: true,
    generatorPinnedIds,
    canvasOnlyPinnedIds,
  };
}

/**
 * Builds normalized StylingIntent using ONLY valid wardrobe item IDs.
 * NEVER accepts canvas item IDs.
 */
export function buildShuffleIntent(
  generatorPinnedIds: string[],
  rawPrompt: string = 'Mannequin Smart Shuffle'
): StylingIntent {
  return {
    rawPrompt,
    mustUseItemIds: [...generatorPinnedIds],
    excludedItemIds: [],
    preferredColors: [],
    avoidedColors: [],
    formality: undefined,
  };
}

/**
 * Selects candidate respecting the 10-entry session ring buffer.
 * If unseen candidates exist, chooses the highest-ranked unseen candidate.
 * If all current candidates have been seen, chooses the least-recently-used candidate from the pool.
 * If exactly one valid candidate exists, repeats gracefully without error.
 */
export function selectDiverseCandidate(
  candidates: CandidateOutfit[],
  recentKeys: string[]
): CandidateOutfit | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const recentSet = new Set(recentKeys);
  const unseen = candidates.find((c) => !recentSet.has(c.key));
  if (unseen) return unseen;

  // All candidates in the current pool have been seen in this session.
  // Pick the candidate whose key was seen least recently (lowest index in recentKeys).
  let oldestIndex = Infinity;
  let bestCandidate = candidates[0];

  for (const cand of candidates) {
    const idx = recentKeys.indexOf(cand.key);
    if (idx !== -1 && idx < oldestIndex) {
      oldestIndex = idx;
      bestCandidate = cand;
    }
  }

  return bestCandidate;
}

/**
 * Resolves new item z-index deterministically around preserved pinned/retained layers.
 * Retained items are NEVER mutated.
 * Canonical slot hierarchy: Shoes(1) < Bottom(2) < Top/Dress(3) < Outerwear(5) < Accessory(6).
 */
export function resolveNewItemZIndex(
  garmentType: string,
  occupiedZIndices: Set<number>
): number {
  const defaults = CATEGORY_PLACEMENT_DEFAULTS[garmentType] || { zIndex: 3 };
  const targetZ = defaults.zIndex;

  if (!occupiedZIndices.has(targetZ)) {
    occupiedZIndices.add(targetZ);
    return targetZ;
  }

  // Collision resolution:
  // For Outerwear / Accessory (higher layers), probe upwards first.
  // For Shoes / Bottom (lower layers), probe downwards first.
  const probeUpwardsFirst = targetZ >= 4;

  if (probeUpwardsFirst) {
    for (let step = 1; step <= 20; step++) {
      if (!occupiedZIndices.has(targetZ + step)) {
        const chosen = targetZ + step;
        occupiedZIndices.add(chosen);
        return chosen;
      }
      if (targetZ - step >= 1 && !occupiedZIndices.has(targetZ - step)) {
        const chosen = targetZ - step;
        occupiedZIndices.add(chosen);
        return chosen;
      }
    }
  } else {
    for (let step = 1; step <= 20; step++) {
      if (targetZ - step >= 1 && !occupiedZIndices.has(targetZ - step)) {
        const chosen = targetZ - step;
        occupiedZIndices.add(chosen);
        return chosen;
      }
      if (!occupiedZIndices.has(targetZ + step)) {
        const chosen = targetZ + step;
        occupiedZIndices.add(chosen);
        return chosen;
      }
    }
  }

  // Fallback: pick any safe non-zero integer
  const maxZ = Math.max(0, ...Array.from(occupiedZIndices));
  const fallback = maxZ + 1;
  occupiedZIndices.add(fallback);
  return fallback;
}

/**
 * Composes canvas items:
 * - Retained items preserve 100% of their transforms (x, y, scale, rotation, zIndex).
 * - Canvas-only pinned items (accessories) are preserved 100%.
 * - Newly added pieces get canonical category positions and deterministic collision-resolved zIndex.
 */
export function composeSmartCanvasItems(
  currentCanvasItems: MannequinCanvasItem[],
  selectedCandidate: CandidateOutfit,
  pinnedWardrobeItemIds: Set<string>,
  canvasOnlyPinnedIds: string[]
): MannequinCanvasItem[] {
  const candidateWardrobeIds = new Set(selectedCandidate.items.map((i) => i.id));
  const canvasOnlySet = new Set(canvasOnlyPinnedIds);

  const resultItems: MannequinCanvasItem[] = [];
  const occupiedZIndices = new Set<number>();

  // 1. First, retain all items that match candidate garments OR are pinned
  for (const existing of currentCanvasItems) {
    const isRetainedInCandidate = candidateWardrobeIds.has(existing.wardrobe_item_id);
    const isExplicitlyPinned = pinnedWardrobeItemIds.has(existing.wardrobe_item_id);
    const isCanvasOnlyPinned = canvasOnlySet.has(existing.wardrobe_item_id);

    if (isRetainedInCandidate || isExplicitlyPinned || isCanvasOnlyPinned) {
      // 100% exact preservation of all spatial properties including zIndex
      resultItems.push({ ...existing });
      occupiedZIndices.add(existing.zIndex);
    }
  }

  // 2. Introduce newly generated garments
  const existingWardrobeIds = new Set(resultItems.map((i) => i.wardrobe_item_id));

  for (const garment of selectedCandidate.items) {
    if (!existingWardrobeIds.has(garment.id)) {
      const gType = resolveEffectiveGarmentBucket(garment) || 'Top';
      const newItem = createMannequinItem(garment, 0);

      // Assign non-colliding deterministic z-index around preserved layers
      newItem.zIndex = resolveNewItemZIndex(gType, occupiedZIndices);
      resultItems.push(newItem);
    }
  }

  return resultItems;
}

/**
 * Default scoring profile for Smart Shuffle.
 * Selected based on empirical 7-fixture characterization test suite.
 */
export const SMART_SHUFFLE_SCORING_PROFILE: ScoringProfile = 'intent-driven';

/**
 * Capacity of the in-session Smart Shuffle ring buffer.
 * Bounded to 10 entries per the frozen Phase C technical architecture.
 */
export const MAX_SESSION_SHUFFLE_HISTORY = 10;

/**
 * Master Smart Shuffle execution pipeline.
 */
export function executeSmartShuffle(input: SmartShuffleInput): SmartShuffleOutcome {
  if (!input.wardrobe || input.wardrobe.length === 0) {
    return {
      success: false,
      errorType: 'EMPTY_WARDROBE',
      message: 'Add items to your wardrobe first to shuffle.',
    };
  }

  const wardrobeMap = new Map(input.wardrobe.map((i) => [i.id, i]));

  // 1. Validate & partition pinned items
  const partition = validateAndPartitionPinnedSet(input.pinnedWardrobeItemIds, wardrobeMap);
  if (!partition.valid) {
    return {
      success: false,
      errorType: 'PIN_CONFLICT',
      message: partition.reason || 'Pinned items conflict.',
    };
  }

  // 2. Build normalized intent strictly with generator pinned IDs
  const intent = buildShuffleIntent(partition.generatorPinnedIds);

  // 3. Generate candidates using canonical engine
  const profileToUse = input.profile ?? null;
  const scoringProfileToUse = input.scoringProfile || SMART_SHUFFLE_SCORING_PROFILE;

  const candidates = generateCandidateOutfits(input.wardrobe, intent, {
    limit: 10,
    profile: profileToUse,
    scoringProfile: scoringProfileToUse,
  });

  if (candidates.length === 0) {
    return {
      success: false,
      errorType: 'NO_CANDIDATES',
      message: partition.generatorPinnedIds.length > 0
        ? 'No matching combination found with your pinned items.'
        : 'Could not compose an outfit from available items.',
    };
  }

  // 4. Select diverse candidate using session ring buffer
  const candidate = selectDiverseCandidate(candidates, input.recentKeys);
  if (!candidate) {
    return {
      success: false,
      errorType: 'NO_CANDIDATES',
      message: 'Could not select an outfit.',
    };
  }

  // 5. Compose canvas items preserving pinned transforms
  const newCanvasItems = composeSmartCanvasItems(
    input.currentCanvasItems,
    candidate,
    input.pinnedWardrobeItemIds,
    partition.canvasOnlyPinnedIds
  );

  const retainedCount = newCanvasItems.filter((ni) =>
    input.currentCanvasItems.some((ci) => ci.wardrobe_item_id === ni.wardrobe_item_id)
  ).length;

  return {
    success: true,
    newCanvasItems,
    outfitKey: candidate.key,
    retainedCount,
    addedCount: newCanvasItems.length - retainedCount,
  };
}
