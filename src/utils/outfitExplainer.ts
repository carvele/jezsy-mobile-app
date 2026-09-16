import { WardrobeItem } from '../services/wardrobeService';
import { ColorMatchResult } from './colorMatcher';
import { PersonalAffinityResult } from './personalStyleEngine';

export interface OutfitExplanation {
  headline: string; // e.g., "Harmonious & Tailored"
  summary: string;  // Natural language sentence explaining why this works
  colorStory: string;
  silhouetteNote: string;
  occasionFit: string;
  proTip: string;
}

/**
 * Generates an honest, grounded stylist explanation for an outfit
 */
export function explainOutfit(
  items: WardrobeItem[],
  colorMatch: ColorMatchResult,
  personalAffinity?: PersonalAffinityResult | null,
  targetOccasion?: string | null
): OutfitExplanation {
  // Extract item names and color tags
  const namesByType: Record<string, string[]> = {};
  const allColors: string[] = [];

  for (const item of items) {
    const type = item.garment_type || 'Piece';
    const name = item.sub_category || item.category || type;
    if (!namesByType[type]) namesByType[type] = [];
    namesByType[type].push(name);

    if (Array.isArray(item.color_tags)) {
      allColors.push(...item.color_tags);
    }
  }

  // 1. Color Story
  let colorStory = 'Clean visual palette.';
  if (colorMatch.label.includes('Neutral') || colorMatch.label.includes('Monochrome')) {
    colorStory = 'The cohesive neutral tones provide understated elegance without visual competition.';
  } else if (colorMatch.label.includes('Complementary')) {
    colorStory = 'The contrasting hues create an intentional visual pop anchored by balanced proportions.';
  } else if (colorMatch.label.includes('Analogous')) {
    colorStory = 'Adjacent color harmonies produce a seamless, calming gradient across your ensemble.';
  } else if (colorMatch.score >= 80) {
    colorStory = 'The selected color combination creates a pleasing, balanced contrast.';
  } else {
    colorStory = 'An expressive, high-contrast mix with noticeable visual contrast.';
  }

  // 2. Silhouette & Composition
  let silhouetteNote = 'Balanced top and bottom proportions.';
  const hasOuter = !!namesByType['Outerwear']?.length;
  const hasShoes = !!namesByType['Shoes']?.length;
  const hasDress = !!namesByType['Dress']?.length;

  if (hasDress) {
    silhouetteNote = 'A unified one-piece foundation creating a streamlined, elongated silhouette.';
  } else if (hasOuter) {
    silhouetteNote = 'Layering with outerwear adds depth, structure, and versatile temperature adjustment.';
  } else if (hasShoes) {
    silhouetteNote = 'Grounded by complementary footwear that completes the vertical line of the look.';
  }

  // 3. Occasion Fit
  const occ = targetOccasion || 'everyday';
  let occasionFit = `Suited for ${occ} settings with effortless comfort.`;
  if (occ.toLowerCase().includes('work') || occ.toLowerCase().includes('office')) {
    occasionFit = 'Structured styling appropriate for professional, focused environments.';
  } else if (occ.toLowerCase().includes('formal') || occ.toLowerCase().includes('wedding')) {
    occasionFit = 'Refined cut and tailored balance designed for formal celebrations.';
  } else if (occ.toLowerCase().includes('date') || occ.toLowerCase().includes('night')) {
    occasionFit = 'Subtle focal points and flattering lines well-suited for an evening out.';
  }

  // 4. Headline
  let headline = 'Likely to Work Well';
  if (colorMatch.score >= 88) {
    headline = 'Strong Visual Chemistry';
  } else if (personalAffinity && personalAffinity.score >= 85) {
    headline = 'Tailored to Your Favorites';
  } else if (hasOuter) {
    headline = 'Polished Layered Look';
  }

  // 5. Summary
  const topDesc = namesByType['Top']?.[0] || namesByType['Dress']?.[0] || 'foundation piece';
  const bottomDesc = namesByType['Bottom']?.[0] || (hasDress ? 'cut' : 'pairing');
  const summary = `These pieces balance well together because the ${topDesc} pairs naturally with the ${bottomDesc}, while the ${allColors.slice(0, 2).join(' and ') || 'palette'} establishes a clear color story.`;

  // 6. Pro Tip
  let proTip = 'Consider minimal jewelry or a leather belt to cleanly define the waistline.';
  if (personalAffinity?.negativeSignals.length) {
    proTip = `Tip: ${personalAffinity.negativeSignals[0]}. Try swapping an accessory if you prefer your classic routine.`;
  } else if (hasOuter) {
    proTip = 'Cuff the sleeves slightly for a modern, relaxed proportion.';
  }

  return {
    headline,
    summary,
    colorStory,
    silhouetteNote,
    occasionFit,
    proTip,
  };
}
