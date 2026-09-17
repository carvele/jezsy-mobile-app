/**
 * aiStylistAdvisor.ts
 * JeZsy Stylist Engine - Outfit Compatibility Scorer.
 *
 * Evaluates an outfit on the mannequin canvas against the user selected occasion
 * and context. Produces a 0-100 JeZsy Outfit Compatibility Score that reflects how
 * well the actual items match the chosen occasion, not a universal fashion truth.
 *
 * Pure, deterministic, reproducible. No hardcoded outfit-specific scores.
 */

import { evaluateColors, ColorMatchResult } from './colorMatcher';
import { MannequinCanvasItem, WardrobeItem } from './mannequinConfig';
import { OutfitExplanation } from './outfitExplainer';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { computePersonalAffinity } from './personalStyleEngine';

export type GradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D';

export interface OutfitContext {
  occasion: string;
  additionalContext?: string;
}

export interface StylePillarBreakdown {
  score: number;
  status: 'excellent' | 'good' | 'warning' | 'alert';
  title: string;
  feedback: string;
}

export interface StylistCritique {
  score: number;
  grade: GradeLetter;
  headline: string;
  verdict: string;
  whatWorks?: string;
  whatCouldBeBetter?: string;
  stylistTip?: string;
  whatsMissing?: string;
  pillars: {
    colorHarmony: StylePillarBreakdown;
    compositionAndLayers: StylePillarBreakdown;
    occasionFit?: StylePillarBreakdown;
    personalPreference?: StylePillarBreakdown;
  };
  tips: string[];
  vibe: string;
  paletteColors: string[];
  isOvercrowded?: boolean;
  explanation?: OutfitExplanation;
}

export function scoreToGrade(score: number): GradeLetter {
  if (score >= 97) return 'A+';
  if (score >= 92) return 'A';
  if (score >= 88) return 'A-';
  if (score >= 83) return 'B+';
  if (score >= 78) return 'B';
  if (score >= 73) return 'B-';
  if (score >= 68) return 'C+';
  if (score >= 62) return 'C';
  if (score >= 55) return 'C-';
  return 'D';
}

const KNOWN_COLORS = [
  'black', 'white', 'cream', 'beige', 'navy', 'blue', 'denim', 'gray', 'grey',
  'charcoal', 'red', 'crimson', 'burgundy', 'maroon', 'wine', 'pink', 'rose', 'blush',
  'orange', 'rust', 'terracotta', 'yellow', 'mustard', 'gold', 'silver', 'green', 'olive',
  'sage', 'emerald', 'teal', 'purple', 'lavender', 'brown', 'tan', 'camel', 'khaki',
  'ivory', 'neon green', 'neon pink', 'neon yellow', 'neon',
];

export function extractColors(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>
): string[] {
  const colors: string[] = [];
  for (const item of items) {
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    let found = false;
    if (w?.color_tags && w.color_tags.length > 0) {
      colors.push(...w.color_tags);
      found = true;
    } else if ((w as any)?.color) {
      colors.push((w as any).color);
      found = true;
    }
    if (!found) {
      const sources = [
        item.name, w?.sub_category, w?.category,
        w?.description, (w as any)?.ai_attributes?.description, (item as any).color,
      ].filter(Boolean).map((s) => String(s).toLowerCase());
      for (const text of sources) {
        for (const kc of KNOWN_COLORS) {
          if (text.includes(kc)) { colors.push(kc); found = true; break; }
        }
        if (found) break;
      }
    }
  }
  return Array.from(new Set(colors.filter(Boolean)));
}

const OCCASION_FORMALITY: Record<string, number> = {
  'sports / gym': 0, 'beach': 0, 'outdoor': 1, 'everyday / casual': 1, 'travel': 1,
  'school': 2, 'party': 2, 'date': 3, 'dinner': 3,
  'work / office': 4, 'church': 4, 'interview': 5, 'wedding / formal event': 5,
};

function getOccasionFormality(occasion: string): number {
  const key = occasion.toLowerCase().trim();
  if (key in OCCASION_FORMALITY) return OCCASION_FORMALITY[key];
  for (const [k, v] of Object.entries(OCCASION_FORMALITY)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return 2;
}

function inferOutfitFormality(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>
): number {
  let sum = 0; let count = 0;
  for (const item of items) {
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    const t = (item.garment_type || '').toLowerCase();
    const desc = [w?.description, (w as any)?.ai_attributes?.description, w?.sub_category, item.name]
      .filter(Boolean).join(' ').toLowerCase();
    const colorTags = (w?.color_tags || []).map((c) => c.toLowerCase());
    let f = 2;
    if (desc.match(/\b(gown|evening|cocktail|blazer|suit|tuxedo|formal|tailored|dress pants|trousers)\b/)) f = 5;
    else if (desc.match(/\b(chino|button.?down|collared|loafer|oxford|heels?|midi dress|wrap dress)\b/)) f = 4;
    else if (desc.match(/\b(jeans?|denim|polo|casual|sneaker|sweatshirt|hoodie)\b/)) f = 2;
    else if (desc.match(/\b(running|gym|athletic|workout|sports?|jersey|training|shorts)\b/)) f = 0;
    else if (desc.match(/\b(swimwear|bikini|beach|flip.?flop|sandal)\b/)) f = 0;
    if (t.includes('shoe') || t.includes('heel') || t.includes('boot')) {
      if (desc.match(/\b(sneaker|trainer|running|canvas)\b/)) f = Math.min(f, 2);
      else if (desc.match(/\b(heel|pump|oxford|loafer|derby)\b/)) f = Math.max(f, 4);
    }
    if (colorTags.some((c) => c.includes('neon'))) f = Math.min(f, 1);
    sum += f; count++;
  }
  return count > 0 ? sum / count : 2;
}

export function gradeOutfit(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>,
  context?: OutfitContext,
  profile?: UserStyleProfileDto | null
): StylistCritique {
  const occasion = context?.occasion ?? '';
  const additionalContext = (context?.additionalContext ?? '').toLowerCase();

  if (!items || items.length === 0) {
    return {
      score: 0, grade: 'D',
      headline: 'Mannequin is Empty',
      verdict: "Add at least one garment to the mannequin, then tap Stylist to get JeZsy's evaluation.",
      pillars: {
        colorHarmony: { score: 0, status: 'alert', title: 'No Colors Detected', feedback: 'Dress the mannequin to begin color evaluation.' },
        compositionAndLayers: { score: 0, status: 'alert', title: 'No Garments', feedback: 'No garments are currently on the canvas.' },
      },
      tips: ['Tap any garment in the wardrobe drawer below to dress the mannequin.'],
      vibe: 'Unstyled', paletteColors: [],
    };
  }

  // Classify garment slots
  const baseTops: MannequinCanvasItem[] = [];
  const outers: MannequinCanvasItem[] = [];
  const bottoms: MannequinCanvasItem[] = [];
  const fullBodyItems: MannequinCanvasItem[] = [];
  const shoes: MannequinCanvasItem[] = [];
  const accessories: MannequinCanvasItem[] = [];

  for (const item of items) {
    const t = (item.garment_type || '').toLowerCase();
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    const desc = [w?.description, (w as any)?.ai_attributes?.description, w?.sub_category, item.name]
      .filter(Boolean).join(' ').toLowerCase();

    const isFullBody = t.includes('dress') || t.includes('jumpsuit') || t.includes('romper')
      || t.includes('gown') || t.includes('swimsuit')
      || desc.match(/\b(jumpsuit|romper|gown|overalls|one.?piece|swimsuit)\b/) !== null;

    const isOuterwear = t.includes('outerwear') || t.includes('jacket') || t.includes('blazer')
      || t.includes('coat') || t.includes('cardigan')
      || desc.match(/\b(blazer|jacket|coat|cardigan|vest|windbreaker)\b/) !== null;

    const isShoe = t.includes('shoe') || t.includes('heel') || t.includes('boot')
      || t.includes('sneaker') || t.includes('sandal')
      || desc.match(/\b(shoes?|sneakers?|heels?|boots?|loafers?|sandals?|pumps?|oxfords?|flats?)\b/) !== null;

    const isBottom = !isFullBody && !isOuterwear && !isShoe && (
      t.includes('bottom') || t.includes('pant') || t.includes('jean') || t.includes('skirt')
      || t.includes('short') || t.includes('trouser')
      || desc.match(/\b(pants?|jeans?|trousers?|skirt|shorts?|slacks)\b/) !== null
    );

    const isTop = !isFullBody && !isOuterwear && !isShoe && !isBottom && (
      t.includes('top') || t.includes('shirt') || t.includes('blouse') || t.includes('sweater')
      || t.includes('bra') || t.includes('tee') || t.includes('tank')
      || desc.match(/\b(shirt|blouse|tee|polo|sweater|knitwear|crop.?top)\b/) !== null
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
  const hasAccessory = accessories.length > 0;
  const hasBodyCoverage = hasDressOrFullBody || (hasTop && hasBottom) || (hasOuterwear && (hasTop || hasBottom));

  const occasionFormality = getOccasionFormality(occasion);
  const outfitFormality = inferOutfitFormality(items, wardrobeLookup);
  const isFormalOccasion = occasionFormality >= 4;
  const isAthleticOccasion = occasion.toLowerCase().match(/\b(sport|gym|athletic)\b/) !== null;
  const isBeachOccasion = occasion.toLowerCase().includes('beach');
  const mentionsRain = additionalContext.match(/\b(rain|wet|umbrella|waterproof)\b/) !== null;
  const mentionsWalking = additionalContext.match(/\b(walk|walking|lot of walking|standing)\b/) !== null;

  const tips: string[] = [];
  let isOvercrowded = false;
  let whatsMissing: string | undefined;

  // Composition scoring
  let compScore = 85;
  let compTitle = 'Balanced Ensemble';
  let compFeedback = 'Solid garment foundation.';
  let compStatus: StylePillarBreakdown['status'] = 'good';

  if (baseTops.length > 1) {
    isOvercrowded = true;
    compScore = Math.max(30, 85 - (baseTops.length - 1) * 25);
    compStatus = 'warning';
    compTitle = `Overcrowded — ${baseTops.length} Competing Tops`;
    compFeedback = `${baseTops.length} separate tops are on the mannequin at once. Choose one base top and optionally layer a jacket.`;
    tips.unshift(`Remove ${baseTops.length - 1} extra top(s) so one hero top leads the look.`);
  } else if (bottoms.length > 1) {
    isOvercrowded = true;
    compScore = Math.max(30, 85 - (bottoms.length - 1) * 30);
    compStatus = 'warning';
    compTitle = `Conflicting Bottoms — ${bottoms.length} Bottoms`;
    compFeedback = 'Multiple separate bottoms are on the mannequin. Choose one trouser or a single skirt.';
    tips.unshift('Choose either pants or a skirt, not both at once.');
  } else if (hasDressOrFullBody && (hasTop || hasBottom)) {
    isOvercrowded = true;
    compScore = Math.max(35, compScore - 25);
    compStatus = 'warning';
    compTitle = 'Conflicting: Dress + Separates';
    compFeedback = 'A dress or jumpsuit already covers the full body. Stacking separate tops or bottoms creates unnecessary volume.';
    tips.unshift('Remove separate tops/bottoms when wearing a dress (layer a jacket over it instead).');
  }

  if (!isOvercrowded) {
    if (hasDressOrFullBody) {
      compScore = 92; compStatus = 'good';
      compTitle = 'Complete One-Piece Ensemble';
      compFeedback = 'A dress or jumpsuit provides full coverage as a standalone piece.';
      if (hasShoes) {
        compScore = Math.min(100, compScore + 5);
        compTitle = 'Complete Head-to-Toe Look';
        compFeedback += ' Footwear anchors the silhouette.';
      } else if (isFormalOccasion) {
        compScore -= 10;
        compFeedback += ' Adding shoes would complete this for the selected occasion.';
        tips.push('Add formal shoes to complete this look.');
        whatsMissing = `Footwear — adding shoes would complete this look for the ${occasion} occasion.`;
      } else {
        compScore -= 5;
        compFeedback += ' Footwear would anchor the proportion further.';
      }
    } else if (hasTop && hasBottom) {
      compScore = 88; compStatus = 'good';
      compTitle = 'Complete Separates';
      compFeedback = 'A clear top and bottom form a solid foundation.';
      if (hasShoes) {
        compScore = Math.min(100, compScore + 7);
        compTitle = 'Complete Head-to-Toe Look';
        compFeedback = 'Head-to-toe styling with dedicated footwear.';
      } else if (isFormalOccasion) {
        compScore -= 12;
        compFeedback += ` For a ${occasion}, shoes are an important part of the complete look.`;
        tips.push('Add shoes to complete this look for the selected occasion.');
        whatsMissing = `Footwear — adding shoes would complete this look for the ${occasion} occasion.`;
      } else {
        compScore -= 6;
        compFeedback += ' Adding footwear would polish the final look.';
        tips.push('Add shoes or heels to anchor the silhouette.');
      }
    } else if (hasTop || (hasOuterwear && !hasBottom)) {
      compScore = 48; compStatus = 'warning';
      compTitle = items.length === 1 ? 'Incomplete Ensemble' : 'Missing Lower-Body Piece';
      compFeedback = 'A top is present but the outfit needs a lower-body piece to be wearable.';
      tips.push('Add trousers, a skirt, or shorts to complete the foundation.');
      whatsMissing = 'Bottom — the outfit has a top but no lower-body piece (trousers, skirt, or shorts).';
    } else if (hasBottom) {
      compScore = 45; compStatus = 'warning';
      compTitle = 'Missing Top';
      compFeedback = 'A bottom piece is present but the outfit needs a top to be complete.';
      tips.push('Add a shirt, blouse, or top to complete the look.');
      whatsMissing = 'Top — the outfit has a bottom piece but no upper-body garment.';
    } else {
      compScore = 35; compStatus = 'alert';
      compTitle = 'No Core Garments';
      compFeedback = 'The mannequin only has accessories. Add a dress, top + bottom, or jumpsuit.';
      whatsMissing = 'Core garments — add a dress, top + bottom, or jumpsuit to create a wearable outfit.';
    }
    if (hasOuterwear && hasBodyCoverage) { compScore = Math.min(100, compScore + 4); compFeedback += ' Layering with outerwear adds depth and structure.'; }
    if (hasAccessory) { compScore = Math.min(100, compScore + 2); compFeedback += ' An accessory adds a refined finishing touch.'; }
  }

  compScore = Math.max(15, Math.min(100, compScore));
  if (compScore >= 90) compStatus = 'excellent';
  else if (compScore >= 75) compStatus = 'good';
  else if (compScore >= 60) compStatus = 'warning';
  else compStatus = 'alert';

  // Color harmony
  const paletteColors = extractColors(items, wardrobeLookup);
  const colorEval: ColorMatchResult = evaluateColors(paletteColors);
  const NEUTRAL_COLORS = new Set(['black', 'white', 'charcoal', 'grey', 'gray', 'navy', 'beige', 'cream', 'brown', 'tan', 'camel', 'khaki']);

  const statementPiece = items.find((item) => {
    const w = wardrobeLookup?.[item.wardrobe_item_id];
    const pat = (((w as any)?.pattern || (w as any)?.ai_attributes?.pattern) || '').toLowerCase();
    const desc = [w?.description, (w as any)?.ai_attributes?.description, item.name, w?.sub_category].filter(Boolean).join(' ').toLowerCase();
    return pat.includes('graphic') || pat.includes('multicolor') || pat.includes('floral') || pat.includes('plaid')
      || desc.includes('graphic') || desc.includes('colorful') || (w?.color_tags || []).length >= 3;
  });

  const hasNeutralBlazerOrOuter = outers.some((o) => {
    const w = wardrobeLookup?.[o.wardrobe_item_id];
    const name = (o.name || w?.sub_category || w?.category || '').toLowerCase();
    const cols = (w?.color_tags || []).map((c) => c.toLowerCase());
    return (name.includes('blazer') || name.includes('jacket') || name.includes('coat'))
      && (cols.length === 0 || cols.some((c) => NEUTRAL_COLORS.has(c)));
  });

  const hasCasualShoes = shoes.some((s) => {
    const w = wardrobeLookup?.[s.wardrobe_item_id];
    const name = (s.name || w?.sub_category || w?.category || '').toLowerCase();
    return name.includes('sneaker') || name.includes('flat') || name.includes('loafer');
  });

  const isStatementWithNeutralAnchor = !!statementPiece && (hasNeutralBlazerOrOuter || (hasCasualShoes && hasBodyCoverage));

  let colorScore = colorEval.score;
  let colorTitle = colorEval.label;
  let colorFeedback = colorEval.feedback;

  if (isStatementWithNeutralAnchor && (colorEval.label === 'Clashing Colors' || colorScore < 75)) {
    colorScore = 84;
    colorTitle = 'Balanced Accent Colors' as any;
    colorFeedback = 'Your colorful statement piece provides energy and focal contrast while neutral items ground the look.';
  }

  let colorStatus: StylePillarBreakdown['status'] = colorScore >= 88 ? 'excellent' : colorScore >= 75 ? 'good' : colorScore >= 60 ? 'warning' : 'alert';
  if (colorEval.label === 'Clashing Colors' && !isStatementWithNeutralAnchor) {
    tips.unshift('Try swapping one high-saturation piece for a neutral tone (cream, navy, or charcoal).');
  }

  // Analyze where_worn_often across all canvas items
  let whereWornBonus = 0;
  let whereWornNote = '';
  let whereWornConflict = '';
  if (occasion) {
    const occLower = occasion.toLowerCase();
    for (const item of items) {
      const w = wardrobeLookup?.[item.wardrobe_item_id];
      const wwo = (
        (w as any)?.where_worn_often ||
        (w as any)?.whereWornOften ||
        (w as any)?.ai_attributes?.whereWornOften ||
        ((w as any)?.occasions || []).join(' ')
      ).toLowerCase();
      if (!wwo) continue;

      const occKeywords = occLower.split(/[\s,/]+/).filter((k: string) => k.length > 2);
      const isMatch = occKeywords.some((k: string) => wwo.includes(k));
      if (isMatch && whereWornBonus < 8) {
        whereWornBonus += 5;
        if (!whereWornNote) {
          whereWornNote = `You noted wearing this piece often for ${wwo}, making it a natural fit for this occasion.`;
        }
      } else {
        const isAthleticPiece = wwo.match(/\b(gym|jogging|workout|running|sport)\b/) !== null;
        const isFormalOccasion = occLower.match(/\b(wedding|formal|gala|black tie|interview)\b/) !== null;
        if (isAthleticPiece && isFormalOccasion && !whereWornConflict) {
          whereWornConflict = `${item.name || 'This piece'} is noted for usual athletic wear (${wwo}), which contrasts with a ${occasion}.`;
        }
      }
    }
  }

  // Occasion fit
  const formalityGap = Math.abs(outfitFormality - occasionFormality);
  let occasionScore = Math.round(Math.max(0, Math.min(100, 100 - formalityGap * 12)));
  let occasionTitle = occasion ? `Matched to ${occasion}` : 'General Styling';
  let occasionFeedback = '';

  if (!occasion) {
    occasionScore = 80;
    occasionFeedback = 'No occasion specified. Score reflects general styling quality.';
  } else if (formalityGap === 0) {
    occasionScore = 95;
    occasionFeedback = `This outfit is well-calibrated for ${occasion}.`;
  } else if (outfitFormality > occasionFormality + 1) {
    occasionScore = Math.max(55, occasionScore);
    occasionTitle = `Slightly Overdressed for ${occasion}`;
    occasionFeedback = `The outfit reads more formal than ${occasion} typically requires. Consider more relaxed pieces.`;
  } else if (outfitFormality < occasionFormality - 1) {
    occasionScore = Math.max(45, occasionScore);
    occasionTitle = `Under-dressed for ${occasion}`;
    occasionFeedback = formalityGap >= 2
      ? `The outfit may read too casually for ${occasion}. Adding a more formal layer or footwear would elevate it.`
      : `The outfit is close but a small step up — like cleaner footwear — would bridge the gap for ${occasion}.`;
    tips.push(`Add a more formal piece (blazer, dress shoes) to better match the ${occasion} context.`);
  } else {
    occasionScore = Math.max(70, occasionScore);
    occasionFeedback = `The outfit is mostly appropriate for ${occasion} with minor adjustments possible.`;
  }

  occasionScore = Math.min(100, occasionScore + whereWornBonus);
  if (whereWornConflict) {
    occasionScore = Math.max(25, occasionScore - 12);
  }
  if (whereWornNote) {
    occasionFeedback = occasionFeedback ? `${occasionFeedback} ${whereWornNote}` : whereWornNote;
  }
  if (whereWornConflict) {
    occasionFeedback = occasionFeedback ? `${occasionFeedback} ${whereWornConflict}` : whereWornConflict;
    tips.push(whereWornConflict);
  }

  if (mentionsRain) {
    const hasRainCoat = outers.some((o) => {
      const desc = [wardrobeLookup?.[o.wardrobe_item_id]?.description, o.name].filter(Boolean).join(' ').toLowerCase();
      return desc.match(/\b(rain|waterproof|trench|windbreaker|mac)\b/) !== null;
    });
    if (!hasRainCoat) tips.push('Context mentions rain — consider adding a waterproof jacket or trench coat.');
  }

  if (mentionsWalking) {
    const hasHighHeels = shoes.some((s) => {
      const desc = [wardrobeLookup?.[s.wardrobe_item_id]?.description, s.name].filter(Boolean).join(' ').toLowerCase();
      return desc.match(/\b(high heel|stiletto|pump)\b/) !== null;
    });
    if (hasHighHeels) tips.push('Context mentions a lot of walking — high heels may be uncomfortable for extended periods.');
  }

  const occasionStatus: StylePillarBreakdown['status'] = occasionScore >= 85 ? 'excellent' : occasionScore >= 70 ? 'good' : occasionScore >= 55 ? 'warning' : 'alert';
  const occasionPillar: StylePillarBreakdown = { score: occasionScore, status: occasionStatus, title: occasionTitle, feedback: occasionFeedback };

  // Personalization via Style Profile
  let personalPillar: StylePillarBreakdown | undefined;
  let personalAffinityScore = 75;
  if (profile) {
    const resolvedWardrobeItems = items.map((i) => wardrobeLookup?.[i.wardrobe_item_id] || (i as any)).filter(Boolean);
    const affinity = computePersonalAffinity(resolvedWardrobeItems as WardrobeItem[], profile, occasion);
    personalAffinityScore = affinity.score;
    const personalStatus: StylePillarBreakdown['status'] =
      personalAffinityScore >= 85 ? 'excellent' : personalAffinityScore >= 70 ? 'good' : personalAffinityScore >= 55 ? 'warning' : 'alert';
    personalPillar = {
      score: personalAffinityScore,
      status: personalStatus,
      title: 'Style Profile Alignment',
      feedback: affinity.recommendationNote || 'Evaluated against your saved style preferences.',
    };
  }

  // Overall score
  const isBodyIncomplete = !hasDressOrFullBody && !(hasTop && hasBottom) && !hasOuterwear;
  const rawScore = (profile && profile.feedbackCount > 0)
    ? (colorScore * 0.35) + (compScore * 0.30) + (occasionScore * 0.20) + (personalAffinityScore * 0.15)
    : (colorScore * 0.45) + (compScore * 0.35) + (occasionScore * 0.20);
  let maxCap = 100;
  if (isOvercrowded) maxCap = 65;
  else if (isBodyIncomplete) maxCap = 58;
  else if (!hasShoes && isFormalOccasion) maxCap = 85;

  const overallScore = Math.max(10, Math.min(maxCap, Math.round(rawScore)));
  const grade = scoreToGrade(overallScore);

  const occasionLabel = occasion || 'this occasion';
  let headline = 'Refined & Harmonious';
  let verdict = 'This combination strikes a tasteful balance of color and structure.';
  let whatWorks: string | undefined = 'The pieces complement each other in tone and proportion.';
  let whatCouldBeBetter: string | undefined;
  let stylistTip = 'Keep accessories minimal to maintain a cohesive look.';

  if (isOvercrowded && baseTops.length > 1) {
    headline = 'Overcrowded Top Half';
    verdict = `You have ${baseTops.length} competing tops on the mannequin. Choose one hero top and optionally layer a jacket.`;
    whatWorks = 'The individual pieces each have strong style potential.';
    whatCouldBeBetter = 'Multiple tops at once create unnecessary bulk and compete for attention.';
    stylistTip = 'Commit to one hero top and use outerwear if you want a layered look.';
  } else if (isOvercrowded) {
    headline = 'Too Many Competing Garments';
    verdict = 'Simplify the layers so each piece has room to make its statement.';
    whatWorks = 'Individual pieces show great variety.';
    whatCouldBeBetter = 'Garment boundaries overlap, making the silhouette feel cluttered.';
    stylistTip = 'Aim for: one top (or dress), one bottom, and one outerwear layer maximum.';
  } else if (isBodyIncomplete) {
    headline = 'Not Ready for a Full Evaluation';
    verdict = `The outfit is missing core pieces needed to properly evaluate it for ${occasionLabel}.`;
    whatWorks = undefined;
    whatCouldBeBetter = whatsMissing ?? 'Add the missing core garments to get a meaningful compatibility score.';
    stylistTip = hasTop ? 'Pair your top with matching bottoms to create a wearable foundation.' : 'Add a top or dress to get started.';
  } else if (isStatementWithNeutralAnchor && hasNeutralBlazerOrOuter) {
    headline = 'Smart Casual Statement Look';
    verdict = `A modern high-low pairing where tailored structure frames a bold focal point. Well-matched for ${occasionLabel}.`;
    whatWorks = 'The blazer gives structure to the colorful piece while neutral tones keep it grounded.';
    whatCouldBeBetter = `The statement piece has strong colors — keep remaining accessories simple for ${occasionLabel}.`;
    stylistTip = 'Let one item stand out and use the others to frame it.';
  } else if (colorEval.label === 'Clashing Colors') {
    headline = 'Bold & High Contrast';
    verdict = `An adventurous pairing with high visual energy. Grounding one piece with a neutral would elevate it for ${occasionLabel}.`;
    whatWorks = 'High visual energy that shows personal confidence.';
    whatCouldBeBetter = 'Multiple saturated hues compete for the eye — a neutral anchor would balance it.';
    stylistTip = 'Replace one bold piece with a neutral (black, cream, or navy) to let a single color lead.';
  } else if (hasDressOrFullBody) {
    const dressW = wardrobeLookup?.[fullBodyItems[0].wardrobe_item_id];
    const dressDesc = [dressW?.description, (dressW as any)?.ai_attributes?.description, fullBodyItems[0].name].filter(Boolean).join(' ').toLowerCase();
    const hasBowTie = dressDesc.match(/\b(bow.?tie|pussy.?bow|bow neckline)\b/) !== null;
    const hasFitAndFlare = dressDesc.match(/\b(fit.?and.?flare|a.?line)\b/) !== null;
    const hasFitted = dressDesc.match(/\b(fitted waist|cinched)\b/) !== null;
    if (hasBowTie || hasFitAndFlare || hasFitted) {
      headline = 'Graceful & Tailored';
      verdict = `A polished one-piece ensemble with deliberate neckline and waist proportions, well-suited for ${occasionLabel}.`;
      const highlights: string[] = [];
      if (hasBowTie) highlights.push('the bow-tie neckline');
      if (hasFitAndFlare || hasFitted) highlights.push('the fitted waist shaping');
      whatWorks = `The dress creates an elegant vertical line${highlights.length > 0 ? `, accented by ${highlights.join(' and ')}` : ''}.`;
      whatCouldBeBetter = hasShoes ? `Ensure footwear matches the formality of ${occasionLabel}.` : 'Adding footwear would anchor the proportion and polish the finish.';
      stylistTip = 'Keep accessories clean to let the neckline remain the focal point.';
    } else if (overallScore >= 82) {
      headline = 'Chic & Cohesive';
      verdict = `A well-composed outfit with good color chemistry, suited for ${occasionLabel}.`;
      whatWorks = 'The outfit creates a clean, streamlined silhouette.';
      whatCouldBeBetter = hasShoes ? 'Ensure accessories complement the garment tone.' : 'Add footwear to complete the look.';
      stylistTip = 'A minimalist necklace or earrings would finish the look elegantly.';
    } else {
      headline = 'Solid Foundation';
      verdict = `A good base look that can be better calibrated for ${occasionLabel} with small adjustments.`;
      whatWorks = 'The silhouette is clean and versatile.';
      whatCouldBeBetter = occasionFeedback || 'Refine the footwear or accessory choices for the occasion.';
      stylistTip = hasShoes ? 'The look is solid — small accessory touches will elevate it.' : 'Add shoes to anchor the look.';
    }
  } else if (overallScore >= 88) {
    headline = 'Masterfully Balanced';
    verdict = `A cohesive outfit with excellent color chemistry and deliberate proportions, well-matched for ${occasionLabel}.`;
    whatWorks = 'Flawless synergy between garment silhouettes and color tones.';
    whatCouldBeBetter = 'Nothing critical — the look is exceptionally well-styled.';
    stylistTip = 'Add a minimalist watch or delicate jewelry to finish the look.';
  } else if (overallScore >= 78) {
    headline = 'Polished & Versatile';
    verdict = `A well-composed outfit that feels intentional and easy, good for ${occasionLabel}.`;
    whatWorks = 'Balanced proportions and harmonious tones.';
    whatCouldBeBetter = occasionFeedback || 'A small accent piece can add an extra layer of interest.';
    stylistTip = `Choose footwear that matches the formality of ${occasionLabel}.`;
  } else if (overallScore >= 65) {
    headline = 'Good Start';
    verdict = `The pieces have potential but need some refinement to fully match ${occasionLabel}.`;
    whatWorks = 'Good individual pieces with styling potential.';
    whatCouldBeBetter = occasionFeedback || 'Adjust the formality or colors for a more cohesive result.';
    stylistTip = 'Focus on one area — color, formality, or completeness — to lift the score.';
  } else {
    headline = 'Needs Work';
    verdict = `The outfit has some challenges for ${occasionLabel}. Let JeZsy help identify what to adjust.`;
    whatWorks = undefined;
    whatCouldBeBetter = whatsMissing ?? occasionFeedback ?? 'Review the garment combination and occasion match.';
    stylistTip = 'Start with the structural gaps, then refine the colors.';
  }

  let vibe = 'Modern Casual';
  if (isStatementWithNeutralAnchor) vibe = 'Smart-Casual Statement';
  else if (isOvercrowded) vibe = 'Layering Experiment';
  else if (isAthleticOccasion) vibe = 'Athleisure';
  else if (isBeachOccasion) vibe = 'Beach Ready';
  else if (hasOuterwear && outers.some((o) => (o.name || '').toLowerCase().includes('blazer'))) vibe = 'Smart Tailored';
  else if (hasDressOrFullBody) vibe = 'Effortless Elegance';
  else if (colorEval.label === 'Clashing Colors') vibe = 'Avant-Garde';
  else if (colorEval.label === 'Perfect Harmony' && paletteColors.some((c) => ['cream', 'black', 'charcoal', 'navy'].includes(c.toLowerCase()))) vibe = 'Quiet Luxury';
  else if (isFormalOccasion) vibe = 'Formal & Polished';

  if (tips.length === 0) {
    tips.push('The silhouette and colors are well-balanced. Style with minimalist jewelry for the finishing touch.');
  }

  return {
    score: overallScore, grade, headline, verdict,
    whatWorks: whatWorks || undefined,
    whatCouldBeBetter: whatCouldBeBetter || undefined,
    stylistTip, whatsMissing,
    pillars: {
      colorHarmony: { score: colorScore, status: colorStatus, title: colorTitle, feedback: colorFeedback },
      compositionAndLayers: { score: compScore, status: compStatus, title: compTitle, feedback: compFeedback },
      occasionFit: occasion ? occasionPillar : undefined,
      personalPreference: personalPillar,
    },
    tips: tips.slice(0, 3), vibe, paletteColors, isOvercrowded,
  };
}
