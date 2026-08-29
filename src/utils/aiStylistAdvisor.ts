/**
 * aiStylistAdvisor.ts
 * Deterministic Fashion Stylist & Outfit Grader Engine for the Mannequin.
 *
 * Evaluates garment combinations based on classical color theory (HSL hue distance,
 * saturation tension, neutral anchoring, metallic harmony) and garment-to-garment
 * composition rules (top+bottom, layering, footwear balance).
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

/**
 * Extracts normalized color tags from canvas items or their wardrobe lookups.
 */
export function extractColors(
  items: MannequinCanvasItem[],
  wardrobeLookup?: Record<string, WardrobeItem>
): string[] {
  const colors: string[] = [];

  for (const item of items) {
    const matchingWardrobe = wardrobeLookup?.[item.wardrobe_item_id];
    if (matchingWardrobe?.color_tags && matchingWardrobe.color_tags.length > 0) {
      colors.push(...matchingWardrobe.color_tags);
    } else if ((matchingWardrobe as any)?.color) {
      colors.push((matchingWardrobe as any).color);
    } else if (item.name) {
      // Extract color if present in name (e.g. "Orange Crop Top" -> "orange")
      const lowerName = item.name.toLowerCase();
      const knownColors = [
        'black', 'white', 'cream', 'beige', 'navy', 'blue', 'denim', 'gray', 'grey',
        'charcoal', 'red', 'crimson', 'burgundy', 'pink', 'rose', 'blush', 'orange',
        'rust', 'terracotta', 'yellow', 'mustard', 'gold', 'silver', 'green', 'olive',
        'sage', 'emerald', 'teal', 'purple', 'lavender', 'brown', 'tan', 'neon green',
        'neon pink', 'neon yellow', 'neon'
      ];
      for (const kc of knownColors) {
        if (lowerName.includes(kc)) {
          colors.push(kc);
          break;
        }
      }
    }
  }

  return Array.from(new Set(colors.filter(Boolean)));
}

/**
 * Grades the outfit styled on the mannequin canvas.
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

  // 1. Classify garment slots present
  const types = items.map((i) => (i.garment_type || 'Top').toLowerCase());
  const hasTop = types.some((t) => t.includes('top') || t.includes('shirt') || t.includes('blouse') || t.includes('sweater') || t.includes('bra'));
  const hasBottom = types.some((t) => t.includes('bottom') || t.includes('pant') || t.includes('jean') || t.includes('skirt') || t.includes('short') || t.includes('trouser'));
  const hasDress = types.some((t) => t.includes('dress') || t.includes('jumpsuit') || t.includes('romper') || t.includes('gown') || t.includes('swimsuit'));
  const hasOuterwear = types.some((t) => t.includes('outerwear') || t.includes('jacket') || t.includes('blazer') || t.includes('coat') || t.includes('cardigan'));
  const hasShoes = types.some((t) => t.includes('shoe') || t.includes('heel') || t.includes('boot') || t.includes('sneaker') || t.includes('sandal'));
  const hasAccessory = types.some((t) => t.includes('accessory') || t.includes('bag') || t.includes('jewelry') || t.includes('scarf') || t.includes('hat') || t.includes('belt'));

  // 2. Evaluate Composition & Layering Pillar
  let compScore = 85;
  let compTitle = 'Balanced Ensemble';
  let compFeedback = 'Solid garment foundation with clear proportions.';
  let compStatus: StylePillarBreakdown['status'] = 'good';
  const tips: string[] = [];

  if (items.length === 1 && !hasDress) {
    compScore = 50;
    compStatus = 'warning';
    compTitle = 'Incomplete Ensemble';
    compFeedback = hasTop
      ? 'Currently styled with only a top. Pair with trousers, a skirt, or shorts to complete the look.'
      : 'Currently styled with only bottoms. Add a complementary top or layering piece.';
    tips.push(hasTop ? 'Add matching bottoms or trousers to complete the foundation.' : 'Add a top or blouse to finish the base look.');
  } else if (!hasDress && (!hasTop || !hasBottom) && !hasOuterwear) {
    compScore = 55;
    compStatus = 'warning';
    compTitle = 'Missing Core Piece';
    compFeedback = 'The outfit is missing either a top or bottom to form a wearable foundation.';
    tips.push('Pair your separates together for a complete look.');
  } else {
    // Full base present (Top + Bottom or Dress)
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

  compScore = Math.max(20, Math.min(100, compScore));
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

  // Add specific color tips if clashing or saturated
  if (colorEval.label === 'Clashing Colors') {
    tips.unshift('Try swapping one high-saturation piece for a neutral tone (cream, navy, or charcoal) to let one hero color lead.');
  } else if (paletteColors.length === 1 && !['black', 'white', 'gray', 'grey'].includes(paletteColors[0].toLowerCase())) {
    tips.push(`Introduce a quiet neutral anchor to give the bold ${paletteColors[0]} hue breathing room.`);
  }

  // 4. Compute Overall Score & Grade
  // Incomplete looks cap the max score so an unstyled top can't receive an A
  const rawWeightedScore = (colorScore * 0.50) + (compScore * 0.50);
  const maxCap = items.length === 1 && !hasDress ? 65 : 100;
  const overallScore = Math.max(15, Math.min(maxCap, Math.round(rawWeightedScore)));
  const grade = scoreToGrade(overallScore);

  // 5. Generate Headline & Verdict
  let headline = 'Refined & Harmonious';
  let verdict = 'This combination strikes a tasteful balance of color and structure.';

  if (colorEval.label === 'Clashing Colors') {
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
  if (hasOuterwear && (types.includes('blazer') || types.includes('coat'))) vibe = 'Smart Tailored';
  else if (hasDress) vibe = 'Effortless Elegance';
  else if (colorEval.label === 'Clashing Colors') vibe = 'Avant-Garde Streetwear';
  else if (colorEval.label === 'Perfect Harmony' && paletteColors.some((c) => ['cream', 'black', 'charcoal', 'navy'].includes(c.toLowerCase()))) vibe = 'Quiet Luxury Minimalist';
  else if (types.some((t) => t.includes('bra') || t.includes('activewear'))) vibe = 'Athleisure Chic';

  // Ensure at least 1 tip exists
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
  };
}
