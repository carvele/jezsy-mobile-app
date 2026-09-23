export interface PreferenceWeights {
  colorHarmony: number;
  composition: number;
  personalStyle: number;
  occasionFit?: number;
  neglectBonus?: number;
}

export type ExplicitSettingKey = 
  | 'avoidedColors' 
  | 'avoidedPatterns' 
  | 'avoidedFits' 
  | 'preferredColors' 
  | 'preferredFits' 
  | 'preferredSilhouettes' 
  | 'maxDailyFormality';

export interface ExplicitPreferences {
  dislikedGarmentTypes?: string[];
  dislikedFits?: string[];
  dislikedPatterns?: string[];
  dislikedColors?: string[];
  avoidedColors?: string[];
  avoidedPatterns?: string[];
  avoidedFits?: string[];
  preferredColors?: string[];
  preferredFits?: string[];
  preferredSilhouettes?: string[];
  maxDailyFormality?: string;
  [key: string]: unknown;
}

export interface StyleDimensionAffinity {
  score: number; // 0.0 - 1.0 (baseline 0.50)
  rawSampleCount: number;
  effectiveSampleCount: number;
  confidence: number; // 0.0 - 1.0
  lastSignalAt: string;
  affinityScore?: number;
  effectiveEvidence?: number;
}

export interface StyleDnaProfile {
  userId: string;
  schemaVersion: number;
  paletteAffinities: Record<string, StyleDimensionAffinity>;
  silhouetteAffinities: Record<string, StyleDimensionAffinity>;
  formalityAffinities: Record<string, StyleDimensionAffinity>;
  accessoryAffinities: Record<string, StyleDimensionAffinity>;
  explicitPreferences: ExplicitPreferences;
  globalConfidence: number; // 0.0 - 1.0
  eventCount: number;
  lastEventTimestamp: string | null;
  learningResetAt: string | null;
  projectionComputedAt: string;
  createdAt?: string;
  updatedAt?: string;
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
  styleDna?: StyleDnaProfile;
  createdAt?: string;
  updatedAt?: string;
}

export type StylePreferenceEventType =
  | 'save_look'
  | 'wear_outfit'
  | 'remix_commit'
  | 'explicit_feedback'
  | 'explicit_setting'
  | 'reset_learned_preferences'
  | 'dont_recommend_item';

export type ExplicitFeedbackKind =
  | 'love_look'
  | 'not_my_style'
  | 'too_formal'
  | 'too_casual'
  | 'dont_recommend_item';

export type ExplicitSettingAction = 'set' | 'update' | 'clear';

export interface StylePreferenceEvent {
  id: string;
  userId: string;
  eventSchemaVersion: number;
  eventType: StylePreferenceEventType;
  preferenceActionId?: string | null;
  signalWeight?: number;
  payload: Record<string, unknown>;
  clientTimestamp: string;
  createdAt?: string;
}

export interface SyncStyleDnaResponse {
  synced_count?: number;
  duplicate_count?: number;
  rejected_count?: number;
  acknowledged_event_ids?: string[];
  rejected_events?: { id: string; reason: string }[];
  profile?: any;
  syncedCount?: number;
  duplicateCount?: number;
  rejectedCount?: number;
  acknowledgedEventIds?: string[];
  rejectedEvents?: { id: string; reason: string }[];
  accepted_ids?: string[];
  duplicate_ids?: string[];
  rejected_ids?: { id: string; reason: string }[];
  server_time?: string;
  schema_version?: number;
}

export type OutfitFeedbackType = 'saved' | 'rejected' | 'liked' | 'disliked' | 'worn' | 'rated' | 'passed';

export interface OutfitFeedbackInput {
  userId: string;
  outfitId?: string | null;
  feedbackType: OutfitFeedbackType;
  rating?: number | null;
  occasion?: string | null;
  wardrobeItemIds?: string[];
  context?: Record<string, unknown>;
}
