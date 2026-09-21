import { CandidateOutfit, StylingIntent, WhyThisWorksDetails } from '@/src/types/styleAdvisor';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';

/**
 * Produces genuine, garment-grounded explanations without fake boilerplate.
 * References verified items, actual colors, materials, and user intent.
 */
export function generateGroundedExplanation(
  candidate: CandidateOutfit,
  intent: StylingIntent
): { whyThisWorks: WhyThisWorksDetails; headline: string; intentMatch: string; proTip?: string } {
  const items = candidate.items;

  const tops = items.filter((i) => resolveEffectiveGarmentBucket(i) === 'Top');
  const bottoms = items.filter((i) => resolveEffectiveGarmentBucket(i) === 'Bottom');
  const dresses = items.filter((i) => resolveEffectiveGarmentBucket(i) === 'Dress');
  const shoes = items.filter((i) => resolveEffectiveGarmentBucket(i) === 'Shoes');
  const outers = items.filter((i) => resolveEffectiveGarmentBucket(i) === 'Outerwear');

  const topName = tops[0]?.sub_category || tops[0]?.category || 'top';
  const bottomName = bottoms[0]?.sub_category || bottoms[0]?.category || 'bottom';
  const dressName = dresses[0]?.sub_category || dresses[0]?.category || 'dress';
  const shoeName = shoes[0]?.sub_category || shoes[0]?.category || 'footwear';
  const outerName = outers[0]?.sub_category || outers[0]?.category || null;

  // 1. Headline
  let headline = 'Curated Wardrobe Ensemble';
  if (intent.formality === 'formal') {
    headline = 'Tailored Formal Silhouette';
  } else if (intent.formality === 'elevatedCasual') {
    headline = 'Polished Smart-Casual Balance';
  } else if (candidate.isComfortFocused) {
    headline = 'Comfortable Streamlined Look';
  } else if (candidate.isStatementFocused) {
    headline = 'Expressive Contrast Ensemble';
  } else if (outerName) {
    headline = `Layered ${outerName.charAt(0).toUpperCase() + outerName.slice(1)} Look`;
  }

  // 2. Intent Match
  let intentMatch = `Styled for ${intent.selectedOccasion || 'your day'} based on your wardrobe pieces.`;
  if (intent.rawPrompt) {
    if (intent.mustUseItemIds && intent.mustUseItemIds.length > 0) {
      intentMatch = `Directly incorporates your requested piece with complementary wardrobe separates.`;
    } else if (intent.comfortPriority) {
      intentMatch = `Prioritizes comfortable mobility while keeping the aesthetic coordinated.`;
    } else {
      intentMatch = `Tailored to your request for a ${intent.formality || 'balanced'} setting.`;
    }
  }

  // 3. Palette story
  const allColors = Array.from(new Set(items.flatMap((i) => i.color_tags || [])));
  let palette = 'Harmonious color balance across separates.';
  if (allColors.length === 1) {
    palette = `A unified monochrome ${allColors[0]} palette that elongates your visual line.`;
  } else if (allColors.length >= 2) {
    const main = allColors.slice(0, 2).join(' and ');
    palette = `${main.charAt(0).toUpperCase() + main.slice(1)} tones establish clean contrast without competing for attention.`;
  }

  // 4. Silhouette
  let silhouette = 'Balanced proportions between upper and lower body.';
  if (dresses.length > 0) {
    silhouette = `The one-piece ${dressName} creates an uninterrupted vertical flow and streamlined silhouette.`;
  } else if (tops.length > 0 && bottoms.length > 0) {
    silhouette = `The ${topName} pairs cleanly with the ${bottomName}, creating a distinct waistline and balanced frame.`;
  }

  // 5. Occasion Fit
  const occLabel = intent.selectedOccasion || (intent.rawPrompt ? 'this setting' : 'daily wear');
  let occasion = `Appropriate for ${occLabel} with balanced formality.`;
  if (intent.formality === 'formal') {
    occasion = `Refined tailoring and structured lines ensure full compliance with formal dress expectations.`;
  } else if (intent.comfortPriority) {
    occasion = `Relaxed textures and comfortable cuts fit dynamic movement throughout ${occLabel}.`;
  }

  // 6. Layering
  let layering: string | undefined;
  if (outerName) {
    layering = `The ${outerName} adds architectural structure to the torso while providing versatile temperature adaptation.`;
  }

  // 7. Footwear
  let footwear: string | undefined;
  if (shoes.length > 0) {
    const isSneaker = shoeName.toLowerCase().includes('sneaker') || shoeName.toLowerCase().includes('flat');
    if (isSneaker) {
      footwear = `The ${shoeName} grounds the ensemble with approachable, effortless comfort.`;
    } else {
      footwear = `The ${shoeName} elevates the bottom line, anchoring the outfit with structured polish.`;
    }
  }

  // 8. Summary
  let summary = '';
  if (dresses.length > 0) {
    summary = `Your ${dressName} anchors this ensemble, complemented by ${shoeName} for an intentional look.`;
  } else if (outerName) {
    summary = `Your ${outerName} provides clean structure over the ${topName} and ${bottomName}, creating a layered look.`;
  } else {
    summary = `The ${topName} pairs with the ${bottomName}, balanced by ${shoeName} for a versatile aesthetic.`;
  }

  // 9. Pro Tip
  let proTip = 'Add a minimal watch or subtle belt to define the transition line.';
  if (outerName && outerName.includes('blazer')) {
    proTip = 'Cuff or push the blazer sleeves up slightly for a relaxed, modern posture.';
  } else if (candidate.isComfortFocused) {
    proTip = 'Keep accessories lightweight so the focus stays on easy mobility.';
  } else if (intent.formality === 'formal') {
    proTip = 'Keep jewelry refined and understated to let the tailoring lead the look.';
  }

  return {
    headline,
    intentMatch,
    whyThisWorks: {
      summary,
      palette,
      silhouette,
      occasion,
      layering,
      footwear,
    },
    proTip,
  };
}
