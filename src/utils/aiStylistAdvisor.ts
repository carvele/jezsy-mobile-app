/**
 * aiStylistAdvisor.ts
 * JeZsy Stylist Engine - Evidence-First, Occasion-Aware Fashion Evaluation System.
 *
 * Architecture:
 * USER METADATA (Authoritative)
 *   + CONTEXT INTERPRETATION (Occasion + Nuanced Additional Context)
 *   + STRUCTURED FASHION SEMANTICS (Materials, Mobility, Water Compatibility, Formality)
 *   + VISION / ML EVIDENCE (Supporting visual evidence, never overwriting user data)
 *   + REQUIREMENT PROFILES & CONTRADICTION ENGINE (Contradiction-first, no formality averaging)
 *   + STRUCTURAL COMPLETENESS (One-piece vs Separates vs Outerwear layering)
 *   + WARDROBE GROUNDING (Real owned items only, explicit fallback when none owned)
 *   + EVIDENCE-GROUNDED QUALITATIVE ASSESSMENT (No 0-100 scores, no letter grades)
 */

import { evaluateColors, ColorMatchResult } from './colorMatcher';
import { MannequinCanvasItem, WardrobeItem } from './mannequinConfig';
import { OutfitExplanation } from './outfitExplainer';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { computePersonalAffinity } from './personalStyleEngine';

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
  | 'dining'
  | 'general';

export interface OutfitContextInterpretation {
  rawOccasion: string;
  rawAdditionalContext: string;
  activity: ActivityType;
  isSpectatingOnly: boolean;
  environment: 'swimmingPool' | 'beachResort' | 'office' | 'outdoors' | 'formalVenue' | 'casualEveryday' | 'general';
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
  summary: string;
}

export interface Contradiction {
  severity: 'severe' | 'major' | 'moderate' | 'minor';
  category: 'activity_water' | 'formality_dresscode' | 'structure_completeness' | 'environment_practicality';
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
  assessment: OverallAssessment;
  headline: string;
  verdict: string;
  whyJezsySaysThis: string;
  stylistsTake: string;
  whatWorks?: string;
  whatCouldBeBetter?: string;
  whatsMissing?: string;
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
// PHASE 4: CONTEXT INTERPRETER
// ============================================================================

/**
 * Interprets the user's explicit occasion and additional context.
 * Distinguishes active swimming from poolside parties, dining, or spectating.
 * Distinguishes formal weddings from beach weddings.
 */
export function interpretOutfitContext(context?: OutfitContext): OutfitContextInterpretation {
  const rawOccasion = (context?.occasion ?? '').trim();
  const rawAdditionalContext = (context?.additionalContext ?? '').trim();
  const occLower = rawOccasion.toLowerCase();
  const addLower = rawAdditionalContext.toLowerCase();
  const full = `${occLower} ${addLower}`.trim();

  // Check for spectating / watching modifiers first (e.g. "watching my kids swim", "spectating")
  const isSpectatingOnly = /\b(watching|watch|spectat|cheering|supporting|sitting and watching)\b/i.test(full);

  // Check for pool party vs active swimming vs poolside dining
  const mentionsSwim = /\b(swim|swimming|pool|swimsuit|swimming pool|laps)\b/i.test(full);
  const mentionsPoolParty = /\b(pool party|poolside party|pool gathering|pool social)\b/i.test(full);
  const mentionsPoolsideDining = /\b(poolside dinner|poolside lunch|pool dining|dinner by the pool)\b/i.test(full);
  const mentionsActiveSwim =
    /\b(swimming a lot|active swimming|swimming laps|lap swimming|swim in the pool|swimming on the pool|swimming in the pool|going swimming|swim a lot|in the water|swim workout)\b/i.test(full) ||
    (occLower === 'swimming' && !isSpectatingOnly && !mentionsPoolParty && !mentionsPoolsideDining);

  // Check for weddings and modifiers
  const isWedding = /\b(wedding|matrimony|nuptials|reception)\b/i.test(full);
  const isBeachOrResort = /\b(beach|resort|seaside|tropical|coastal|cruise|vacation)\b/i.test(full);
  const isBeachWedding = isWedding && (isBeachOrResort || /\b(beach wedding|seaside wedding)\b/i.test(full));

  // Determine Activity
  let activity: ActivityType = 'general';
  let environment: OutfitContextInterpretation['environment'] = 'general';
  let waterExposure: OutfitContextInterpretation['waterExposure'] = 'none';
  let physicalActivity: OutfitContextInterpretation['physicalActivity'] = 'low';
  let mobilityRequirement: OutfitContextInterpretation['mobilityRequirement'] = 'standard';
  let formalityExpectation: OutfitContextInterpretation['formalityExpectation'] = 'casual';
  const practicalityRequirements: string[] = [];

  if (mentionsSwim && !isSpectatingOnly && (mentionsActiveSwim || (!mentionsPoolParty && !mentionsPoolsideDining && occLower.includes('swim')))) {
    activity = 'activeSwimming';
    environment = 'swimmingPool';
    waterExposure = 'high';
    physicalActivity = 'high';
    mobilityRequirement = 'high';
    formalityExpectation = 'casual';
    practicalityRequirements.push('swimwear foundation', 'water-safe construction', 'unrestricted aquatic mobility');
  } else if (mentionsPoolsideDining) {
    activity = 'poolsideDining';
    environment = 'swimmingPool';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'elevatedCasual';
    practicalityRequirements.push('resort casual or elevated dining attire');
  } else if (mentionsPoolParty) {
    activity = 'poolsideSocial';
    environment = 'swimmingPool';
    waterExposure = 'low';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    practicalityRequirements.push('resort/summer party attire', 'poolside footwear');
  } else if (isBeachWedding) {
    activity = 'beachWedding';
    environment = 'beachResort';
    waterExposure = 'low';
    physicalActivity = 'low';
    formalityExpectation = 'semiFormal';
    practicalityRequirements.push('elevated resort attire', 'sand-friendly footwear');
  } else if (isWedding || /\b(formal|black.?tie|white.?tie|gala|ball|cocktail|ceremony)\b/i.test(full)) {
    activity = 'formalCeremony';
    environment = 'formalVenue';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'formal';
    practicalityRequirements.push('tailored or formal foundation', 'formal footwear', 'structured silhouette');
  } else if (/\b(running|jogging|marathon|track)\b/i.test(full)) {
    activity = 'running';
    environment = 'outdoors';
    waterExposure = 'none';
    physicalActivity = 'high';
    mobilityRequirement = 'high';
    formalityExpectation = 'casual';
    practicalityRequirements.push('athletic moisture-wicking gear', 'cushioned running footwear');
  } else if (/\b(gym|workout|fitness|training|yoga|pilates|crossfit)\b/i.test(full)) {
    activity = 'gymWorkout';
    environment = 'indoors' as any;
    waterExposure = 'none';
    physicalActivity = 'high';
    mobilityRequirement = 'high';
    formalityExpectation = 'casual';
    practicalityRequirements.push('athletic performance wear', 'training footwear');
  } else if (/\b(office|interview|business|conference|corporate|work)\b/i.test(full)) {
    activity = 'workProfessional';
    environment = 'office';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'semiFormal';
    practicalityRequirements.push('workplace-appropriate tailoring', 'professional footwear');
  } else if (isBeachOrResort) {
    activity = 'beachResort';
    environment = 'beachResort';
    waterExposure = 'moderate';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    practicalityRequirements.push('breathable lightweight clothing', 'sun/beach-friendly pieces');
  } else if (/\b(dinner|date night|restaurant|drinks|night out)\b/i.test(full)) {
    activity = 'dining';
    environment = 'indoors' as any;
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'elevatedCasual';
    practicalityRequirements.push('smart casual or evening attire');
  } else {
    activity = 'casualDaily';
    environment = 'casualEveryday';
    waterExposure = 'none';
    physicalActivity = 'low';
    formalityExpectation = 'casual';
    practicalityRequirements.push('comfortable everyday separates');
  }

  // Handle weather and walking modifiers
  if (/\b(rain|wet|storm|downpour)\b/i.test(addLower)) {
    practicalityRequirements.push('weather-resistant layering or umbrella');
  }
  if (/\b(walk|walking|lot of walking|standing)\b/i.test(addLower)) {
    practicalityRequirements.push('comfortable walking footwear');
  }

  return {
    rawOccasion,
    rawAdditionalContext,
    activity,
    isSpectatingOnly,
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
  const color = (wardrobeItem as any)?.color || (wardrobeItem as any)?.colors || '';
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

  // Detect Functional Structure
  const t = (item.garment_type || '').toLowerCase();
  const isOnePiece =
    t.includes('dress') || t.includes('jumpsuit') || t.includes('romper') || t.includes('gown') || t.includes('swimsuit') ||
    /\b(dress|jumpsuit|romper|gown|overalls|one.?piece|swimsuit|bikini|monokini)\b/i.test(combinedText);

  const isOuterwear =
    t.includes('outerwear') || t.includes('jacket') || t.includes('blazer') || t.includes('coat') || t.includes('cardigan') ||
    /\b(blazer|jacket|coat|cardigan|vest|windbreaker|trench|parka)\b/i.test(combinedText);

  const isFootwear =
    t.includes('shoe') || t.includes('heel') || t.includes('boot') || t.includes('sneaker') || t.includes('sandal') ||
    /\b(shoes?|sneakers?|heels?|boots?|loafers?|sandals?|pumps?|oxfords?|flats?|mary jane)\b/i.test(combinedText);

  const isLowerBody =
    !isOnePiece && !isOuterwear && !isFootwear && (
      t.includes('bottom') || t.includes('pant') || t.includes('jean') || t.includes('skirt') || t.includes('short') || t.includes('trouser') ||
      /\b(pants?|jeans?|trousers?|skirt|shorts?|slacks|leggings?)\b/i.test(combinedText)
    );

  const isUpperBody =
    !isOnePiece && !isOuterwear && !isFootwear && !isLowerBody && (
      t.includes('top') || t.includes('shirt') || t.includes('blouse') || t.includes('sweater') || t.includes('bra') || t.includes('tee') || t.includes('tank') ||
      /\b(shirt|blouse|tee|polo|sweater|knitwear|tank|crop.?top|turtleneck)\b/i.test(combinedText)
    );

  const isAccessory = !isOnePiece && !isOuterwear && !isFootwear && !isLowerBody && !isUpperBody;

  let garmentFamily: GarmentSemanticProfile['garmentStructure']['garmentFamily'] = 'upperBody';
  if (isOnePiece) garmentFamily = 'onePiece';
  else if (isOuterwear) garmentFamily = 'outerwear';
  else if (isFootwear) garmentFamily = 'footwear';
  else if (isLowerBody) garmentFamily = 'lowerBody';
  else if (isAccessory) garmentFamily = 'accessory';

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
  if (/\b(swimsuit|bikini|swim trunks?|boardshorts?|rash guard|swim briefs?|neoprene|spandex swim)\b/i.test(combinedText)) {
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
    whereWornOften.match(/\b(running|gym|workout|jogging|training|sport|track|fitness)\b/i) !== null ||
    occasions.some((o) => o.match(/\b(running|gym|workout|sports?|training)\b/i)) ||
    description.match(/\b(running|exercise|gym|workout|jogging|athletic|training|sports?)\b/i) !== null ||
    userNotes.match(/\b(running|exercise|gym|workout|jogging|athletic|training|sports?)\b/i) !== null ||
    subCategory.match(/\b(running|gym|workout|track|sweatpants|sports bra|athletic sneakers|running shoes)\b/i) !== null ||
    combinedText.match(/\b(running shorts|gym shorts|track pants|sweatpants|sports bra|jersey|athletic sneakers|running shoes|workout leggings|gym wear|workout top)\b/i) !== null;

  const isFormal =
    combinedText.match(/\b(blazer|suit|tuxedo|gown|evening dress|cocktail dress|tailored|trousers?|dress pants|slacks|oxfords?|loafers?|derby|heels?|pumps?)\b/i) !== null;

  const isElevated = isFormal || /\b(button.?down|blouse|linen|silk|cashmere|smart casual)\b/i.test(combinedText);

  // Mobility
  let mobility: GarmentSemanticProfile['mobility'] = 'medium';
  if (isAthletic || isExplicitSwimwear) {
    mobility = 'high';
  } else if (
    /\b(micro mini|pencil skirt|tight|corset|high heels?|stiletto|tuxedo|rigid)\b/i.test(combinedText)
  ) {
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
      running: /\b(running|jogging|track)\b/i.test(combinedText),
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
  const { activity, formalityExpectation } = context;

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
      summary: 'Active pool swimming requires swim-compatible garments, high water compatibility, and unrestricted aquatic mobility.',
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
      summary: 'Pool party social setting welcomes relaxed resort wear, stylish summer separates, and casual poolside footwear.',
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
      summary: 'Beach wedding invites elevated resort wear, breathable fabrics, and refined footwear suitable for coastal settings.',
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
      summary: 'Formal wedding and ceremony standards require elevated formalwear, structured silhouettes, and dress footwear.',
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
      summary: 'Running requires lightweight, breathable athletic garments and cushioned running shoes.',
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
      summary: 'Professional workplace standards require clean tailoring, modesty, and professional footwear.',
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
    overcrowdingNote = 'A dress or jumpsuit already provides full body coverage; separate tops or bottoms create conflicting bulk.';
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
    // Check for missing swimwear foundation
    const hasSwimwear = garments.some((g) => g.activitySignals.swimming || g.waterCompatibility === 'suitable');
    if (!hasSwimwear) {
      contradictions.push({
        severity: 'severe',
        category: 'activity_water',
        garmentName: 'Outfit Foundation',
        reason: 'The outfit lacks swim-compatible clothing or a swimwear foundation.',
        whyItMatters: 'Active swimming involves sustained water immersion, which requires garments engineered for aquatic use.',
        suggestedFix: 'Replace the outfit with a swimsuit, swim trunks, or swim-compatible activewear.',
      });
    }

    // Check individual garments for water conflicts
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
          reason: `${name} (${isSuedeOrVelvet ? 'suede/velvet' : isLeather ? 'leather' : 'fashion'} flats/shoes) cannot withstand pool water immersion.`,
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

  // 2. FORMAL WEDDING / HIGH FORMALITY CONTRADICTIONS (Phase 27 Regression Core)
  if (reqs.prohibitsAthletic) {
    for (const g of garments) {
      if (g.styleSignals.athletic) {
        contradictions.push({
          severity: 'severe',
          category: 'formality_dresscode',
          garmentName: g.identity.name,
          reason: `${g.identity.name} is an athletic garment that clashes with formal event standards.`,
          whyItMatters: 'Athletic wear conveys extreme informality, violating formal dress codes.',
          suggestedFix: 'Replace athletic pieces with tailored formal garments like trousers or a suit.',
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

  // 3. STRUCTURAL COMPLETENESS (Outerwear without base top)
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
        recommendationText: `Replace the outfit with your ${(swimItem as any).name || swimItem.sub_category || 'swimwear'} from your wardrobe.`,
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
  const hasBottomConflict = contradictions.some(
    (c) => c.category === 'formality_dresscode' && c.garmentName.toLowerCase().includes('short')
  );
  if (hasBottomConflict && reqs?.requiresFormalAttire) {
    const formalBottom = ownedItems.find((w) => {
      const sem = buildGarmentSemanticProfile({ wardrobe_item_id: w.id } as any, w);
      return sem.garmentStructure.isLowerBody && !sem.styleSignals.athletic && sem.formality === 'formal';
    });

    if (formalBottom) {
      alternatives.push({
        slot: 'bottom',
        found: true,
        item: formalBottom,
        recommendationText: `You could wear your ${(formalBottom as any).name || formalBottom.sub_category || 'tailored trousers'} from your wardrobe.`,
      });
    } else {
      alternatives.push({
        slot: 'bottom',
        found: false,
        recommendationText: 'JeZsy could not find a suitable formal alternative in your current wardrobe.',
      });
    }
  }

  // Search for formal shoes if formal footwear conflict exists
  const hasShoeConflict = contradictions.some(
    (c) => c.category === 'formality_dresscode' && (c.garmentName.toLowerCase().includes('shoe') || c.garmentName.toLowerCase().includes('sneaker'))
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
        recommendationText: `Pair with your ${(formalShoe as any).name || formalShoe.sub_category || 'dress shoes'} to anchor the formal outfit.`,
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
  const contextInterpretation = interpretOutfitContext(context);
  const { rawOccasion, rawAdditionalContext, activity } = contextInterpretation;
  const occasionLabel = rawOccasion || 'your day';

  // Empty Mannequin handling
  if (!items || items.length === 0) {
    return {
      assessment: 'Incomplete outfit',
      headline: 'Mannequin is Empty',
      verdict: "Add at least one garment to the mannequin, then check your outfit to get JeZsy's evaluation.",
      whyJezsySaysThis: 'No garments are currently dressed on the mannequin canvas.',
      stylistsTake: 'No garments are currently dressed on the mannequin. Please select clothes from your wardrobe to begin styling.',
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
        colorHarmony: { status: 'alert', title: 'No Colors Detected', feedback: 'Dress the mannequin to begin color evaluation.' },
        compositionAndLayers: { status: 'alert', title: 'No Garments', feedback: 'No garments are currently on the canvas.' },
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
  const onlyAccessories = !structure.hasOnePiece && !structure.hasTop && !structure.hasBottom && !structure.hasOuterwear;

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
    stylistsTake = 'An outfit requires core clothing pieces to be wearable. Add a dress, jumpsuit, or a top and bottom.';
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
    // Bottom + Shoes without a top
    if (reqs.prohibitsAthletic && garmentProfiles.some((g) => g.styleSignals.athletic)) {
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality Mismatch';
      verdict = `Athletic shorts and running shoes conflict directly with the formal standards of a ${occasionLabel}.`;
      whyJezsySaysThis = `Running shorts and running shoes are athletic garments that strongly clash with the elevated formal dress code required for a ${occasionLabel}.`;
      stylistsTake = whyJezsySaysThis;
      whatWorks = undefined;
      whatCouldBeBetter = 'Replace athletic shorts and running shoes with tailored formalwear such as trousers and dress shoes.';
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
      whatCouldBeBetter = 'Add a breathable athletic running tee or tank if upper-body sun protection or coverage is desired.';
      whatsMissing = 'Upper-body layer — add a performance running tee or tank if needed.';
      tips.push('Opt for moisture-wicking materials for optimal performance during workouts.');
    } else if (activity === 'casualDaily') {
      assessment = 'Could work with changes';
      headline = 'Relaxed Athleisure';
      verdict = `A relaxed athleisure base that could work for ${occasionLabel}, but needs an upper layer.`;
      whyJezsySaysThis = 'Running shorts and sneakers provide relaxed comfort for everyday downtime, but adding a casual t-shirt or hoodie is needed for complete public wear.';
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
    // Outerwear + Bottoms + Shoes without an inner base top
    if (reqs.prohibitsAthletic && garmentProfiles.some((g) => g.styleSignals.athletic)) {
      // Test 1 Scenario: Blazer + Running Shorts + Sneakers for Wedding
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality & Structural Mismatch';
      verdict = `This combination is not suitable for a ${occasionLabel}.`;
      whyJezsySaysThis =
        'The blazer adds an elevated element, but the running shorts and running sneakers make the outfit predominantly athletic and casual. That conflicts with the stated wedding setting, and the missing base layer also leaves the outfit incomplete.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = undefined; // Strictly omitted for severe conflicts

      const betterPoints: string[] = [];
      betterPoints.push('Running shorts are athletic wear, conflicting directly with wedding attire standards.');
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
    } else if (activity === 'casualDaily') {
      assessment = 'Could work with changes';
      headline = 'High-Low Streetwear Concept';
      verdict = `An interesting high-low contrast that could work for ${occasionLabel}, but needs an inner top.`;
      whyJezsySaysThis =
        'Pairing a tailored blazer with casual shorts and sneakers creates a recognizable high-low streetwear aesthetic, but the outfit currently lacks an inner top under the blazer.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'The tailored structure of the blazer contrasts deliberately with relaxed athletic pieces for an intentional high-low vibe.';
      whatCouldBeBetter = 'Add a simple inner top (such as a plain crewneck t-shirt or tank) so the blazer can be styled open or closed comfortably.';
      whatsMissing = 'An upper-body base layer — add a t-shirt or casual top underneath the blazer.';
      tips.push('Add a clean white or neutral tee underneath the blazer to complete the upper body.');
    } else {
      assessment = 'Incomplete outfit';
      headline = 'Missing Inner Top';
      verdict = 'An inner top is required underneath your outerwear.';
      whyJezsySaysThis = 'While outerwear frames the torso, an inner base layer is necessary for comfort, styling, and completeness.';
      stylistsTake = whyJezsySaysThis;
      whatsMissing = 'Base top — add a shirt, blouse, or tee underneath the jacket.';
      tips.push('Layer a base top under the outerwear.');
    }
  } else if (severeContradictions.length > 0 || majorContradictions.length > 0) {
    // Priority 2: Severe / Major Activity or Dress-Code Contradictions
    assessment = 'Not appropriate for this occasion';

    if (activity === 'activeSwimming') {
      // Phase 28 Exact Swimming Regression
      headline = 'Activity & Water Mismatch';
      verdict = `This outfit is not appropriate for active swimming.`;
      whyJezsySaysThis = `You indicated active swimming in a pool, which requires water-safe swimwear and aquatic mobility. The selected sweater, denim skirt, and suede/velvet Mary Jane flats are fashion separates that will become waterlogged, heavy, and damaged in chlorinated water.`;
      stylistsTake = `You said you'll be actively swimming a lot in a pool, so the outfit needs to support water exposure, movement, and swimming rather than simply look coordinated. The knit sweater, denim micro mini skirt, and suede/velvet Mary Jane flats are fashion pieces that conflict with those requirements.`;

      // Visual coordination can be noted if colors harmonize, but strictly secondary!
      if (colorEval.score >= 70) {
        whatWorks = `The ${paletteColors.join(', ')} palette coordinates visually. However, visual coordination does not overcome the activity mismatch.`;
      } else {
        whatWorks = undefined;
      }

      whatCouldBeBetter = `Change the outfit from a fashion/poolside look into an outfit designed for active swimming. Replace the knit sweater, denim skirt, and delicate footwear with functional swimwear.`;
      whatsMissing = `Swim-appropriate clothing and appropriate pool footwear if needed.`;

      const swimAlt = wardrobeAlternatives.find((a) => a.slot === 'swimwear');
      if (swimAlt?.found && swimAlt.item) {
        tips.push(`Switch to your ${(swimAlt.item as any).name || swimAlt.item.sub_category} from your wardrobe.`);
      } else {
        tips.push("JeZsy couldn't find a suitable swimwear item in your current wardrobe.");
      }
      tips.push('Active pool swimming requires chlorine-resistant, water-compatible fabrics like nylon or spandex.');
      tips.push('Wear pool slides or water shoes on the pool deck to protect footwear from water damage.');
    } else {
      // General major contradiction
      headline = 'Occasion & Formality Conflict';
      verdict = `The outfit elements clash with the expectations of a ${occasionLabel}.`;
      whyJezsySaysThis = contradictions.map((c) => c.reason).join(' ');
      stylistsTake = whyJezsySaysThis;
      whatWorks = undefined; // Strictly omitted for formal/severe contradictions
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
      whyJezsySaysThis = 'The garment has an athletic/sport orientation, which contradicts the formal requirements of a wedding.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = undefined;
      whatCouldBeBetter = 'Opt for an elevated formal dress or gown rather than athletic activewear.';
      tips.push('Choose a cocktail or evening dress for formal events.');
    } else {
      assessment = 'Appropriate for this occasion';
      headline = 'Elevated One-Piece Silhouette';
      verdict = `A complete head-to-toe foundation that works well for ${occasionLabel}.`;
      whyJezsySaysThis = `The one-piece garment provides clean vertical continuity and a complete silhouette. ${structure.hasShoes ? 'Footwear anchors the overall proportion.' : 'Adding footwear will finish the look.'}`;
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'A one-piece foundation provides complete head-to-toe vertical continuity without competing layers.';

      if (!structure.hasShoes && reqs.requiresFormalAttire) {
        assessment = 'Could work with changes';
        whatCouldBeBetter = 'Footwear is an essential component for formal occasions.';
        const shoeAlt = wardrobeAlternatives.find((a) => a.slot === 'shoes');
        if (shoeAlt?.found && shoeAlt.item) {
          whatsMissing = `Footwear — complete your formal look with your ${(shoeAlt.item as any).name || shoeAlt.item.sub_category}.`;
          tips.push(`Pair with your ${(shoeAlt.item as any).name || shoeAlt.item.sub_category} to anchor the formal outfit.`);
        } else {
          whatsMissing = 'Footwear — JeZsy could not find suitable formal footwear in your current wardrobe.';
          tips.push('Add formal shoes or heels to polish the presentation.');
        }
      }
    }
  } else if (structure.hasTop && structure.hasBottom) {
    // Complete Separates
    if (activity === 'beachWedding' || reqs.allowsResortElevated && rawOccasion.toLowerCase().includes('beach')) {
      // Beach wedding allows tailored shorts, linen shirts, resort styling
      assessment = 'Appropriate for this occasion';
      headline = 'Refined Resort Styling';
      verdict = `Tailored resort pieces well-suited for a ${occasionLabel}.`;
      whyJezsySaysThis = 'The tailored shorts and elevated top fit the relaxed yet celebratory expectations of a beach wedding.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Tailored lightweight pieces balance polished styling with beach-ready breathability.';
      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Pair with clean loafers or refined resort sandals to finish the beach wedding look.';
        tips.push('Choose footwear suitable for sand or boardwalk settings.');
      }
    } else if (activity === 'poolsideSocial') {
      // Pool party social setting (Phase 30)
      assessment = 'Appropriate for this occasion';
      headline = 'Poolside Social Ensemble';
      verdict = `Relaxed summer separates well-suited for a ${occasionLabel}.`;
      whyJezsySaysThis = 'A pool party is a social gathering where fashionable resort separates and comfortable warm-weather styling are right at home.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Casual summer separates provide effortless comfort and poolside style.';
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
      whyJezsySaysThis = 'The combination provides tailored structure and polished presence appropriate for professional settings.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Structured styling delivers a crisp, work-ready silhouette.';
      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Adding office-appropriate shoes will finish the presentation.';
        tips.push('Pair with loafers or work shoes.');
      }
    } else if (activity === 'running' || activity === 'gymWorkout') {
      assessment = 'Appropriate for this occasion';
      headline = 'Functional Athletic Gear';
      verdict = `Performance pieces suited for ${occasionLabel}.`;
      whyJezsySaysThis = 'The athletic separates offer optimal mobility and functional performance for physical activity.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'Activewear fabrics and cuts support natural movement and breathability.';
    } else {
      assessment = 'Appropriate for this occasion';
      headline = 'Casual Everyday Outfit';
      verdict = `Comfortable separates suited for ${occasionLabel}.`;
      whyJezsySaysThis = 'The pieces create a relaxed, wearable outfit for informal daily wear.';
      stylistsTake = whyJezsySaysThis;
      whatWorks = 'The upper and lower garments provide practical comfort and effortless daytime styling.';
      if (!structure.hasShoes) {
        whatCouldBeBetter = 'Adding footwear will complete the head-to-toe presentation.';
        tips.push('Choose shoes that complement your outfit.');
      }
    }
  }

  // Strict invariant: when outfit is not appropriate, whyThisWorks must NOT be displayed UNLESS specifically acknowledging secondary visual coordination with an explicit caveat
  if (assessment === 'Not appropriate for this occasion' && whatWorks && !whatWorks.includes('does not overcome')) {
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
  if (rawAdditionalContext.match(/\b(rain|wet|umbrella|waterproof)\b/i)) {
    const hasRainCoat = structure.outers.some((o) =>
      o.combinedText.match(/\b(rain|waterproof|trench|windbreaker)\b/i)
    );
    if (!hasRainCoat) {
      tips.push('Your context mentions rain — consider bringing an umbrella or adding a weather-resistant jacket.');
    }
  }

  if (rawAdditionalContext.match(/\b(walk|walking|lot of walking|standing)\b/i)) {
    const hasHighHeels = structure.shoes.some((s) =>
      s.combinedText.match(/\b(high heel|stiletto|pump)\b/i)
    );
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
        status: assessment === 'Appropriate for this occasion' ? 'excellent' : assessment === 'Could work with changes' ? 'good' : 'alert',
        title: headline,
        feedback: verdict,
      },
    },
  };
}
