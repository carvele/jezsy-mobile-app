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

/**
 * Extracts full authoritative metadata text for an item from user-entered attributes.
 */
function getItemSemanticText(
  item: MannequinCanvasItem,
  wardrobeItem?: WardrobeItem
): {
  category: string;
  subCategory: string;
  whereWornOften: string;
  description: string;
  userNotes: string;
  combinedText: string;
} {
  const category = wardrobeItem?.category || item.garment_type || '';
  const subCategory = wardrobeItem?.sub_category || '';
  const whereWornOften = (
    (wardrobeItem as any)?.where_worn_often ||
    (wardrobeItem as any)?.whereWornOften ||
    (wardrobeItem as any)?.ai_attributes?.whereWornOften ||
    ((wardrobeItem as any)?.occasions || []).join(' ') ||
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

  const combinedText = [
    item.name,
    category,
    subCategory,
    whereWornOften,
    description,
    userNotes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return { category, subCategory, whereWornOften, description, userNotes, combinedText };
}

/**
 * Determines whether an item is athletic based on user metadata.
 */
function isAthleticGarment(semantic: { combinedText: string; whereWornOften: string; description: string }): boolean {
  const { combinedText, whereWornOften, description } = semantic;
  // If user explicitly stated where worn often is gym/running/workout
  if (whereWornOften.match(/\b(running|gym|workout|jogging|training|sport|track|fitness)\b/i)) {
    return true;
  }
  // If description specifically notes athletic/exercise use
  if (description.match(/\b(running|exercise|gym|workout|jogging|athletic|training|sports?)\b/i)) {
    return true;
  }
  // If category or name denotes athletic wear
  return combinedText.match(/\b(running shorts|gym shorts|track pants|sweatpants|sports bra|jersey|athletic sneakers|running shoes|workout leggings)\b/i) !== null;
}

/**
 * Determines whether an item is formal/tailored based on user metadata.
 */
function isFormalGarment(semantic: { combinedText: string }): boolean {
  return semantic.combinedText.match(/\b(blazer|suit|tuxedo|gown|evening dress|cocktail dress|tailored|trousers?|dress pants|slacks|oxfords?|loafers?|derby|heels?|pumps?)\b/i) !== null;
}

/**
 * Determines whether footwear is sporty/casual sneakers.
 */
function isCasualOrSportyFootwear(semantic: { combinedText: string }): boolean {
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

  // Occasion Nature Detection
  const isHighFormality = occLower.match(/\b(wedding|formal|black.?tie|white.?tie|gala|ball|cocktail)\b/) !== null;
  const isProfessional = occLower.match(/\b(interview|office|work|business|conference|church)\b/) !== null;
  const isCasualOccasion = occLower.match(/\b(casual|day out|everyday|streetwear|school|errands|travel|park|hanging out)\b/) !== null;
  const isAthleticOccasion = occLower.match(/\b(sport|gym|workout|running|yoga|fitness|athletic|training)\b/) !== null;

  // Contradiction Analysis (NO AVERAGE FORMALITY)
  const contradictions: string[] = [];
  const athleticPieces: string[] = [];
  const formalPieces: string[] = [];
  const casualPieces: string[] = [];

  for (const entry of itemSemantics) {
    const { item, semantic } = entry;
    const name = item.name || semantic.category || 'Item';
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

  // Grounded search in user's actual wardrobe for real replacements (Part 23)
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

  // Overall Assessment Formulation (Part 2 & Part 7)
  let assessment: OverallAssessment = 'Appropriate for this occasion';
  let headline = 'Refined & Harmonious';
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
    assessment = 'Incomplete outfit';
    headline = 'Missing Upper-Body Garment';
    verdict = 'A bottom piece is present, but an upper-body garment is needed.';
    stylistsTake = 'A wearable outfit requires an upper-body piece to complement the selected bottom.';
    whatsMissing = 'Top — add a shirt, blouse, or top to complete the look.';
    tips.push('Add a matching top from your wardrobe drawer.');
  } else if (missingBaseTopUnderOuter) {
    // Outerwear + Bottoms + Shoes without an inner top
    if (isHighFormality && athleticPieces.length > 0) {
      // Test 1: Blazer + Running shorts + Sneakers for Wedding
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality & Structural Mismatch';
      verdict = `This combination is not suitable for a ${occasionLabel}.`;
      stylistsTake = `The blazer adds tailored structure, but the running shorts and sneakers keep the outfit predominantly athletic and casual. For a wedding, these pieces pull in conflicting directions, and the missing upper-body base layer leaves the outfit incomplete.`;
      whatWorks = undefined; // Strictly omitted for fundamentally mismatched outfits

      const betterPoints: string[] = [];
      betterPoints.push('Running shorts are athletic wear, conflicting directly with wedding attire standards.');
      if (shoes.length > 0 && isCasualOrSportyFootwear(itemSemantics.find((e) => shoes.some((s) => s.id === e.item.id))?.semantic || { combinedText: '' })) {
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
      // Test 2: Blazer + Running shorts + Sneakers for Casual Day Out
      assessment = 'Could work with changes';
      headline = 'High-Low Streetwear Concept';
      verdict = `An interesting high-low contrast that could work for ${occasionLabel}, but needs an inner top.`;
      stylistsTake = `Pairing a tailored blazer with casual shorts and sneakers creates a recognizable high-low streetwear aesthetic, but the outfit currently lacks an inner top under the blazer.`;
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
    // Tests 3 & 4: Dress or Jumpsuit one-piece foundations
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
      headline = 'Graceful One-Piece Silhouette';
      verdict = `A complete head-to-toe foundation that works well for ${occasionLabel}.`;
      stylistsTake = `The one-piece garment provides clean vertical continuity and a complete silhouette. ${hasShoes ? 'Footwear anchors the overall proportion.' : 'Adding footwear will finish the look.'}`;
      whatWorks = 'A one-piece foundation naturally creates an unbroken, cohesive silhouette with balanced proportions.';
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
    if (isHighFormality && (athleticPieces.length > 0 || (shoes.length > 0 && isCasualOrSportyFootwear(itemSemantics.find((e) => shoes.some((s) => s.id === e.item.id))?.semantic || { combinedText: '' })))) {
      assessment = 'Not appropriate for this occasion';
      headline = 'Formality Mismatch';
      verdict = `The casual or athletic pieces are out of place for a ${occasionLabel}.`;
      stylistsTake = `While the separates provide coverage, the styling is too casual for a wedding.`;
      whatWorks = undefined;
      whatCouldBeBetter = 'Elevate the pieces by replacing athletic garments with tailored formal wear.';
      tips.push('Swap casual items for formal alternatives.');
    } else {
      assessment = 'Appropriate for this occasion';
      headline = 'Balanced & Cohesive Ensemble';
      verdict = `A solid combination of separates calibrated for ${occasionLabel}.`;
      stylistsTake = 'The proportions between top and bottom are well-proportioned, creating a functional and stylish outfit.';
      whatWorks = 'The top and bottom anchor each other in silhouette and coverage.';
      if (!hasShoes) {
        whatCouldBeBetter = 'Adding footwear will complete the head-to-toe presentation.';
        tips.push('Choose shoes that complement the formality of your outfit.');
      }
    }
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
