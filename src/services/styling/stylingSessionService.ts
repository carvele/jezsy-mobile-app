import {
  WardrobeItem,
  StylingIntent,
  CandidateOutfit,
  StylingOption,
  StylingRefinementType,
} from '@/src/types/styleAdvisor';
import { parseStylingIntent } from './intentParser';
import { generateCandidateOutfits } from './candidateGenerator';
import { rankCandidatesWithAI } from './aiCandidateRanker';
import { UserStyleProfileDto } from '@/src/types/dto/styleProfile';
import { IAIStylistProvider } from '../aiStylistProvider';

export interface StylingSessionState {
  intent: StylingIntent;
  lockedWardrobeItemIds: string[];
  options: StylingOption[];
  allCandidates: CandidateOutfit[];
  activeIndex: number;
  seenOutfitKeys: Set<string>;
  wardrobe: WardrobeItem[];
  profile?: UserStyleProfileDto | null;
  loading: boolean;
  error?: string | null;
}

/**
 * Applies diversity penalties and bonuses according to the session rules:
 * - exact previous outfit: strongly avoided (-100 penalty)
 * - high-overlap outfit (>60% overlap with previous outfits): moderate penalty (-30)
 * - must-use item: exempt from diversity penalties
 * - never-worn item: discovery bonus (+10)
 * - recently worn item: mild rotation penalty (-10)
 */
export function applyDiversityScoring(
  candidates: CandidateOutfit[],
  seenKeys: Set<string>,
  mustUseIds: Set<string>
): CandidateOutfit[] {
  return candidates.map((cand) => {
    let penalty = 0;
    const candItemIds = new Set(cand.items.map((i) => i.id));

    // Exact previous outfit penalty
    if (seenKeys.has(cand.key)) {
      penalty += 100;
    } else {
      // Check partial overlap with previously seen looks
      for (const seenKey of seenKeys) {
        const seenIds = seenKey.split('|');
        if (seenIds.length > 0) {
          let overlap = 0;
          for (const sId of seenIds) {
            // Must-use items are exempt from overlap penalty
            if (!mustUseIds.has(sId) && candItemIds.has(sId)) {
              overlap++;
            }
          }
          const overlapRatio = overlap / Math.max(cand.items.length, seenIds.length);
          if (overlapRatio >= 0.6) {
            penalty += 30;
          }
        }
      }
    }

    // Never-worn discovery bonus
    const neverWornCount = cand.items.filter((i) => !i.wear_count).length;
    const bonus = neverWornCount * 10;

    return {
      ...cand,
      baseScore: Math.max(10, cand.baseScore - penalty + bonus),
    };
  }).sort((a, b) => b.baseScore - a.baseScore);
}

/**
 * Initializes and executes a new styling session from user prompt + optional occasion/chips shortcut + optional locked items.
 */
export async function createStylingSession(
  rawPrompt: string,
  selectedOccasionOrChips: string | any | null | undefined,
  wardrobe: WardrobeItem[],
  profile?: UserStyleProfileDto | null,
  provider?: IAIStylistProvider,
  initialLockedItemIds: string[] = []
): Promise<StylingSessionState> {
  const lockedWardrobeItemIds = Array.from(new Set(initialLockedItemIds));
  const intent = parseStylingIntent(rawPrompt, selectedOccasionOrChips, wardrobe, undefined, lockedWardrobeItemIds);

  // If directly contradictory constraints were detected (e.g. "All black but avoid black" or prompt opposes locked item)
  if (intent.conflictingConstraints && intent.conflictingConstraints.length > 0) {
    return {
      intent,
      lockedWardrobeItemIds,
      options: [],
      allCandidates: [],
      activeIndex: 0,
      seenOutfitKeys: new Set(),
      wardrobe,
      profile,
      loading: false,
      error: intent.conflictingConstraints.join(' '),
    };
  }

  // 1. Generate candidate pool from actual wardrobe
  const candidates = generateCandidateOutfits(wardrobe, intent, { limit: 12, profile });
  if (candidates.length === 0) {
    return {
      intent,
      lockedWardrobeItemIds,
      options: [],
      allCandidates: [],
      activeIndex: 0,
      seenOutfitKeys: new Set(),
      wardrobe,
      profile,
      loading: false,
      error: 'No viable outfit combinations found in your wardrobe matching these criteria.',
    };
  }

  // 2. Build wardrobe lookup table
  const wardrobeLookup: Record<string, WardrobeItem> = {};
  for (const item of wardrobe) {
    wardrobeLookup[item.id] = item;
  }

  // 3. AI ranking and selection (with deterministic fallback and supplemental fill)
  const options = await rankCandidatesWithAI(candidates, intent, wardrobeLookup, provider);

  // 4. Record chosen keys in seen history
  const seenKeys = new Set<string>();
  for (const opt of options) {
    seenKeys.add(opt.key);
  }

  return {
    intent,
    lockedWardrobeItemIds,
    options,
    allCandidates: candidates,
    activeIndex: 0,
    seenOutfitKeys: seenKeys,
    wardrobe,
    profile,
    loading: false,
    error: null,
  };
}

/**
 * Refines the current styling session based on an action (e.g. "moreFormal", "tryAnother", "avoidItem", "useItem").
 * Durably preserves lockedWardrobeItemIds across all refinements.
 */
export async function refineStylingSession(
  currentState: StylingSessionState,
  refinement: StylingRefinementType,
  targetItemId?: string,
  provider?: IAIStylistProvider
): Promise<StylingSessionState> {
  const nextIntent: StylingIntent = { ...currentState.intent };
  const nextSeenKeys = new Set(currentState.seenOutfitKeys);
  const lockedIds = currentState.lockedWardrobeItemIds || [];

  // Mark all current options as seen to force diversification
  for (const opt of currentState.options) {
    nextSeenKeys.add(opt.key);
  }

  switch (refinement) {
    case 'moreFormal': {
      if (!nextIntent.formality || nextIntent.formality === 'casual') {
        nextIntent.formality = 'elevatedCasual';
      } else {
        nextIntent.formality = 'formal';
      }
      break;
    }
    case 'moreRelaxed': {
      if (nextIntent.formality === 'formal') {
        nextIntent.formality = 'elevatedCasual';
      } else {
        nextIntent.formality = 'casual';
      }
      nextIntent.comfortPriority = true;
      break;
    }
    case 'moreComfortable': {
      nextIntent.comfortPriority = true;
      break;
    }
    case 'moreModest': {
      nextIntent.modestyPreference = true;
      break;
    }
    case 'moreColorful': {
      // Exclude monochrome constraint if present
      nextIntent.preferredColors = (nextIntent.preferredColors || []).concat(['vibrant', 'color']);
      break;
    }
    case 'tryAnother': {
      // Keeping intent same, diversity scoring will push unseen pieces to top
      break;
    }
    case 'avoidItem': {
      if (targetItemId) {
        // Guard: cannot avoid a garment that is currently locked in session
        if (lockedIds.includes(targetItemId)) {
          return {
            ...currentState,
            error: 'This garment is currently locked for styling. Unlock it before excluding.',
          };
        }
        nextIntent.excludedItemIds = Array.from(
          new Set([...(nextIntent.excludedItemIds || []), targetItemId])
        );
        nextIntent.mustUseItemIds = (nextIntent.mustUseItemIds || []).filter((id) => id !== targetItemId);
      }
      break;
    }
    case 'useItem': {
      if (targetItemId) {
        nextIntent.mustUseItemIds = Array.from(
          new Set([...(nextIntent.mustUseItemIds || []), targetItemId])
        );
        nextIntent.excludedItemIds = (nextIntent.excludedItemIds || []).filter((id) => id !== targetItemId);
      }
      break;
    }
  }

  // Ensure all durable locked items remain in mustUseItemIds
  if (lockedIds.length > 0) {
    nextIntent.mustUseItemIds = Array.from(
      new Set([...(nextIntent.mustUseItemIds || []), ...lockedIds])
    );
  }

  // Generate candidates with updated intent
  const rawCandidates = generateCandidateOutfits(currentState.wardrobe, nextIntent, {
    limit: 12,
    profile: currentState.profile,
  });

  if (rawCandidates.length === 0) {
    return {
      ...currentState,
      intent: nextIntent,
      error: 'No combinations found satisfying this refinement.',
    };
  }

  // Apply diversity scoring using seen keys
  const mustUseSet = new Set(nextIntent.mustUseItemIds || []);
  const diversifiedCandidates = applyDiversityScoring(rawCandidates, nextSeenKeys, mustUseSet);

  const wardrobeLookup: Record<string, WardrobeItem> = {};
  for (const item of currentState.wardrobe) {
    wardrobeLookup[item.id] = item;
  }

  const options = await rankCandidatesWithAI(diversifiedCandidates, nextIntent, wardrobeLookup, provider);

  for (const opt of options) {
    nextSeenKeys.add(opt.key);
  }

  return {
    ...currentState,
    intent: nextIntent,
    lockedWardrobeItemIds: lockedIds,
    options,
    allCandidates: diversifiedCandidates,
    activeIndex: 0,
    seenOutfitKeys: nextSeenKeys,
    error: null,
  };
}
