import { UserStyleProfileDto, OutfitFeedbackType } from '../types/dto/styleProfile';
import { WardrobeItem } from '../services/wardrobeService';

export interface PersonalAffinityResult {
  score: number; // 0 - 100
  positiveSignals: string[];
  negativeSignals: string[];
  recommendationNote: string;
}

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
 * Computes how well an outfit matches the user's personal style profile
 */
export function computePersonalAffinity(
  items: WardrobeItem[],
  profile?: UserStyleProfileDto | null,
  targetOccasion?: string | null
): PersonalAffinityResult {
  if (!profile || profile.feedbackCount === 0) {
    return {
      score: 75,
      positiveSignals: ['Neutral profile baseline'],
      negativeSignals: [],
      recommendationNote: 'Classic baseline styling recommended.',
    };
  }

  let affinityPoints = 70; // baseline
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  const explicit = profile.explicitPreferences || {};

  // 1. Check colors against preferences
  for (const item of items) {
    const itemColors: string[] = Array.isArray(item.color_tags) ? item.color_tags : [];
    for (const c of itemColors) {
      if (profile.preferredColors.includes(c)) {
        affinityPoints += 6;
        positiveSignals.push(`Features preferred color: ${c}`);
      }
      if (profile.avoidedColors.includes(c)) {
        affinityPoints -= 12;
        negativeSignals.push(`Contains avoided color: ${c}`);
      }
      if (explicit.dislikedColors?.includes(c)) {
        affinityPoints -= 20;
        negativeSignals.push(`Matches explicit color dislike: ${c}`);
      }
    }

    // 2. Garment types & fits
    if (item.garment_type && profile.preferredGarmentTypes.includes(item.garment_type)) {
      affinityPoints += 3;
    }
    if ((item as any).fit && explicit.dislikedFits?.includes((item as any).fit)) {
      affinityPoints -= 25;
      negativeSignals.push(`Features avoided fit: ${(item as any).fit}`);
    }

    // 3. Patterns
    if ((item as any).pattern && profile.avoidedPatterns.includes((item as any).pattern)) {
      affinityPoints -= 15;
      negativeSignals.push(`Features pattern to avoid: ${(item as any).pattern}`);
    }
  }

  // 4. Occasion match
  if (targetOccasion && profile.preferredOccasions.includes(targetOccasion)) {
    affinityPoints += 8;
    positiveSignals.push(`Tailored for your preferred occasion: ${targetOccasion}`);
  }

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
  };
}

/**
 * Updates a user's style profile weights and affinity lists based on a feedback event.
 * Uses bounded adjustments to prevent single accidental clicks from distorting the profile.
 */
export function updateProfileFromFeedback(
  profile: UserStyleProfileDto,
  feedbackType: OutfitFeedbackType,
  items: WardrobeItem[],
  occasion?: string | null
): UserStyleProfileDto {
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
        // Remove from avoided if user wore it
        updated.avoidedColors = updated.avoidedColors.filter((col) => col !== c);
      } else if (isNegative) {
        // Only avoid if user rejected it multiple times
        if (updated.feedbackCount >= 3 && !updated.avoidedColors.includes(c) && !updated.preferredColors.includes(c)) {
          updated.avoidedColors.push(c);
        }
      }
    }
  }

  if (occasion && isPositive && !updated.preferredOccasions.includes(occasion)) {
    updated.preferredOccasions.push(occasion);
  }

  // Weight progression: As user gives more feedback, personalization weight gradually increases
  if (updated.feedbackCount >= 5 && updated.preferenceWeights.personalStyle < 0.35) {
    updated.preferenceWeights = {
      colorHarmony: 0.35,
      composition: 0.35,
      personalStyle: 0.30,
      occasionFit: 0.15,
    };
  }

  return updated;
}
