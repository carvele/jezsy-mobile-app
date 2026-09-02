/* eslint-disable */
/**
 * aiStylistAdvisor.ts
 * Deterministic Fashion Stylist & Outfit Grader Engine for the Mannequin.
 *
 * Evaluates garment combinations based on classical color theory (HSL hue distance,
 * saturation tension, neutral anchoring, metallic harmony) and garment-to-garment
 * composition rules (top+bottom, layering, footwear balance, duplicate slot detection).
 *
 * Pure, deterministic, and 100% reproducible.
 */

import { evaluateColors, ColorMatchResult } from './colorMatcher';
import { MannequinCanvasItem, WardrobeItem } from './mannequinConfig';

export type GradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D';

export interface StylePillarBreakdown {
  score: number; // 0 to 100
  status: 'excellent' | 'good' | 'warning' | 'alert';
  title: string;
  feedback: string;
}

export interface StylistCritique {
  score: number; // 0 to 100
  grade: GradeLetter;
  headline: string;
  verdict: string;
  pillars: {
    colorHarmony: StylePillarBreakdown;
    compositionAndLayers: StylePillarBreakdown;
  };
  tips: string[];
  vibe: string;
  paletteColors: string[];
  isOvercrowded?: boolean;
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
  'ivory', 'neon green', 'neon pink', 'neon yellow', 'neon'
];

/**
 * Extracts normalized color tags from canvas items, wardrobe lookups, or garment names.
 */
export function extractColors(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>
): string[] {
  const colors: string[] = [];

  for (const item of items) {
    const matchingWardrobe = wardrobeLookup?.[item.wardrobe_item_id];
    let found = false;

    if (matchingWardrobe?.color_tags && matchingWardrobe.color_tags.length > 0) {
      colors.push(...matchingWardrobe.color_tags);
      found = true;
    } else if ((matchingWardrobe as any)?.color) {
      colors.push((matchingWardrobe as any).color);
      found = true;
    }

    // Inspect item name, sub_category, category if not found
    const textSources = [
      item.name,
      matchingWardrobe?.sub_category,
      matchingWardrobe?.category,
      (item as any).color,
    ].filter(Boolean).map((s) => String(s).toLowerCase());

    for (const text of textSources) {
      for (const kc of KNOWN_COLORS) {
        if (text.includes(kc)) {
          colors.push(kc);
          found = true;
          break;
        }
      }
    }
  }

  return Array.from(new Set(colors.filter(Boolean)));
}

/**
 * Grades the outfit styled on the mannequin canvas with honest, realistic critique.
 */
export function gradeOutfit(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>
): StylistCritique {
  if (!items || items.length === 0) {
    return {
      score: 0,
      grade: 'D',
      headline: 'Mannequin is Empty',
      verdict: 'Add at least one top, bottom, or dress to receive a fashion critique.',
      pillars: {
        colorHarmony: {
          score: 0,
          status: 'alert',
          title: 'No Colors Detected',
          feedback: 'Dress the mannequin to begin color harmony evaluation.',
        },
        compositionAndLayers: {
          score: 0,
          status: 'alert',
          title: 'Incomplete Look',
          feedback: 'No garments are currently on the canvas.',
        },
      },
      tips: ['Tap any garment in the wardrobe drawer below to dress the mannequin.'],
      vibe: 'Unstyled',
      paletteColors: [],
    };
  }

  // 1. Classify garment items by specific structural roles
  const baseTops: MannequinCanvasItem[] = [];
  const outers: MannequinCanvasItem[] = [];
  const bottoms: MannequinCanvasItem[] = [];
  const dresses: MannequinCanvasItem[] = [];
  const shoes: MannequinCanvasItem[] = [];
  const accessories: MannequinCanvasItem[] = [];

  for (const item of items) {
    const t = (item.garment_type || '').toLowerCase();
    if (t.includes('outerwear') || t.includes('jacket') || t.includes('blazer') || t.includes('coat') || t.includes('cardigan')) {
      outers.push(item);
    } else if (t.includes('top') || t.includes('shirt') || t.includes('blouse') || t.includes('sweater') || t.includes('bra') || t.includes('tee')) {
      baseTops.push(item);
    } else if (t.includes('bottom') || t.includes('pant') || t.includes('jean') || t.includes('skirt') || t.includes('short') || t.includes('trouser')) {
      bottoms.push(item);
    } else if (t.includes('dress') || t.includes('jumpsuit') || t.includes('romper') || t.includes('gown') || t.includes('swimsuit')) {
      dresses.push(item);
    } else if (t.includes('shoe') || t.includes('heel') || t.includes('boot') || t.includes('sneaker') || t.includes('sandal')) {
      shoes.push(item);
    } else {
      accessories.push(item);
    }
  }

  const hasDress = dresses.length > 0;
  const hasTop = baseTops.length > 0;
  const hasBottom = bottoms.length > 0;
  const hasOuterwear = outers.length > 0;
  const hasShoes = shoes.length > 0;
  const hasAccessory = accessories.length > 0;

  // 2. Overcrowding & Duplicate Slot Checks (Brutal Honesty)
  let isOvercrowded = false;
  let compScore = 85;
  let compTitle = 'Balanced Ensemble';
  let compFeedback = 'Solid garment foundation with clear proportions.';
  let compStatus: StylePillarBreakdown['status'] = 'good';
  const tips: string[] = [];

  // Check 2A: Multiple competing base tops (e.g. 3 shirts/blouses simultaneously)
  if (baseTops.length > 1) {
    isOvercrowded = true;
    const extraTops = baseTops.length - 1;
    compScore -= extraTops * 25; // Heavily penalize multiple competing tops
    compStatus = 'warning';
    compTitle = `Overcrowded Canvas (${baseTops.length} Competing Tops)`;
    compFeedback = `You currently have ${baseTops.length} separate tops on the mannequin. In realistic styling, commit to one base top (with an optional outerwear jacket) so the look doesn't feel cluttered.`;
    tips.unshift(`Remove ${extraTops} extra top(s) to let one clear hero top lead the outfit.`);
  }

  // Check 2B: Multiple competing bottoms (e.g. 2 skirts or pants + skirt)
  if (bottoms.length > 1) {
    isOvercrowded = true;
    const extraBottoms = bottoms.length - 1;
    compScore -= extraBottoms * 30;
    compStatus = 'warning';
    compTitle = `Conflicting Bottoms (${bottoms.length} Bottoms)`;
    compFeedback = `Multiple separate bottoms are on the mannequin at once. Choose one pair of trousers or a single skirt.`;
    tips.unshift('Choose either pants or a skirt, not both together.');
  }

  // Check 2C: Dress stacked with separate tops/bottoms
  if (hasDress && (hasTop || hasBottom)) {
    isOvercrowded = true;
    compScore -= 25;
    compStatus = 'warning';
    compTitle = 'Conflicting Dress & Separates';
    compFeedback = 'A dress functions as a complete full-body piece. Stacking separate tops or bottoms creates volume conflicts unless styled as an outerwear jacket.';
    tips.unshift('Remove separate tops/bottoms when wearing a dress (or layer a jacket over it).');
  }

  // Check 2D: Single item on canvas
  if (items.length === 1 && !hasDress) {
    compScore = 50;
    compStatus = 'warning';
    compTitle = 'Incomplete Ensemble';
    compFeedback = hasTop
      ? 'Currently styled with only a top. Pair with trousers, a skirt, or shorts to complete the look.'
      : 'Currently styled with only bottoms. Add a complementary top or blouse.';
    tips.push(hasTop ? 'Add matching bottoms or trousers to complete the foundation.' : 'Add a top or blouse to finish the base look.');
  } else if (!hasDress && (!hasTop || !hasBottom) && !hasOuterwear && !isOvercrowded) {
    compScore = 55;
    compStatus = 'warning';
    compTitle = 'Missing Core Piece';
    compFeedback = 'The outfit is missing either a top or bottom to form a wearable foundation.';
    tips.push('Pair your separates together for a complete look.');
  } else if (!isOvercrowded) {
    // Normal complete ensemble
    compScore = 90;
    compStatus = 'good';

    if (hasShoes) {
      compScore += 5;
      compTitle = 'Complete Head-to-Toe Look';
      compFeedback = 'Excellent head-to-toe styling with dedicated footwear anchoring the silhouette.';
    } else {
      compScore -= 8;
      compFeedback = 'Solid base ensemble. Adding footwear will anchor the proportion and polish the finish.';
      tips.push('Add shoes or heels to ground the full silhouette.');
    }

    if (hasOuterwear) {
      compScore += 5;
      compFeedback += ' Layering with outerwear adds sophisticated depth and structure.';
    }

    if (hasAccessory) {
      compScore += 3;
      compFeedback += ' An accessory adds a refined accent.';
    }
  }

  compScore = Math.max(15, Math.min(100, compScore));
  if (compScore >= 90) compStatus = 'excellent';
  else if (compScore >= 75) compStatus = 'good';
  else if (compScore >= 60) compStatus = 'warning';
  else compStatus = 'alert';

  // 3. Evaluate Color Harmony Pillar
  const paletteColors = extractColors(items, wardrobeLookup);
  const colorEval: ColorMatchResult = evaluateColors(paletteColors);

  let colorScore = colorEval.score;
  let colorStatus: StylePillarBreakdown['status'] = 'good';

  if (colorScore >= 88) colorStatus = 'excellent';
  else if (colorScore >= 75) colorStatus = 'good';
  else if (colorScore >= 60) colorStatus = 'warning';
  else colorStatus = 'alert';

  const colorPillar: StylePillarBreakdown = {
    score: colorScore,
    status: colorStatus,
    title: colorEval.label,
    feedback: colorEval.feedback,
  };

  if (colorEval.label === 'Clashing Colors') {
    tips.unshift('Try swapping one high-saturation piece for a neutral tone (cream, navy, or charcoal) to let one hero color lead.');
  } else if (paletteColors.length === 1 && !['black', 'white', 'gray', 'grey'].includes(paletteColors[0].toLowerCase())) {
    tips.push(`Introduce a quiet neutral anchor to give the bold ${paletteColors[0]} hue breathing room.`);
  }

  // 4. Compute Overall Score & Grade
  // Incomplete looks cap the max score so an unstyled top can't receive an A
  const rawWeightedScore = (colorScore * 0.45) + (compScore * 0.55);
  let maxCap = 100;
  if (isOvercrowded) maxCap = 68; // Overcrowded canvas cannot get above C+
  else if (items.length === 1 && !hasDress) maxCap = 65;

  const overallScore = Math.max(15, Math.min(maxCap, Math.round(rawWeightedScore)));
  const grade = scoreToGrade(overallScore);

  // 5. Generate Headline & Verdict
  let headline = 'Refined & Harmonious';
  let verdict = 'This combination strikes a tasteful balance of color and structure.';

  if (isOvercrowded && baseTops.length > 1) {
    headline = 'Overcrowded Top Half';
    verdict = `You have ${baseTops.length} competing tops floating on the mannequin. Choose one primary top and layer an outerwear jacket over it to create a clean, wearable silhouette.`;
  } else if (isOvercrowded) {
    headline = 'Cluttered Combination';
    verdict = 'Too many competing garments are stacked on the mannequin. Simplify the layers so each piece has room to shine.';
  } else if (colorEval.label === 'Clashing Colors') {
    headline = 'Bold & High Contrast';
    verdict = 'An adventurous, high-energy pairing, but the competing saturation creates visual tension. Grounding one piece will instantly elevate it.';
  } else if (overallScore >= 92) {
    headline = 'Chic & Masterfully Balanced';
    verdict = 'A cohesive ensemble with impeccable color chemistry and deliberate proportion. Ready to wear with confidence.';
  } else if (overallScore >= 80) {
    headline = 'Polished & Versatile';
    verdict = 'A well-composed outfit that feels intentional and effortless. Clean lines and great synergy.';
  } else if (overallScore >= 65) {
    headline = 'Casual & Expressive';
    verdict = 'A relaxed, easygoing combination. A minor tweak to layering or accessories will pull the look together.';
  } else {
    headline = 'Needs Harmonizing';
    verdict = 'The pieces are competing for focus. Focus on a single statement piece and build neutral structure around it.';
  }

  // 6. Deduce Style Vibe
  let vibe = 'Modern Casual';
  if (isOvercrowded) vibe = 'Layering Experiment';
  else if (hasOuterwear && (outers.some((o) => (o.name || '').toLowerCase().includes('blazer')))) vibe = 'Smart Tailored';
  else if (hasDress) vibe = 'Effortless Elegance';
  else if (colorEval.label === 'Clashing Colors') vibe = 'Avant-Garde Streetwear';
  else if (colorEval.label === 'Perfect Harmony' && paletteColors.some((c) => ['cream', 'black', 'charcoal', 'navy'].includes(c.toLowerCase()))) vibe = 'Quiet Luxury Minimalist';
  else if (baseTops.some((t) => (t.garment_type || '').toLowerCase().includes('bra') || (t.name || '').toLowerCase().includes('activewear'))) vibe = 'Athleisure Chic';

  if (tips.length === 0) {
    tips.push('The silhouette and colors are well-balanced. Style with minimalist jewelry for the final touch.');
  }

  return {
    score: overallScore,
    grade,
    headline,
    verdict,
    pillars: {
      colorHarmony: colorPillar,
      compositionAndLayers: {
        score: compScore,
        status: compStatus,
        title: compTitle,
        feedback: compFeedback,
      },
    },
    tips: tips.slice(0, 3),
    vibe,
    paletteColors,
    isOvercrowded,
  };
}
