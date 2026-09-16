export interface PreferenceWeights {
  colorHarmony: number;
  composition: number;
  personalStyle: number;
  occasionFit?: number;
  neglectBonus?: number;
}

export interface ExplicitPreferences {
  dislikedGarmentTypes?: string[];
  dislikedFits?: string[];
  dislikedPatterns?: string[];
  dislikedColors?: string[];
  preferredSilhouettes?: string[];
  maxDailyFormality?: string;
  [key: string]: unknown;
}

export interface UserStyleProfileDto {
  userId: string;
  preferredGarmentTypes: string[];
  preferredFits: string[];
  preferredOccasions: string[];
  avoidedPatterns: string[];
  avoidedColors: string[];
  preferredColors: string[];
  styleKeywords: string[];
  explicitPreferences: ExplicitPreferences;
  preferenceWeights: PreferenceWeights;
  feedbackCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export type OutfitFeedbackType = 'saved' | 'rejected' | 'liked' | 'disliked' | 'worn' | 'rated';

export interface OutfitFeedbackInput {
  userId: string;
  outfitId?: string | null;
  feedbackType: OutfitFeedbackType;
  rating?: number | null;
  occasion?: string | null;
  wardrobeItemIds?: string[];
  context?: Record<string, unknown>;
}
