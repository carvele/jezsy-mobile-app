export type StylistAnalysisMode = 'hybridLLM' | 'ruleBasedFallback' | 'ruleBasedEvidence';

/** Structured visual evidence produced by garmentVisualCache for a single wardrobe item. */
export interface VisualItemEvidence {
  /** Never overwrites user Category — supporting evidence only */
  visualGarmentFamily: string;
  /** 0 = casual, 1 = fully formal */
  formalitySignal: number;
  athleticSignal: boolean;
  swimwearSignal: boolean;
  /** Pattern detected from image pixels, null if uncertain */
  visualPattern: string | null;
  dominantColors: { name: string; hex: string; role: 'dominant' | 'secondary' | 'accent'; confidence: number }[];
  isRealMl: boolean;
  modelName: string;
  confidence: number;
  lowConfidence: boolean;
}

export interface StylistEvidencePacketItem {
  wardrobeItemId: string;
  category: string;
  subCategory: string;
  effectiveGarmentBucket?: string;
  garmentType?: string;
  garmentFamily?: string;
  garmentSubtype?: string;
  description?: string;
  userNotes?: string;
  whereWorn?: string;
  rawColor?: string;
  colorTags?: string[];
  material?: string;
  fit?: string;
  thermalLevel?: string;
  coverageLevel?: string;
  functionalRole?: string;
  personalUsage?: {
    activities?: string[];
    rawText?: string;
  };
  styleSignals?: Record<string, boolean>;
  /** Visual evidence for this item — absent when image analysis unavailable */
  visualEvidence?: VisualItemEvidence;
}

export interface StylistEvidencePacket {
  request: {
    analysisId: string;
    rawContext: string;
    structuredContext: {
      rawOccasion: string;
      rawAdditionalContext: string;
      activity?: string;
      occasionType?: string;
      timeOfDay?: string;
      weather?: string;
      temperatureRequirement?: string;
      socialContext?: string;
      environment?: 'indoor' | 'outdoor' | 'unknown';
      isIndoorOverride?: boolean;
    };
    generatedAt: string;
  };
  outfit: {
    items: StylistEvidencePacketItem[];
  };
  structure: {
    completeness: string;
    hasTop: boolean;
    hasBottom: boolean;
    hasOnePiece: boolean;
    hasOuterwear: boolean;
    hasShoes: boolean;
    isOvercrowded: boolean;
    structuralNotes?: string;
  };
  requirements: {
    formalityLevel: string;
    requiresThermalCoverage: boolean;
    requiresWaterCompatibility: boolean;
    requiresActivewear: boolean;
    allowsAthleticPieces: boolean;
  };
  contradictions: {
    dimension: string;
    severity: 'severe' | 'major' | 'moderate' | 'minor';
    message: string;
    garmentId?: string;
  }[];
  personalization: {
    garmentId: string;
    description?: string;
    activities?: string[];
  }[];
  visualEvidence?: {
    paletteColors: string[];
    dominantColors?: { name: string; hex: string }[];
    /** Per-item visual evidence, keyed by wardrobeItemId */
    itemEvidence?: Record<string, VisualItemEvidence>;
    colorHarmonyNote?: string;
    overallFormalitySignal?: number;
    visualAnalysisMode?: 'realMl' | 'fallback' | 'unavailable';
  };
}

export interface StructuredAIResponse {
  assessment: 'Appropriate for this occasion' | 'Could work with changes' | 'Not appropriate for this occasion' | 'Incomplete outfit';
  headline: string;
  contextFit?: {
    occasion?: string;
    activity?: string;
    weather?: string;
    thermal?: string;
    social?: string;
    practicality?: string;
  };
  whyJezsySaysThis: string;
  whatWorks?: string[];
  whatConflicts?: string[];
  personalization?: string;
  stylistTake: string;
  improvements?: {
    reason: string;
    existingWardrobeItemIds: string[];
  }[];
  missing?: string[];
}

export interface AIAnalysisResult {
  success: boolean;
  data?: StructuredAIResponse;
  provider?: string;
  model?: string;
  analysisMode: StylistAnalysisMode;
  fallbackReason?: string;
}
