/**
 * Backward-compatible adapter for legacy outfit generator callers.
 * Delegates combination generation to CanonicalCandidateEngine (candidateGenerator.ts)
 * and wear stats to wardrobeStats.ts.
 */

import { Database } from '@/src/types/database.types';
import { ColorMatchResult, evaluateColors } from './colorMatcher';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { explainOutfit, OutfitExplanation } from './outfitExplainer';
import { computePersonalAffinity } from './personalStyleEngine';
import {
  evaluateWardrobeOutfit,
  OverallAssessment,
  Contradiction,
  StylistCritique,
  OutfitContext,
} from './aiStylistAdvisor';
import {
  generateCandidateOutfits,
  CandidateGenerationOptions,
} from '../services/styling/candidateGenerator';
import { StylingIntent, CandidateOutfit } from '../types/styleAdvisor';
import { computeStats, WardrobeStats } from './wardrobeStats';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export { computeStats, WardrobeStats };

export interface GeneratedOutfit {
  key: string;
  items: WardrobeItem[];
  score: number;
  label: ColorMatchResult['label'];
  reason: string;
  explanation?: OutfitExplanation;
  personalScore?: number;
  occasion?: string | null;
  assessment?: OverallAssessment;
  critique?: StylistCritique;
  contradictions?: string[];
  rawContradictions?: Contradiction[];
}

export interface GenerateOutfitsOptions {
  limit?: number;
  occasion?: string | null;
  additionalContext?: string | null;
  profile?: UserStyleProfileDto | null;
  requiredItemId?: string | null;
}

/** Normalizes legacy options into a complete StylingIntent without silent default inventions. */
function buildPassiveStylingIntent(options: GenerateOutfitsOptions): StylingIntent {
  return {
    rawPrompt: options.additionalContext || '',
    selectedOccasion: options.occasion || null,
    // Do NOT invent 'formality: casual' for callers that had no formality target
    formality: undefined,
    mustUseItemIds: options.requiredItemId ? [options.requiredItemId] : [],
    excludedItemIds: [],
    preferredColors: [],
    avoidedColors: [],
  };
}

/** Maps a canonical CandidateOutfit to the legacy GeneratedOutfit contract. */
function mapCandidateToGeneratedOutfit(
  cand: CandidateOutfit,
  options: GenerateOutfitsOptions
): GeneratedOutfit {
  const items = cand.items;
  const colors = items.flatMap((i) => i.color_tags || []);
  const match = evaluateColors(colors);
  const personal = computePersonalAffinity(items, options.profile, options.occasion);

  const context: OutfitContext | undefined = options.occasion
    ? { occasion: options.occasion, additionalContext: options.additionalContext ?? undefined }
    : undefined;
  const critique = evaluateWardrobeOutfit(items, undefined, context, options.profile);

  const explanation = explainOutfit(items, match, personal, options.occasion);
  const neverWorn = items.filter((i) => !i.wear_count);

  let reason = (options.occasion && critique.whyJezsySaysThis) ? critique.whyJezsySaysThis : explanation.summary;
  if (neverWorn.length === 1) {
    reason += ` Includes a piece you have never worn.`;
  } else if (neverWorn.length > 1) {
    reason += ` Puts ${neverWorn.length} never-worn pieces to work.`;
  }

  return {
    key: cand.key,
    items: cand.items,
    score: cand.baseScore,
    label: (cand.colorMatchLabel as ColorMatchResult['label']) || match.label,
    reason,
    explanation,
    personalScore: personal.score,
    occasion: options.occasion,
    assessment: critique.assessment,
    critique,
    contradictions: critique.contradictions,
    rawContradictions: critique.rawContradictions,
  };
}

/**
 * Returns ranked outfit suggestions, best first.
 * Supports backward-compatible calls:
 * - generateOutfits(items, 6)
 * - generateOutfits(items, { limit: 6, occasion: 'Work', profile })
 */
export function generateOutfits(
  items: WardrobeItem[],
  optionsOrLimit: number | GenerateOutfitsOptions = 6
): GeneratedOutfit[] {
  const options: GenerateOutfitsOptions =
    typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit }
      : optionsOrLimit;

  const intent = buildPassiveStylingIntent(options);
  const candidateOptions: CandidateGenerationOptions = {
    limit: options.limit || 6,
    profile: options.profile,
    scoringProfile: 'legacy-passive',
  };

  const candidates = generateCandidateOutfits(items, intent, candidateOptions);
  return candidates.map((c) => mapCandidateToGeneratedOutfit(c, options));
}
