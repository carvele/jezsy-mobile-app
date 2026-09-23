import {
  UserStyleProfileDto,
  OutfitFeedbackType,
  StyleDnaProfile,
  StylePreferenceEvent,
  StyleDimensionAffinity,
  ExplicitPreferences,
} from '../types/dto/styleProfile';
import { WardrobeItem } from '../services/wardrobeService';

export interface PersonalAffinityResult {
  score: number; // 0 - 100
  positiveSignals: string[];
  negativeSignals: string[];
  recommendationNote: string;
  learnedDnaDelta?: number;
}

// Named deterministic configuration constants
export const EXPLICIT_PREFERRED_COLOR_BOOST = 6;
export const EXPLICIT_PREFERRED_FIT_BOOST = 5;
export const EXPLICIT_PREFERRED_SILHOUETTE_BOOST = 5;
export const EXPLICIT_DISLIKED_COLOR_PENALTY = 20;
export const EXPLICIT_DISLIKED_FIT_PENALTY = 25;
export const EXPLICIT_DISLIKED_PATTERN_PENALTY = 15;
export const LEARNED_STYLE_MAX_DELTA = 15;

export const STYLE_DNA_HALF_LIFE_DAYS = 60;
export const STYLE_DNA_LAMBDA = 0.011552453; // ln(2) / 60

export const DEFAULT_STYLE_PROFILE: Omit<UserStyleProfileDto, 'userId'> = {
  preferredGarmentTypes: ['Top', 'Bottom', 'Dress', 'Outerwear'],
  preferredFits: ['Regular'],
  preferredOccasions: ['Casual', 'Everyday', 'Work'],
  avoidedPatterns: [],
  avoidedColors: [],
  preferredColors: [],
  styleKeywords: ['Classic', 'Modern Casual'],
  explicitPreferences: {},
  preferenceWeights: {
    colorHarmony: 0.40,
    composition: 0.35,
    personalStyle: 0.25,
    occasionFit: 0.15,
  },
  feedbackCount: 0,
};

/**
 * Maps global confidence or StyleDnaProfile to human-readable qualitative maturity states.
 * Frozen requirements:
 *   globalConfidence < 0.30            → "Learning your style"
 *   0.30 <= globalConfidence < 0.70    → "Getting to know your style"
 *   globalConfidence >= 0.70           → "Style profile established"
 */
export function getQualitativeStyleMaturity(input: number | StyleDnaProfile): {
  level: number;
  label: string;
  badge: string;
  stage: 'learning' | 'developing' | 'established';
  explanation: string;
} {
  const conf = typeof input === 'number' ? input : input.globalConfidence;

  if (conf < 0.30) {
    return {
      level: 0,
      label: 'Learning your style',
      badge: '🌱',
      stage: 'learning',
      explanation: 'We are learning your preferences as you save, remix, and wear outfits.',
    };
  }
  if (conf < 0.70) {
    return {
      level: 1,
      label: 'Getting to know your style',
      badge: '🌿',
      stage: 'developing',
      explanation: 'Your style profile is developing based on your recent outfits.',
    };
  }
  return {
    level: 2,
    label: 'Style profile established',
    badge: '✨',
    stage: 'established',
    explanation: 'Your style profile is established and personalizing your recommendations.',
  };
}

/**
 * Checks if a Style DNA dimension meets the grounded evidence threshold for user-facing claims.
 * Frozen requirements:
 *   dimension.effectiveSampleCount >= 5
 *   dimension.confidence >= 0.50
 *   affinityScore >= 0.70
 */
export function isDimensionGrounded(affinity?: StyleDimensionAffinity | null): boolean {
  if (!affinity) return false;
  const effectiveSamples = affinity.effectiveSampleCount ?? affinity.effectiveEvidence ?? 0;
  const confidence = affinity.confidence ?? 0;
  const score = affinity.affinityScore ?? affinity.score ?? 0;
  return effectiveSamples >= 5 && confidence >= 0.50 && score >= 0.70;
}

/**
 * Derives the server-authoritative signal weight for an event.
 */
export function deriveEventWeight(e: StylePreferenceEvent): number {
  if (e.signalWeight !== undefined) return e.signalWeight;
  switch (e.eventType) {
    case 'wear_outfit':
      return 1.00;
    case 'save_look':
      return 0.70;
    case 'remix_commit':
      return 0.50;
    case 'explicit_feedback': {
      const kind = e.payload?.feedback_kind;
      if (kind === 'love_look') return 0.80;
      if (kind === 'not_my_style' || kind === 'too_formal' || kind === 'too_casual') return -0.80;
      if (kind === 'dont_recommend_item') return 0.00;
      return 0.50;
    }
    case 'dont_recommend_item':
      return 0.00;
    default:
      return 0.00;
  }
}

/**
 * Local deterministic Style DNA aggregator matching the PostgreSQL aggregator exactly.
 */
export function aggregateStyleDnaLocally(
  userId: string,
  events: StylePreferenceEvent[],
  asOf: Date = new Date(),
  existingProfile?: StyleDnaProfile | null
): StyleDnaProfile {
  const asOfTime = asOf.getTime();

  // 1. Determine effective reset cutoff (never regresses)
  let effectiveResetAt = existingProfile?.learningResetAt ? new Date(existingProfile.learningResetAt).getTime() : 0;
  for (const e of events) {
    if (e.eventType === 'reset_learned_preferences') {
      const resetTime = new Date(e.clientTimestamp).getTime();
      if (resetTime > effectiveResetAt) effectiveResetAt = resetTime;
    }
  }

  // 2. Aggregate explicit settings (latest-wins semantics)
  const explicitPrefs: ExplicitPreferences = { ...(existingProfile?.explicitPreferences || {}) };
  const settingEvents = events
    .filter((e) => e.eventType === 'explicit_setting')
    .sort((a, b) => {
      const diff = new Date(b.clientTimestamp).getTime() - new Date(a.clientTimestamp).getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });

  const seenKeys = new Set<string>();
  for (const e of settingEvents) {
    const key = e.payload?.setting_key as string;
    const action = e.payload?.action as string;
    const val = e.payload?.setting_value;
    if (key && !seenKeys.has(key)) {
      seenKeys.add(key);
      if (action === 'clear') {
        delete (explicitPrefs as any)[key];
      } else if (action === 'set' || action === 'update') {
        if (val !== null && val !== undefined) {
          (explicitPrefs as any)[key] = val;
        }
      }
    }
  }

  // Deduplicate duplicate event IDs in input stream
  const uniqueEventsMap = new Map<string, StylePreferenceEvent>();
  for (const e of events) {
    if (!uniqueEventsMap.has(e.id)) {
      uniqueEventsMap.set(e.id, e);
    }
  }
  const uniqueEvents = Array.from(uniqueEventsMap.values());

  // 3. Deduplicate events sharing preferenceActionId (keep max signal weight)
  const actionGroupMap = new Map<string, StylePreferenceEvent>();
  const validLearnedEvents: {
    event: StylePreferenceEvent;
    decayFactor: number;
    weight: number;
  }[] = [];

  for (const e of uniqueEvents) {
    if (
      e.eventType !== 'save_look' &&
      e.eventType !== 'wear_outfit' &&
      e.eventType !== 'remix_commit' &&
      e.eventType !== 'explicit_feedback'
    ) {
      continue;
    }
    // Exclude item-level feedback from global evidence
    if (e.payload?.feedback_kind === 'dont_recommend_item') continue;

    const eventTime = new Date(e.clientTimestamp).getTime();
    if (effectiveResetAt > 0 && eventTime <= effectiveResetAt) continue;

    const groupKey = e.preferenceActionId ? `action_${e.preferenceActionId}` : `event_${e.id}`;
    const existing = actionGroupMap.get(groupKey);

    const weight = deriveEventWeight(e);
    if (!existing || deriveEventWeight(existing) < weight) {
      actionGroupMap.set(groupKey, e);
    }
  }

  for (const e of actionGroupMap.values()) {
    const eventTime = new Date(e.clientTimestamp).getTime();
    const deltaDays = Math.max(0, (asOfTime - eventTime) / 86400000);
    const decayFactor = Math.exp(-STYLE_DNA_LAMBDA * deltaDays);
    const weight = deriveEventWeight(e);
    validLearnedEvents.push({ event: e, decayFactor, weight });
  }

  // 4. Helper to aggregate dimension tokens
  const aggregateDimension = (tokenExtractor: (e: StylePreferenceEvent) => string[]) => {
    const map: Record<string, {
      rawCount: number;
      effectiveSamples: number;
      decaySum: number;
      weightedSum: number;
      lastSignalAt: string;
    }> = {};

    for (const item of validLearnedEvents) {
      const tokens = tokenExtractor(item.event);
      for (const tok of tokens) {
        if (!tok) continue;
        if (!map[tok]) {
          map[tok] = {
            rawCount: 0,
            effectiveSamples: 0,
            decaySum: 0,
            weightedSum: 0,
            lastSignalAt: item.event.clientTimestamp,
          };
        }
        map[tok].rawCount += 1;
        map[tok].effectiveSamples += Math.abs(item.weight) * item.decayFactor;
        map[tok].decaySum += item.decayFactor;
        map[tok].weightedSum += item.weight * item.decayFactor;
        if (new Date(item.event.clientTimestamp).getTime() > new Date(map[tok].lastSignalAt).getTime()) {
          map[tok].lastSignalAt = item.event.clientTimestamp;
        }
      }
    }

    const result: Record<string, StyleDimensionAffinity> = {};
    for (const [tok, data] of Object.entries(map)) {
      const rawScore = data.decaySum > 0
        ? ((data.weightedSum / data.decaySum) + 1.0) / 2.0
        : 0.50;
      const score = Math.round(Math.min(1.0, Math.max(0.0, rawScore)) * 1000) / 1000;
      const effectiveSampleCount = Math.round(data.effectiveSamples * 1000) / 1000;
      const confidence = Math.min(1.0, Math.round((effectiveSampleCount / 10.0) * 1000) / 1000);

      result[tok] = {
        score,
        affinityScore: Math.round((score - 0.50) * 20 * 100) / 100,
        rawSampleCount: data.rawCount,
        effectiveSampleCount,
        effectiveEvidence: effectiveSampleCount,
        confidence,
        lastSignalAt: data.lastSignalAt,
      };
    }
    return result;
  };

  const isFormalityFeedback = (e: StylePreferenceEvent) => {
    const kind = e.payload?.feedback_kind;
    return kind === 'too_formal' || kind === 'too_casual';
  };

  const paletteAffinities = aggregateDimension((e) => {
    if (isFormalityFeedback(e)) return [];
    return Array.isArray(e.payload?.palette) ? (e.payload.palette as string[]) : [];
  });
  const silhouetteAffinities = aggregateDimension((e) => {
    if (isFormalityFeedback(e)) return [];
    return Array.isArray(e.payload?.silhouettes) ? (e.payload.silhouettes as string[]) : [];
  });
  const formalityAffinities = aggregateDimension((e) => {
    return Array.isArray(e.payload?.formality) ? (e.payload.formality as string[]) : [];
  });
  const accessoryAffinities = aggregateDimension((e) => {
    if (isFormalityFeedback(e)) return [];
    return Array.isArray(e.payload?.accessories) ? (e.payload.accessories as string[]) : [];
  });

  // 5. Global confidence calculation
  let learnedEffectiveEvidence = 0;
  for (const item of validLearnedEvents) {
    learnedEffectiveEvidence += item.decayFactor;
  }
  const globalConfidence = Math.min(1.0, Math.round((learnedEffectiveEvidence / 15.0) * 1000) / 1000);

  // Total audit event count
  const totalEventCount = uniqueEvents.length;
  const lastEvent = uniqueEvents.length > 0
    ? uniqueEvents.reduce((latest, cur) => (new Date(cur.clientTimestamp).getTime() > new Date(latest.clientTimestamp).getTime() ? cur : latest))
    : null;

  return {
    userId,
    schemaVersion: 1,
    paletteAffinities,
    silhouetteAffinities,
    formalityAffinities,
    accessoryAffinities,
    explicitPreferences: explicitPrefs,
    globalConfidence,
    eventCount: totalEventCount,
    lastEventTimestamp: lastEvent ? lastEvent.clientTimestamp : null,
    learningResetAt: effectiveResetAt > 0 ? new Date(effectiveResetAt).toISOString() : null,
    projectionComputedAt: asOf.toISOString(),
  };
}

/**
 * Computes how well an outfit matches the user's personal style profile,
 * upholding the non-negotiable hierarchy:
 * Explicit Session Intent > Explicit Exclusions > Explicit Preferred > Structural Validity > Learned Style DNA.
 */
export function computePersonalAffinity(
  items: WardrobeItem[],
  profile?: UserStyleProfileDto | StyleDnaProfile | null,
  targetOccasion?: string | null,
  explicitIntent?: { rawPrompt?: string; selectedOccasion?: string | null; mustUseItemIds?: string[] }
): PersonalAffinityResult {
  const dna: StyleDnaProfile | undefined =
    (profile as UserStyleProfileDto)?.styleDna ||
    ((profile as any)?.paletteAffinities ? (profile as StyleDnaProfile) : undefined);

  const hasDnaEvidence = !!(dna && (dna.eventCount > 0 || (dna.globalConfidence ?? 0) > 0));
  const hasLegacyFeedback = ((profile as UserStyleProfileDto)?.feedbackCount ?? 0) > 0;
  const hasExplicitPrefs = !!(
    profile?.explicitPreferences &&
    Object.values(profile.explicitPreferences).some((v) => (Array.isArray(v) ? v.length > 0 : !!v))
  );

  if (!profile || (!hasDnaEvidence && !hasLegacyFeedback && !hasExplicitPrefs)) {
    return {
      score: 75,
      positiveSignals: ['Neutral profile baseline'],
      negativeSignals: [],
      recommendationNote: 'Classic baseline styling recommended.',
      learnedDnaDelta: 0,
    };
  }

  let affinityPoints = 70; // baseline
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  const explicit = profile.explicitPreferences || {};
  const avoidedColors = (explicit.avoidedColors || explicit.dislikedColors || (profile as any).avoidedColors || []) as string[];
  const preferredColors = (explicit.preferredColors || (profile as UserStyleProfileDto).preferredColors || []) as string[];
  const avoidedFits = (explicit.avoidedFits || explicit.dislikedFits || (profile as any).avoidedFits || []) as string[];
  const preferredFits = (explicit.preferredFits || (profile as UserStyleProfileDto).preferredFits || []) as string[];
  const avoidedPatterns = (explicit.avoidedPatterns || explicit.dislikedPatterns || (profile as UserStyleProfileDto).avoidedPatterns || []) as string[];

  // 1. Explicit Exclusions (Hard Constraints) & Preferred (Deterministic Boosts)
  for (const item of items) {
    const isItemExplicitlyPinned = explicitIntent?.mustUseItemIds?.includes(item.id);
    const itemColors: string[] = Array.isArray(item.color_tags) ? item.color_tags : [];
    for (const c of itemColors) {
      const isColorExplicitlyRequested = isItemExplicitlyPinned ||
        (explicitIntent?.rawPrompt && explicitIntent.rawPrompt.toLowerCase().includes(c.toLowerCase()));
      if (avoidedColors.includes(c)) {
        if (!isColorExplicitlyRequested) {
          affinityPoints -= EXPLICIT_DISLIKED_COLOR_PENALTY;
          negativeSignals.push(`Matches explicit color dislike: ${c}`);
        }
      }
      if (preferredColors.includes(c)) {
        affinityPoints += EXPLICIT_PREFERRED_COLOR_BOOST;
        positiveSignals.push(`Features preferred color: ${c}`);
      }
    }

    // Garment types & fits
    if (item.garment_type && (profile as UserStyleProfileDto).preferredGarmentTypes?.includes(item.garment_type)) {
      affinityPoints += 3;
    }
    const fit = (item as any).fit || (item as any).ai_attributes?.fit;
    if (fit) {
      const isFitExplicitlyRequested = isItemExplicitlyPinned ||
        (explicitIntent?.rawPrompt && explicitIntent.rawPrompt.toLowerCase().includes(fit.toLowerCase()));
      if (avoidedFits.includes(fit)) {
        if (!isFitExplicitlyRequested) {
          affinityPoints -= EXPLICIT_DISLIKED_FIT_PENALTY;
          negativeSignals.push(`Features avoided fit: ${fit}`);
        }
      }
      if (preferredFits.includes(fit)) {
        affinityPoints += EXPLICIT_PREFERRED_FIT_BOOST;
        positiveSignals.push(`Features preferred fit: ${fit}`);
      }
    }

    const pat = (item as any).pattern || (item as any).ai_attributes?.pattern;
    if (pat && avoidedPatterns.includes(pat)) {
      affinityPoints -= EXPLICIT_DISLIKED_PATTERN_PENALTY;
      negativeSignals.push(`Features pattern to avoid: ${pat}`);
    }

    const sub = (item.sub_category || '').toLowerCase();
    if ((profile as UserStyleProfileDto).styleKeywords?.some((kw) => kw && sub.includes(kw.toLowerCase()))) {
      affinityPoints += 5;
      positiveSignals.push(`Matches personal style favorite: ${item.sub_category}`);
    }
  }

  // 2. Occasion match
  if (targetOccasion && (profile as UserStyleProfileDto).preferredOccasions?.includes(targetOccasion)) {
    affinityPoints += 8;
    positiveSignals.push(`Tailored for your preferred occasion: ${targetOccasion}`);
  }

  // 3. Learned Style DNA Integration (Bounded to +/- 15 points)
  let learnedDelta = 0;
  if (dna) {
    let sumDnaPoints = 0;
    let countedDimensions = 0;

    for (const item of items) {
      // Check palettes against DNA
      const colors = item.color_tags || [];
      for (const c of colors) {
        if (c && dna.paletteAffinities?.[c]) {
          const aff = dna.paletteAffinities[c];
          if (aff.confidence >= 0.20) {
            sumDnaPoints += (aff.score - 0.50) * 30;
            countedDimensions++;
            if (aff.score >= 0.70 && isDimensionGrounded(aff)) {
              positiveSignals.push(`Features your favorite palette: ${c}`);
            }
          }
        }
      }

      // Check silhouettes against DNA
      const sil = (item as any).ai_attributes?.silhouette || (item as any).ai_attributes?.fit || (item as any).silhouette;
      if (sil && dna.silhouetteAffinities?.[sil]) {
        const aff = dna.silhouetteAffinities[sil];
        if (aff.confidence >= 0.20) {
          sumDnaPoints += (aff.score - 0.50) * 30;
          countedDimensions++;
          if (aff.score >= 0.70 && isDimensionGrounded(aff)) {
            positiveSignals.push(`Aligns with your signature silhouette: ${sil}`);
          }
        }
      }
    }

    if (countedDimensions > 0) {
      const rawDelta = sumDnaPoints / countedDimensions;
      learnedDelta = Math.max(-LEARNED_STYLE_MAX_DELTA, Math.min(LEARNED_STYLE_MAX_DELTA, Math.round(rawDelta)));
    }
  }

  // 4. Intent Supremacy: Explicit session prompt overrides conflicting learned DNA
  if (explicitIntent?.rawPrompt && learnedDelta < 0) {
    // If prompt explicitly asked for something that Style DNA dislikes, suppress negative penalty
    learnedDelta = 0;
  }

  affinityPoints += learnedDelta;

  const finalScore = Math.max(10, Math.min(100, Math.round(affinityPoints)));

  let note = 'Well balanced for your wardrobe habits.';
  if (finalScore >= 85) {
    note = 'Strong match with your saved style preferences.';
  } else if (finalScore <= 55) {
    note = 'Experimental combination outside your usual favorites.';
  }

  return {
    score: finalScore,
    positiveSignals: Array.from(new Set(positiveSignals)).slice(0, 3),
    negativeSignals: Array.from(new Set(negativeSignals)).slice(0, 3),
    recommendationNote: note,
    learnedDnaDelta: learnedDelta,
  };
}

/**
 * Updates a user's legacy style profile weights and affinity lists based on a feedback event.
 * Pass / Exposure actions are strictly excluded from producing negative preferences.
 */
export function updateProfileFromFeedback(
  profile: UserStyleProfileDto,
  feedbackType: OutfitFeedbackType,
  items: WardrobeItem[],
  occasion?: string | null
): UserStyleProfileDto {
  // Pass produces ZERO Style DNA / preference updates
  if (feedbackType === 'passed') {
    return profile;
  }

  const updated: UserStyleProfileDto = {
    ...profile,
    preferredColors: [...profile.preferredColors],
    avoidedColors: [...profile.avoidedColors],
    preferredOccasions: [...profile.preferredOccasions],
    feedbackCount: profile.feedbackCount + 1,
    updatedAt: new Date().toISOString(),
  };

  const isPositive = feedbackType === 'liked' || feedbackType === 'saved' || feedbackType === 'worn';
  const isNegative = feedbackType === 'rejected' || feedbackType === 'disliked';

  for (const item of items) {
    const colors: string[] = Array.isArray(item.color_tags) ? item.color_tags : [];
    for (const c of colors) {
      if (isPositive) {
        if (!updated.preferredColors.includes(c)) {
          updated.preferredColors.push(c);
        }
        updated.avoidedColors = updated.avoidedColors.filter((col) => col !== c);
      } else if (isNegative) {
        if (updated.feedbackCount >= 3 && !updated.avoidedColors.includes(c) && !updated.preferredColors.includes(c)) {
          updated.avoidedColors.push(c);
        }
      }
    }

    if (isPositive) {
      if (item.garment_type && !updated.preferredGarmentTypes.includes(item.garment_type)) {
        updated.preferredGarmentTypes.push(item.garment_type);
      }
      const fit = (item as any).fit || (item as any).ai_attributes?.fit;
      if (fit && !updated.preferredFits.includes(fit)) {
        updated.preferredFits.push(fit);
      }
      const sub = (item.sub_category || '').toLowerCase();
      if (sub.includes('sneaker') && !updated.styleKeywords.includes('Sneakers')) {
        updated.styleKeywords.push('Sneakers');
      }
      if ((fit || '').toLowerCase().includes('oversized') && !updated.styleKeywords.includes('Oversized')) {
        updated.styleKeywords.push('Oversized');
      }
    }
  }

  if (occasion && isPositive && !updated.preferredOccasions.includes(occasion)) {
    updated.preferredOccasions.push(occasion);
  }

  return updated;
}
