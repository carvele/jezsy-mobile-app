import {
  CandidateOutfit,
  StylingIntent,
  StylingOption,
  StylingAIRecommendation,
  WardrobeItem,
} from '@/src/types/styleAdvisor';
import { generateGroundedExplanation } from './groundedExplainer';
import { defaultAIStylistProvider, IAIStylistProvider } from '../aiStylistProvider';

/**
 * Validates that an AI recommendation references a known candidate ID from the pool,
 * contains no generic filler, and adheres to the strict contract.
 */
function validateAIRecommendation(
  rec: any,
  candidateMap: Map<string, CandidateOutfit>
): StylingAIRecommendation | null {
  if (!rec || typeof rec !== 'object') return null;
  const candidateId = typeof rec.candidateId === 'string' ? rec.candidateId.trim() : '';
  if (!candidateMap.has(candidateId)) {
    // Reject unknown or hallucinated candidate IDs
    return null;
  }

  const label = typeof rec.label === 'string' && rec.label.trim().length > 0 ? rec.label.trim() : 'Curated Look';
  const headline = typeof rec.headline === 'string' && rec.headline.trim().length > 0 ? rec.headline.trim() : 'Stylist Selection';
  const intentMatch = typeof rec.intentMatch === 'string' && rec.intentMatch.trim().length > 0
    ? rec.intentMatch.trim()
    : 'Selected to match your styling context.';

  const wtw = rec.whyThisWorks;
  if (!wtw || typeof wtw !== 'object') return null;

  const summary = typeof wtw.summary === 'string' && wtw.summary.trim().length >= 10 ? wtw.summary.trim() : '';
  const palette = typeof wtw.palette === 'string' && wtw.palette.trim().length > 0 ? wtw.palette.trim() : '';
  const silhouette = typeof wtw.silhouette === 'string' && wtw.silhouette.trim().length > 0 ? wtw.silhouette.trim() : '';
  const occasion = typeof wtw.occasion === 'string' && wtw.occasion.trim().length > 0 ? wtw.occasion.trim() : '';

  if (!summary || !palette || !silhouette) {
    return null;
  }

  // Reject generic filler phrases
  const bannedPhrases = [
    /casual everyday outfit/i,
    /comfortable separates suited for/i,
    /the pieces create a relaxed, wearable outfit/i,
    /effortlessly daytime styling/i,
  ];
  for (const pattern of bannedPhrases) {
    if (pattern.test(summary) || pattern.test(headline)) {
      return null;
    }
  }

  return {
    candidateId,
    label,
    headline,
    intentMatch,
    whyThisWorks: {
      summary,
      palette,
      silhouette,
      occasion,
      layering: typeof wtw.layering === 'string' ? wtw.layering.trim() : undefined,
      footwear: typeof wtw.footwear === 'string' ? wtw.footwear.trim() : undefined,
    },
    proTip: typeof rec.proTip === 'string' ? rec.proTip.trim() : undefined,
  };
}

/**
 * Derives contextual variation labels from the user's styling intent.
 */
function deriveVariationLabels(intent: StylingIntent, count: number): string[] {
  const occ = (intent.selectedOccasion || intent.rawPrompt || '').toLowerCase();

  if (occ.includes('dinner') || occ.includes('date')) {
    return ['Polished', 'Contemporary', 'Comfortable'].slice(0, count);
  }
  if (occ.includes('interview') || occ.includes('work') || occ.includes('presentation')) {
    return ['Conservative', 'Modern Professional', 'Approachable'].slice(0, count);
  }
  if (occ.includes('travel') || occ.includes('flight') || occ.includes('road')) {
    return ['Comfort First', 'Polished Travel', 'Layer Ready'].slice(0, count);
  }
  if (occ.includes('party') || occ.includes('celebrat') || occ.includes('event')) {
    return ['Festive', 'Chic Statement', 'Effortless'].slice(0, count);
  }
  if (intent.formality === 'formal') {
    return ['Formal Classic', 'Sleek Modern', 'Refined'].slice(0, count);
  }

  return Array.from({ length: count }, (_, i) => `Look ${i + 1}`);
}

/**
 * Deterministic fallback ranker and explainer when AI is unavailable, times out, or returns invalid IDs.
 */
export function rankCandidatesDeterministic(
  candidates: CandidateOutfit[],
  intent: StylingIntent,
  limit = 3
): StylingOption[] {
  const chosen = candidates.slice(0, limit);
  const labels = deriveVariationLabels(intent, chosen.length);

  return chosen.map((cand, idx) => {
    const grounded = generateGroundedExplanation(cand, intent);
    return {
      candidateId: cand.candidateId,
      items: cand.items,
      key: cand.key,
      label: labels[idx] || `Look ${idx + 1}`,
      headline: grounded.headline,
      intentMatch: grounded.intentMatch,
      whyThisWorks: grounded.whyThisWorks,
      proTip: grounded.proTip,
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: cand.baseScore,
    };
  });
}

/**
 * Ranks and selects the top outfit options using the AI Stylist, with verified grounding and instant fallback.
 */
export async function rankCandidatesWithAI(
  candidates: CandidateOutfit[],
  intent: StylingIntent,
  wardrobeLookup: Record<string, WardrobeItem>,
  provider?: IAIStylistProvider
): Promise<StylingOption[]> {
  if (!candidates || candidates.length === 0) return [];

  // Bounded target: 2 to 3 options
  const targetCount = Math.min(3, Math.max(1, candidates.length));
  const candidateMap = new Map<string, CandidateOutfit>(candidates.map((c) => [c.candidateId, c]));
  const activeProvider = provider || defaultAIStylistProvider;

  // If provider has rankCandidates, attempt AI selection
  if (typeof (activeProvider as any).rankCandidates === 'function') {
    try {
      const aiResult = await (activeProvider as any).rankCandidates(candidates, intent, wardrobeLookup);
      if (aiResult && aiResult.success && Array.isArray(aiResult.recommendations)) {
        const validatedOptions: StylingOption[] = [];
        const seenCandidateIds = new Set<string>();

        for (const rec of aiResult.recommendations) {
          const validated = validateAIRecommendation(rec, candidateMap);
          if (validated && !seenCandidateIds.has(validated.candidateId)) {
            seenCandidateIds.add(validated.candidateId);
            const cand = candidateMap.get(validated.candidateId)!;
            validatedOptions.push({
              candidateId: cand.candidateId,
              items: cand.items,
              key: cand.key,
              label: validated.label,
              headline: validated.headline,
              intentMatch: validated.intentMatch,
              whyThisWorks: validated.whyThisWorks,
              proTip: validated.proTip,
              isAiRanked: true,
              assessment: 'Appropriate for this occasion',
              score: cand.baseScore,
            });
            if (validatedOptions.length >= targetCount) break;
          }
        }

        // If at least one look was validly ranked by AI, fill any remaining slots with deterministic looks
        if (validatedOptions.length > 0) {
          if (validatedOptions.length < targetCount) {
            const fallbackPool = candidates.filter((c) => !seenCandidateIds.has(c.candidateId));
            const extra = rankCandidatesDeterministic(fallbackPool, intent, targetCount - validatedOptions.length);
            validatedOptions.push(...extra);
          }
          return validatedOptions;
        }
      }
    } catch (err) {
      console.warn('[aiCandidateRanker] AI ranking failed, falling back to deterministic ranker:', err);
    }
  }

  // Graceful deterministic fallback
  return rankCandidatesDeterministic(candidates, intent, targetCount);
}
