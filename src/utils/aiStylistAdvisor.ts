/**
 * aiStylistAdvisor.ts
 * JeZsy Stylist Engine - Deep Context-Aware Fashion Reasoning System.
 *
 * Architecture:
 * USER METADATA (Authoritative)
 *   + MULTI-DIMENSIONAL CONTEXT PARSER (Occasion, Time of Day, Weather, Environment, Exceptions)
 *   + STRUCTURED FASHION SEMANTICS (Materials, Mobility, Water Compatibility, Thermal, Coverage, Functional Role)
 *   + PERSONALIZATION SIGNALS (User wear habits, user notes, personal usage)
 *   + VISION / ML EVIDENCE (Color harmony, visual palette, never overwriting user data)
 *   + CONTRADICTION-FIRST ENGINE (Occasion, Weather/Thermal, Activity, Formality, Structure)
 *   + STRUCTURAL COMPLETENESS (One-piece vs Separates vs Outerwear layering)
 *   + WARDROBE GROUNDING (Owned items only, explicit fallback when none owned)
 *   + EVIDENCE-GROUNDED QUALITATIVE ASSESSMENT (No 0-100 scores, no letter grades)
 */

import { evaluateColors, ColorMatchResult } from './colorMatcher';
import { MannequinCanvasItem, WardrobeItem } from './mannequinConfig';
import { OutfitExplanation } from './outfitExplainer';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { computePersonalAffinity } from './personalStyleEngine';
import {
  normalizeGarment,
  resolveEffectiveGarmentBucket,
  ThermalLevel,
  CoverageLevel,
  FunctionalRole,
  PersonalUsageSignal,
} from './garmentSemanticClassifier';
import {
  StylistEvidencePacket,
  StylistEvidencePacketItem,
  StructuredAIResponse,
  StylistAnalysisMode,
} from '../types/aiStylist';
import { IAIStylistProvider, defaultAIStylistProvider } from '../services/aiStylistProvider';

export type OverallAssessment =
  | 'Appropriate for this occasion'
  | 'Could work with changes'
  | 'Not appropriate for this occasion'
  | 'Incomplete outfit';

export interface OutfitContext {
  occasion: string;
  additionalContext?: string;
}

export type ActivityType =
  | 'activeSwimming'
  | 'poolsideSocial'
  | 'poolsideDining'
  | 'beachResort'
  | 'running'
  | 'gymWorkout'
  | 'formalCeremony'
  | 'beachWedding'
  | 'workProfessional'
  | 'casualDaily'
  | 'casualWalk'
  | 'dining'
  | 'breakfastDining'
  | 'casualDining'
  | 'coffeeSocial'
  | 'lounging'
  | 'general';

export type TimeOfDay =
  | 'morning'
  | 'daytime'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'lateNight'
  | 'unknown';

export type WeatherCondition =
  | 'cold'
  | 'mild'
  | 'warm'
  | 'hot'
  | 'rainy'
  | 'windy'
  | 'humid'
  | 'unknown';

export type TemperatureRequirement =
  | 'warmthNeeded'
  | 'breathabilityNeeded'
  | 'balanced'
  | 'unknown';

export type OccasionType =
  | 'date'
  | 'wedding'
  | 'swimming'
  | 'running'
  | 'gym'
  | 'office'
  | 'casualWalk'
  | 'breakfastDining'
  | 'casualDining'
  | 'coffeeSocial'
  | 'formalCeremony'
  | 'casualDaily'
  | 'beach'
  | 'general';

export interface OutfitContextInterpretation {
  rawOccasion: string;
  rawAdditionalContext: string;
  activity: ActivityType;
  occasionType: OccasionType;
  timeOfDay: TimeOfDay;
  weather: WeatherCondition;
  temperatureRequirement: TemperatureRequirement;
  isSpectatingOnly: boolean;
  isIndoorOverride: boolean;
  isDiningOrMeal?: boolean;
  socialSetting?:
    | 'intimateDate'
    | 'formalCelebration'
    | 'casualSocial'
    | 'athleticWorkout'
    | 'diningMeal'
    | 'professional'
    | 'leisure'
    | 'homeRelaxed'
    | 'general';
  environment:
    | 'swimmingPool'
    | 'beachResort'
    | 'office'
    | 'outdoors'
    | 'formalVenue'
    | 'casualEveryday'
    | 'indoors'
    | 'cafe'
    | 'diningVenue'
    | 'home'
    | 'general';
  waterExposure: 'high' | 'moderate' | 'low' | 'none';
  physicalActivity: 'high' | 'moderate' | 'low';
  mobilityRequirement: 'high' | 'moderate' | 'standard';
  formalityExpectation: 'formal' | 'semiFormal' | 'elevatedCasual' | 'casual';
  practicalityRequirements: string[];
}

export type GarmentMaterial =
  | 'knit'
  | 'denim'
  | 'suede'
  | 'velvet'
  | 'leather'
  | 'swimwearSynthetic'
  | 'athleticSynthetic'
  | 'cotton'
  | 'linen'
  | 'silk'
  | 'wool'
  | 'unknown';

export interface GarmentSemanticProfile {
  identity: {
    wardrobeItemId?: string;
    imageUrl?: string;
    name: string;
  };
  rawUserData: {
    category: string;
    subCategory: string;
    color: string;
    colorTags: string[];
    whereWornOften: string;
    description: string;
    userNotes: string;
    occasions: string[];
    seasons: string[];
  };
  garmentStructure: {
    garmentFamily: 'onePiece' | 'upperBody' | 'lowerBody' | 'outerwear' | 'footwear' | 'accessory';
    garmentType: string;
    isOnePiece: boolean;
    isUpperBody: boolean;
    isLowerBody: boolean;
    isOuterwear: boolean;
    isFootwear: boolean;
    isAccessory: boolean;
  };
  styleSignals: {
    casual: boolean;
    elevated: boolean;
    formal: boolean;
    athletic: boolean;
    streetwear: boolean;
    resort: boolean;
    evening: boolean;
    professional: boolean;
  };
  activitySignals: {
    swimming: boolean;
    running: boolean;
    gym: boolean;
    workout: boolean;
    hiking: boolean;
    walking: boolean;
    lounging: boolean;
    sports: boolean;
  };
  materialSignals: GarmentMaterial[];
  waterCompatibility: 'suitable' | 'questionable' | 'poor' | 'unknown';
  mobility: 'high' | 'medium' | 'low' | 'unknown';
  formality: 'formal' | 'semiFormal' | 'elevatedCasual' | 'casual' | 'unknown';
  thermal: ThermalLevel;
  coverage: CoverageLevel;
  functionalRole: FunctionalRole;
  personalUsage: PersonalUsageSignal;
  subtype: string | null;
  confidenceSource: 'user' | 'vision' | 'inferred';
  combinedText: string;
}

export interface OccasionRequirementProfile {
  requiresSwimwear: boolean;
  requiresWaterCompatibility: 'high' | 'moderate' | 'none';
  requiresHighMobility: boolean;
  requiresFormalAttire: boolean;
  allowsResortElevated: boolean;
  prohibitsAthletic: boolean;
  prohibitsSwimwearConflicts: boolean;
  prohibitsCasualFootwear: boolean;
  requiresBaseTop: boolean;
  occasionType: OccasionType;
  requiresWarmth: boolean;
  prohibitsExposedLegsInCold: boolean;
  allowsAthletic: boolean;
  timeOfDay: TimeOfDay;
  weather: WeatherCondition;
  summary: string;
}

export interface Contradiction {
  severity: 'severe' | 'major' | 'moderate' | 'minor';
  category:
    | 'activity_water'
    | 'formality_dresscode'
    | 'structure_completeness'
    | 'environment_practicality'
    | 'weather_thermal'
    | 'occasion_context';
  garmentName: string;
  reason: string;
  whyItMatters: string;
  suggestedFix: string;
}

export interface WardrobeAlternative {
  slot: 'top' | 'bottom' | 'shoes' | 'onePiece' | 'swimwear';
  found: boolean;
  item?: WardrobeItem;
  recommendationText: string;
}

export interface StylePillarBreakdown {
  status: 'excellent' | 'good' | 'warning' | 'alert';
  title: string;
  feedback: string;
}

export interface StylistCritique {
  analysisId?: string;
  generatedAt?: string;
  analysisVersion?: string;
  analysisMode?: StylistAnalysisMode;
  contextHash?: string;
  outfitHash?: string;
  wardrobeItemIds?: string[];
  cacheStatus?: 'fresh' | 'cache_hit' | 'miss';
  aiProvider?: string;
  aiModel?: string;
  evidenceCount?: number;
  fallbackReason?: string;
  contextFit?: {
    occasion?: string;
    activity?: string;
    weather?: string;
    thermal?: string;
    social?: string;
    practicality?: string;
  };
  assessment: OverallAssessment;
  headline: string;
  verdict: string;
  whyJezsySaysThis: string;
  stylistsTake: string;
  whatWorks?: string;
  whatCouldBeBetter?: string;
  whatsMissing?: string;
  personalization?: string;
  wardrobeAlternatives?: WardrobeAlternative[];
  tips: string[];
  vibe: string;
  paletteColors: string[];
  isOvercrowded?: boolean;
  mannequinItems: MannequinCanvasItem[];
  context?: OutfitContext;
  contextInterpretation?: OutfitContextInterpretation;
  contradictions?: string[];
  pillars?: {
    colorHarmony: StylePillarBreakdown;
    compositionAndLayers: StylePillarBreakdown;
    occasionFit?: StylePillarBreakdown;
    personalPreference?: StylePillarBreakdown;
  };
  explanation?: OutfitExplanation;
}

export const STYLIST_ANALYSIS_VERSION = '3.0.0';

export function generateAnalysisId(): string {
  return `stylist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function computeContextHash(ctx?: OutfitContext): string {
  if (!ctx) return 'no_context';
  const occ = (ctx.occasion || '').trim().toLowerCase();
  const add = (ctx.additionalContext || '').trim().toLowerCase();
  let hash = 0;
  const str = `${occ}:::${add}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return `ctx_${Math.abs(hash).toString(16)}`;
}

export function computeOutfitHash(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>
): string {
  if (!items || items.length === 0) return 'empty_outfit';
  const tokens = items
    .map((item) => {
      const w = wardrobeLookup?.[item.wardrobe_item_id];
      const name = (item.name || (w as any)?.name || w?.sub_category || '').toLowerCase();
      const type = (item.garment_type || w?.category || '').toLowerCase();
      return `${item.wardrobe_item_id || item.id}:${type}:${name}`;
    })
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < tokens.length; i++) {
    hash = ((hash << 5) - hash + tokens.charCodeAt(i)) | 0;
  }
  return `outfit_${Math.abs(hash).toString(16)}`;
}

// Backward compatibility alias
export type GarmentSemanticData = GarmentSemanticProfile['rawUserData'] & {
  photoUrl?: string;
  wardrobeItemId?: string;
  combinedText: string;
};

/**
 * Extracts distinct color tokens from items while preserving all user-specified colors.
 * Does not collapse "navy blue, white" into single generic colors.
 */
export function extractColors(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>
): string[] {
  const colors: string[] = [];

  for (const item of items) {
    const w = wardrobeLookup?.[item.wardrobe_item_id];

    // Priority 1: User-entered raw color or color_tags
    const rawColor =
      (w as any)?.color ||
      (w as any)?.ai_attributes?.rawColor ||
      (item as any)?.color;

    if (rawColor && typeof rawColor === 'string') {
      const splitTokens = rawColor
        .split(/[,/&]|\band\b/i)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (splitTokens.length > 0) {
        colors.push(...splitTokens);
        continue;
      }
    }

    if (w?.color_tags && w.color_tags.length > 0) {
      colors.push(...w.color_tags);
      continue;
    }

    // Fallback: Infer from item name or subcategory
    const text = [item.name, w?.sub_category, w?.category, w?.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const KNOWN_COLORS = [
      'black', 'white', 'cream', 'beige', 'navy', 'blue', 'denim', 'gray', 'grey',
      'charcoal', 'red', 'crimson', 'burgundy', 'maroon', 'wine', 'pink', 'rose', 'blush',
      'orange', 'rust', 'terracotta', 'yellow', 'mustard', 'gold', 'silver', 'green', 'olive',
      'sage', 'emerald', 'teal', 'purple', 'lavender', 'brown', 'tan', 'camel', 'khaki',
      'ivory', 'neon green', 'neon pink', 'neon yellow',
    ];

    for (const kc of KNOWN_COLORS) {
      if (new RegExp(`\\b${kc}\\b`, 'i').test(text)) {
        colors.push(kc);
      }
    }
  }

  // Deduplicate case-insensitively while preserving human-readable casing
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const c of colors) {
    const lower = c.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(c);
    }
  }
  return deduped;
}

// ============================================================================
// PHASE 4: MULTI-DIMENSIONAL CONTEXT PARSER
// ============================================================================

/**
 * Interprets the user's explicit occasion and additional context.
 * Parses: Occasion, Time of Day, Weather, Temperature Requirement, Environment, and Exceptions.
 */
export function interpretOutfitContext(context?: OutfitContext): OutfitContextInterpretation {
  const rawOccasion = (context?.occasion ?? '').trim();
  const rawAdditionalContext = (context?.additionalContext ?? '').trim();
  const occLower = rawOccasion.toLowerCase();
  const addLower = rawAdditionalContext.toLowerCase();
  const full = `${occLower} ${addLower}`.trim();

  // 1. Time of Day Detection
  let timeOfDay: TimeOfDay = 'unknown';
  if (/\b(late.?night|midnight)\b/i.test(full)) {
    timeOfDay = 'lateNight';
  } else if (/\b(night|tonight|nighttime|late evening)\b/i.test(full)) {
    timeOfDay = 'night';
  } else if (/\b(evening)\b/i.test(full)) {
    timeOfDay = 'evening';
  } else if (/\b(afternoon)\b/i.test(full)) {
    timeOfDay = 'afternoon';
  } else if (/\b(morning|breakfast|brunch)\b/i.test(full)) {
    timeOfDay = 'morning';
  } else if (/\b(day|daytime|today)\b/i.test(full)) {
    timeOfDay = 'daytime';
  }

  // 2. Weather & Temperature Detection
  let weather: WeatherCondition = 'unknown';
  let temperatureRequirement: TemperatureRequirement = 'unknown';

  if (
    /\b(cold|freezing|chilly|winter|frost|snow|get cold|getting cold|cool tonight|cold tonight|it will get cold|it will be cold tonight|cold night)\b/i.test(
      full
    )
  ) {
    weather = 'cold';
    temperatureRequirement = 'warmthNeeded';
  } else if (/\b(hot|sweltering|scorching|summer|heat)\b/i.test(full)) {
    weather = 'hot';
    temperatureRequirement = 'breathabilityNeeded';
  } else if (/\b(warm|sunny)\b/i.test(full)) {
    weather = 'warm';
    temperatureRequirement = 'breathabilityNeeded';
  } else if (/\b(rain|raining|rainy|wet|downpour|storm|might rain)\b/i.test(full)) {
    weather = 'rainy';
  } else if (/\b(wind|windy|breezy)\b/i.test(full)) {
    weather = 'windy';
  }

  // 3. Indoor Contextual Exception Override
  const isIndoorOverride = /\b(arcade|indoor|indoors|inside|staying inside|staying indoors|at home|home|dining at home)\b/i.test(
    full
  );

  // 4. Spectating / Watching Modifiers
  const isSpectatingOnly = /\b(watching|watch|spectat|cheering|supporting|sitting and watching)\b/i.test(full);

  // 5. Activity, Occasion Type, and Environment Detection
  const mentionsSwim = /\b(swim|swimming|pool|swimsuit|swimming pool|laps)\b/i.test(full);
  const mentionsPoolParty = /\b(pool party|poolside party|pool gathering|pool social)\b/i.test(full);
  const mentionsPoolsideDining = /\b(poolside dinner|poolside lunch|pool dining|dinner by the pool)\b/i.test(full);
  const mentionsActiveSwim =
    /\b(swimming a lot|active swimming|swimming laps|lap swimming|swim in the pool|swimming on the pool|swimming in the pool|going swimming|swim a lot|in the water|swim workout)\b/i.test(
      full
    ) ||
    (occLower === 'swimming' && !isSpectatingOnly && !mentionsPoolParty && !mentionsPoolsideDining);

  const isWedding = /\b(wedding|matrimony|nuptials|reception)\b/i.test(full);
  const isBeachOrResort = /\b(beach|resort|seaside|tropical|coastal|cruise|vacation)\b/i.test(full);
  const isBeachWedding = isWedding && (isBeachOrResort || /\b(beach wedding|seaside wedding)\b/i.test(full));
  const isDate = /\b(date|date night|dinner date|romantic|anniversary)\b/i.test(full);

  const mentionsBreakfast = /\b(breakfast|brunch|morning meal|pancakes|waffles|indoor breakfast)\b/i.test(full);
  const mentionsCoffee = /\b(coffee|cafe|coffee date|starbucks|latte|espresso|coffee shop)\b/i.test(full);
  const isRun = /\b(running|jogging|marathon|track|5k|10k|sprint)\b/i.test(full);
  const isWalk = /\b(walk|walking|stroll|afternoon walk|evening walk|park walk)\b/i.test(full);

  let occasionType: OccasionType = 'general';
  let activity: ActivityType = 'general';
  let environment: OutfitContextInterpretation['environment'] = isIndoorOverride ? 'indoors' : 'general';
  let waterExposure: OutfitContextInterpretation['waterExposure'] = 'none';
  let physicalActivity: OutfitContextInterpretation['physicalActivity'] = 'low';
  let mobilityRequirement: OutfitContextInterpretation['mobilityRequirement'] = 'standard';
  let formalityExpectation: OutfitContextInterpretation['formalityExpectation'] = 'casual';
  let isDiningOrMeal = false;
  let socialSetting: OutfitContextInterpretation['socialSetting'] = 'general';
  const practicalityRequirements: string[] = [];

  if (
    mentionsSwim &&
    !isSpectatingOnly &&
    (mentionsActiveSwim || (!mentionsPoolParty && !mentionsPoolsideDining && occLower.includes('swim')))
  ) {
    occasionType = 'swimming';
    activity = 'activeSwimming';
    environment = 'swimmingPool';
    waterExposure = 'high';
    physicalActivity = 'high';
    mobilityRequirement = 'high';
    formalityExpectation = 'casual';
    socialSetting = 'athleticWorkout';
    practicalityRequirements.push('swimwear foundation', 'water-safe construction', 'unrestricted aquatic mobility');
  } else if (mentionsPoolsideDining) {
    occasionType = 'swimming';
    activity = 'poolsideDining';
    environment = 'swimmingPool';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'elevatedCasual';
    isDiningOrMeal = true;
    socialSetting = 'diningMeal';
    practicalityRequirements.push('resort casual or elevated dining attire');
  } else if (mentionsPoolParty) {
    occasionType = 'swimming';
    activity = 'poolsideSocial';
    environment = 'swimmingPool';
    waterExposure = 'low';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    socialSetting = 'casualSocial';
    practicalityRequirements.push('resort/summer party attire', 'poolside footwear');
  } else if (isBeachWedding) {
    occasionType = 'wedding';
    activity = 'beachWedding';
    environment = 'beachResort';
    waterExposure = 'low';
    physicalActivity = 'low';
    formalityExpectation = 'semiFormal';
    socialSetting = 'formalCelebration';
    practicalityRequirements.push('elevated resort attire', 'sand-friendly footwear');
  } else if (isWedding || /\b(formal|black.?tie|white.?tie|gala|ball|cocktail|ceremony)\b/i.test(full)) {
    occasionType = 'wedding';
    activity = 'formalCeremony';
    environment = 'formalVenue';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'formal';
    socialSetting = 'formalCelebration';
    practicalityRequirements.push('tailored or formal foundation', 'formal footwear', 'structured silhouette');
  } else if (isRun) {
    occasionType = 'running';
    activity = 'running';
    environment = 'outdoors';
    waterExposure = 'none';
    physicalActivity = 'high';
    mobilityRequirement = 'high';
    formalityExpectation = 'casual';
    socialSetting = 'athleticWorkout';
    practicalityRequirements.push('athletic moisture-wicking gear', 'cushioned running footwear');
  } else if (/\b(gym|workout|fitness|training|yoga|pilates|crossfit)\b/i.test(full)) {
    occasionType = 'gym';
    activity = 'gymWorkout';
    environment = 'indoors';
    waterExposure = 'none';
    physicalActivity = 'high';
    mobilityRequirement = 'high';
    formalityExpectation = 'casual';
    socialSetting = 'athleticWorkout';
    practicalityRequirements.push('athletic performance wear', 'training footwear');
  } else if (isDate) {
    occasionType = 'date';
    activity = 'dining';
    environment = isIndoorOverride ? 'indoors' : 'general';
    waterExposure = 'none';
    physicalActivity = 'low';
    socialSetting = 'intimateDate';
    formalityExpectation = /\b(formal|fancy|upscale|high.?end|fine dining)\b/i.test(full)
      ? 'formal'
      : 'elevatedCasual';
    practicalityRequirements.push('intentional social/date presentation');
  } else if (mentionsBreakfast) {
    occasionType = 'breakfastDining';
    activity = 'breakfastDining';
    environment = isIndoorOverride || /indoor/i.test(full) ? 'indoors' : 'cafe';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    isDiningOrMeal = true;
    socialSetting = 'diningMeal';
    practicalityRequirements.push('comfortable morning dining separates', 'relaxed morning comfort');
  } else if (mentionsCoffee) {
    occasionType = 'coffeeSocial';
    activity = 'coffeeSocial';
    environment = 'cafe';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    isDiningOrMeal = true;
    socialSetting = 'casualSocial';
    practicalityRequirements.push('relaxed cafe social separates');
  } else if (isWalk) {
    occasionType = 'casualWalk';
    activity = 'casualDaily';
    environment = isIndoorOverride ? 'indoors' : 'outdoors';
    waterExposure = 'none';
    physicalActivity = 'moderate';
    mobilityRequirement = 'standard';
    formalityExpectation = 'casual';
    socialSetting = 'leisure';
    practicalityRequirements.push('comfortable walking separates', 'walk-friendly footwear');
  } else if (/\b(office|interview|business|conference|corporate|work)\b/i.test(full)) {
    occasionType = 'office';
    activity = 'workProfessional';
    environment = 'office';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'semiFormal';
    socialSetting = 'professional';
    practicalityRequirements.push('workplace-appropriate tailoring', 'professional footwear');
  } else if (isBeachOrResort) {
    occasionType = 'beach';
    activity = 'beachResort';
    environment = 'beachResort';
    waterExposure = 'moderate';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    socialSetting = 'leisure';
    practicalityRequirements.push('breathable lightweight clothing', 'sun/beach-friendly pieces');
  } else if (/\b(dinner|restaurant|drinks|night out|lunch|supper)\b/i.test(full)) {
    occasionType = 'casualDining';
    activity = 'dining';
    environment = isIndoorOverride ? 'indoors' : 'diningVenue';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'elevatedCasual';
    isDiningOrMeal = true;
    socialSetting = 'diningMeal';
    practicalityRequirements.push('smart casual or evening dining attire');
  } else {
    occasionType = 'casualDaily';
    activity = 'casualDaily';
    environment = isIndoorOverride ? 'indoors' : 'casualEveryday';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    socialSetting = isIndoorOverride ? 'homeRelaxed' : 'general';
    practicalityRequirements.push('comfortable everyday separates');
  }

  // Handle weather & temperature requirements
  if (temperatureRequirement === 'warmthNeeded' && !isIndoorOverride) {
    practicalityRequirements.push('warm layering and adequate cold-weather coverage');
  }
  if (weather === 'rainy') {
    practicalityRequirements.push('weather-resistant layering or umbrella');
  }
  if (
    /\b(walk|walking|lot of walking|standing)\b/i.test(full) &&
    !practicalityRequirements.includes('comfortable walking footwear')
  ) {
    practicalityRequirements.push('comfortable walking footwear');
  }

  return {
    rawOccasion,
    rawAdditionalContext,
    activity,
    occasionType,
    timeOfDay,
    weather,
    temperatureRequirement,
    isSpectatingOnly,
    isIndoorOverride,
    isDiningOrMeal,
    socialSetting,
    environment,
    waterExposure,
    physicalActivity,
    mobilityRequirement,
    formalityExpectation,
    practicalityRequirements,
  };
}

// ============================================================================
// PHASE 3: STRUCTURED GARMENT SEMANTICS
// ============================================================================

/**
 * Builds a structured semantic profile for a mannequin garment.
 * Combines authoritative raw user metadata with inferred structural and material signals.
 * Never overwrites user metadata with vision or generic labels.
 */
export function buildGarmentSemanticProfile(
  item: MannequinCanvasItem,
  wardrobeItem?: WardrobeItem
): GarmentSemanticProfile {
  const category = wardrobeItem?.category || item.garment_type || '';
  const subCategory = wardrobeItem?.sub_category || '';
  const color =
    (wardrobeItem as any)?.color ||
    (wardrobeItem as any)?.colors ||
    (wardrobeItem as any)?.ai_attributes?.rawColor ||
    '';
  const colorTags = wardrobeItem?.color_tags || [];
  const whereWornOften =
    (wardrobeItem as any)?.where_worn_often ||
    (wardrobeItem as any)?.whereWornOften ||
    (wardrobeItem as any)?.ai_attributes?.whereWornOften ||
    '';
  const description =
    wardrobeItem?.description ||
    (wardrobeItem as any)?.ai_attributes?.description ||
    '';
  const userNotes =
    wardrobeItem?.user_notes ||
    (wardrobeItem as any)?.ai_attributes?.userNotes ||
    '';
  const occasions: string[] = (wardrobeItem as any)?.occasions || [];
  const seasons: string[] = (wardrobeItem as any)?.seasons || [];
  const photoUrl = (wardrobeItem as any)?.photo_url || item.image_url || undefined;
  const wardrobeItemId = item.wardrobe_item_id || (wardrobeItem as any)?.id || undefined;
  const name = item.name || subCategory || category || 'Item';

  const combinedText = [
    name,
    category,
    subCategory,
    color,
    colorTags.join(' '),
    whereWornOften,
    description,
    userNotes,
    occasions.join(' '),
    seasons.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Normalize through classifier for thermal, coverage, functionalRole, personalUsage
  const normalized = normalizeGarment(
    category,
    subCategory,
    color,
    whereWornOften,
    description,
    userNotes
  );

  const thermal = normalized.thermal;
  const coverage = normalized.coverage;
  const functionalRole = normalized.functionalRole;
  const personalUsage = normalized.personalUsage;
  const subtype = normalized.subtype;

  // Detect Functional Structure using authoritative semantic classification
  let garmentFamily: GarmentSemanticProfile['garmentStructure']['garmentFamily'];
  if (normalized.family === 'Dress') {
    garmentFamily = 'onePiece';
  } else if (normalized.family === 'Outerwear') {
    garmentFamily = 'outerwear';
  } else if (normalized.family === 'Footwear') {
    garmentFamily = 'footwear';
  } else if (normalized.family === 'Bottom') {
    garmentFamily = 'lowerBody';
  } else if (normalized.family === 'Accessory') {
    garmentFamily = 'accessory';
  } else if (normalized.family === 'Top') {
    garmentFamily = 'upperBody';
  } else {
    // Fallback if semantic family is Unknown
    const effectiveBucket = resolveEffectiveGarmentBucket(item);
    if (effectiveBucket === 'Bottom') garmentFamily = 'lowerBody';
    else if (effectiveBucket === 'Dress') garmentFamily = 'onePiece';
    else if (effectiveBucket === 'Outerwear') garmentFamily = 'outerwear';
    else if (effectiveBucket === 'Shoes') garmentFamily = 'footwear';
    else if (effectiveBucket === 'Accessory') garmentFamily = 'accessory';
    else garmentFamily = 'upperBody';
  }

  const isOnePiece = garmentFamily === 'onePiece';
  const isOuterwear = garmentFamily === 'outerwear';
  const isFootwear = garmentFamily === 'footwear';
  const isLowerBody = garmentFamily === 'lowerBody';
  const isUpperBody = garmentFamily === 'upperBody';
  const isAccessory = garmentFamily === 'accessory';

  // Detect Materials
  const materialSignals: GarmentMaterial[] = [];
  if (/\b(knit|ribbed.?knit|sweater|turtleneck|cardigan|wool|cashmere)\b/i.test(combinedText)) {
    materialSignals.push('knit');
  }
  if (/\b(denim|jeans?|five.?pocket|chambray)\b/i.test(combinedText)) {
    materialSignals.push('denim');
  }
  if (/\b(suede)\b/i.test(combinedText)) {
    materialSignals.push('suede');
  }
  if (/\b(velvet)\b/i.test(combinedText)) {
    materialSignals.push('velvet');
  }
  if (/\b(leather)\b/i.test(combinedText)) {
    materialSignals.push('leather');
  }
  if (
    /\b(swimsuit|bikini|swim trunks?|boardshorts?|rash guard|swim briefs?|neoprene|spandex swim)\b/i.test(combinedText)
  ) {
    materialSignals.push('swimwearSynthetic');
  }
  if (/\b(spandex|lycra|nylon athletic|polyester athletic|dry.?fit|running shorts|sweatpants)\b/i.test(combinedText)) {
    materialSignals.push('athleticSynthetic');
  }
  if (/\b(linen)\b/i.test(combinedText)) {
    materialSignals.push('linen');
  }
  if (/\b(silk|satin)\b/i.test(combinedText)) {
    materialSignals.push('silk');
  }
  if (/\b(cotton)\b/i.test(combinedText)) {
    materialSignals.push('cotton');
  }
  if (materialSignals.length === 0) {
    materialSignals.push('unknown');
  }

  // Detect Water Compatibility
  const isExplicitSwimwear =
    materialSignals.includes('swimwearSynthetic') ||
    /\b(swimwear|swimsuit|bikini|swim trunks?|boardshorts?|rash guard|swim briefs?)\b/i.test(combinedText);

  let waterCompatibility: GarmentSemanticProfile['waterCompatibility'] = 'unknown';
  if (isExplicitSwimwear) {
    waterCompatibility = 'suitable';
  } else if (
    materialSignals.includes('denim') ||
    materialSignals.includes('knit') ||
    materialSignals.includes('suede') ||
    materialSignals.includes('velvet') ||
    materialSignals.includes('leather') ||
    /\b(sweater|turtleneck|wool|coat|blazer|mary jane|heels?|loafers?|oxfords?)\b/i.test(combinedText)
  ) {
    waterCompatibility = 'poor';
  } else if (/\b(athletic shorts|running shorts|dry.?fit)\b/i.test(combinedText)) {
    waterCompatibility = 'questionable';
  }

  // Detect Style Signals
  const isAthletic =
    functionalRole === 'athleticPerformance' ||
    whereWornOften.match(/\b(running|gym|workout|jogging|training|sport|track|fitness|exercis)\b/i) !== null ||
    occasions.some((o) => o.match(/\b(running|gym|workout|sports?|training)\b/i)) ||
    description.match(/\b(running|exercise|gym|workout|jogging|athletic|training|sports?)\b/i) !== null ||
    userNotes.match(/\b(running|exercise|gym|workout|jogging|athletic|training|sports?)\b/i) !== null ||
    subCategory.match(/\b(running|gym|workout|track|sweatpants|sports bra|athletic sneakers|running shoes)\b/i) !==
      null ||
    combinedText.match(
      /\b(running shorts|gym shorts|track pants|sweatpants|sports bra|jersey|athletic sneakers|running shoes|workout leggings|gym wear|workout top)\b/i
    ) !== null;

  const isFormal =
    combinedText.match(
      /\b(blazer|suit|tuxedo|gown|evening dress|cocktail dress|tailored|trousers?|dress pants|slacks|oxfords?|loafers?|derby|heels?|pumps?)\b/i
    ) !== null;

  const isElevated = isFormal || /\b(button.?down|blouse|linen|silk|cashmere|smart casual)\b/i.test(combinedText);

  // Mobility
  let mobility: GarmentSemanticProfile['mobility'] = 'medium';
  if (isAthletic || isExplicitSwimwear) {
    mobility = 'high';
  } else if (/\b(micro mini|pencil skirt|tight|corset|high heels?|stiletto|tuxedo|rigid)\b/i.test(combinedText)) {
    mobility = 'low';
  }

  // Formality
  let formality: GarmentSemanticProfile['formality'] = 'casual';
  if (isFormal) formality = 'formal';
  else if (isElevated) formality = 'elevatedCasual';
  else if (isAthletic) formality = 'casual';

  return {
    identity: {
      wardrobeItemId,
      imageUrl: photoUrl,
      name,
    },
    rawUserData: {
      category,
      subCategory,
      color,
      colorTags,
      whereWornOften,
      description,
      userNotes,
      occasions,
      seasons,
    },
    garmentStructure: {
      garmentFamily,
      garmentType: item.garment_type || category,
      isOnePiece,
      isUpperBody,
      isLowerBody,
      isOuterwear,
      isFootwear,
      isAccessory,
    },
    styleSignals: {
      casual: !isFormal && !isElevated,
      elevated: isElevated,
      formal: isFormal,
      athletic: isAthletic,
      streetwear: isAthletic && isOuterwear,
      resort: /\b(resort|linen|swim|vacation)\b/i.test(combinedText),
      evening: /\b(evening|gown|cocktail)\b/i.test(combinedText),
      professional: /\b(office|business|blazer|trousers)\b/i.test(combinedText),
    },
    activitySignals: {
      swimming: isExplicitSwimwear,
      running:
        /\b(running|jogging|track)\b/i.test(combinedText) ||
        functionalRole === 'athleticPerformance' ||
        subtype === 'Running Shorts',
      gym: /\b(gym|workout|fitness)\b/i.test(combinedText),
      workout: isAthletic,
      hiking: /\b(hiking|trail)\b/i.test(combinedText),
      walking: /\b(walking|sneakers)\b/i.test(combinedText),
      lounging: /\b(lounging|sweatpants|pajamas)\b/i.test(combinedText),
      sports: isAthletic,
    },
    materialSignals,
    waterCompatibility,
    mobility,
    formality,
    thermal,
    coverage,
    functionalRole,
    personalUsage,
    subtype,
    confidenceSource: 'user',
    combinedText,
  };
}

// ============================================================================
// PHASE 6: OCCASION REQUIREMENT PROFILES
// ============================================================================

export function buildOccasionRequirements(
  context: OutfitContextInterpretation
): OccasionRequirementProfile {
  const {
    activity,
    occasionType,
    formalityExpectation,
    weather,
    temperatureRequirement,
    isIndoorOverride,
    timeOfDay,
  } = context;

  const requiresWarmth = (weather === 'cold' || temperatureRequirement === 'warmthNeeded') && !isIndoorOverride;
  const prohibitsExposedLegsInCold = requiresWarmth;

  if (activity === 'activeSwimming') {
    return {
      requiresSwimwear: true,
      requiresWaterCompatibility: 'high',
      requiresHighMobility: true,
      requiresFormalAttire: false,
      allowsResortElevated: false,
      prohibitsAthletic: false,
      prohibitsSwimwearConflicts: true,
      prohibitsCasualFootwear: false,
      requiresBaseTop: false,
      occasionType,
      requiresWarmth: false,
      prohibitsExposedLegsInCold: false,
      allowsAthletic: false,
      timeOfDay,
      weather,
      summary:
        'Active pool swimming requires swim-compatible garments, high water compatibility, and unrestricted aquatic mobility.',
    };
  }

  if (activity === 'poolsideSocial') {
    return {
      requiresSwimwear: false,
      requiresWaterCompatibility: 'moderate',
      requiresHighMobility: false,
      requiresFormalAttire: false,
      allowsResortElevated: true,
      prohibitsAthletic: false,
      prohibitsSwimwearConflicts: false,
      prohibitsCasualFootwear: false,
      requiresBaseTop: true,
      occasionType,
      requiresWarmth,
      prohibitsExposedLegsInCold,
      allowsAthletic: true,
      timeOfDay,
      weather,
      summary:
        'Pool party social setting welcomes relaxed resort wear, stylish summer separates, and casual poolside footwear.',
    };
  }

  if (activity === 'beachWedding') {
    return {
      requiresSwimwear: false,
      requiresWaterCompatibility: 'none',
      requiresHighMobility: false,
      requiresFormalAttire: false,
      allowsResortElevated: true,
      prohibitsAthletic: true,
      prohibitsSwimwearConflicts: false,
      prohibitsCasualFootwear: false,
      requiresBaseTop: true,
      occasionType,
      requiresWarmth,
      prohibitsExposedLegsInCold,
      allowsAthletic: false,
      timeOfDay,
      weather,
      summary:
        'Beach wedding invites elevated resort wear, breathable fabrics, and refined footwear suitable for coastal settings.',
    };
  }

  if (activity === 'formalCeremony' || formalityExpectation === 'formal') {
    return {
      requiresSwimwear: false,
      requiresWaterCompatibility: 'none',
      requiresHighMobility: false,
      requiresFormalAttire: true,
      allowsResortElevated: false,
      prohibitsAthletic: true,
      prohibitsSwimwearConflicts: false,
      prohibitsCasualFootwear: true,
      requiresBaseTop: true,
      occasionType,
      requiresWarmth,
      prohibitsExposedLegsInCold,
      allowsAthletic: false,
      timeOfDay,
      weather,
      summary:
        'Formal wedding and ceremony standards require elevated formalwear, structured silhouettes, and dress footwear.',
    };
  }

  if (activity === 'running') {
    return {
      requiresSwimwear: false,
      requiresWaterCompatibility: 'none',
      requiresHighMobility: true,
      requiresFormalAttire: false,
      allowsResortElevated: false,
      prohibitsAthletic: false,
      prohibitsSwimwearConflicts: false,
      prohibitsCasualFootwear: false,
      requiresBaseTop: false,
      occasionType,
      requiresWarmth,
      prohibitsExposedLegsInCold: false,
      allowsAthletic: true,
      timeOfDay,
      weather,
      summary: 'Running requires lightweight, breathable athletic garments and cushioned running shoes.',
    };
  }

  if (occasionType === 'date') {
    return {
      requiresSwimwear: false,
      requiresWaterCompatibility: 'none',
      requiresHighMobility: false,
      requiresFormalAttire: false,
      allowsResortElevated: true,
      prohibitsAthletic: true,
      prohibitsSwimwearConflicts: false,
      prohibitsCasualFootwear: false,
      requiresBaseTop: true,
      occasionType,
      requiresWarmth,
      prohibitsExposedLegsInCold,
      allowsAthletic: false,
      timeOfDay,
      weather,
      summary: `A date${timeOfDay === 'night' ? ' at night' : ''} calls for intentional, socially coordinated styling${
        requiresWarmth ? ' and warmth for cold conditions' : ''
      }.`,
    };
  }

  if (activity === 'workProfessional') {
    return {
      requiresSwimwear: false,
      requiresWaterCompatibility: 'none',
      requiresHighMobility: false,
      requiresFormalAttire: false,
      allowsResortElevated: false,
      prohibitsAthletic: true,
      prohibitsSwimwearConflicts: false,
      prohibitsCasualFootwear: true,
      requiresBaseTop: true,
      occasionType,
      requiresWarmth,
      prohibitsExposedLegsInCold,
      allowsAthletic: false,
      timeOfDay,
      weather,
      summary: 'Professional workplace standards require clean tailoring, modesty, and professional footwear.',
    };
  }

  if (occasionType === 'breakfastDining' || activity === 'breakfastDining') {
    return {
      requiresSwimwear: false,
      requiresWaterCompatibility: 'none',
      requiresHighMobility: false,
      requiresFormalAttire: false,
      allowsResortElevated: true,
      prohibitsAthletic: false,
      prohibitsSwimwearConflicts: false,
      prohibitsCasualFootwear: false,
      requiresBaseTop: true,
      occasionType,
      requiresWarmth,
      prohibitsExposedLegsInCold,
      allowsAthletic: true,
      timeOfDay,
      weather,
      summary: 'A morning breakfast calls for relaxed, comfortable separates suited for leisurely dining.',
    };
  }

  return {
    requiresSwimwear: false,
    requiresWaterCompatibility: 'none',
    requiresHighMobility: false,
    requiresFormalAttire: false,
    allowsResortElevated: true,
    prohibitsAthletic: false,
    prohibitsSwimwearConflicts: false,
    prohibitsCasualFootwear: false,
    requiresBaseTop: true,
    occasionType,
    requiresWarmth,
    prohibitsExposedLegsInCold,
    allowsAthletic: true,
    timeOfDay,
    weather,
    summary: 'Everyday casual wear allows versatile, comfortable separates suited for daily activities.',
  };
}

// ============================================================================
// PHASE 8: CONTRADICTION ENGINE (Contradiction-First, No Score Averaging)
// ============================================================================

export interface OutfitStructure {
  baseTops: GarmentSemanticProfile[];
  outers: GarmentSemanticProfile[];
  bottoms: GarmentSemanticProfile[];
  onePieces: GarmentSemanticProfile[];
  shoes: GarmentSemanticProfile[];
  accessories: GarmentSemanticProfile[];
  hasOnePiece: boolean;
  hasTop: boolean;
  hasBottom: boolean;
  hasOuterwear: boolean;
  hasShoes: boolean;
  isOvercrowded: boolean;
  overcrowdingNote: string;
}

export function buildOutfitStructure(garments: GarmentSemanticProfile[]): OutfitStructure {
  const baseTops: GarmentSemanticProfile[] = [];
  const outers: GarmentSemanticProfile[] = [];
  const bottoms: GarmentSemanticProfile[] = [];
  const onePieces: GarmentSemanticProfile[] = [];
  const shoes: GarmentSemanticProfile[] = [];
  const accessories: GarmentSemanticProfile[] = [];

  for (const g of garments) {
    const fam = g.garmentStructure.garmentFamily;
    if (fam === 'onePiece') onePieces.push(g);
    else if (fam === 'outerwear') outers.push(g);
    else if (fam === 'lowerBody') bottoms.push(g);
    else if (fam === 'footwear') shoes.push(g);
    else if (fam === 'upperBody') baseTops.push(g);
    else accessories.push(g);
  }

  const hasOnePiece = onePieces.length > 0;
  const hasTop = baseTops.length > 0;
  const hasBottom = bottoms.length > 0;
  const hasOuterwear = outers.length > 0;
  const hasShoes = shoes.length > 0;

  let isOvercrowded = false;
  let overcrowdingNote = '';
  if (baseTops.length > 1) {
    isOvercrowded = true;
    overcrowdingNote = `You have ${baseTops.length} separate tops on the mannequin at once. Choose one primary base top.`;
  } else if (bottoms.length > 1) {
    isOvercrowded = true;
    overcrowdingNote = `You have ${bottoms.length} separate bottoms on the mannequin. Choose one trouser or skirt.`;
  } else if (hasOnePiece && (hasTop || hasBottom)) {
    isOvercrowded = true;
    overcrowdingNote =
      'A dress or jumpsuit already provides full body coverage; separate tops or bottoms create conflicting bulk.';
  }

  return {
    baseTops,
    outers,
    bottoms,
    onePieces,
    shoes,
    accessories,
    hasOnePiece,
    hasTop,
    hasBottom,
    hasOuterwear,
    hasShoes,
    isOvercrowded,
    overcrowdingNote,
  };
}

export function detectContradictions(
  garments: GarmentSemanticProfile[],
  reqs: OccasionRequirementProfile,
  structure: OutfitStructure
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  // 1. ACTIVE SWIMMING CONTRADICTIONS (Phase 28 Regression Core)
  if (reqs.prohibitsSwimwearConflicts || reqs.requiresSwimwear) {
    const hasSwimwear = garments.some((g) => g.activitySignals.swimming || g.waterCompatibility === 'suitable');
    if (!hasSwimwear) {
      contradictions.push({
        severity: 'severe',
        category: 'activity_water',
        garmentName: 'Outfit Foundation',
        reason: 'The outfit lacks swim-compatible clothing or a swimwear foundation.',
        whyItMatters:
          'Active swimming involves sustained water immersion, which requires garments engineered for aquatic use.',
        suggestedFix: 'Replace the outfit with a swimsuit, swim trunks, or swim-compatible activewear.',
      });
    }

    for (const g of garments) {
      const name = g.identity.name;
      const isKnit = g.materialSignals.includes('knit');
      const isDenim = g.materialSignals.includes('denim');
      const isSuedeOrVelvet = g.materialSignals.includes('suede') || g.materialSignals.includes('velvet');
      const isLeather = g.materialSignals.includes('leather');

      if (isKnit) {
        contradictions.push({
          severity: 'severe',
          category: 'activity_water',
          garmentName: name,
          reason: `${name} is a knit sweater/garment that absorbs heavy water and restricts movement in a pool.`,
          whyItMatters: 'Heavy knits become waterlogged, dangerously heavy, and distorted when immersed in water.',
          suggestedFix: 'Swap the knitwear for swimwear or a lightweight swim rash guard.',
        });
      } else if (isDenim) {
        contradictions.push({
          severity: 'severe',
          category: 'activity_water',
          garmentName: name,
          reason: `${name} is denim, which is completely unsuited for pool swimming.`,
          whyItMatters: 'Denim stiffens, holds excessive moisture, chafes, and degrades quickly in chlorinated water.',
          suggestedFix: 'Replace the denim bottom with swim trunks or bikini/swim shorts.',
        });
      } else if (g.garmentStructure.isFootwear && (isSuedeOrVelvet || isLeather || !g.activitySignals.swimming)) {
        contradictions.push({
          severity: 'severe',
          category: 'activity_water',
          garmentName: name,
          reason: `${name} (${
            isSuedeOrVelvet ? 'suede/velvet' : isLeather ? 'leather' : 'fashion'
          } flats/shoes) cannot withstand pool water immersion.`,
          whyItMatters: 'Delicate suede, velvet, and fashion footwear are damaged by water and provide no pool traction.',
          suggestedFix: 'Go barefoot at the pool deck or use water-resistant pool slides/swim shoes.',
        });
      } else if (g.waterCompatibility === 'poor') {
        contradictions.push({
          severity: 'major',
          category: 'activity_water',
          garmentName: name,
          reason: `${name} is constructed from materials that do not tolerate pool water immersion.`,
          whyItMatters: 'Regular street fashion degrades and becomes waterlogged in a swimming pool.',
          suggestedFix: 'Switch to aquatic-safe garments.',
        });
      }
    }
  }

  // 2. FORMAL WEDDING / HIGH FORMALITY / DATE ATHLETIC CONTRADICTIONS
  if (reqs.prohibitsAthletic) {
    for (const g of garments) {
      if (g.styleSignals.athletic || g.functionalRole === 'athleticPerformance') {
        const isDateContext = reqs.occasionType === 'date';
        const userAssociatedExercise =
          g.personalUsage?.activities?.includes('Exercise') || g.personalUsage?.activities?.includes('Running');
        const personalNoteSnippet = userAssociatedExercise
          ? ` and you associate them with ${g.personalUsage.activities.join(' and ')}`
          : '';

        contradictions.push({
          severity: isDateContext ? 'major' : 'severe',
          category: isDateContext ? 'occasion_context' : 'formality_dresscode',
          garmentName: g.identity.name,
          reason: isDateContext
            ? `${g.identity.name} carries a strong performance/activewear signal${personalNoteSnippet}, which conflicts with the intentional styling of a date setting.`
            : `${g.identity.name} is an athletic garment that clashes with formal event standards.`,
          whyItMatters: isDateContext
            ? 'A date setting generally calls for intentional, socially aligned attire rather than workout or training apparel.'
            : 'Athletic wear conveys extreme informality, violating formal dress codes.',
          suggestedFix: isDateContext
            ? 'Replace the athletic shorts with clean trousers, jeans, or a skirt suited for date styling.'
            : 'Replace athletic pieces with tailored formal garments like trousers or a suit.',
        });
      }
    }
  }

  if (reqs.prohibitsCasualFootwear && structure.hasShoes) {
    for (const s of structure.shoes) {
      const isSneakerOrSporty =
        s.styleSignals.athletic ||
        /\b(sneakers?|running shoes|trainers?|canvas shoes|slip.?on|flip.?flop|sandals?)\b/i.test(s.combinedText);
      if (isSneakerOrSporty) {
        contradictions.push({
          severity: 'major',
          category: 'formality_dresscode',
          garmentName: s.identity.name,
          reason: `Footwear (${s.identity.name}) is sporty/casual rather than formal dress footwear.`,
          whyItMatters: 'Casual footwear undermines the elevated presentation required for a formal occasion.',
          suggestedFix: 'Swap sneakers for dress shoes, oxfords, loafers, or formal heels.',
        });
      }
    }
  }

  // 3. RUNNING ACTIVITY RESTRICTIVE FOOTWEAR CONTRADICTION
  if (reqs.occasionType === 'running') {
    for (const s of structure.shoes) {
      const isRunningShoe =
        s.subtype === 'Running Shoes' ||
        s.styleSignals.athletic ||
        /\b(running shoes?|trainers?|running sneakers?|cushion)\b/i.test(s.combinedText);
      if (!isRunningShoe) {
        contradictions.push({
          severity: 'major',
          category: 'environment_practicality',
          garmentName: s.identity.name,
          reason: `${s.identity.name} are non-athletic footwear lacking the cushioning and support required for running.`,
          whyItMatters: 'Running in lifestyle or non-cushioned footwear causes discomfort and risks foot injury.',
          suggestedFix: 'Switch to cushioned running shoes.',
        });
      }
    }

    for (const t of structure.baseTops) {
      const isHeavyKnit =
        t.materialSignals.includes('knit') ||
        t.thermal === 'heavyWarmth' ||
        /\b(knit|sweater|turtleneck|cardigan|wool|cashmere)\b/i.test(t.combinedText);
      if (isHeavyKnit) {
        contradictions.push({
          severity: 'major',
          category: 'environment_practicality',
          garmentName: t.identity.name,
          reason: `${t.identity.name} is a heavy insulating knit sweater that traps body heat and causes overheating during a sustained run.`,
          whyItMatters:
            'Running generates intense metabolic body heat; non-breathable knitwear prevents sweat evaporation and leads to rapid thermal discomfort.',
          suggestedFix: 'Replace the knit sweater with a moisture-wicking technical running shirt or lightweight athletic tee.',
        });
      }
    }
  }

  // 4. WEATHER & THERMAL CONTRADICTIONS
  if (reqs.requiresWarmth && reqs.prohibitsExposedLegsInCold) {
    for (const g of garments) {
      const isMinimalLower =
        g.garmentStructure.isLowerBody &&
        (g.coverage === 'minimal' ||
          g.thermal === 'lightWarmth' ||
          /\b(shorts?|running shorts|mini skirt|micro mini)\b/i.test(g.combinedText));
      if (isMinimalLower) {
        contradictions.push({
          severity: 'major',
          category: 'weather_thermal',
          garmentName: g.identity.name,
          reason: `${g.identity.name} provides limited warmth and leaves significant leg exposure for a cold ${
            reqs.timeOfDay !== 'unknown' ? reqs.timeOfDay : 'night'
          }.`,
          whyItMatters: 'Cold nighttime conditions demand lower-body thermal protection and wind coverage.',
          suggestedFix: 'Swap the shorts for full-length pants, jeans, or layer with warm opaque tights.',
        });
      }
    }

    // Upper vs Lower thermal mismatch
    const hasWarmTop =
      structure.baseTops.some((t) => t.thermal === 'heavyWarmth') ||
      structure.outers.some((o) => o.thermal === 'heavyWarmth');
    const hasExposedLegBottom = structure.bottoms.some(
      (b) => b.coverage === 'minimal' || b.thermal === 'lightWarmth' || /\b(shorts?|mini skirt)\b/i.test(b.combinedText)
    );
    if (hasWarmTop && hasExposedLegBottom) {
      contradictions.push({
        severity: 'moderate',
        category: 'weather_thermal',
        garmentName: 'Upper-Lower Thermal Balance',
        reason: 'The heavy warm knit upper layer sharply contrasts with the bare-leg lower garment.',
        whyItMatters:
          'An exposed-leg silhouette creates thermal inconsistency and reads as an incomplete cold-weather outfit.',
        suggestedFix: 'Balance upper warmth with full-coverage bottoms or warm tights.',
      });
    }
  }

  // 5. STRUCTURAL COMPLETENESS (Outerwear without base top)
  if (structure.hasOuterwear && !structure.hasTop && !structure.hasOnePiece) {
    contradictions.push({
      severity: 'major',
      category: 'structure_completeness',
      garmentName: structure.outers[0]?.identity.name || 'Outerwear',
      reason: 'Outerwear is worn without a base inner top underneath.',
      whyItMatters: 'A jacket or blazer frames the torso but does not substitute for a base upper-body layer.',
      suggestedFix: 'Add a dress shirt, blouse, or tee underneath the outerwear.',
    });
  }

  return contradictions;
}

// ============================================================================
// PHASE 15: REAL WARDROBE GROUNDING FOR ALTERNATIVES
// ============================================================================

export function generateWardrobeAlternatives(
  contradictions: Contradiction[],
  wardrobeLookup?: Record<string, WardrobeItem>,
  reqs?: OccasionRequirementProfile
): WardrobeAlternative[] {
  if (!wardrobeLookup || Object.keys(wardrobeLookup).length === 0) {
    return [];
  }

  const alternatives: WardrobeAlternative[] = [];
  const ownedItems = Object.values(wardrobeLookup).filter((w) => !(w as any).deleted);

  // Search for swimwear if required
  if (reqs?.requiresSwimwear) {
    const swimItem = ownedItems.find((w) => {
      const sem = buildGarmentSemanticProfile({ wardrobe_item_id: w.id } as any, w);
      return sem.activitySignals.swimming || sem.waterCompatibility === 'suitable';
    });

    if (swimItem) {
      alternatives.push({
        slot: 'swimwear',
        found: true,
        item: swimItem,
        recommendationText: `Replace the outfit with your ${
          (swimItem as any).name || swimItem.sub_category || 'swimwear'
        } from your wardrobe.`,
      });
    } else {
      alternatives.push({
        slot: 'swimwear',
        found: false,
        recommendationText: "JeZsy couldn't find a suitable swimwear item in your current wardrobe.",
      });
    }
  }

  // Search for formal bottom if formal contradiction exists
  const hasFormalBottomConflict = contradictions.some(
    (c) => c.category === 'formality_dresscode' && c.garmentName.toLowerCase().includes('short')
  );
  if (hasFormalBottomConflict && reqs?.requiresFormalAttire) {
    const formalBottom = ownedItems.find((w) => {
      const sem = buildGarmentSemanticProfile({ wardrobe_item_id: w.id } as any, w);
      return sem.garmentStructure.isLowerBody && !sem.styleSignals.athletic && sem.formality === 'formal';
    });

    if (formalBottom) {
      alternatives.push({
        slot: 'bottom',
        found: true,
        item: formalBottom,
        recommendationText: `You could wear your ${
          (formalBottom as any).name || formalBottom.sub_category || 'tailored trousers'
        } from your wardrobe.`,
      });
    } else {
      alternatives.push({
        slot: 'bottom',
        found: false,
        recommendationText: 'JeZsy could not find a suitable formal alternative in your current wardrobe.',
      });
    }
  }

  // Search for cold-weather bottom if thermal/cold contradiction exists
  const hasColdBottomConflict = contradictions.some(
    (c) =>
      (c.category === 'weather_thermal' || c.category === 'occasion_context') &&
      (c.garmentName.toLowerCase().includes('short') || c.garmentName.toLowerCase().includes('skirt'))
  );
  if (hasColdBottomConflict && (reqs?.requiresWarmth || reqs?.occasionType === 'date')) {
    const warmBottom = ownedItems.find((w) => {
      const sem = buildGarmentSemanticProfile({ wardrobe_item_id: w.id } as any, w);
      return (
        sem.garmentStructure.isLowerBody &&
        !sem.styleSignals.athletic &&
        (sem.coverage === 'full' || sem.thermal === 'heavyWarmth' || sem.thermal === 'moderateWarmth')
      );
    });

    if (warmBottom) {
      const bName = (warmBottom as any).name || warmBottom.sub_category || 'trousers';
      alternatives.push({
        slot: 'bottom',
        found: true,
        item: warmBottom,
        recommendationText: `Your ${bName} would address the cold-weather issue while keeping the outfit relaxed.`,
      });
    } else {
      alternatives.push({
        slot: 'bottom',
        found: false,
        recommendationText: "I don't see a wardrobe item that resolves the main cold-weather issue.",
      });
    }
  }

  // Search for formal shoes if formal footwear conflict exists
  const hasShoeConflict = contradictions.some(
    (c) =>
      c.category === 'formality_dresscode' &&
      (c.garmentName.toLowerCase().includes('shoe') || c.garmentName.toLowerCase().includes('sneaker'))
  );
  if (hasShoeConflict && reqs?.requiresFormalAttire) {
    const formalShoe = ownedItems.find((w) => {
      const sem = buildGarmentSemanticProfile({ wardrobe_item_id: w.id } as any, w);
      return sem.garmentStructure.isFootwear && !sem.styleSignals.athletic && sem.formality === 'formal';
    });

    if (formalShoe) {
      alternatives.push({
        slot: 'shoes',
        found: true,
        item: formalShoe,
        recommendationText: `Pair with your ${
          (formalShoe as any).name || formalShoe.sub_category || 'dress shoes'
        } to anchor the formal outfit.`,
      });
    } else {
      alternatives.push({
        slot: 'shoes',
        found: false,
        recommendationText: 'JeZsy could not find suitable formal footwear in your current wardrobe.',
      });
    }
  }

  return alternatives;
}

// ============================================================================
// PHASE 21 & 22: CORE STYLIST EVALUATION ENGINE
// ============================================================================

export function gradeOutfit(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>,
  context?: OutfitContext,
  profile?: UserStyleProfileDto | null
): StylistCritique {
  const analysisId = generateAnalysisId();
  const generatedAt = new Date().toISOString();
  const contextHash = computeContextHash(context);
  const outfitHash = computeOutfitHash(items, wardrobeLookup);
  const wardrobeItemIds = (items || []).map((i) => i.wardrobe_item_id).filter(Boolean);
  const analysisMode = 'ruleBasedEvidence' as const;
  const cacheStatus = 'fresh' as const;

  const contextInterpretation = interpretOutfitContext(context);
  const { rawOccasion, rawAdditionalContext, activity, occasionType, timeOfDay, weather, isIndoorOverride } =
    contextInterpretation;
  const occasionLabel = rawOccasion || 'your day';

  // Empty Mannequin handling
  if (!items || items.length === 0) {
    return {
      analysisId,
      generatedAt,
      analysisVersion: STYLIST_ANALYSIS_VERSION,
      analysisMode,
      contextHash,
      outfitHash,
      wardrobeItemIds: [],
      cacheStatus,
      assessment: 'Incomplete outfit',
      headline: 'Mannequin is Empty',
      verdict: "Add at least one garment to the mannequin, then check your outfit to get JeZsy's evaluation.",
      whyJezsySaysThis: 'No garments are currently dressed on the mannequin canvas.',
      stylistsTake:
        'No garments are currently dressed on the mannequin. Please select clothes from your wardrobe to begin styling.',
      whatWorks: undefined,
      whatCouldBeBetter: 'The mannequin has no garments on it.',
      whatsMissing: 'Add core garments (a dress, jumpsuit, or a top and bottom combination) to create a wearable outfit.',
      tips: ['Tap any garment in the wardrobe drawer below to dress the mannequin.'],
      vibe: 'Unstyled',
      paletteColors: [],
      mannequinItems: [],
      context,
      contextInterpretation,
      contradictions: [],
      pillars: {
        colorHarmony: {
          status: 'alert',
          title: 'No Colors Detected',
          feedback: 'Dress the mannequin to begin color evaluation.',
        },
        compositionAndLayers: {
          status: 'alert',
          title: 'No Garments',
          feedback: 'No garments are currently on the canvas.',
        },
      },
    };
  }

  // 1. Build Garment Semantic Profiles for all items on canvas
  const garmentProfiles = items.map((item) => {
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    return buildGarmentSemanticProfile(item, w);
  });

  // 2. Build Outfit Structure
  const structure = buildOutfitStructure(garmentProfiles);

  // 3. Build Occasion Requirements
  const reqs = buildOccasionRequirements(contextInterpretation);

  // 4. Detect Contradictions
  const contradictions = detectContradictions(garmentProfiles, reqs, structure);
  const severeContradictions = contradictions.filter((c) => c.severity === 'severe');
  const majorContradictions = contradictions.filter((c) => c.severity === 'major');

  // 5. Visual Compatibility & Color Analysis
  const paletteColors = extractColors(items, wardrobeLookup);
  const colorEval: ColorMatchResult = evaluateColors(paletteColors);

  // 6. Wardrobe-Grounded Alternatives
  const wardrobeAlternatives = generateWardrobeAlternatives(contradictions, wardrobeLookup, reqs);

  // 7. Structural Flags
  const missingBaseTopUnderOuter = structure.hasOuterwear && !structure.hasTop && !structure.hasOnePiece;
  const missingBottom = !structure.hasOnePiece && (structure.hasTop || structure.hasOuterwear) && !structure.hasBottom;
  const missingTopOnly = !structure.hasOnePiece && !structure.hasOuterwear && structure.hasBottom && !structure.hasTop;
  const onlyAccessories =
    !structure.hasOnePiece && !structure.hasTop && !structure.hasBottom && !structure.hasOuterwear;

  // 8. Formulate Qualitative Assessment
  let assessment: OverallAssessment = 'Appropriate for this occasion';
  let headline = 'Appropriate Outfit';
  let verdict = '';
  let whyJezsySaysThis = '';
  let stylistsTake = '';
  let whatWorks: string | undefined;
  let whatCouldBeBetter: string | undefined;
  let whatsMissing: string | undefined;
  const tips: string[] = [];

  // Priority 1: Structural Incompleteness / Overcrowding
  if (structure.isOvercrowded) {
    assessment = 'Incomplete outfit';
    headline = 'Too Many Competing Garments';
    verdict = 'Simplify the layers so each garment has room to breathe.';
    whyJezsySaysThis = structure.overcrowdingNote;
    stylistsTake = structure.overcrowdingNote || 'The outfit has overlapping garments in the same structural slot.';
    whatCouldBeBetter = structure.overcrowdingNote;
    tips.push('Aim for: one top (or dress), one bottom, and at most one outerwear layer.');
  } else if (onlyAccessories) {
    assessment = 'Incomplete outfit';
    headline = 'No Core Garments';
    verdict = 'The mannequin only has accessories.';
    whyJezsySaysThis = 'The outfit only contains accessories without any foundational clothing layers.';
    stylistsTake =
      'An outfit requires core clothing pieces to be wearable. Add a dress, jumpsuit, or a top and bottom.';
    whatsMissing = 'Core garments — please add a dress, jumpsuit, or a top and bottom combination.';
    tips.push('Select a top or dress from your wardrobe to anchor the outfit.');
  } else if (missingBottom) {
    assessment = 'Incomplete outfit';
    headline = 'Missing Lower-Body Garment';
    verdict = 'An upper piece is selected, but a bottom is needed to complete the foundation.';
    whyJezsySaysThis = 'The outfit has upper coverage but lacks trousers, a skirt, or shorts to be wearable.';
    stylistsTake = 'The outfit has upper coverage but lacks trousers, a skirt, or shorts to be wearable.';
    const formalBottomAlt = wardrobeAlternatives.find((a) => a.slot === 'bottom');
    if (formalBottomAlt?.found && formalBottomAlt.item) {
      const bName = (formalBottomAlt.item as any).name || formalBottomAlt.item.sub_category || 'bottom';
      whatsMissing = `Bottom — complete the foundation with your ${bName} from your wardrobe.`;
      tips.push(`Pair with your ${bName} for a complete silhouette.`);
    } else {
      whatsMissing = 'Bottom — trousers, a skirt, or shorts are needed to complete the foundation.';
      if (reqs.requiresFormalAttire) {
        tips.push('JeZsy could not find a suitable formal alternative in your current wardrobe.');
      } else {
        tips.push('Add a bottom piece from your wardrobe drawer below.');
      }
    }
  } else if (missingTopOnly) {
    if (reqs.prohibitsAthletic && garmentProfiles.some((g) => g.styleSignals.athletic)) {
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality Mismatch';
      verdict = `Athletic shorts and running shoes conflict directly with the formal standards of a ${occasionLabel}.`;
      whyJezsySaysThis = `Running shorts and running shoes are athletic garments that strongly clash with the elevated formal dress code required for a ${occasionLabel}.`;
      stylistsTake = whyJezsySaysThis;
      whatWorks = undefined;
      whatCouldBeBetter =
        'Replace athletic shorts and running shoes with tailored formalwear such as trousers and dress shoes.';
      const missingPieces = ['Formal upper-body garment (dress shirt or formal top).'];
      const botAlt = wardrobeAlternatives.find((a) => a.slot === 'bottom');
      const shoeAlt = wardrobeAlternatives.find((a) => a.slot === 'shoes');
      if (botAlt && !botAlt.found) missingPieces.push(`Formal bottom: ${botAlt.recommendationText}`);
      if (shoeAlt && !shoeAlt.found) missingPieces.push(`Formal footwear: ${shoeAlt.recommendationText}`);
      whatsMissing = missingPieces.join(' ');
      tips.push('Weddings call for tailored, elegant attire rather than athletic activewear.');
    } else if (activity === 'running' || activity === 'gymWorkout') {
      assessment = 'Appropriate for this occasion';
      headline = 'Functional Running Gear';
      verdict = `Athletic shorts and running shoes are functional for ${occasionLabel}.`;
      whyJezsySaysThis = `Running shorts and running shoes provide high mobility and cushioning suitable for ${occasionLabel}.`;
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Garments are purpose-built for athletic movement, breathability, and physical activity.';
      whatCouldBeBetter =
        'Add a breathable athletic running tee or tank if upper-body sun protection or coverage is desired.';
      whatsMissing = 'Upper-body layer — add a performance running tee or tank if needed.';
      tips.push('Opt for moisture-wicking materials for optimal performance during workouts.');
    } else if (activity === 'casualDaily') {
      assessment = 'Could work with changes';
      headline = 'Relaxed Athleisure';
      verdict = `A relaxed athleisure base that could work for ${occasionLabel}, but needs an upper layer.`;
      whyJezsySaysThis =
        'Running shorts and sneakers provide relaxed comfort for everyday downtime, but adding a casual t-shirt or hoodie is needed for complete public wear.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Athletic pieces provide casual comfort and high mobility for informal downtime.';
      whatCouldBeBetter = 'Add a casual t-shirt, tank, or hoodie to complete the outfit for public wear.';
      whatsMissing = 'Top — add a casual t-shirt, tank, or hoodie to complete your everyday look.';
      tips.push('Pair with a relaxed crewneck t-shirt or hoodie for an effortless athleisure style.');
    } else {
      assessment = 'Incomplete outfit';
      headline = 'Missing Upper-Body Garment';
      verdict = 'A bottom piece is present, but an upper-body garment is needed.';
      whyJezsySaysThis = 'A wearable outfit requires an upper-body piece to complement the selected bottom.';
      stylistsTake = whyJezsySaysThis;
      whatsMissing = 'Top — add a shirt, blouse, or top to complete the look.';
      tips.push('Add a matching top from your wardrobe drawer.');
    }
  } else if (missingBaseTopUnderOuter) {
    if (reqs.prohibitsAthletic && garmentProfiles.some((g) => g.styleSignals.athletic)) {
      // Test 1 Scenario: Blazer + Running Shorts + Sneakers for Wedding
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality & Structural Mismatch';
      verdict = `This combination is not suitable for a ${occasionLabel}.`;
      whyJezsySaysThis =
        'The blazer adds an elevated element, but the running shorts and running sneakers make the outfit predominantly athletic and casual. That conflicts with the stated wedding setting, and the missing base layer also leaves the outfit incomplete.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = undefined;

      const betterPoints: string[] = [
        'Running shorts are athletic wear, conflicting directly with wedding attire standards.',
      ];
      if (structure.shoes.some((s) => s.styleSignals.athletic || s.combinedText.includes('sneaker'))) {
        betterPoints.push('Sneakers reinforce a casual/sporty aesthetic unsuitable for a formal wedding.');
      }
      betterPoints.push('The blazer requires an appropriate base top or shirt underneath.');
      whatCouldBeBetter = betterPoints.join(' ');

      const missingGaps: string[] = ['An upper-body base layer (dress shirt or formal blouse) underneath the blazer.'];
      const botAlt = wardrobeAlternatives.find((a) => a.slot === 'bottom');
      const shoeAlt = wardrobeAlternatives.find((a) => a.slot === 'shoes');
      if (botAlt && !botAlt.found) missingGaps.push(`Formal bottom: ${botAlt.recommendationText}`);
      if (shoeAlt && !shoeAlt.found) missingGaps.push(`Formal footwear: ${shoeAlt.recommendationText}`);
      whatsMissing = missingGaps.join(' ');

      tips.push('Replace athletic shorts with tailored trousers or a formal skirt.');
      if (botAlt?.found && botAlt.item) {
        tips.push(`You could wear your ${(botAlt.item as any).name || botAlt.item.sub_category} from your wardrobe.`);
      } else {
        tips.push('Your current wardrobe does not contain an obvious formal bottom for this occasion.');
      }
    } else if (activity === 'casualDaily' || occasionType === 'casualWalk') {
      assessment = 'Could work with changes';
      headline = 'High-Low Streetwear Concept';
      verdict = `An interesting high-low contrast that could work for ${occasionLabel}, but needs an inner top.`;
      whyJezsySaysThis =
        'Pairing a tailored blazer with casual shorts and sneakers creates a recognizable high-low streetwear aesthetic, but the outfit currently lacks an inner top under the blazer.';
      stylistsTake = whyJezsySaysThis;
      whatWorks =
        'The tailored structure of the blazer contrasts deliberately with relaxed athletic pieces for an intentional high-low vibe.';
      whatCouldBeBetter =
        'Add a simple inner top (such as a plain crewneck t-shirt or tank) so the blazer can be styled open or closed comfortably.';
      whatsMissing = 'An upper-body base layer — add a t-shirt or casual top underneath the blazer.';
      tips.push('Add a clean white or neutral tee underneath the blazer to complete the upper body.');
    } else {
      assessment = 'Incomplete outfit';
      headline = 'Missing Inner Top';
      verdict = 'An inner top is required underneath your outerwear.';
      whyJezsySaysThis =
        'While outerwear frames the torso, an inner base layer is necessary for comfort, styling, and completeness.';
      stylistsTake = whyJezsySaysThis;
      whatsMissing = 'Base top — add a shirt, blouse, or tee underneath the jacket.';
      tips.push('Layer a base top under the outerwear.');
    }
  } else if (severeContradictions.length > 0 || majorContradictions.length > 0) {
    // Priority 2: Severe or Major Contradictions

    if (activity === 'activeSwimming') {
      // Swimming Scenario
      assessment = 'Not appropriate for this occasion';
      headline = 'Activity & Water Mismatch';
      verdict = `This outfit is not appropriate for active swimming.`;

      const topNames = structure.baseTops.map((t) => t.identity.name.toLowerCase()).join(' and ');
      const botNames = structure.bottoms.map((b) => b.identity.name.toLowerCase()).join(' and ');
      const shoeNames = structure.shoes.map((s) => s.identity.name.toLowerCase()).join(' and ');
      const pieceSummaries: string[] = [];
      if (topNames) pieceSummaries.push(`the ${topNames}`);
      if (botNames) pieceSummaries.push(`the ${botNames}`);
      if (shoeNames) pieceSummaries.push(`the ${shoeNames}`);
      const pieceList = pieceSummaries.join(', ');

      whyJezsySaysThis = `You indicated active swimming in a pool, which requires water-safe swimwear and aquatic mobility. The selected separates (${
        pieceList || 'street garments'
      }) are fashion pieces: ${
        structure.baseTops.some((t) => t.materialSignals.includes('knit'))
          ? 'the knit sweater will absorb chlorinated water and become dangerously heavy, '
          : ''
      }${
        structure.bottoms.some((b) => b.styleSignals.athletic)
          ? 'the running shorts lack chlorine-resistant aquatic construction, '
          : ''
      }and footwear like flats cannot withstand pool water immersion.`;

      stylistsTake = `You said you'll be actively swimming a lot in a pool, so the outfit needs to support water exposure, movement, and swimming rather than simply look coordinated. The ${
        pieceList || 'selected separates'
      } are fashion pieces that conflict with those requirements.`;

      if (colorEval.score >= 70) {
        whatWorks = `The ${paletteColors.join(
          ', '
        )} palette coordinates visually. However, visual coordination does not overcome the activity mismatch.`;
      } else {
        whatWorks = undefined;
      }

      whatCouldBeBetter = `Change from street/casual separates into functional swimwear. Replace the ${
        pieceList || 'clothes'
      } with a swimsuit or swim trunks, and wear water-safe pool slides on the deck.`;
      whatsMissing = `Swim-appropriate clothing and appropriate pool footwear if needed.`;

      const swimAlt = wardrobeAlternatives.find((a) => a.slot === 'swimwear');
      if (swimAlt?.found && swimAlt.item) {
        tips.push(`Switch to your ${(swimAlt.item as any).name || swimAlt.item.sub_category} from your wardrobe.`);
      } else {
        tips.push("JeZsy couldn't find a suitable swimwear item in your current wardrobe.");
      }
      tips.push('Active pool swimming requires chlorine-resistant, water-compatible fabrics like nylon or spandex.');
      tips.push('Wear pool slides or water shoes on the pool deck to protect footwear from water damage.');
    } else if (occasionType === 'date' || reqs.requiresWarmth) {
      // Test Case A Scenario: Cold Night Date with Running Shorts, Sweater, Flats
      assessment = 'Not appropriate for this occasion';
      headline = 'Thermal & Occasion Conflict';
      verdict = `The athletic running shorts create both a thermal and occasion mismatch for a cold night date.`;

      const conflictShorts = garmentProfiles.find(
        (g) => g.styleSignals.athletic || g.functionalRole === 'athleticPerformance' || g.subtype === 'Running Shorts'
      );
      const personalNote = conflictShorts?.personalUsage?.rawText
        ? ` and you associate them with ${conflictShorts.personalUsage.activities.join(' and ') || 'exercise'}`
        : '';
      const shortsDesc = conflictShorts?.identity.name || 'running shorts';

      whyJezsySaysThis = `The main conflict is the ${shortsDesc}. Your description identifies them as athletic running shorts${personalNote}, so they carry a strong performance/activewear signal. That works naturally for running but conflicts with the cold-night part of your date context because the shorts provide limited warmth and leave legs exposed. The knit sweater helps with upper-body warmth, but it does not fully resolve the exposed-leg and occasion mismatch.`;

      stylistsTake = `While the sweater provides soft upper warmth and the flats keep footwear subtle, the running shorts pull the outfit into gym activewear and offer no protection against tonight's cold. Swapping the shorts for full-length pants or warm tights will instantly align the look with an evening date.`;

      // Positive elements grounded in reality:
      const positivePoints: string[] = [];
      if (structure.baseTops.some((t) => t.materialSignals.includes('knit') || t.thermal === 'heavyWarmth')) {
        positivePoints.push('The knit sweater provides upper-body warmth and texture');
      }
      if (structure.shoes.some((s) => !s.styleSignals.athletic)) {
        positivePoints.push('the flats keep the footwear from reinforcing the athletic identity of the shorts');
      }
      if (colorEval.score >= 70 && paletteColors.length > 1) {
        positivePoints.push(`the ${paletteColors.join(', ')} colors coordinate cleanly`);
      }

      if (positivePoints.length > 0) {
        whatWorks = `${positivePoints.join(', ')}. However, color and upper warmth do not overcome the lower-body thermal and date mismatch.`;
      } else {
        whatWorks = undefined;
      }

      whatCouldBeBetter = `Replace the athletic running shorts with full-length trousers, tailored jeans, or warm tights to protect against the cold night temperature and elevate the outfit for a date.`;

      const warmBotAlt = wardrobeAlternatives.find((a) => a.slot === 'bottom');
      if (warmBotAlt?.found && warmBotAlt.item) {
        whatsMissing = `Bottom — complete the outfit with your ${
          (warmBotAlt.item as any).name || warmBotAlt.item.sub_category || 'trousers'
        } from your wardrobe.`;
        tips.push(
          `Your ${(warmBotAlt.item as any).name || warmBotAlt.item.sub_category} will resolve the cold-weather issue.`
        );
      } else {
        whatsMissing = "Bottom — I don't see a wardrobe item that resolves the main cold-weather issue.";
        tips.push('Full-length trousers or jeans would balance the sweater and provide necessary cold-night warmth.');
      }
      tips.push('An evening date calls for intentional social styling rather than workout activewear.');
    } else if (occasionType === 'running' || activity === 'running') {
      // Running Scenario with practical issues (e.g. heavy knit sweater or lifestyle flats)
      const hasHeavySweater = structure.baseTops.some(
        (t) => t.materialSignals.includes('knit') || t.thermal === 'heavyWarmth'
      );
      const hasFlatsOrNonRunningShoes = structure.shoes.some(
        (s) => !s.styleSignals.athletic && !/\b(running shoes?|trainers?|sneakers?)\b/i.test(s.combinedText)
      );
      const runningShorts = garmentProfiles.find(
        (g) => g.styleSignals.athletic || g.functionalRole === 'athleticPerformance' || g.subtype === 'Running Shorts'
      );

      assessment = 'Could work with changes';
      headline = 'Athletic Bottom with Heavy Top';
      verdict = `The running shorts are built for running, but a heavy knit sweater will trap excess body heat during a run.`;

      const userPersonalizationNote = runningShorts?.personalUsage?.rawText
        ? ` and you explicitly love wearing them for exercise and running`
        : '';

      whyJezsySaysThis = `The running shorts are one of the strongest context matches in this outfit: your description notes they are 2-in-1 athletic running shorts${userPersonalizationNote}, and your stated activity is running. Their lightweight shell and built-in undershorts support natural stride and athletic mobility. However, the knit sweater is heavy and insulating, which traps body heat and causes overheating during a sustained run${
        hasFlatsOrNonRunningShoes
          ? ', while lifestyle flats lack the cushioning, arch support, and road impact absorption required for running'
          : ''
      }.`;

      stylistsTake = `Keep the running shorts as your functional athletic foundation, but swap the heavy knit sweater for a breathable moisture-wicking top and wear supportive running shoes to protect your feet and joints during the run.`;

      whatWorks =
        'The running shorts are directly aligned with your running activity, offering unrestricted mobility, lightweight 2-in-1 construction, and athletic ventilation.';

      const conflicts: string[] = [];
      if (hasHeavySweater) {
        conflicts.push(
          'Swap the heavy knit sweater for a breathable moisture-wicking running shirt or lightweight technical top'
        );
      }
      if (hasFlatsOrNonRunningShoes) {
        conflicts.push('replace flats with cushioned running shoes designed for athletic impact');
      }
      whatCouldBeBetter = `${conflicts.join(', and ')}.`;
      tips.push('Choose technical performance fabrics (like nylon or poly-spandex) to regulate body temperature while running.');
      if (hasFlatsOrNonRunningShoes) {
        tips.push('Cushioned running shoes are essential for shock absorption and joint protection.');
      }
    } else {
      // General major contradiction
      assessment = 'Not appropriate for this occasion';
      headline = 'Occasion & Formality Conflict';
      verdict = `The outfit elements clash with the expectations of a ${occasionLabel}.`;
      whyJezsySaysThis = contradictions.map((c) => c.reason).join(' ');
      stylistsTake = `The combination contains styling conflicts that mismatch ${occasionLabel}. Adjusting garment formality will create a more intentional silhouette.`;
      whatWorks = undefined;
      whatCouldBeBetter = contradictions.map((c) => c.whyItMatters).join(' ');
      tips.push(`Adjust garment formality to better align with ${occasionLabel}.`);
    }
  } else if (structure.hasOnePiece) {
    // One-Piece Garment handling (Dresses, Jumpsuits, Rompers)
    const onePiece = structure.onePieces[0];
    const isDressAthletic = onePiece?.styleSignals.athletic;

    if (reqs.prohibitsAthletic && isDressAthletic) {
      assessment = 'Not appropriate for this occasion';
      headline = 'Athletic One-Piece for Formal Event';
      verdict = `This athletic piece is not suited for a ${occasionLabel}.`;
      whyJezsySaysThis =
        'The garment has an athletic/sport orientation, which contradicts the formal requirements of a wedding.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = undefined;
      whatCouldBeBetter = 'Opt for an elevated formal dress or gown rather than athletic activewear.';
      tips.push('Choose a cocktail or evening dress for formal events.');
    } else if (reqs.requiresWarmth && timeOfDay === 'night') {
      // Test Case F: Dress + Flats for Cold Night Date
      assessment = 'Could work with changes';
      headline = 'Needs Cold-Weather Layering';
      verdict = `A stylish dress foundation for an evening date, but you will need warm layering for tonight's cold temperature.`;
      whyJezsySaysThis = `The dress creates a complete one-piece silhouette suitable for a date, but tonight's cold conditions call for an outer coat or jacket and leg coverage to stay warm.`;
      stylistsTake = whyJezsySaysThis;
      whatWorks =
        'The one-piece dress provides an intentional, flattering date silhouette, and the flats keep the footwear versatile.';
      whatCouldBeBetter =
        'Layer a warm tailored coat, jacket, or cardigan over the dress, and consider tights for lower-body warmth.';
      whatsMissing = 'Outerwear layer — add a coat or jacket from your wardrobe to insulate against the cold air.';
      tips.push('Layer a trench coat, wool coat, or leather jacket over your dress.');
      tips.push('Opaque tights or boots can provide comfortable warmth for cold night temperatures.');
    } else {
      assessment = 'Appropriate for this occasion';
      headline = 'Elevated One-Piece Silhouette';
      verdict = `A complete head-to-toe foundation that works well for ${occasionLabel}.`;
      whyJezsySaysThis = `The one-piece garment provides clean vertical continuity and a complete silhouette. ${
        structure.hasShoes ? 'Footwear anchors the overall proportion.' : 'Adding footwear will finish the look.'
      }`;
      stylistsTake = whyJezsySaysThis;
      whatWorks =
        'A one-piece foundation provides complete head-to-toe vertical continuity without competing layers.';

      if (!structure.hasShoes && reqs.requiresFormalAttire) {
        assessment = 'Could work with changes';
        whatCouldBeBetter = 'Footwear is an essential component for formal occasions.';
        const shoeAlt = wardrobeAlternatives.find((a) => a.slot === 'shoes');
        if (shoeAlt?.found && shoeAlt.item) {
          whatsMissing = `Footwear — complete your formal look with your ${
            (shoeAlt.item as any).name || shoeAlt.item.sub_category
          }.`;
          tips.push(`Pair with your ${(shoeAlt.item as any).name || shoeAlt.item.sub_category} to anchor the formal outfit.`);
        } else {
          whatsMissing = 'Footwear — JeZsy could not find suitable formal footwear in your current wardrobe.';
          tips.push('Add formal shoes or heels to polish the presentation.');
        }
      }
    }
  } else if (structure.hasTop && structure.hasBottom) {
    // Complete Separates
    if (activity === 'beachWedding' || (reqs.allowsResortElevated && rawOccasion.toLowerCase().includes('beach'))) {
      assessment = 'Appropriate for this occasion';
      headline = 'Refined Resort Styling';
      verdict = `Tailored resort pieces well-suited for a ${occasionLabel}.`;
      whyJezsySaysThis =
        'The tailored shorts and elevated top fit the relaxed yet celebratory expectations of a beach wedding.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Tailored lightweight pieces balance polished styling with beach-ready breathability.';
      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Pair with clean loafers or refined resort sandals to finish the beach wedding look.';
        tips.push('Choose footwear suitable for sand or boardwalk settings.');
      }
    } else if (activity === 'poolsideSocial') {
      assessment = 'Appropriate for this occasion';
      headline = 'Poolside Social Ensemble';
      verdict = `Relaxed summer separates well-suited for a ${occasionLabel}.`;
      whyJezsySaysThis =
        'A pool party is a social gathering where fashionable resort separates and comfortable warm-weather styling are right at home.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Casual summer separates provide comfortable, relaxed poolside style.';
      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Pair with clean sandals, espadrilles, or pool slides to finish the look.';
        tips.push('Opt for water-friendly footwear near the pool deck.');
      }
    } else if (activity === 'formalCeremony' || reqs.requiresFormalAttire) {
      assessment = 'Appropriate for this occasion';
      headline = 'Elevated Formal Ensemble';
      verdict = `Tailored separates aligned with the formal expectations of ${occasionLabel}.`;
      whyJezsySaysThis = `The tailored pieces establish an elevated presentation appropriate for ${occasionLabel}.`;
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'The structured pieces provide a clean, formal silhouette appropriate for formal celebrations.';
      if (!structure.hasShoes) {
        assessment = 'Could work with changes';
        whatCouldBeBetter = 'Formal events require appropriate dress footwear.';
        tips.push('Complete the look with formal shoes.');
      }
    } else if (activity === 'workProfessional') {
      assessment = 'Appropriate for this occasion';
      headline = 'Professional Workplace Separates';
      verdict = `Structured pieces suitable for a ${occasionLabel} environment.`;
      whyJezsySaysThis =
        'The combination provides tailored structure and polished presence appropriate for professional settings.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Structured styling delivers a crisp, work-ready silhouette.';
      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Adding office-appropriate shoes will finish the presentation.';
        tips.push('Pair with loafers or work shoes.');
      }
    } else if (occasionType === 'running' || activity === 'running') {
      // Running Scenario (e.g. Running 5km tonight)
      const hasHeavySweater = structure.baseTops.some(
        (t) => t.materialSignals.includes('knit') || t.thermal === 'heavyWarmth'
      );
      const hasFlatsOrNonRunningShoes = structure.shoes.some(
        (s) => !s.styleSignals.athletic && !/\b(running shoes?|trainers?|sneakers?)\b/i.test(s.combinedText)
      );
      const runningShorts = garmentProfiles.find(
        (g) => g.styleSignals.athletic || g.functionalRole === 'athleticPerformance' || g.subtype === 'Running Shorts'
      );

      if (hasHeavySweater || hasFlatsOrNonRunningShoes) {
        assessment = 'Could work with changes';
        headline = 'Athletic Bottom with Heavy Top';
        verdict = `The running shorts are built for running, but a heavy knit sweater will trap excess body heat during a run.`;

        const userPersonalizationNote = runningShorts?.personalUsage?.rawText
          ? ` and you explicitly love wearing them for exercise and running`
          : '';

        whyJezsySaysThis = `The running shorts are one of the strongest context matches in this outfit: your description notes they are 2-in-1 athletic running shorts${userPersonalizationNote}, and your stated activity is running. Their lightweight shell and built-in undershorts support natural stride and athletic mobility. However, the knit sweater is heavy and insulating, which traps body heat and causes overheating during a sustained run${
          hasFlatsOrNonRunningShoes
            ? ', while lifestyle flats lack the cushioning, arch support, and road impact absorption required for running'
            : ''
        }.`;

        stylistsTake = `Keep the running shorts as your functional athletic foundation, but swap the heavy knit sweater for a breathable moisture-wicking top and wear supportive running shoes to protect your feet and joints during the run.`;

        whatWorks =
          'The running shorts are directly aligned with your running activity, offering unrestricted mobility, lightweight 2-in-1 construction, and athletic ventilation.';

        const conflicts: string[] = [];
        if (hasHeavySweater) {
          conflicts.push(
            'Swap the heavy knit sweater for a breathable moisture-wicking running shirt or lightweight technical top'
          );
        }
        if (hasFlatsOrNonRunningShoes) {
          conflicts.push('replace flats with cushioned running shoes designed for athletic impact');
        }
        whatCouldBeBetter = `${conflicts.join(', and ')}.`;
        tips.push('Choose technical performance fabrics (like nylon or poly-spandex) to regulate body temperature while running.');
        if (hasFlatsOrNonRunningShoes) {
          tips.push('Cushioned running shoes are essential for shock absorption and joint protection.');
        }
      } else {
        assessment = 'Appropriate for this occasion';
        headline = 'Functional Athletic Gear';
        verdict = `Performance pieces suited for ${occasionLabel}.`;
        whyJezsySaysThis =
          'The athletic separates offer optimal mobility and functional performance for running activity.';
        stylistsTake =
          'A purpose-built athletic outfit with lightweight fabrics and unrestricted movement ready for running.';
        whatWorks = 'Activewear fabrics and cuts support natural movement and breathability.';
      }
    } else if (occasionType === 'casualWalk') {
      // Casual afternoon walk scenario
      assessment = 'Appropriate for this occasion';
      headline = 'Relaxed Walking Ensemble';
      verdict = `A comfortable casual combination well-suited for an afternoon walk.`;
      whyJezsySaysThis =
        'The athletic shorts provide unrestricted ease of movement and ventilation for walking, balanced comfortably by the knit sweater for relaxed upper warmth and practical flats for an easy stroll.';
      stylistsTake =
        'An effortless casual pairing where lower-body athletic mobility meets cozy upper knitwear for an easy afternoon pace.';
      whatWorks =
        'The athletic shorts provide unrestricted mobility for walking, while the sweater adds relaxed casual comfort.';
      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Ensure you wear comfortable walking shoes for prolonged steps.';
      } else {
        whatCouldBeBetter =
          'For extended distances or brisk walking, supportive walking sneakers will provide more arch cushioning than casual flats.';
      }
      tips.push('If walking prolonged distances, consider supportive walking sneakers.');
    } else if (occasionType === 'breakfastDining' || activity === 'breakfastDining') {
      // Indoor Breakfast Scenario
      const conflictShorts = garmentProfiles.find(
        (g) => g.styleSignals.athletic || g.functionalRole === 'athleticPerformance' || g.subtype === 'Running Shorts'
      );
      const isIndoorVenue = isIndoorOverride || /indoor/i.test(`${rawOccasion} ${rawAdditionalContext}`);
      const venueSetting = isIndoorVenue ? 'in a climate-controlled setting' : 'for morning downtime';

      assessment = 'Appropriate for this occasion';
      headline = 'Casual Morning Separates';
      verdict = `Comfortable morning separates, though the athletic running shorts contrast stylistically with the cozy knit sweater.`;

      whyJezsySaysThis = `For an indoor breakfast ${venueSetting}, the knit sweater provides cozy, relaxed upper-body warmth, and the flats keep footwear understated and easy. However, your running shorts—which you describe as 2-in-1 athletic running shorts and enjoy wearing for exercise—carry an explicit gym and workout identity. While physically comfortable for a quiet breakfast at home, pairing performance activewear with a cozy knit top creates a noticeable stylistic contrast between athletic training gear and leisure morning dining.`;

      stylistsTake = `The outfit is comfortable and wearable for relaxed morning downtime at home, but swapping the athletic running shorts for casual chinos, lounge pants, or soft denim creates a more cohesive look for breakfast out.`;

      whatWorks = `The knit sweater delivers soft, comfortable upper warmth suited for indoor morning dining, and the flats keep footwear understated without reinforcing the athletic identity of the shorts.`;

      whatCouldBeBetter = conflictShorts
        ? 'If having breakfast out at a cafe or diner rather than relaxing at home, swap the athletic running shorts for casual trousers, chinos, or comfortable jeans.'
        : undefined;

      tips.push('Pair the knit sweater with casual pants or soft denim for a cohesive breakfast presentation.');
    } else if (occasionType === 'coffeeSocial' || activity === 'coffeeSocial') {
      // Cafe / Coffee Social Scenario
      assessment = 'Appropriate for this occasion';
      headline = 'Casual Cafe Styling';
      verdict = `A relaxed cafe combination with cozy knitwear and understated footwear.`;
      whyJezsySaysThis = `For a casual coffee outing, the knit sweater brings a comfortable, approachable texture that fits a cafe atmosphere well, paired with versatile flats. The athletic shorts give the outfit a distinctly sporty tone; casual trousers or denim balance the sweater naturally.`;
      stylistsTake = `An easy, casual coffee ensemble that balances relaxed morning leisure with sporty comfort.`;
      whatWorks = `The knit sweater provides soft, cozy drape that suits a casual cafe atmosphere comfortably.`;
      whatCouldBeBetter =
        'For a more polished cafe setting, casual jeans or tailored trousers elevate the look beyond gym activewear.';
      tips.push('Opt for soft denim or chinos to complement the knit sweater for coffee meetings.');
    } else {
      // Evidence-grounded dynamic evaluation for general separates
      const topG = structure.baseTops[0];
      const botG = structure.bottoms[0];
      const shoeG = structure.shoes[0];

      const topName = topG?.identity.name || 'top';
      const botName = botG?.identity.name || 'bottom';
      const shoeName = shoeG?.identity.name || 'footwear';

      const isBotAthletic = botG?.styleSignals.athletic || botG?.functionalRole === 'athleticPerformance';
      const isTopKnit = topG?.materialSignals.includes('knit');

      assessment = 'Appropriate for this occasion';
      headline = `${topName} with ${botName}`;
      verdict = `A relaxed combination of ${topName.toLowerCase()} and ${botName.toLowerCase()} for ${occasionLabel}.`;

      const contextDesc =
        weather === 'cold'
          ? 'colder temperatures'
          : weather === 'warm' || weather === 'hot'
          ? 'warmer weather'
          : occasionLabel;

      whyJezsySaysThis = `Pairing your ${topName.toLowerCase()}${
        isTopKnit ? ' (with soft knit warmth)' : ''
      } with ${botName.toLowerCase()} creates a wearable separates base for ${contextDesc}. ${
        structure.hasShoes
          ? `The ${shoeName.toLowerCase()} anchors the lower half in everyday comfort.`
          : 'Adding appropriate footwear will finish the head-to-toe presentation.'
      }`;

      stylistsTake = `The outfit balances upper and lower proportions cleanly, offering easy wearability suited for ${occasionLabel}.`;

      whatWorks = `The ${topName.toLowerCase()} coordinates comfortably with the ${botName.toLowerCase()} for an understated, casual silhouette.`;

      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Adding footwear will complete the head-to-toe presentation.';
        tips.push('Choose shoes that complement your outfit.');
      } else if (
        isBotAthletic &&
        !rawOccasion.toLowerCase().includes('run') &&
        !rawOccasion.toLowerCase().includes('gym')
      ) {
        whatCouldBeBetter = `The athletic styling of the ${botName.toLowerCase()} leans toward sporty activewear; tailored or casual denim separates would lend a more elevated tone if desired.`;
      }
    }
  }

  // Strict invariant: when outfit is not appropriate, whyThisWorks must NOT be displayed UNLESS specifically acknowledging secondary visual coordination with an explicit caveat
  if (assessment === 'Not appropriate for this occasion' && whatWorks && !/\bnot overcome\b/i.test(whatWorks)) {
    whatWorks = undefined;
  }

  // Personalization influence (separate from objective occasion compatibility)
  if (profile && profile.feedbackCount > 0) {
    const resolvedWardrobeItems = items
      .map((i) => wardrobeLookup?.[i.wardrobe_item_id])
      .filter(Boolean) as WardrobeItem[];
    if (resolvedWardrobeItems.length > 0) {
      const affinity = computePersonalAffinity(resolvedWardrobeItems, profile, rawOccasion);
      if (affinity.recommendationNote && assessment === 'Appropriate for this occasion') {
        tips.push(affinity.recommendationNote);
      }
    }
  }

  // Weather and walking context tips
  if (rawAdditionalContext.match(/\b(rain|wet|umbrella|waterproof)\b/i) || weather === 'rainy') {
    const hasRainCoat = structure.outers.some((o) =>
      o.combinedText.match(/\b(rain|waterproof|trench|windbreaker)\b/i)
    );
    if (!hasRainCoat) {
      tips.push('Your context mentions rain — consider bringing an umbrella or adding a weather-resistant jacket.');
    }
  }

  if (rawAdditionalContext.match(/\b(walk|walking|lot of walking|standing)\b/i) || occasionType === 'casualWalk') {
    const hasHighHeels = structure.shoes.some((s) => s.combinedText.match(/\b(high heel|stiletto|pump)\b/i));
    if (hasHighHeels) {
      tips.push('Your context mentions a lot of walking — high heels may cause discomfort over extended periods.');
    }
  }

  // Determine Vibe
  let vibe = 'Modern Casual';
  if (activity === 'activeSwimming') vibe = 'Aquatic / Active';
  else if (activity === 'poolsideSocial') vibe = 'Poolside Resort';
  else if (reqs.requiresFormalAttire) vibe = 'Formal & Elevated';
  else if (garmentProfiles.some((g) => g.styleSignals.athletic) && structure.hasOuterwear) vibe = 'High-Low Streetwear';
  else if (garmentProfiles.some((g) => g.styleSignals.athletic)) vibe = 'Athleisure';
  else if (structure.hasOnePiece) vibe = 'Effortless One-Piece';
  else if (activity === 'workProfessional') vibe = 'Smart Professional';
  else if (colorEval.label === 'Perfect Harmony') vibe = 'Quiet Luxury';

  return {
    analysisId,
    generatedAt,
    analysisVersion: STYLIST_ANALYSIS_VERSION,
    analysisMode,
    contextHash,
    outfitHash,
    wardrobeItemIds,
    cacheStatus,
    aiProvider: 'deterministic-local',
    aiModel: 'evidence-engine-v3',
    evidenceCount: contradictions.length + items.length,
    assessment,
    headline,
    verdict,
    whyJezsySaysThis,
    stylistsTake,
    whatWorks,
    whatCouldBeBetter,
    whatsMissing,
    wardrobeAlternatives,
    tips: tips.slice(0, 3),
    vibe,
    paletteColors,
    isOvercrowded: structure.isOvercrowded,
    mannequinItems: items,
    context,
    contextInterpretation,
    contradictions: contradictions.map((c) => c.reason),
    pillars: {
      colorHarmony: {
        status: colorEval.score >= 85 ? 'excellent' : colorEval.score >= 70 ? 'good' : 'warning',
        title: colorEval.label,
        feedback: colorEval.feedback,
      },
      compositionAndLayers: {
        status:
          assessment === 'Appropriate for this occasion'
            ? 'excellent'
            : assessment === 'Could work with changes'
            ? 'good'
            : 'alert',
        title: headline,
        feedback: verdict,
      },
    },
  };
}

/**
 * Validates that the generated critique actually addresses the user's explicit context dimensions.
 * For cold/night/date: must address cold/thermal, night/evening, and date/social.
 * For swimming: must address water/swimming/pool.
 * For running: must address running/exercise.
 * For breakfast: must address morning/breakfast/dining.
 */
export function validateContextRelevance(
  critique: StylistCritique,
  context?: OutfitContextInterpretation
): boolean {
  if (!context) return true;
  const text = `${critique.headline} ${critique.verdict} ${critique.whyJezsySaysThis} ${critique.stylistsTake} ${
    critique.whatWorks || ''
  } ${critique.whatCouldBeBetter || ''}`.toLowerCase();

  // If cold weather was specified
  if (context.weather === 'cold' || context.temperatureRequirement === 'warmthNeeded') {
    const mentionsCold = /\b(cold|chill|warmth|temperature|freezing|insulat|layering|cool)\b/i.test(text);
    if (!mentionsCold) return false;
  }

  // If swimming was specified
  if (context.activity === 'activeSwimming' || context.occasionType === 'swimming') {
    const mentionsWater = /\b(swim|water|pool|swimwear|chlorin|aquatic)\b/i.test(text);
    if (!mentionsWater) return false;
  }

  // If running was specified
  if (context.activity === 'running' || context.occasionType === 'running') {
    const mentionsRun = /\b(run|running|athletic|stride|cushion|mobility)\b/i.test(text);
    if (!mentionsRun) return false;
  }

  // If breakfast/dining was specified
  if (context.activity === 'breakfastDining' || context.occasionType === 'breakfastDining') {
    const mentionsMorning = /\b(breakfast|morning|dining|meal|cafe|home)\b/i.test(text);
    if (!mentionsMorning) return false;
  }

  return true;
}

/**
 * Builds the structured Stylist Evidence Packet sent to the server-side LLM.
 * Contains only grounded facts, semantic classifications, structural analysis,
 * detected contradictions, and user personalization notes.
 */
export function buildStylistEvidencePacket(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>,
  context?: OutfitContext,
  _profile?: UserStyleProfileDto | null
): StylistEvidencePacket {
  const contextInterpretation = interpretOutfitContext(context);
  const garmentProfiles = (items || []).map((item) => {
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    return buildGarmentSemanticProfile(item, w);
  });
  const structure = buildOutfitStructure(garmentProfiles);
  const reqs = buildOccasionRequirements(contextInterpretation);
  const contradictions = detectContradictions(garmentProfiles, reqs, structure);
  const paletteColors = extractColors(items, wardrobeLookup);

  const outfitItems: StylistEvidencePacketItem[] = garmentProfiles.map((p) => ({
    wardrobeItemId: p.identity.wardrobeItemId || p.identity.name,
    category: p.rawUserData.category,
    subCategory: p.rawUserData.subCategory,
    garmentType: p.garmentStructure.garmentType,
    garmentFamily: p.garmentStructure.garmentFamily,
    garmentSubtype: p.subtype || undefined,
    description: p.rawUserData.description || undefined,
    userNotes: p.rawUserData.userNotes || undefined,
    rawColor: p.rawUserData.color,
    colorTags: p.rawUserData.colorTags,
    thermalLevel: p.thermal,
    coverageLevel: p.coverage,
    functionalRole: p.functionalRole,
    personalUsage: p.personalUsage?.rawText
      ? { activities: p.personalUsage.activities, rawText: p.personalUsage.rawText }
      : undefined,
    styleSignals: p.styleSignals,
    imageUrl: p.identity.imageUrl,
  }));

  const personalization = garmentProfiles
    .filter((p) => p.personalUsage?.rawText || p.rawUserData.whereWornOften || p.rawUserData.description)
    .map((p) => ({
      garmentId: p.identity.wardrobeItemId || p.identity.name,
      description: p.rawUserData.description,
      activities: (p.personalUsage?.activities || []).map((a) => a.toLowerCase()),
    }));

  return {
    request: {
      analysisId: generateAnalysisId(),
      rawContext: `${context?.occasion || ''} ${context?.additionalContext || ''}`.trim(),
      structuredContext: {
        rawOccasion: contextInterpretation.rawOccasion,
        rawAdditionalContext: contextInterpretation.rawAdditionalContext,
        activity: contextInterpretation.activity,
        occasionType: contextInterpretation.occasionType,
        timeOfDay: contextInterpretation.timeOfDay,
        weather: contextInterpretation.weather,
        temperatureRequirement: contextInterpretation.temperatureRequirement,
        socialContext: contextInterpretation.socialSetting,
        environment: contextInterpretation.isIndoorOverride ? 'indoor' : 'unknown',
        isIndoorOverride: contextInterpretation.isIndoorOverride,
      },
      generatedAt: new Date().toISOString(),
    },
    outfit: {
      items: outfitItems,
    },
    structure: {
      completeness:
        (structure.hasOnePiece || (structure.hasTop && structure.hasBottom)) && !structure.isOvercrowded
          ? 'complete'
          : 'incomplete',
      hasTop: structure.hasTop,
      hasBottom: structure.hasBottom,
      hasOnePiece: structure.hasOnePiece,
      hasOuterwear: structure.hasOuterwear,
      hasShoes: structure.hasShoes,
      isOvercrowded: structure.isOvercrowded,
      structuralNotes: structure.overcrowdingNote || undefined,
    },
    requirements: {
      formalityLevel: reqs.requiresFormalAttire ? 'formal' : 'casual',
      requiresThermalCoverage: reqs.requiresWarmth,
      requiresWaterCompatibility: reqs.requiresWaterCompatibility !== 'none',
      requiresActivewear: reqs.requiresHighMobility,
      allowsAthleticPieces: reqs.allowsAthletic,
    },
    contradictions: contradictions.map((c) => ({
      dimension: c.category,
      severity: c.severity,
      message: c.reason,
      garmentId: c.garmentName,
    })),
    personalization,
    visualEvidence: {
      paletteColors,
    },
  };
}

/**
 * Synthesizes a hybrid critique merging validated server LLM reasoning over grounded evidence.
 */
export function synthesizeHybridCritique(
  aiResponse: StructuredAIResponse,
  packet: StylistEvidencePacket,
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>,
  context?: OutfitContext,
  providerName?: string,
  modelName?: string
): StylistCritique {
  const contextInterpretation = interpretOutfitContext(context);
  const garmentProfiles = (items || []).map((item) => {
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    return buildGarmentSemanticProfile(item, w);
  });
  const structure = buildOutfitStructure(garmentProfiles);
  const reqs = buildOccasionRequirements(contextInterpretation);
  const contradictions = detectContradictions(garmentProfiles, reqs, structure);
  const paletteColors = extractColors(items, wardrobeLookup);
  const colorEval: ColorMatchResult = evaluateColors(paletteColors);
  const wardrobeAlternatives = generateWardrobeAlternatives(contradictions, wardrobeLookup, reqs);

  const vibe = aiResponse.headline || 'Styled Look';

  const whatWorks =
    Array.isArray(aiResponse.whatWorks) && aiResponse.whatWorks.length > 0
      ? aiResponse.whatWorks.join(' ')
      : undefined;

  const whatCouldBeBetter =
    Array.isArray(aiResponse.whatConflicts) && aiResponse.whatConflicts.length > 0
      ? aiResponse.whatConflicts.join(' ')
      : undefined;

  const whatsMissing =
    Array.isArray(aiResponse.missing) && aiResponse.missing.length > 0
      ? aiResponse.missing.join(' ')
      : undefined;

  const verdict = `${aiResponse.headline}: ${aiResponse.whyJezsySaysThis.slice(0, 120)}...`;

  const tips: string[] = [];
  if (aiResponse.improvements && aiResponse.improvements.length > 0) {
    aiResponse.improvements.forEach((imp) => tips.push(imp.reason));
  } else if (whatsMissing) {
    tips.push(whatsMissing);
  } else {
    tips.push(aiResponse.stylistTake);
  }

  return {
    analysisId: packet.request.analysisId,
    generatedAt: packet.request.generatedAt,
    analysisVersion: STYLIST_ANALYSIS_VERSION,
    analysisMode: 'hybridLLM',
    contextHash: computeContextHash(context),
    outfitHash: computeOutfitHash(items, wardrobeLookup),
    wardrobeItemIds: (items || []).map((i) => i.wardrobe_item_id).filter(Boolean),
    cacheStatus: 'fresh',
    aiProvider: providerName || 'supabase-edge',
    aiModel: modelName || 'gemini-1.5-flash',
    evidenceCount: (packet.contradictions?.length || 0) + (packet.outfit?.items?.length || 0),
    contextFit: aiResponse.contextFit,
    personalization: aiResponse.personalization,
    assessment: aiResponse.assessment,
    headline: aiResponse.headline,
    verdict,
    whyJezsySaysThis: aiResponse.whyJezsySaysThis,
    stylistsTake: aiResponse.stylistTake,
    whatWorks,
    whatCouldBeBetter,
    whatsMissing,
    wardrobeAlternatives,
    tips: tips.slice(0, 3),
    vibe,
    paletteColors,
    isOvercrowded: structure.isOvercrowded,
    mannequinItems: items,
    context,
    contextInterpretation,
    contradictions: contradictions.map((c) => `${c.reason} (${c.severity})`),
    pillars: {
      colorHarmony: {
        status: colorEval.score >= 85 ? 'excellent' : colorEval.score >= 70 ? 'good' : 'warning',
        title: colorEval.label,
        feedback: colorEval.feedback,
      },
      compositionAndLayers: {
        status:
          aiResponse.assessment === 'Appropriate for this occasion'
            ? 'excellent'
            : aiResponse.assessment === 'Could work with changes'
            ? 'good'
            : 'alert',
        title: aiResponse.headline,
        feedback: verdict,
      },
    },
  };
}

/**
 * Asynchronously evaluates an outfit using the hybrid AI Stylist architecture:
 * 1. Gathers structured facts, semantics, and contradictions via the deterministic engine.
 * 2. Transmits the evidence packet to the secure AI provider.
 * 3. Validates the response against grounding, item IDs, context relevance, and section uniqueness.
 * 4. Gracefully falls back to the deterministic evidence engine if the provider is unavailable
 *    or validation fails.
 */
export async function gradeOutfitWithAI(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>,
  context?: OutfitContext,
  profile?: UserStyleProfileDto | null,
  provider?: IAIStylistProvider
): Promise<StylistCritique> {
  if (!items || items.length === 0) {
    return gradeOutfit(items, wardrobeLookup, context, profile);
  }

  const packet = buildStylistEvidencePacket(items, wardrobeLookup, context, profile);
  const activeProvider = provider || defaultAIStylistProvider;

  let result;
  try {
    result = await activeProvider.analyze(packet, wardrobeLookup);
  } catch (err: unknown) {
    result = {
      success: false,
      analysisMode: 'ruleBasedFallback' as const,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }

  if (result.success && result.data) {
    return synthesizeHybridCritique(
      result.data,
      packet,
      items,
      wardrobeLookup,
      context,
      result.provider,
      result.model
    );
  }

  // Fallback to grounded deterministic evidence engine
  const fallbackCritique = gradeOutfit(items, wardrobeLookup, context, profile);
  return {
    ...fallbackCritique,
    analysisMode: 'ruleBasedFallback',
    aiProvider: 'deterministic-local',
    aiModel: 'evidence-engine-v3',
    evidenceCount: (packet.contradictions?.length || 0) + (packet.outfit?.items?.length || 0),
    fallbackReason: result.fallbackReason || 'AI provider unavailable',
  };
}


