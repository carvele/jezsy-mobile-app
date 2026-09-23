/**
 * outfitRemixService.ts
 * Pure domain service for Phase E Interactive Remix & Slot-Level Garment Swapping.
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
  RemixedSlotItem,
  OutfitRemixResult,
} from '@/src/types/outfitRemix';
import { generateCandidateOutfits } from './candidateGenerator';
import { generateGroundedExplanation } from './groundedExplainer';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';

const MAX_REMIX_HISTORY = 10;

/**
 * Maps a candidate outfit into the remix slot model while preserving
 * passthrough items, existing lock state, and lock provenance for retained pieces.
 */
export function applyCandidateToRemixState(
  state: OutfitRemixState,
  candidate: CandidateOutfit
): OutfitRemixState {
  const passthroughItems = [...state.passthroughItems];

  const newSlots: Record<OutfitRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };

  for (const item of candidate.items) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = (rawBucket === 'footwear' ? 'shoes' : rawBucket) as OutfitRemixSlotType;

    if (bucket in newSlots) {
      const existing = state.slots[bucket];
      if (existing && existing.item.id === item.id) {
        // Retain existing lock state and provenance for unchanged pieces
        newSlots[bucket] = existing;
      } else {
        // New piece in this slot defaults to an unlocked remix item
        newSlots[bucket] = {
          slotType: bucket,
          item,
          isLocked: false,
          lockReason: 'remix',
          canUnlockInRemix: true,
        };
      }
    }
  }

  return {
    ...state,
    slots: newSlots,
    passthroughItems,
    activeCandidate: candidate,
    isDirty: true,
    error: null,
  };
}

/**
 * Toggles the lock on a slot.
 * Rejects unlocking if the item is an authoritative parent constraint (style-around or parent-must-use).
 */
export function toggleSlotLock(
  state: OutfitRemixState,
  slotType: OutfitRemixSlotType
): OutfitRemixState {
  const slotData = state.slots[slotType];
  if (!slotData) return state;

  if (slotData.isLocked && !slotData.canUnlockInRemix) {
    return {
      ...state,
      error: 'This item is required by your styling session and cannot be unlocked in Remix.',
    };
  }

  const updatedSlot: RemixedSlotItem = {
    ...slotData,
    isLocked: !slotData.isLocked,
  };

  return {
    ...state,
    slots: {
      ...state.slots,
      [slotType]: updatedSlot,
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
  wardrobe: WardrobeItem[]
): { candidate: CandidateOutfit; replacementItem: WardrobeItem }[] {
  const currentSlotItem = state.slots[targetSlot]?.item;
  if (!currentSlotItem) return [];

  // Retain all non-target garments as must-use
  const nonTargetItemIds: string[] = [];
  for (const [slotKey, slotData] of Object.entries(state.slots)) {
    if (slotKey !== targetSlot && slotData?.item) {
      nonTargetItemIds.push(slotData.item.id);
    }
  }

  const mergedMustUse = Array.from(
    new Set([...(state.intent.mustUseItemIds || []), ...nonTargetItemIds])
  );
  const mergedExcluded = Array.from(
    new Set([...(state.intent.excludedItemIds || []), currentSlotItem.id])
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
    const itemInSlot = cand.items.find((i) => {
      const b = resolveEffectiveGarmentBucket(i).toLowerCase();
      const mapped = b === 'footwear' ? 'shoes' : b;
      return mapped === targetSlot;
    });

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

  // Filter active wardrobe items (reject deleted/stale items)
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

  // 3. Preserve compatible non-base must-use pieces (Shoes, Outerwear)
  const nonBaseItemIds: string[] = [];
  if (state.slots.shoes?.item && (state.slots.shoes.isLocked || parentMustUseIds.has(state.slots.shoes.item.id))) {
    nonBaseItemIds.push(state.slots.shoes.item.id);
  }
  if (state.slots.outerwear?.item && (state.slots.outerwear.isLocked || parentMustUseIds.has(state.slots.outerwear.item.id))) {
    nonBaseItemIds.push(state.slots.outerwear.item.id);
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

  if (unlockedItemIds.length === 0) {
    return { ...state, error: 'All slots are locked. Unlock at least one piece to shuffle.' };
  }

  // Preserve current base structure (never implicitly switch between Dress and Separates during shuffle)
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

  // Anti-repeat selection with TRUE deterministic LRU fallback:
  // History is newest-first: index 0 is most recent, index 9 is oldest seen.
  const history = state.history;
  const unseen = candidates.filter((c) => !history.includes(c.key));

  let chosen: CandidateOutfit;
  if (unseen.length > 0) {
    chosen = unseen[0];
  } else {
    // True LRU: select candidate whose key appears at the largest index (oldest) in history
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

  const outerwearIntent: StylingIntent = {
    ...state.intent,
    mustUseItemIds: Array.from(new Set([...(state.intent.mustUseItemIds || []), ...currentItemIds])),
  };

  const candidates = generateCandidateOutfits(wardrobe, outerwearIntent, {
    limit: 8,
    profile: state.profile,
  });

  const candWithOuter = candidates.find((c) =>
    c.items.some((i) => resolveEffectiveGarmentBucket(i) === 'Outerwear')
  );

  if (!candWithOuter) {
    return { ...state, error: 'No compatible outerwear found in your wardrobe for this look.' };
  }

  return applyCandidateToRemixState(state, candWithOuter);
}

/**
 * Removes outerwear without corrupting the base outfit.
 * Rejects removal if outerwear is an authoritative parent constraint.
 */
export function removeOuterwear(state: OutfitRemixState): OutfitRemixState {
  if (state.slots.outerwear === null) return state;

  if (state.slots.outerwear.isLocked && !state.slots.outerwear.canUnlockInRemix) {
    return { ...state, error: 'Cannot remove outerwear required by your Style Advisor session.' };
  }

  const updatedSlots = { ...state.slots, outerwear: null };
  const activeItems = Object.values(updatedSlots)
    .filter((s): s is RemixedSlotItem => Boolean(s?.item))
    .map((s) => s.item)
    .concat(state.passthroughItems);

  const candidateKey = activeItems.map((i) => i.id).sort().join('|');
  const dummyCandidate: CandidateOutfit = {
    candidateId: candidateKey,
    items: activeItems,
    key: candidateKey,
    baseScore: state.activeCandidate?.baseScore ?? 80,
    colorMatchLabel: 'Balanced',
    formalityLevel: state.intent.formality || 'balanced',
    hasDress: activeItems.some((i) => resolveEffectiveGarmentBucket(i) === 'Dress'),
    hasShoes: activeItems.some((i) => resolveEffectiveGarmentBucket(i) === 'Shoes'),
    hasOuterwear: false,
  };

  return {
    ...state,
    slots: updatedSlots,
    activeCandidate: dummyCandidate,
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

  const slots: Record<OutfitRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };
  const passthroughItems: WardrobeItem[] = [];

  for (const item of look.items) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = (rawBucket === 'footwear' ? 'shoes' : rawBucket) as OutfitRemixSlotType;

    if (bucket in slots) {
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

      slots[bucket] = {
        slotType: bucket,
        item,
        isLocked,
        lockReason,
        canUnlockInRemix,
      };
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
  };

  return {
    sourceType: 'style-advisor',
    originalOutfitKey: look.key,
    slots,
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

  const slots: Record<OutfitRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };
  const passthroughItems: WardrobeItem[] = [];

  for (const item of outfit.items) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = (rawBucket === 'footwear' ? 'shoes' : rawBucket) as OutfitRemixSlotType;

    if (bucket in slots) {
      slots[bucket] = {
        slotType: bucket,
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
  };

  return {
    sourceType: 'passive-outfit',
    originalOutfitKey: outfitKey,
    slots,
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

  const slots: Record<OutfitRemixSlotType, RemixedSlotItem | null> = {
    top: null,
    bottom: null,
    dress: null,
    shoes: null,
    outerwear: null,
  };

  for (const item of resolvedItems) {
    const rawBucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const bucket = (rawBucket === 'footwear' ? 'shoes' : rawBucket) as OutfitRemixSlotType;

    if (bucket in slots) {
      slots[bucket] = {
        slotType: bucket,
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
    items: resolvedItems.concat(passthroughItems),
    key: outfitKey,
    baseScore: 85,
    colorMatchLabel: 'Balanced',
    formalityLevel: 'balanced',
    hasDress: !!slots.dress,
    hasShoes: !!slots.shoes,
    hasOuterwear: !!slots.outerwear,
  };

  return {
    sourceType: 'saved-outfit',
    originalOutfitKey: outfitKey,
    slots,
    passthroughItems,
    history: [outfitKey],
    intent: { rawPrompt: '' },
    activeCandidate: dummyCandidate,
    isDirty: false,
    error: null,
    missingItems: missingItems.length > 0 ? missingItems : undefined,
  };
}
