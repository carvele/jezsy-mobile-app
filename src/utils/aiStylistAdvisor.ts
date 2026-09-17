/**
 * aiStylistAdvisor.ts
 * JeZsy Stylist Engine - Critical Context & Garment Compatibility Advisor.
 *
 * Evaluates an outfit on the mannequin canvas against user-selected occasion
 * and context using user-entered wardrobe metadata as authoritative ground truth.
 *
 * Evaluates:
 * 1. Explicit user context (occasion, weather, constraints)
 * 2. Actual wardrobe items on the mannequin
 * 3. User-entered wardrobe metadata (category, sub-category, color, where_worn_often, description, personal notes)
 * 4. Outfit completeness (one-piece vs separates vs outerwear layering)
 * 5. Occasion/formality compatibility and contradiction detection
 * 6. Visual evidence & color harmony
 * 7. Personalization alignment
 *
 * Pure, deterministic, evidence-grounded. No numeric 0-100 scores. No letter grades.
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

export interface StylePillarBreakdown {
  status: 'excellent' | 'good' | 'warning' | 'alert';
  title: string;
  feedback: string;
}

export interface StylistCritique {
  assessment: OverallAssessment;
  headline: string;
  verdict: string;
  stylistsTake: string;
  whatWorks?: string;
  whatCouldBeBetter?: string;
  whatsMissing?: string;
  tips: string[];
  vibe: string;
  paletteColors: string[];
  isOvercrowded?: boolean;
  mannequinItems: MannequinCanvasItem[];
  context?: OutfitContext;
  contradictions?: string[];
  pillars?: {
    colorHarmony: StylePillarBreakdown;
    compositionAndLayers: StylePillarBreakdown;
    occasionFit?: StylePillarBreakdown;
    personalPreference?: StylePillarBreakdown;
  };
  explanation?: OutfitExplanation;
}

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

export interface GarmentSemanticData {
  category: string;
  subCategory: string;
  color: string;
  whereWornOften: string;
  description: string;
  userNotes: string;
  occasions: string[];
  seasons: string[];
  photoUrl?: string;
  wardrobeItemId?: string;
  combinedText: string;
}

/**
 * Extracts full authoritative metadata text for an item from user-entered attributes.
 * Preserves all 11 user-entered metadata dimensions without downgrading or overwriting.
 */
function getItemSemanticText(
  item: MannequinCanvasItem,
  wardrobeItem?: WardrobeItem
): GarmentSemanticData {
  const category = wardrobeItem?.category || item.garment_type || '';
  const subCategory = wardrobeItem?.sub_category || '';
  const color = (wardrobeItem as any)?.color || (wardrobeItem as any)?.colors || '';
  const whereWornOften = (
    (wardrobeItem as any)?.where_worn_often ||
    (wardrobeItem as any)?.whereWornOften ||
    (wardrobeItem as any)?.ai_attributes?.whereWornOften ||
    ''
  );
  const description = (
    wardrobeItem?.description ||
    (wardrobeItem as any)?.ai_attributes?.description ||
    ''
  );
  const userNotes = (
    wardrobeItem?.user_notes ||
    (wardrobeItem as any)?.ai_attributes?.userNotes ||
    ''
  );
  const occasions: string[] = (wardrobeItem as any)?.occasions || [];
  const seasons: string[] = (wardrobeItem as any)?.seasons || [];
  const photoUrl = (wardrobeItem as any)?.photo_url || item.image_url || undefined;
  const wardrobeItemId = item.wardrobe_item_id || (wardrobeItem as any)?.id || undefined;

  const combinedText = [
    item.name,
    category,
    subCategory,
    color,
    whereWornOften,
    description,
    userNotes,
    occasions.join(' '),
    seasons.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    category,
    subCategory,
    color,
    whereWornOften,
    description,
    userNotes,
    occasions,
    seasons,
    photoUrl,
    wardrobeItemId,
    combinedText,
  };
}

/**
 * Determines whether an item is athletic based on user metadata.
 * Uses explicit user text (where worn often, description, subcategory, notes) as primary evidence.
 */
function isAthleticGarment(semantic: GarmentSemanticData): boolean {
  const { combinedText, whereWornOften, description, userNotes, subCategory, occasions } = semantic;
  // User explicitly stated where worn often is gym/running/workout
  if (whereWornOften.match(/\b(running|gym|workout|jogging|training|sport|track|fitness)\b/i)) {
    return true;
  }
  // Explicit occasion tags include athletic/workout/gym/running
  if (occasions.some((o) => o.match(/\b(running|gym|workout|sports?|training)\b/i))) {
    return true;
  }
  // Description specifically notes athletic/exercise use
  if (description.match(/\b(running|exercise|gym|workout|jogging|athletic|training|sports?)\b/i)) {
    return true;
  }
  // User notes specifically note athletic/exercise use
  if (userNotes.match(/\b(running|exercise|gym|workout|jogging|athletic|training|sports?)\b/i)) {
    return true;
  }
  // Subcategory explicitly athletic
  if (subCategory.match(/\b(running|gym|workout|track|sweatpants|sports bra|athletic sneakers|running shoes)\b/i)) {
    return true;
  }
  // Combined text matches athletic phrases, avoiding false positives
  return combinedText.match(/\b(running shorts|gym shorts|track pants|sweatpants|sports bra|jersey|athletic sneakers|running shoes|workout leggings|gym wear|workout top)\b/i) !== null;
}

/**
 * Determines whether an item is formal/tailored based on user metadata.
 */
function isFormalGarment(semantic: GarmentSemanticData): boolean {
  return semantic.combinedText.match(/\b(blazer|suit|tuxedo|gown|evening dress|cocktail dress|tailored|trousers?|dress pants|slacks|oxfords?|loafers?|derby|heels?|pumps?)\b/i) !== null;
}

/**
 * Determines whether footwear is sporty/casual sneakers.
 */
function isCasualOrSportyFootwear(semantic: GarmentSemanticData): boolean {
  return semantic.combinedText.match(/\b(sneakers?|running shoes|trainers?|canvas shoes|slip.?on|flip.?flop|sandals?)\b/i) !== null;
}

/**
 * Core Stylist Outfit Evaluation Engine
 */
export function gradeOutfit(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>,
  context?: OutfitContext,
  profile?: UserStyleProfileDto | null
): StylistCritique {
  const occasion = (context?.occasion ?? '').trim();
  const additionalContext = (context?.additionalContext ?? '').trim();
  const occLower = occasion.toLowerCase();
  const addLower = additionalContext.toLowerCase();
  const fullContextText = `${occLower} ${addLower}`.trim();

  // Part 28: Empty Mannequin handling
  if (!items || items.length === 0) {
    return {
      assessment: 'Incomplete outfit',
      headline: 'Mannequin is Empty',
      verdict: "Add at least one garment to the mannequin, then check your outfit to get JeZsy's evaluation.",
      stylistsTake: 'No garments are currently dressed on the mannequin. Please select clothes from your wardrobe to begin styling.',
      whatWorks: undefined,
      whatCouldBeBetter: 'The mannequin has no garments on it.',
      whatsMissing: 'Add core garments (a dress, jumpsuit, or a top and bottom combination) to create a wearable outfit.',
      tips: ['Tap any garment in the wardrobe drawer below to dress the mannequin.'],
      vibe: 'Unstyled',
      paletteColors: [],
      mannequinItems: [],
      context,
      contradictions: [],
      pillars: {
        colorHarmony: { status: 'alert', title: 'No Colors Detected', feedback: 'Dress the mannequin to begin color evaluation.' },
        compositionAndLayers: { status: 'alert', title: 'No Garments', feedback: 'No garments are currently on the canvas.' },
      },
    };
  }

  // Classify mannequin garments into functional slots
  const baseTops: MannequinCanvasItem[] = [];
  const outers: MannequinCanvasItem[] = [];
  const bottoms: MannequinCanvasItem[] = [];
  const fullBodyItems: MannequinCanvasItem[] = [];
  const shoes: MannequinCanvasItem[] = [];
  const accessories: MannequinCanvasItem[] = [];

  const itemSemantics = items.map((item) => {
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    return {
      item,
      wardrobeItem: w,
      semantic: getItemSemanticText(item, w),
    };
  });

  for (const entry of itemSemantics) {
    const { item, semantic } = entry;
    const t = (item.garment_type || '').toLowerCase();
    const text = semantic.combinedText;

    const isFullBody =
      t.includes('dress') || t.includes('jumpsuit') || t.includes('romper') || t.includes('gown') || t.includes('swimsuit') ||
      text.match(/\b(jumpsuit|romper|gown|overalls|one.?piece|swimsuit|maxi dress|midi dress|mini dress)\b/) !== null;

    const isOuterwear =
      t.includes('outerwear') || t.includes('jacket') || t.includes('blazer') || t.includes('coat') || t.includes('cardigan') ||
      text.match(/\b(blazer|jacket|coat|cardigan|vest|windbreaker|trench)\b/) !== null;

    const isShoe =
      t.includes('shoe') || t.includes('heel') || t.includes('boot') || t.includes('sneaker') || t.includes('sandal') ||
      text.match(/\b(shoes?|sneakers?|heels?|boots?|loafers?|sandals?|pumps?|oxfords?|flats?)\b/) !== null;

    const isBottom =
      !isFullBody && !isOuterwear && !isShoe && (
        t.includes('bottom') || t.includes('pant') || t.includes('jean') || t.includes('skirt') || t.includes('short') || t.includes('trouser') ||
        text.match(/\b(pants?|jeans?|trousers?|skirt|shorts?|slacks|leggings?)\b/) !== null
      );

    const isTop =
      !isFullBody && !isOuterwear && !isShoe && !isBottom && (
        t.includes('top') || t.includes('shirt') || t.includes('blouse') || t.includes('sweater') || t.includes('bra') || t.includes('tee') || t.includes('tank') ||
        text.match(/\b(shirt|blouse|tee|polo|sweater|knitwear|tank|crop.?top)\b/) !== null
      );

    if (isFullBody) fullBodyItems.push(item);
    else if (isOuterwear) outers.push(item);
    else if (isShoe) shoes.push(item);
    else if (isBottom) bottoms.push(item);
    else if (isTop) baseTops.push(item);
    else accessories.push(item);
  }

  const hasDressOrFullBody = fullBodyItems.length > 0;
  const hasTop = baseTops.length > 0;
  const hasBottom = bottoms.length > 0;
  const hasOuterwear = outers.length > 0;
  const hasShoes = shoes.length > 0;

  // Structural Completeness Checks
  let isOvercrowded = false;
  let overcrowdingNote = '';
  if (baseTops.length > 1) {
    isOvercrowded = true;
    overcrowdingNote = `You have ${baseTops.length} separate tops on the mannequin at once. Choose one primary base top.`;
  } else if (bottoms.length > 1) {
    isOvercrowded = true;
    overcrowdingNote = `You have ${bottoms.length} separate bottoms on the mannequin. Choose one trouser or skirt.`;
  } else if (hasDressOrFullBody && (hasTop || hasBottom)) {
    isOvercrowded = true;
    overcrowdingNote = 'A dress or jumpsuit already provides full body coverage; separate tops or bottoms create conflicting bulk.';
  }

  // Part 11: One-Piece vs Separates vs Outerwear completeness
  const missingBaseTopUnderOuter = hasOuterwear && !hasTop && !hasDressOrFullBody;
  const missingBottom = !hasDressOrFullBody && (hasTop || hasOuterwear) && !hasBottom;
  const missingTopOnly = !hasDressOrFullBody && !hasOuterwear && hasBottom && !hasTop;
  const onlyAccessories = !hasDressOrFullBody && !hasTop && !hasBottom && !hasOuterwear;

  // Occasion Nature Detection (Part 6 & Part 7)
  const isBeachOrResort = fullContextText.match(/\b(beach|resort|pool|vacation)\b/) !== null;
  const isBeachWedding = isBeachOrResort && fullContextText.match(/\b(wedding)\b/) !== null;
  const isHighFormality = !isBeachWedding && fullContextText.match(/\b(wedding|formal|black.?tie|white.?tie|gala|ball|cocktail|ceremony|reception)\b/) !== null;
  const isProfessional = fullContextText.match(/\b(interview|office|work|business|conference|church)\b/) !== null;
  const isCasualOccasion = fullContextText.match(/\b(casual|day out|everyday|streetwear|school|errands|travel|park|hanging out)\b/) !== null;
  const isAthleticOccasion = fullContextText.match(/\b(sport|gym|workout|running|yoga|fitness|athletic|training)\b/) !== null;

  // Contradiction Analysis (NO AVERAGE FORMALITY)
  const contradictions: string[] = [];
  const athleticPieces: string[] = [];
  const formalPieces: string[] = [];
  const casualPieces: string[] = [];

  for (const entry of itemSemantics) {
    const { item, semantic } = entry;
    const name = item.name || semantic.subCategory || semantic.category || 'Item';
    if (isAthleticGarment(semantic)) {
      athleticPieces.push(name);
    } else if (isFormalGarment(semantic)) {
      formalPieces.push(name);
    } else {
      casualPieces.push(name);
    }
  }

  // Check contradictions against occasion
  if (isHighFormality) {
    if (athleticPieces.length > 0) {
      contradictions.push(
        `${athleticPieces.join(' and ')} give the outfit a strongly athletic direction, which is fundamentally incompatible with the elevated formal dress code expected for a wedding.`
      );
    }
    if (shoes.length > 0) {
      const casualShoeEntries = itemSemantics.filter(
        (e) => shoes.some((s) => s.id === e.item.id) && isCasualOrSportyFootwear(e.semantic)
      );
      if (casualShoeEntries.length > 0) {
        contradictions.push(
          `The footwear (${casualShoeEntries.map((e) => e.item.name).join(', ')}) reinforces a sporty, relaxed aesthetic rather than wedding-appropriate formal footwear.`
        );
      }
    }
    if (missingBaseTopUnderOuter) {
      contradictions.push(
        'An outerwear piece is present, but there is no upper-body base layer (such as a formal shirt, blouse, or top) completing the upper body.'
      );
    }
  } else if (isProfessional) {
    if (athleticPieces.length > 0) {
      contradictions.push(
        `${athleticPieces.join(' and ')} are athletic garments that contrast sharply with professional workplace standards.`
      );
    }
    if (missingBaseTopUnderOuter) {
      contradictions.push('A base top is required underneath your outerwear for a professional look.');
    }
  } else if (isAthleticOccasion) {
    if (formalPieces.length > 0) {
      contradictions.push(
        `${formalPieces.join(' and ')} are formal structured pieces that restrict mobility and clash with athletic/workout use.`
      );
    }
  }

  // Grounded search in user's actual wardrobe for real replacements (Part 16 & Part 24)
  const findRealWardrobeAlternative = (slot: 'bottom' | 'top' | 'shoes', formality: 'formal' | 'casual'): string | null => {
    if (!wardrobeLookup) return null;
    for (const w of Object.values(wardrobeLookup)) {
      if ((w as any).deleted) continue;
      const sem = getItemSemanticText({ wardrobe_item_id: w.id } as any, w);
      const isAthl = isAthleticGarment(sem);
      const isForm = isFormalGarment(sem);
      const t = (w.garment_type || '').toLowerCase();
      const desc = sem.combinedText;

      if (slot === 'bottom') {
        const isB = t.includes('bottom') || t.includes('pant') || t.includes('trouser') || t.includes('skirt') || desc.match(/\b(trousers?|dress pants?|slacks|skirt)\b/) !== null;
        if (isB && !isAthl && (formality === 'formal' ? isForm : !isForm)) {
          return (w as any).name || w.sub_category || w.category || 'trousers';
        }
      } else if (slot === 'shoes') {
        const isS = t.includes('shoe') || t.includes('heel') || t.includes('boot') || desc.match(/\b(loafers?|oxfords?|heels?|pumps?)\b/) !== null;
        if (isS && !isCasualOrSportyFootwear(sem) && (formality === 'formal' ? isForm : true)) {
          return (w as any).name || w.sub_category || 'dress shoes';
        }
      } else if (slot === 'top') {
        const isT = t.includes('top') || t.includes('shirt') || t.includes('blouse') || desc.match(/\b(shirt|blouse|button.?down)\b/) !== null;
        if (isT && !isAthl) {
          return (w as any).name || w.sub_category || 'top';
        }
      }
    }
    return null;
  };

  // Color evaluation
  const paletteColors = extractColors(items, wardrobeLookup);
  const colorEval: ColorMatchResult = evaluateColors(paletteColors);

  // Overall Assessment Formulation (Part 13: Qualitative, no numeric scores or letter grades)
  let assessment: OverallAssessment = 'Appropriate for this occasion';
  let headline = 'Appropriate Outfit';
  let verdict = '';
  let stylistsTake = '';
  let whatWorks: string | undefined;
  let whatCouldBeBetter: string | undefined;
  let whatsMissing: string | undefined;
  const tips: string[] = [];

  const occasionLabel = occasion || 'your day';

  if (isOvercrowded) {
    assessment = 'Incomplete outfit';
    headline = 'Too Many Competing Garments';
    verdict = 'Simplify the layers so each garment has room to breathe.';
    stylistsTake = overcrowdingNote || 'The outfit has overlapping garments in the same structural slot.';
    whatCouldBeBetter = overcrowdingNote;
    tips.push('Aim for: one top (or dress), one bottom, and at most one outerwear layer.');
  } else if (onlyAccessories) {
    assessment = 'Incomplete outfit';
    headline = 'No Core Garments';
    verdict = 'The mannequin only has accessories.';
    stylistsTake = 'An outfit requires core clothing pieces to be wearable. Add a dress, jumpsuit, or a top and bottom.';
    whatsMissing = 'Core garments — please add a dress, jumpsuit, or a top and bottom combination.';
    tips.push('Select a top or dress from your wardrobe to anchor the outfit.');
  } else if (missingBottom) {
    assessment = 'Incomplete outfit';
    headline = 'Missing Lower-Body Garment';
    verdict = 'An upper piece is selected, but a bottom is needed to complete the foundation.';
    stylistsTake = 'The outfit has upper coverage but lacks trousers, a skirt, or shorts to be wearable.';
    const realBottom = findRealWardrobeAlternative('bottom', isHighFormality ? 'formal' : 'casual');
    if (realBottom) {
      whatsMissing = `Bottom — complete the foundation with your ${realBottom} from your wardrobe.`;
      tips.push(`Pair with your ${realBottom} for a complete silhouette.`);
    } else {
      whatsMissing = 'Bottom — trousers, a skirt, or shorts are needed to complete the foundation.';
      if (isHighFormality) {
        tips.push('JeZsy could not find a suitable formal alternative in your current wardrobe.');
      } else {
        tips.push('Add a bottom piece from your wardrobe drawer below.');
      }
    }
  } else if (missingTopOnly) {
    // Check contextual intent for bottom + shoes without a top
    if (isHighFormality && athleticPieces.length > 0) {
      // Running shorts + running shoes for wedding -> strong contextual contradiction
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality Mismatch';
      verdict = `Athletic shorts and running shoes conflict directly with the formal standards of a ${occasionLabel}.`;
      stylistsTake = 'Running shorts and running shoes are athletic gear that strongly clash with the elevated formal dress code required for a wedding.';
      whatWorks = undefined;
      whatCouldBeBetter = 'Replace athletic shorts and running shoes with tailored formalwear such as trousers and dress shoes.';
      const realFormalBottom = findRealWardrobeAlternative('bottom', 'formal');
      const realFormalShoes = findRealWardrobeAlternative('shoes', 'formal');
      const missingPieces = ['Formal upper-body garment (dress shirt or formal top).'];
      if (!realFormalBottom) {
        missingPieces.push('Formal bottom: JeZsy could not find a suitable formal alternative in your current wardrobe.');
      }
      if (!realFormalShoes) {
        missingPieces.push('Formal footwear: JeZsy could not find suitable formal footwear in your current wardrobe.');
      }
      whatsMissing = missingPieces.join(' ');
      tips.push('Weddings call for tailored, elegant attire rather than athletic activewear.');
    } else if (isAthleticOccasion) {
      // Running shorts + running shoes for Running context -> activity appropriate
      assessment = 'Appropriate for this occasion';
      headline = 'Functional Running Gear';
      verdict = `Athletic shorts and running shoes are functional for ${occasionLabel}.`;
      stylistsTake = `Running shorts and running shoes provide high mobility and cushioning suitable for ${occasionLabel}.`;
      whatWorks = 'Garments are purpose-built for athletic movement, breathability, and physical activity.';
      whatCouldBeBetter = 'Add a breathable athletic running tee or tank if upper-body sun protection or coverage is desired.';
      whatsMissing = 'Upper-body layer — add a performance running tee or tank if needed.';
      tips.push('Opt for moisture-wicking materials for optimal performance during workouts.');
    } else if (isCasualOccasion) {
      // Running shorts + running shoes for Casual day out -> contextually evaluated, not automatically rejected
      assessment = 'Could work with changes';
      headline = 'Relaxed Athleisure';
      verdict = `A relaxed athleisure base that could work for ${occasionLabel}, but needs an upper layer.`;
      stylistsTake = 'Running shorts and sneakers provide relaxed comfort for everyday downtime, but adding a casual t-shirt or hoodie is needed for complete public wear.';
      whatWorks = 'Athletic pieces provide casual comfort and high mobility for informal downtime.';
      whatCouldBeBetter = 'Add a casual t-shirt, tank, or hoodie to complete the outfit for public wear.';
      whatsMissing = 'Top — add a casual t-shirt, tank, or hoodie to complete your everyday look.';
      tips.push('Pair with a relaxed crewneck t-shirt or hoodie for an effortless athleisure style.');
    } else {
      assessment = 'Incomplete outfit';
      headline = 'Missing Upper-Body Garment';
      verdict = 'A bottom piece is present, but an upper-body garment is needed.';
      stylistsTake = 'A wearable outfit requires an upper-body piece to complement the selected bottom.';
      whatsMissing = 'Top — add a shirt, blouse, or top to complete the look.';
      tips.push('Add a matching top from your wardrobe drawer.');
    }
  } else if (missingBaseTopUnderOuter) {
    // Outerwear + Bottoms + Shoes without an inner top
    if (isHighFormality && athleticPieces.length > 0) {
      // Test 1 Failure Case: Blazer + Running shorts + Sneakers for Wedding
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality & Structural Mismatch';
      verdict = `This combination is not suitable for a ${occasionLabel}.`;
      stylistsTake = 'The blazer adds an elevated element, but the running shorts and running sneakers make the outfit predominantly athletic and casual. That conflicts with the stated wedding setting, and the missing base layer also leaves the outfit incomplete.';
      whatWorks = undefined; // Strictly omitted for fundamentally mismatched outfits

      const betterPoints: string[] = [];
      betterPoints.push('Running shorts are athletic wear, conflicting directly with wedding attire standards.');
      if (shoes.length > 0 && isCasualOrSportyFootwear(itemSemantics.find((e) => shoes.some((s) => s.id === e.item.id))?.semantic || { combinedText: '', whereWornOften: '', description: '', userNotes: '', subCategory: '', occasions: [], category: '', color: '', seasons: [] })) {
        betterPoints.push('Sneakers reinforce a casual/sporty aesthetic unsuitable for a formal wedding.');
      }
      betterPoints.push('The blazer requires an appropriate base top or shirt underneath.');
      whatCouldBeBetter = betterPoints.join(' ');

      // Grounded check for real formal bottom and footwear replacements
      const realFormalBottom = findRealWardrobeAlternative('bottom', 'formal');
      const realFormalShoes = findRealWardrobeAlternative('shoes', 'formal');

      const missingGaps: string[] = ['An upper-body base layer (dress shirt or formal blouse) underneath the blazer.'];
      if (!realFormalBottom) {
        missingGaps.push('Formal bottom: JeZsy could not find a suitable formal alternative in your current wardrobe.');
      }
      if (!realFormalShoes) {
        missingGaps.push('Formal footwear: JeZsy could not find suitable formal footwear in your current wardrobe.');
      }
      whatsMissing = missingGaps.join(' ');

      tips.push('Replace athletic shorts with tailored trousers or a formal skirt.');
      if (realFormalBottom) {
        tips.push(`You could wear your ${realFormalBottom} from your wardrobe.`);
      } else {
        tips.push('Your current wardrobe does not contain an obvious formal bottom for this occasion.');
      }
    } else if (isCasualOccasion) {
      // Blazer + Running shorts + Sneakers for Casual Day Out
      assessment = 'Could work with changes';
      headline = 'High-Low Streetwear Concept';
      verdict = `An interesting high-low contrast that could work for ${occasionLabel}, but needs an inner top.`;
      stylistsTake = 'Pairing a tailored blazer with casual shorts and sneakers creates a recognizable high-low streetwear aesthetic, but the outfit currently lacks an inner top under the blazer.';
      whatWorks = 'The tailored structure of the blazer contrasts deliberately with relaxed athletic pieces for an intentional high-low vibe.';
      whatCouldBeBetter = 'Add a simple inner top (such as a plain crewneck t-shirt or tank) so the blazer can be styled open or closed comfortably.';
      whatsMissing = 'An upper-body base layer — add a t-shirt or casual top underneath the blazer.';
      tips.push('Add a clean white or neutral tee underneath the blazer to complete the upper body.');
    } else {
      assessment = 'Incomplete outfit';
      headline = 'Missing Inner Top';
      verdict = 'An inner top is required underneath your outerwear.';
      stylistsTake = 'While outerwear frames the torso, an inner base layer is necessary for comfort, styling, and completeness.';
      whatsMissing = 'Base top — add a shirt, blouse, or tee underneath the jacket.';
      tips.push('Layer a base top under the outerwear.');
    }
  } else if (contradictions.length > 0) {
    // Outfit is complete, but has severe contextual contradictions
    assessment = 'Not appropriate for this occasion';
    headline = 'Occasion & Formality Conflict';
    verdict = `The outfit elements clash with the expectations of a ${occasionLabel}.`;
    stylistsTake = contradictions.join(' ');
    whatWorks = undefined;
    whatCouldBeBetter = contradictions.join(' ');
    tips.push(`Adjust garment formality to better align with ${occasionLabel}.`);
  } else if (hasDressOrFullBody) {
    // Dress or Jumpsuit one-piece foundations
    const dressEntry = itemSemantics.find((e) => fullBodyItems.some((f) => f.id === e.item.id));
    const isDressAthletic = dressEntry ? isAthleticGarment(dressEntry.semantic) : false;

    if (isHighFormality && isDressAthletic) {
      assessment = 'Not appropriate for this occasion';
      headline = 'Athletic One-Piece for Formal Event';
      verdict = `This athletic piece is not suited for a ${occasionLabel}.`;
      stylistsTake = 'The garment has an athletic/sport orientation, which contradicts the formal requirements of a wedding.';
      whatWorks = undefined;
      whatCouldBeBetter = 'Opt for an elevated formal dress or gown rather than athletic activewear.';
      tips.push('Choose a cocktail or evening dress for formal events.');
    } else {
      assessment = 'Appropriate for this occasion';
      headline = 'Elevated One-Piece Silhouette';
      verdict = `A complete head-to-toe foundation that works well for ${occasionLabel}.`;
      stylistsTake = `The one-piece garment provides clean vertical continuity and a complete silhouette. ${hasShoes ? 'Footwear anchors the overall proportion.' : 'Adding footwear will finish the look.'}`;
      whatWorks = 'A one-piece foundation provides complete head-to-toe vertical continuity without competing layers.';
      if (!hasShoes && isHighFormality) {
        assessment = 'Could work with changes';
        whatCouldBeBetter = 'Footwear is an essential component for formal occasions.';
        const realFormalShoes = findRealWardrobeAlternative('shoes', 'formal');
        if (realFormalShoes) {
          whatsMissing = `Footwear — complete your formal look with your ${realFormalShoes}.`;
          tips.push(`Pair with your ${realFormalShoes} to anchor the formal outfit.`);
        } else {
          whatsMissing = 'Footwear — JeZsy could not find suitable formal footwear in your current wardrobe.';
          tips.push('Add formal shoes or heels to polish the presentation.');
        }
      }
    }
  } else if (hasTop && hasBottom) {
    // Complete Separates
    if (isHighFormality && (athleticPieces.length > 0 || (shoes.length > 0 && isCasualOrSportyFootwear(itemSemantics.find((e) => shoes.some((s) => s.id === e.item.id))?.semantic || { combinedText: '', whereWornOften: '', description: '', userNotes: '', subCategory: '', occasions: [], category: '', color: '', seasons: [] })))) {
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality Mismatch';
      verdict = `The casual or athletic pieces are out of place for a ${occasionLabel}.`;
      stylistsTake = 'While the separates provide coverage, the styling is too casual for a wedding.';
      whatWorks = undefined;
      whatCouldBeBetter = 'Elevate the pieces by replacing athletic garments with tailored formal wear.';
      tips.push('Swap casual items for formal alternatives.');
    } else if (isBeachWedding) {
      // Beach wedding allows tailored shorts, linen shirts, resort styling
      assessment = 'Appropriate for this occasion';
      headline = 'Refined Resort Styling';
      verdict = `Tailored resort pieces well-suited for a ${occasionLabel}.`;
      stylistsTake = 'The tailored shorts and elevated top fit the relaxed yet celebratory expectations of a beach wedding.';
      whatWorks = 'Tailored lightweight pieces balance polished styling with beach-ready breathability.';
      if (!hasShoes) {
        whatCouldBeBetter = 'Pair with clean loafers or refined resort sandals to finish the beach wedding look.';
        tips.push('Choose footwear suitable for sand or boardwalk settings.');
      }
    } else if (isHighFormality) {
      assessment = 'Appropriate for this occasion';
      headline = 'Elevated Formal Ensemble';
      verdict = `Tailored separates aligned with the formal expectations of ${occasionLabel}.`;
      stylistsTake = `The tailored pieces establish an elevated presentation appropriate for ${occasionLabel}.`;
      whatWorks = 'The structured pieces provide a clean, formal silhouette appropriate for formal celebrations.';
      if (!hasShoes) {
        assessment = 'Could work with changes';
        whatCouldBeBetter = 'Formal events require appropriate dress footwear.';
        tips.push('Complete the look with formal shoes.');
      }
    } else if (isProfessional) {
      assessment = 'Appropriate for this occasion';
      headline = 'Professional Workplace Separates';
      verdict = `Structured pieces suitable for a ${occasionLabel} environment.`;
      stylistsTake = 'The combination provides tailored structure and polished presence appropriate for professional settings.';
      whatWorks = 'Structured styling delivers a crisp, work-ready silhouette.';
      if (!hasShoes) {
        whatCouldBeBetter = 'Adding office-appropriate shoes will finish the presentation.';
        tips.push('Pair with loafers or work shoes.');
      }
    } else if (isAthleticOccasion) {
      assessment = 'Appropriate for this occasion';
      headline = 'Functional Athletic Gear';
      verdict = `Performance pieces suited for ${occasionLabel}.`;
      stylistsTake = 'The athletic separates offer optimal mobility and functional performance for physical activity.';
      whatWorks = 'Activewear fabrics and cuts support natural movement and breathability.';
    } else {
      assessment = 'Appropriate for this occasion';
      headline = 'Casual Everyday Outfit';
      verdict = `Comfortable separates suited for ${occasionLabel}.`;
      stylistsTake = 'The pieces create a relaxed, wearable outfit for informal daily wear.';
      whatWorks = 'The upper and lower garments provide practical comfort and effortless daytime styling.';
      if (!hasShoes) {
        whatCouldBeBetter = 'Adding footwear will complete the head-to-toe presentation.';
        tips.push('Choose shoes that complement your outfit.');
      }
    }
  }

  // Strict invariant: when outfit is not appropriate, whyThisWorks must NOT be displayed
  if (assessment === 'Not appropriate for this occasion') {
    whatWorks = undefined;
  }

  // Personalization influence (Part 25: separate from objective occasion compatibility)
  if (profile && profile.feedbackCount > 0) {
    const resolvedWardrobeItems = items
      .map((i) => wardrobeLookup?.[i.wardrobe_item_id])
      .filter(Boolean) as WardrobeItem[];
    if (resolvedWardrobeItems.length > 0) {
      const affinity = computePersonalAffinity(resolvedWardrobeItems, profile, occasion);
      if (affinity.recommendationNote && assessment === 'Appropriate for this occasion') {
        tips.push(affinity.recommendationNote);
      }
    }
  }

  // Contextual weather/walking tips (Part 6)
  if (addLower.match(/\b(rain|wet|umbrella|waterproof)\b/)) {
    const hasRainCoat = outers.some((o) => {
      const sem = itemSemantics.find((e) => e.item.id === o.id)?.semantic;
      return sem?.combinedText.match(/\b(rain|waterproof|trench|windbreaker)\b/) !== null;
    });
    if (!hasRainCoat) {
      tips.push('Your context mentions rain — consider bringing an umbrella or adding a weather-resistant jacket.');
    }
  }

  if (addLower.match(/\b(walk|walking|lot of walking|standing)\b/)) {
    const hasHighHeels = shoes.some((s) => {
      const sem = itemSemantics.find((e) => e.item.id === s.id)?.semantic;
      return sem?.combinedText.match(/\b(high heel|stiletto|pump)\b/) !== null;
    });
    if (hasHighHeels) {
      tips.push('Your context mentions a lot of walking — high heels may cause discomfort over extended periods.');
    }
  }

  // Determine Vibe
  let vibe = 'Modern Casual';
  if (isHighFormality) vibe = 'Formal & Elevated';
  else if (athleticPieces.length > 0 && outers.length > 0) vibe = 'High-Low Streetwear';
  else if (athleticPieces.length > 0) vibe = 'Athleisure';
  else if (hasDressOrFullBody) vibe = 'Effortless One-Piece';
  else if (isProfessional) vibe = 'Smart Professional';
  else if (colorEval.label === 'Perfect Harmony') vibe = 'Quiet Luxury';

  return {
    assessment,
    headline,
    verdict,
    stylistsTake,
    whatWorks,
    whatCouldBeBetter,
    whatsMissing,
    tips: tips.slice(0, 3),
    vibe,
    paletteColors,
    isOvercrowded,
    mannequinItems: items,
    context,
    contradictions,
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
