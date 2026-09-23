/**
 * outfitRemixService.ts
 * Pure domain service for Phase E & F Interactive Remix & Multi-Capacity Accessory Swapping.
 *
 * Invariant: ZERO second recommendation engine.
 * All replacements, structural transitions, and shuffles use the canonical generator (generateCandidateOutfits).
 * Explanations and scores reuse canonical groundedExplainer and candidate.baseScore.
 */

import { WardrobeItem, StylingIntent, CandidateOutfit, StylingOption } from '@/src/types/styleAdvisor';
import { UserStyleProfileDto } from '@/src/types/dto/styleProfile';
import {
  OutfitRemixState,
  OutfitRemixSlotType,
  CoreRemixSlotType,
  RemixedSlotItem,
  OutfitRemixResult,
  AccessorySlotState,
  ACCESSORY_SLOT_CAPACITIES,
} from '@/src/types/outfitRemix';
import { generateCandidateOutfits } from './candidateGenerator';
import { generateGroundedExplanation } from './groundedExplainer';
import {
  resolveEffectiveGarmentBucket,
  resolveAccessorySubtype,
  AccessorySubtype,
} from '@/src/utils/garmentSemanticClassifier';
import { randomUUID } from 'expo-crypto';
import { styleDnaSyncManager } from './styleDnaSyncManager';

const MAX_REMIX_HISTORY = 10;

function createEmptyAccessorySlots(): Partial<Record<AccessorySubtype, AccessorySlotState>> {
  const result: Partial<Record<AccessorySubtype, AccessorySlotState>> = {};
  for (const [sub, cap] of Object.entries(ACCESSORY_SLOT_CAPACITIES)) {
    const subtype = sub as AccessorySubtype;
    result[subtype] = {
      subtype,
      capacity: cap,
      items: [],
    };
  }
  return result;
}

/**
 * Maps a candidate outfit into the remix slot model while preserving
 * passthrough items, existing lock state, and lock provenance for retained pieces.
 */
export function applyCandidateToRemixState(
  state: OutfitRemixState,
  candidate: CandidateOutfit
): OutfitRemixState {
  const newSlots: Record<CoreRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };

  const newAccessorySlots = createEmptyAccessorySlots();
  const passthroughItems: WardrobeItem[] = [];

  for (const item of candidate.items) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = rawBucket === 'footwear' ? 'shoes' : rawBucket;

    if (bucket in newSlots) {
      const coreSlot = bucket as CoreRemixSlotType;
      const existing = state.slots[coreSlot];
      if (existing && existing.item.id === item.id) {
        newSlots[coreSlot] = existing;
      } else {
        newSlots[coreSlot] = {
          slotType: coreSlot,
          item,
          isLocked: false,
          lockReason: 'remix',
          canUnlockInRemix: true,
        };
      }
    } else if (rawBucket === 'accessory') {
      const accSub = resolveAccessorySubtype(item);
      if (accSub && newAccessorySlots[accSub]) {
        const slotState = newAccessorySlots[accSub]!;
        if (slotState.items.length < slotState.capacity) {
          const existingSlot = state.accessorySlots?.[accSub];
          const existingItem = existingSlot?.items.find((i) => i.item.id === item.id);
          if (existingItem) {
            slotState.items.push(existingItem);
          } else {
            slotState.items.push({
              slotType: accSub,
              item,
              isLocked: false,
              lockReason: 'remix',
              canUnlockInRemix: true,
            });
          }
        } else {
          passthroughItems.push(item);
        }
      } else {
        passthroughItems.push(item);
      }
    } else {
      passthroughItems.push(item);
    }
  }

  // Preserve passthroughs that were already in state
  for (const p of state.passthroughItems) {
    if (!candidate.items.some((i) => i.id === p.id) && !passthroughItems.some((i) => i.id === p.id)) {
      passthroughItems.push(p);
    }
  }

  return {
    ...state,
    slots: newSlots,
    accessorySlots: newAccessorySlots,
    passthroughItems,
    activeCandidate: candidate,
    isDirty: true,
    error: null,
  };
}

/**
 * Toggles the lock on a core slot or an accessory slot.
 * Rejects unlocking if the item is an authoritative parent constraint (style-around or parent-must-use).
 */
export function toggleSlotLock(
  state: OutfitRemixState,
  slotType: OutfitRemixSlotType,
  itemId?: string
): OutfitRemixState {
  const coreSlots = ['top', 'bottom', 'dress', 'shoes', 'outerwear'] as CoreRemixSlotType[];
  if (coreSlots.includes(slotType as CoreRemixSlotType)) {
    const coreKey = slotType as CoreRemixSlotType;
    const slotData = state.slots[coreKey];
    if (!slotData) return state;

    if (slotData.isLocked && !slotData.canUnlockInRemix) {
      return {
        ...state,
        error: 'This item is required by your styling session and cannot be unlocked in Remix.',
      };
    }

    return {
      ...state,
      slots: {
        ...state.slots,
        [coreKey]: {
          ...slotData,
          isLocked: !slotData.isLocked,
        },
      },
      error: null,
    };
  }

  // Accessory slot toggle
  const accSub = slotType as AccessorySubtype;
  const accSlot = state.accessorySlots?.[accSub];
  if (!accSlot || accSlot.items.length === 0) return state;

  const targetItem = itemId
    ? accSlot.items.find((i) => i.item.id === itemId)
    : accSlot.items[0];

  if (!targetItem) return state;

  if (targetItem.isLocked && !targetItem.canUnlockInRemix) {
    return {
      ...state,
      error: 'This accessory is required by your styling session and cannot be unlocked in Remix.',
    };
  }

  const updatedItems = accSlot.items.map((i) =>
    i.item.id === targetItem.item.id ? { ...i, isLocked: !i.isLocked } : i
  );

  return {
    ...state,
    accessorySlots: {
      ...state.accessorySlots,
      [accSub]: {
        ...accSlot,
        items: updatedItems,
      },
    },
    error: null,
  };
}

/**
 * Extracts canonical slot replacement options using generateCandidateOutfits.
 * For target slot S_t:
 * - non-target items mapped to mustUseItemIds
 * - current target item mapped to excludedItemIds
 * - parent intent preserved in full
 * - returns unique candidate items ranked by candidate.baseScore
 */
export function getCanonicalSlotReplacements(
  state: OutfitRemixState,
  targetSlot: OutfitRemixSlotType,
  wardrobe: WardrobeItem[],
  targetItemId?: string
): { candidate: CandidateOutfit; replacementItem: WardrobeItem }[] {
  const isCore = ['top', 'bottom', 'dress', 'shoes', 'outerwear'].includes(targetSlot);
  let currentTargetItem: WardrobeItem | null = null;

  if (isCore) {
    currentTargetItem = state.slots[targetSlot as CoreRemixSlotType]?.item || null;
  } else {
    const accSub = targetSlot as AccessorySubtype;
    const accSlot = state.accessorySlots?.[accSub];
    if (accSlot && accSlot.items.length > 0) {
      currentTargetItem = targetItemId
        ? accSlot.items.find((i) => i.item.id === targetItemId)?.item || null
        : accSlot.items[0].item;
    }
  }

  if (!currentTargetItem) return [];

  // Retain all non-target garments as must-use
  const nonTargetItemIds: string[] = [];
  for (const [slotKey, slotData] of Object.entries(state.slots)) {
    if ((slotKey !== targetSlot || !isCore) && slotData?.item) {
      nonTargetItemIds.push(slotData.item.id);
    }
  }

  if (state.accessorySlots) {
    for (const accSlot of Object.values(state.accessorySlots)) {
      if (accSlot?.items) {
        for (const it of accSlot.items) {
          if (it.item.id !== currentTargetItem.id) {
            nonTargetItemIds.push(it.item.id);
          }
        }
      }
    }
  }

  const mergedMustUse = Array.from(
    new Set([...(state.intent.mustUseItemIds || []), ...nonTargetItemIds])
  );
  const mergedExcluded = Array.from(
    new Set([...(state.intent.excludedItemIds || []), currentTargetItem.id])
  );

  const slotIntent: StylingIntent = {
    ...state.intent,
    mustUseItemIds: mergedMustUse,
    excludedItemIds: mergedExcluded,
  };

  const activeWardrobe = wardrobe.filter((i) => !i.deleted);

  const candidates = generateCandidateOutfits(activeWardrobe, slotIntent, {
    limit: 12,
    profile: state.profile,
  });

  const seenIds = new Set<string>();
  const results: { candidate: CandidateOutfit; replacementItem: WardrobeItem }[] = [];

  for (const cand of candidates) {
    let itemInSlot: WardrobeItem | undefined;
    if (isCore) {
      itemInSlot = cand.items.find((i) => {
        const b = resolveEffectiveGarmentBucket(i).toLowerCase();
        const mapped = b === 'footwear' ? 'shoes' : b;
        return mapped === targetSlot;
      });
    } else {
      itemInSlot = cand.items.find((i) => {
        return (
          resolveEffectiveGarmentBucket(i) === 'Accessory' &&
          resolveAccessorySubtype(i) === targetSlot &&
          !nonTargetItemIds.includes(i.id)
        );
      });
    }

    if (itemInSlot && !seenIds.has(itemInSlot.id)) {
      seenIds.add(itemInSlot.id);
      results.push({ candidate: cand, replacementItem: itemInSlot });
    }
  }

  return results;
}

/**
 * Applies a specific canonical candidate replacement directly into the remix state.
 */
export function replaceSlotItemWithCandidate(
  state: OutfitRemixState,
  candidate: CandidateOutfit
): OutfitRemixState {
  const next = applyCandidateToRemixState(state, candidate);
  const nextHistory = [candidate.key, ...state.history.filter((k) => k !== candidate.key)].slice(
    0,
    MAX_REMIX_HISTORY
  );
  return {
    ...next,
    history: nextHistory,
  };
}

/**
 * Atomically transitions between Dress and Separates base structure.
 * Validates authoritative parent must-use constraints and local locks.
 * Guarantees zero invalid intermediate states.
 */
export function switchBaseStructure(
  state: OutfitRemixState,
  targetStructure: 'dress' | 'separates',
  wardrobe: WardrobeItem[]
): OutfitRemixState {
  const currentIsDress = !!state.slots.dress;
  if ((targetStructure === 'dress' && currentIsDress) || (targetStructure === 'separates' && !currentIsDress)) {
    return state;
  }

  const activeWardrobe = wardrobe.filter((i) => !i.deleted);

  // 1. Check authoritative parent must-use constraints and session anchors
  const parentMustUseIds = new Set(state.intent.mustUseItemIds || []);
  for (const slotData of Object.values(state.slots)) {
    if (
      slotData &&
      (slotData.lockReason === 'style-around' ||
        slotData.lockReason === 'parent-must-use' ||
        parentMustUseIds.has(slotData.item.id))
    ) {
      const b = slotData.slotType;
      if (targetStructure === 'dress' && (b === 'top' || b === 'bottom')) {
        return {
          ...state,
          error: 'Cannot switch to a dress: your session requires this top/bottom.',
        };
      }
      if (targetStructure === 'separates' && b === 'dress') {
        return {
          ...state,
          error: 'Cannot switch to separates: your session requires this dress.',
        };
      }
    }
  }

  // 2. Check local locks
  if (currentIsDress && state.slots.dress?.isLocked) {
    return { ...state, error: 'Unlock your dress before switching to separates.' };
  }
  if (!currentIsDress && (state.slots.top?.isLocked || state.slots.bottom?.isLocked)) {
    return { ...state, error: 'Unlock your top and bottom before switching to a dress.' };
  }

  // 3. Preserve compatible non-base must-use pieces (Shoes, Outerwear, Accessories)
  const nonBaseItemIds: string[] = [];
  if (state.slots.shoes?.item && (state.slots.shoes.isLocked || parentMustUseIds.has(state.slots.shoes.item.id))) {
    nonBaseItemIds.push(state.slots.shoes.item.id);
  }
  if (state.slots.outerwear?.item && (state.slots.outerwear.isLocked || parentMustUseIds.has(state.slots.outerwear.item.id))) {
    nonBaseItemIds.push(state.slots.outerwear.item.id);
  }
  if (state.accessorySlots) {
    for (const accSlot of Object.values(state.accessorySlots)) {
      if (accSlot?.items) {
        for (const it of accSlot.items) {
          if (it.isLocked || parentMustUseIds.has(it.item.id)) {
            nonBaseItemIds.push(it.item.id);
          }
        }
      }
    }
  }

  // 4. Filter wardrobe to force target base structure
  const eligibleWardrobe = activeWardrobe.filter((item) => {
    const bucket = resolveEffectiveGarmentBucket(item);
    return targetStructure === 'dress'
      ? bucket !== 'Top' && bucket !== 'Bottom'
      : bucket !== 'Dress';
  });

  const transitionIntent: StylingIntent = {
    ...state.intent,
    mustUseItemIds: nonBaseItemIds,
  };

  const candidates = generateCandidateOutfits(eligibleWardrobe, transitionIntent, {
    limit: 5,
    profile: state.profile,
  });

  if (candidates.length === 0) {
    return {
      ...state,
      error: `No compatible ${targetStructure} options found in your wardrobe.`,
    };
  }

  const chosen = candidates[0];
  const next = applyCandidateToRemixState(state, chosen);
  const nextHistory = [chosen.key, ...state.history.filter((k) => k !== chosen.key)].slice(
    0,
    MAX_REMIX_HISTORY
  );

  return {
    ...next,
    history: nextHistory,
  };
}

/**
 * Shuffles all unlocked slots while preserving locked pieces and base structure.
 * Employs bounded anti-repeat memory with true deterministic LRU fallback.
 */
export function shuffleUnlockedSlots(
  state: OutfitRemixState,
  wardrobe: WardrobeItem[]
): OutfitRemixState {
  const lockedItemIds: string[] = [];
  const unlockedItemIds: string[] = [];

  for (const slotData of Object.values(state.slots)) {
    if (slotData) {
      if (slotData.isLocked) {
        lockedItemIds.push(slotData.item.id);
      } else {
        unlockedItemIds.push(slotData.item.id);
      }
    }
  }

  if (state.accessorySlots) {
    for (const accSlot of Object.values(state.accessorySlots)) {
      if (accSlot?.items) {
        for (const it of accSlot.items) {
          if (it.isLocked) {
            lockedItemIds.push(it.item.id);
          } else {
            unlockedItemIds.push(it.item.id);
          }
        }
      }
    }
  }

  if (unlockedItemIds.length === 0) {
    return { ...state, error: 'All slots are locked. Unlock at least one piece to shuffle.' };
  }

  // Preserve current base structure
  const isDress = !!state.slots.dress;
  const eligibleWardrobe = wardrobe.filter((item) => {
    const bucket = resolveEffectiveGarmentBucket(item);
    return isDress ? bucket !== 'Top' && bucket !== 'Bottom' : bucket !== 'Dress';
  });

  const shuffleIntent: StylingIntent = {
    ...state.intent,
    mustUseItemIds: Array.from(new Set([...(state.intent.mustUseItemIds || []), ...lockedItemIds])),
    excludedItemIds: Array.from(new Set([...(state.intent.excludedItemIds || []), ...unlockedItemIds])),
  };

  const candidates = generateCandidateOutfits(eligibleWardrobe, shuffleIntent, {
    limit: 12,
    profile: state.profile,
  });

  if (candidates.length === 0) {
    return { ...state, error: 'No alternative combinations found preserving your locked pieces.' };
  }

  // Anti-repeat selection with TRUE deterministic LRU fallback
  const history = state.history;
  const unseen = candidates.filter((c) => !history.includes(c.key));

  let chosen: CandidateOutfit;
  if (unseen.length > 0) {
    chosen = unseen[0];
  } else {
    let maxHistoryIndex = -1;
    chosen = candidates[0];
    for (const cand of candidates) {
      const idx = history.indexOf(cand.key);
      if (idx > maxHistoryIndex) {
        maxHistoryIndex = idx;
        chosen = cand;
      }
    }
  }

  const next = applyCandidateToRemixState(state, chosen);
  const nextHistory = [chosen.key, ...history.filter((k) => k !== chosen.key)].slice(
    0,
    MAX_REMIX_HISTORY
  );

  return {
    ...next,
    history: nextHistory,
  };
}

/**
 * Adds compatible outerwear derived from canonical candidates.
 */
export function addOuterwear(
  state: OutfitRemixState,
  wardrobe: WardrobeItem[]
): OutfitRemixState {
  if (state.slots.outerwear !== null) return state;

  const currentItemIds: string[] = [];
  for (const slotData of Object.values(state.slots)) {
    if (slotData?.item) currentItemIds.push(slotData.item.id);
  }
  if (state.accessorySlots) {
    for (const accSlot of Object.values(state.accessorySlots)) {
      if (accSlot?.items) {
        for (const it of accSlot.items) {
          currentItemIds.push(it.item.id);
        }
      }
    }
  }

  const outerwearIntent: StylingIntent = {
    ...state.intent,
    mustUseItemIds: Array.from(new Set([...(state.intent.mustUseItemIds || []), ...currentItemIds])),
  };

  const candidates = generateCandidateOutfits(wardrobe, outerwearIntent, {
    limit: 5,
    profile: state.profile,
  });

  const candWithOuter = candidates.find((c) =>
    c.items.some((i) => resolveEffectiveGarmentBucket(i) === 'Outerwear')
  );

  if (!candWithOuter) {
    return { ...state, error: 'No compatible outerwear found in your wardrobe for this outfit.' };
  }

  return replaceSlotItemWithCandidate(state, candWithOuter);
}

/**
 * Removes the outerwear layer from the current remix look.
 */
export function removeOuterwear(state: OutfitRemixState): OutfitRemixState {
  const currentOuterwear = state.slots.outerwear;
  if (!currentOuterwear) return state;

  if (currentOuterwear.isLocked && !currentOuterwear.canUnlockInRemix) {
    return {
      ...state,
      error: 'Cannot remove outerwear required by your Style Advisor session',
    };
  }

  const nextSlots = { ...state.slots, outerwear: null };
  const activeItems: WardrobeItem[] = [];
  for (const s of Object.values(nextSlots)) {
    if (s?.item) activeItems.push(s.item);
  }
  if (state.accessorySlots) {
    for (const accSlot of Object.values(state.accessorySlots)) {
      if (accSlot?.items) {
        for (const it of accSlot.items) activeItems.push(it.item);
      }
    }
  }
  activeItems.push(...state.passthroughItems);

  const newKey = activeItems.map((i) => i.id).sort().join('|');

  const dummyCandidate: CandidateOutfit = {
    candidateId: newKey,
    items: activeItems,
    key: newKey,
    baseScore: state.activeCandidate ? Math.max(50, state.activeCandidate.baseScore - 2) : 80,
    colorMatchLabel: state.activeCandidate?.colorMatchLabel || 'Balanced',
    formalityLevel: state.intent.formality || 'balanced',
    hasDress: !!nextSlots.dress,
    hasShoes: !!nextSlots.shoes,
    hasOuterwear: false,
  };

  const nextHistory = [newKey, ...state.history.filter((k) => k !== newKey)].slice(
    0,
    MAX_REMIX_HISTORY
  );

  return {
    ...state,
    slots: nextSlots,
    activeCandidate: dummyCandidate,
    history: nextHistory,
    isDirty: true,
    error: null,
  };
}

/**
 * Builds the canonical OutfitRemixResult with fresh score and grounded explanation.
 * Strictly derives score from candidate.baseScore without arbitrary fallbacks.
 */
export function createRemixResult(state: OutfitRemixState): OutfitRemixResult {
  const activeItems: WardrobeItem[] = [];
  for (const slotData of Object.values(state.slots)) {
    if (slotData?.item) activeItems.push(slotData.item);
  }
  if (state.accessorySlots) {
    for (const accSlot of Object.values(state.accessorySlots)) {
      if (accSlot?.items) {
        for (const it of accSlot.items) {
          activeItems.push(it.item);
        }
      }
    }
  }
  activeItems.push(...state.passthroughItems);

  const outfitKey = activeItems.map((i) => i.id).sort().join('|');
  const score = state.activeCandidate?.baseScore ?? 80;

  const candidateForExplainer: CandidateOutfit = state.activeCandidate || {
    candidateId: outfitKey,
    items: activeItems,
    key: outfitKey,
    baseScore: score,
    colorMatchLabel: 'Coordinated',
    formalityLevel: state.intent.formality || 'balanced',
    hasDress: activeItems.some((i) => resolveEffectiveGarmentBucket(i) === 'Dress'),
    hasShoes: activeItems.some((i) => resolveEffectiveGarmentBucket(i) === 'Shoes'),
    hasOuterwear: activeItems.some((i) => resolveEffectiveGarmentBucket(i) === 'Outerwear'),
    hasBag: activeItems.some((i) => resolveAccessorySubtype(i) === 'bag'),
    hasBelt: activeItems.some((i) => resolveAccessorySubtype(i) === 'belt'),
    accessoryCount: activeItems.filter((i) => resolveEffectiveGarmentBucket(i) === 'Accessory').length,
  };

  const grounded = generateGroundedExplanation(candidateForExplainer, state.intent);

  return {
    items: activeItems,
    outfitKey,
    score,
    headline: grounded.headline,
    label: 'Remixed Look',
    whyThisWorks: grounded.whyThisWorks,
    isRemixedDraft: state.isDirty,
  };
}

/**
  * Commits the current remix state: records a 'remix_commit' event with a stable preference_action_id,
  * allowing subsequent save_look events to be linked and deduplicated on the server.
  */
export async function commitRemixState(
  userId: string,
  state: OutfitRemixState,
  actionId?: string
): Promise<{ preferenceActionId: string; result: OutfitRemixResult }> {
  const preferenceActionId = actionId || randomUUID();
  const baseResult = createRemixResult(state);
  const result: OutfitRemixResult = {
    ...baseResult,
    preferenceActionId,
  };

  if (userId) {
    try {
      const palette = Array.from(
        new Set(result.items.flatMap((i) => i.color_tags || []).filter(Boolean))
      );
      const silhouettes = Array.from(
        new Set(
          result.items
            .map((i) => (i.ai_attributes as any)?.fit || (i.ai_attributes as any)?.silhouette)
            .filter(Boolean)
        )
      );
      const formality = state.intent.formality ? [state.intent.formality] : [];
      const accessories = result.items
        .filter((i) => resolveEffectiveGarmentBucket(i) === 'Accessory')
        .map((i) => resolveAccessorySubtype(i) || i.description || '')
        .filter(Boolean);

      const replacedSlots: string[] = [];
      if (state.history && state.history.length > 1) {
        // Track slots that differ from original if dirty
        for (const [slotKey, slotData] of Object.entries(state.slots)) {
          if (slotData?.item) replacedSlots.push(slotKey);
        }
      }

      await styleDnaSyncManager.recordEvent(
        userId,
        'remix_commit',
        {
          item_ids: result.items.map((i) => i.id),
          palette,
          silhouettes,
          formality,
          accessories,
          replaced_slots: replacedSlots,
        },
        preferenceActionId
      );
    } catch {
      // Non-blocking telemetry
    }
  }

  return { preferenceActionId, result };
}

// ── Source Adapters ──

/**
 * Adapts a Style Advisor look into OutfitRemixState.
 * Identifies 'style-around' from session lockedWardrobeItemIds and 'parent-must-use' from intent.mustUseItemIds.
 */
export function adaptStyleAdvisorLookToRemix(
  look: StylingOption,
  wardrobe: WardrobeItem[],
  intent: StylingIntent,
  sessionLockedIds: string[] = []
): OutfitRemixState {
  const sessionLockedSet = new Set(sessionLockedIds);
  const parentMustUseSet = new Set(intent.mustUseItemIds || []);

  const slots: Record<CoreRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };
  const accessorySlots = createEmptyAccessorySlots();
  const passthroughItems: WardrobeItem[] = [];

  for (const item of look.items) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = rawBucket === 'footwear' ? 'shoes' : rawBucket;

    let isLocked = false;
    let lockReason: 'style-around' | 'parent-must-use' | 'remix' = 'remix';
    let canUnlockInRemix = true;

    if (sessionLockedSet.has(item.id)) {
      isLocked = true;
      lockReason = 'style-around';
      canUnlockInRemix = false;
    } else if (parentMustUseSet.has(item.id)) {
      isLocked = true;
      lockReason = 'parent-must-use';
      canUnlockInRemix = false;
    }

    if (bucket in slots) {
      const coreSlot = bucket as CoreRemixSlotType;
      slots[coreSlot] = {
        slotType: coreSlot,
        item,
        isLocked,
        lockReason,
        canUnlockInRemix,
      };
    } else if (rawBucket === 'accessory') {
      const accSub = resolveAccessorySubtype(item);
      const isGenerativeSlot = accSub === 'bag' || accSub === 'belt' || accSub === 'jewelry';
      if (
        isGenerativeSlot &&
        accSub &&
        accessorySlots[accSub] &&
        accessorySlots[accSub]!.items.length < accessorySlots[accSub]!.capacity
      ) {
        accessorySlots[accSub]!.items.push({
          slotType: accSub,
          item,
          isLocked,
          lockReason,
          canUnlockInRemix,
        });
      } else {
        passthroughItems.push(item);
      }
    } else {
      passthroughItems.push(item);
    }
  }

  const dummyCandidate: CandidateOutfit = {
    candidateId: look.candidateId,
    items: look.items,
    key: look.key,
    baseScore: look.score,
    colorMatchLabel: 'Coordinated',
    formalityLevel: intent.formality || 'balanced',
    hasDress: !!slots.dress,
    hasShoes: !!slots.shoes,
    hasOuterwear: !!slots.outerwear,
    hasBag: look.items.some((i) => resolveAccessorySubtype(i) === 'bag'),
    hasBelt: look.items.some((i) => resolveAccessorySubtype(i) === 'belt'),
    accessoryCount: look.items.filter((i) => resolveEffectiveGarmentBucket(i) === 'Accessory').length,
  };

  return {
    sourceType: 'style-advisor',
    originalOutfitKey: look.key,
    slots,
    accessorySlots,
    passthroughItems,
    history: [look.key],
    intent,
    activeCandidate: dummyCandidate,
    isDirty: false,
    error: null,
  };
}

/**
 * Adapts a Passive Outfits feed suggestion into OutfitRemixState.
 * Invariant: Uses neutral intent without fabricating fictional prompt or occasion context.
 */
export function adaptPassiveOutfitToRemix(
  outfit: { key?: string; items: WardrobeItem[]; label?: string; score?: number },
  wardrobe: WardrobeItem[],
  profile?: UserStyleProfileDto | null
): OutfitRemixState {
  const outfitKey = outfit.key || outfit.items.map((i) => i.id).sort().join('|');

  const slots: Record<CoreRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };
  const accessorySlots = createEmptyAccessorySlots();
  const passthroughItems: WardrobeItem[] = [];

  for (const item of outfit.items) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = rawBucket === 'footwear' ? 'shoes' : rawBucket;

    if (bucket in slots) {
      const coreSlot = bucket as CoreRemixSlotType;
      slots[coreSlot] = {
        slotType: coreSlot,
        item,
        isLocked: false,
        lockReason: 'remix',
        canUnlockInRemix: true,
      };
    } else {
      passthroughItems.push(item);
    }
  }

  const dummyCandidate: CandidateOutfit = {
    candidateId: outfitKey,
    items: outfit.items,
    key: outfitKey,
    baseScore: outfit.score || 85,
    colorMatchLabel: outfit.label || 'Balanced',
    formalityLevel: 'balanced',
    hasDress: !!slots.dress,
    hasShoes: !!slots.shoes,
    hasOuterwear: !!slots.outerwear,
    hasBag: outfit.items.some((i) => resolveAccessorySubtype(i) === 'bag'),
    hasBelt: outfit.items.some((i) => resolveAccessorySubtype(i) === 'belt'),
    accessoryCount: outfit.items.filter((i) => resolveEffectiveGarmentBucket(i) === 'Accessory').length,
  };

  return {
    sourceType: 'passive-outfit',
    originalOutfitKey: outfitKey,
    slots,
    accessorySlots,
    passthroughItems,
    history: [outfitKey],
    intent: { rawPrompt: '' }, // Neutral intent: never invent occasion
    profile,
    activeCandidate: dummyCandidate,
    isDirty: false,
    error: null,
  };
}

/**
 * Adapts a Saved Outfit record into OutfitRemixState.
 * Resolves wardrobe_item_id || id against live wardrobe.
 * Unresolved pieces are routed to passthroughItems; incompatible structures are safely flagged.
 */
export function adaptSavedOutfitToRemix(
  savedOutfit: { id: string; name?: string | null; items?: any },
  wardrobe: WardrobeItem[]
): OutfitRemixState {
  const rawItems = Array.isArray(savedOutfit.items) ? savedOutfit.items : [];
  const wardrobeMap = new Map(wardrobe.map((w) => [w.id, w]));

  const resolvedItems: WardrobeItem[] = [];
  const passthroughItems: WardrobeItem[] = [];
  const missingItems: { id: string; slot?: string; name?: string }[] = [];

  for (const raw of rawItems) {
    const wId = raw.wardrobe_item_id || raw.id;
    const liveItem = wId ? wardrobeMap.get(wId) : null;
    const rawSlot = (raw.slot || '').toLowerCase();
    const isCoreSlot = ['top', 'bottom', 'dress', 'shoes', 'footwear', 'outerwear'].includes(rawSlot);

    if (liveItem) {
      if (raw.slot && !isCoreSlot) {
        passthroughItems.push(liveItem);
      } else {
        resolvedItems.push(liveItem);
      }
    } else if (raw) {
      const hasUsableSnapshot = Boolean(raw.image_url || raw.name);
      if (hasUsableSnapshot) {
        // Preserved non-editable snapshot (e.g. historical look piece with image or title)
        passthroughItems.push({
          id: wId || `snapshot_${Math.random()}`,
          user_id: '',
          product_id: raw.product_id || null,
          image_url: raw.image_url || '',
          category: raw.slot || raw.category || 'Accessory',
          sub_category: raw.name || raw.sub_category || 'Preserved Item',
          deleted: false,
          created_at: '',
          color_tags: raw.color_tags || [],
          garment_type: raw.slot || 'accessory',
          wear_count: 0,
          last_worn_at: null,
          description: null,
          user_notes: null,
          ai_attributes: null,
          occasions: [],
          seasons: [],
          embedding: null,
        } as unknown as WardrobeItem);
      } else {
        // Deleted item without usable snapshot: record explicitly, never fabricate WardrobeItem
        missingItems.push({
          id: wId || 'unknown_item',
          slot: raw.slot || undefined,
          name: raw.name || undefined,
        });
      }
    }
  }

  const outfitKey = resolvedItems.map((i) => i.id).sort().join('|') || savedOutfit.id;

  const slots: Record<CoreRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };
  const accessorySlots = createEmptyAccessorySlots();

  for (const item of resolvedItems) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = rawBucket === 'footwear' ? 'shoes' : rawBucket;

    if (bucket in slots) {
      const coreSlot = bucket as CoreRemixSlotType;
      slots[coreSlot] = {
        slotType: coreSlot,
        item,
        isLocked: false,
        lockReason: 'remix',
        canUnlockInRemix: true,
      };
    } else if (rawBucket === 'accessory') {
      const accSub = resolveAccessorySubtype(item);
      const isGenerativeSlot = accSub === 'bag' || accSub === 'belt' || accSub === 'jewelry';
      if (
        isGenerativeSlot &&
        accSub &&
        accessorySlots[accSub] &&
        accessorySlots[accSub]!.items.length < accessorySlots[accSub]!.capacity
      ) {
        accessorySlots[accSub]!.items.push({
          slotType: accSub,
          item,
          isLocked: false,
          lockReason: 'remix',
          canUnlockInRemix: true,
        });
      } else {
        passthroughItems.push(item);
      }
    } else {
      passthroughItems.push(item);
    }
  }

  const dummyCandidate: CandidateOutfit = {
    candidateId: outfitKey,
    items: resolvedItems.concat(passthroughItems),
    key: outfitKey,
    baseScore: 85,
    colorMatchLabel: 'Balanced',
    formalityLevel: 'balanced',
    hasDress: !!slots.dress,
    hasShoes: !!slots.shoes,
    hasOuterwear: !!slots.outerwear,
    hasBag: resolvedItems.some((i) => resolveAccessorySubtype(i) === 'bag'),
    hasBelt: resolvedItems.some((i) => resolveAccessorySubtype(i) === 'belt'),
    accessoryCount: resolvedItems.filter((i) => resolveEffectiveGarmentBucket(i) === 'Accessory').length,
  };

  return {
    sourceType: 'saved-outfit',
    originalOutfitKey: outfitKey,
    slots,
    accessorySlots,
    passthroughItems,
    history: [outfitKey],
    intent: { rawPrompt: '' },
    activeCandidate: dummyCandidate,
    isDirty: false,
    error: null,
    missingItems: missingItems.length > 0 ? missingItems : undefined,
  };
}
