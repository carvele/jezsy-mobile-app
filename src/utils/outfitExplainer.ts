import { WardrobeItem } from '../services/wardrobeService';
import { ColorMatchResult } from './colorMatcher';
import { PersonalAffinityResult } from './personalStyleEngine';

export interface OutfitExplanation {
  headline: string;
  summary: string;
  colorStory: string;
  silhouetteNote: string;
  occasionFit: string;
  proTip: string;
  whyThisWorks?: string;
  whatCouldBeBetter?: string;
  stylingTip?: string;
  layeringNote?: string;
  footwearRelationship?: string;
  patternBalance?: string;
}

const NEUTRAL_COLORS = new Set([
  'black', 'white', 'charcoal', 'grey', 'gray', 'navy', 'beige', 'cream', 'brown', 'tan', 'camel', 'khaki'
]);

/**
 * Extracts verified garment material ONLY if explicitly present in the record
 * or user description. Never hallucinates or guesses unstated materials.
 */
function getVerifiedMaterial(item: WardrobeItem): string | null {
  const rawMaterial = (item as any).material || (item as any).ai_attributes?.material;
  if (rawMaterial && typeof rawMaterial === 'string' && rawMaterial.trim() && rawMaterial.toLowerCase() !== 'unknown' && rawMaterial.toLowerCase() !== 'other') {
    return rawMaterial.trim();
  }

  // Check user description for explicit material mention
  const desc = (item.description || (item as any).ai_attributes?.description || '').toLowerCase();
  const KNOWN_FABRICS = ['leather', 'denim', 'cotton', 'linen', 'silk', 'wool', 'polyester', 'knit', 'velvet', 'rayon', 'nylon', 'spandex', 'chiffon', 'satin'];
  for (const fabric of KNOWN_FABRICS) {
    if (new RegExp(`\\b${fabric}\\b`, 'i').test(desc)) {
      return fabric.charAt(0).toUpperCase() + fabric.slice(1);
    }
  }

  return null;
}

/**
 * Returns a grounded, honest garment reference without hallucinating unverified attributes.
 * E.g., if material is "Leather", returns "leather shoes"; if unknown, returns "shoes".
 */
function getGroundedItemLabel(item: WardrobeItem): string {
  const type = item.garment_type || 'Piece';
  const name = (item.sub_category || item.category || type).toLowerCase();
  const material = getVerifiedMaterial(item);

  // If material is verified and not already in the name, prefix it honestly
  if (material && !name.includes(material.toLowerCase())) {
    return `${material.toLowerCase()} ${name}`;
  }
  return name;
}

/**
 * Extracts semantic design features from user description or more_details.
 */
function extractSemanticFeatures(item: WardrobeItem): {
  neckline?: string;
  waist?: string;
  length?: string;
  sleeves?: string;
  notesPreference?: string;
} {
  const text = [
    item.description,
    (item as any).ai_attributes?.description,
    (item as any).sub_category,
  ].filter(Boolean).join(' ').toLowerCase();

  const notes = [
    item.user_notes,
    (item as any).ai_attributes?.user_notes,
  ].filter(Boolean).join(' ').toLowerCase();

  const details = (item as any).more_details || (item as any).ai_attributes?.more_details || {};

  // Neckline
  let neckline = details.neckline;
  if (!neckline) {
    if (text.includes('bow-tie') || text.includes('bow tie') || text.includes('pussy-bow')) neckline = 'bow-tie neckline';
    else if (text.includes('v-neck')) neckline = 'V-neck';
    else if (text.includes('crew neck') || text.includes('round neck')) neckline = 'crew neckline';
    else if (text.includes('sweetheart')) neckline = 'sweetheart neckline';
    else if (text.includes('boat neck')) neckline = 'boat neckline';
    else if (text.includes('halter')) neckline = 'halter neckline';
  }

  // Waist / Silhouette
  let waist = details.waist;
  if (!waist) {
    if (text.includes('fit-and-flare') || text.includes('fit and flare')) waist = 'fit-and-flare waist';
    else if (text.includes('fitted waist')) waist = 'fitted waist';
    else if (text.includes('a-line') || text.includes('a line')) waist = 'A-line cut';
    else if (text.includes('empire')) waist = 'empire waist';
    else if (text.includes('oversized')) waist = 'oversized silhouette';
  }

  // Length
  let length = details.length;
  if (!length) {
    if (text.includes('midi')) length = 'midi length';
    else if (text.includes('maxi')) length = 'maxi length';
    else if (text.includes('mini')) length = 'mini length';
    else if (text.includes('cropped')) length = 'cropped length';
  }

  // Sleeves
  let sleeves = details.sleeve_length || details.sleeve_style;
  if (!sleeves) {
    if (text.includes('short sleeve') || text.includes('short sleeves')) sleeves = 'short sleeves';
    else if (text.includes('long sleeve') || text.includes('long sleeves')) sleeves = 'long sleeves';
    else if (text.includes('sleeveless')) sleeves = 'sleeveless cut';
    else if (text.includes('puff sleeve')) sleeves = 'puff sleeves';
  }

  // Personal notes styling preference
  let notesPreference: string | undefined;
  if (notes.includes('sneaker') || notes.includes('sneakers')) {
    notesPreference = 'sneakers';
  } else if (notes.includes('rainy') || notes.includes('rain')) {
    notesPreference = 'weather versatility';
  }

  return { neckline, waist, length, sleeves, notesPreference };
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
  const itemsByType: Record<string, WardrobeItem[]> = {};
  const namesByType: Record<string, string[]> = {};
  const allColors: string[] = [];

  for (const item of items) {
    const type = item.garment_type || 'Piece';
    if (!itemsByType[type]) itemsByType[type] = [];
    itemsByType[type].push(item);

    const name = getGroundedItemLabel(item);
    if (!namesByType[type]) namesByType[type] = [];
    namesByType[type].push(name);

    if (Array.isArray(item.color_tags)) {
      allColors.push(...item.color_tags);
    }
  }

  const tops = itemsByType['Top'] || [];
  const outers = itemsByType['Outerwear'] || [];
  const bottoms = itemsByType['Bottom'] || [];
  const dresses = itemsByType['Dress'] || [];
  const shoes = itemsByType['Shoes'] || [];

  const hasDress = dresses.length > 0;
  const hasOuter = outers.length > 0;
  const hasShoes = shoes.length > 0;
  const hasTop = tops.length > 0;
  const hasBottom = bottoms.length > 0;

  // Statement piece detection (graphic, multi-color, floral, or statement pattern)
  const statementPiece = items.find((item) => {
    const pattern = ((item as any).pattern || (item as any).ai_attributes?.pattern || '').toLowerCase();
    const name = (item.sub_category || item.category || '').toLowerCase();
    const desc = (item.description || '').toLowerCase();
    const tags = item.color_tags || [];
    return (
      pattern.includes('graphic') ||
      pattern.includes('floral') ||
      pattern.includes('plaid') ||
      pattern.includes('animal') ||
      pattern.includes('multicolor') ||
      name.includes('graphic') ||
      desc.includes('graphic') ||
      tags.length >= 3
    );
  });

  const hasNeutralBlazerOrOuter = outers.some((o) => {
    const name = (o.sub_category || o.category || '').toLowerCase();
    const isBlazer = name.includes('blazer') || name.includes('jacket') || name.includes('coat');
    const colors = (o.color_tags || []).map((c) => c.toLowerCase());
    const isNeutral = colors.length === 0 || colors.some((c) => NEUTRAL_COLORS.has(c));
    return isBlazer && isNeutral;
  });

  const hasSneakersOrCasualShoes = shoes.some((s) => {
    const name = (s.sub_category || s.category || '').toLowerCase();
    return name.includes('sneaker') || name.includes('flat') || name.includes('trainer') || name.includes('casual');
  });

  const isStatementWithNeutralAnchor = !!statementPiece && (hasNeutralBlazerOrOuter || (hasSneakersOrCasualShoes && (hasBottom || hasDress)));

  // Semantic feature analysis on primary piece
  const heroPiece = dresses[0] || tops[0] || statementPiece || items[0];
  const semantics = heroPiece ? extractSemanticFeatures(heroPiece) : {};

  // Check personal notes preferences across all items
  const userNotesSneakerMention = items.some((i) => {
    const n = (i.user_notes || (i as any).ai_attributes?.user_notes || '').toLowerCase();
    return n.includes('sneaker');
  });

  // 1. Color Story / Balance
  let colorStory = 'Clean visual palette.';
  if (isStatementWithNeutralAnchor && hasNeutralBlazerOrOuter) {
    colorStory = 'The colorful statement shirt brings vibrant energy, while the neutral blazer and footwear anchor the look with clean contrast.';
  } else if (colorMatch.label.includes('Neutral') || colorMatch.label.includes('Monochrome')) {
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
  if (hasDress) {
    const dressFeatures = [semantics.length, semantics.waist, semantics.neckline].filter(Boolean);
    if (dressFeatures.length > 0) {
      silhouetteNote = `A cohesive one-piece foundation featuring a ${dressFeatures.join(' with ')} that creates an elongated, refined silhouette.`;
    } else {
      silhouetteNote = 'A unified one-piece foundation creating a streamlined, elongated silhouette.';
    }
  } else if (hasOuter && hasTop && hasBottom) {
    silhouetteNote = 'Layering with structured outerwear adds depth and frames the torso with balanced proportions.';
  } else if (hasOuter) {
    silhouetteNote = 'Layering with outerwear adds depth, structure, and versatile temperature adjustment.';
  } else if (hasShoes) {
    silhouetteNote = 'Grounded by complementary footwear that completes the vertical line of the look.';
  }

  // 3. Occasion Fit
  const occ = targetOccasion || 'everyday';
  let occasionFit = `Suited for ${occ} settings with effortless comfort.`;
  const lowerOcc = occ.toLowerCase();
  if (lowerOcc.includes('work') || lowerOcc.includes('office') || lowerOcc.includes('business')) {
    occasionFit = 'Structured styling appropriate for professional, focused environments.';
  } else if (lowerOcc.includes('formal') || lowerOcc.includes('wedding') || lowerOcc.includes('church')) {
    occasionFit = 'Refined cut and tailored balance designed for formal celebrations, church, and ceremonies.';
  } else if (lowerOcc.includes('dinner') || lowerOcc.includes('date') || lowerOcc.includes('night')) {
    occasionFit = 'Subtle focal points and flattering lines well-suited for dinner and evening outings.';
  } else if (lowerOcc.includes('casual') || lowerOcc.includes('travel')) {
    occasionFit = 'Relaxed, practical balance ensuring day-long mobility and ease.';
  }

  // 4. Headline
  let headline = 'Likely to Work Well';
  if (isStatementWithNeutralAnchor && hasNeutralBlazerOrOuter) {
    headline = 'Smart Casual Statement Look';
  } else if (hasDress && (semantics.neckline || semantics.waist)) {
    headline = 'Graceful & Tailored Silhouette';
  } else if (colorMatch.score >= 88) {
    headline = 'Strong Visual Chemistry';
  } else if (personalAffinity && personalAffinity.score >= 85) {
    headline = 'Tailored to Your Favorites';
  } else if (hasOuter) {
    headline = 'Polished Layered Look';
  }

  // 5. Summary (Stylist's Take)
  let summary = '';
  let whyThisWorks = '';
  let whatCouldBeBetter = '';
  let stylingTip = '';

  if (isStatementWithNeutralAnchor && hasNeutralBlazerOrOuter && hasSneakersOrCasualShoes) {
    summary = 'Your blazer gives structure to the graphic shirt, while the sneakers keep the outfit relaxed and comfortable.';
    whyThisWorks = 'The tailored blazer frames the expressive print with clean lines, and the sneakers ground the look in effortless smart-casual style.';
    whatCouldBeBetter = 'The shirt already has several bright colors, so keeping the remaining pieces simple can help it stay the main focus.';
    stylingTip = 'Let one piece stand out and use the other pieces to support it.';
  } else if (isStatementWithNeutralAnchor && hasNeutralBlazerOrOuter) {
    summary = 'The blazer provides tailored structure over the graphic focal piece, creating an intentional high-low balance.';
    whyThisWorks = 'Clean neutral layering anchors the colorful focal point without competing for attention.';
    whatCouldBeBetter = 'Keep jewelry and accessory shapes minimal so the print remains the hero element.';
    stylingTip = 'Let one statement piece lead the look.';
  } else if (hasDress) {
    const dressName = namesByType['Dress']?.[0] || 'dress';
    const detailSnippets = [semantics.neckline, semantics.waist, semantics.sleeves].filter(Boolean);
    const detailClause = detailSnippets.length > 0 ? ` with its ${detailSnippets.join(' and ')}` : '';
    summary = `The ${dressName}${detailClause} provides an effortless standalone look with balanced visual flow.`;
    whyThisWorks = 'A unified one-piece garment naturally eliminates top-and-bottom cut lines, creating a flattering vertical line.';
    whatCouldBeBetter = hasShoes ? 'Ensure the hemline pairs harmoniously with your shoe height.' : 'Adding footwear will anchor the proportion and polish the silhouette.';
    stylingTip = userNotesSneakerMention && hasShoes && hasSneakersOrCasualShoes
      ? 'Honoring your note, pairing this with sneakers keeps the energy effortless and modern.'
      : 'Add delicate earrings or a small handbag to elevate the neckline.';
  } else {
    const topDesc = namesByType['Top']?.[0] || 'top';
    const bottomDesc = namesByType['Bottom']?.[0] || 'bottom';
    summary = `These pieces balance well together because the ${topDesc} pairs naturally with the ${bottomDesc}, while the ${allColors.slice(0, 2).join(' and ') || 'palette'} establishes a clear color story.`;
    whyThisWorks = 'Harmonious color distribution and balanced proportions create an intentional aesthetic.';
    whatCouldBeBetter = hasOuter ? 'Keep inner sleeve lengths smooth beneath the outer layer.' : 'A lightweight jacket or belt can define the transition between top and bottom.';
    stylingTip = userNotesSneakerMention && hasShoes && hasSneakersOrCasualShoes
      ? 'Pairing with sneakers respects your favorite casual routine.'
      : 'Choose footwear that matches the formality of your planned setting.';
  }

  // 6. Pro Tip
  let proTip = stylingTip || 'Consider minimal jewelry or a leather belt to cleanly define the waistline.';
  if (personalAffinity?.negativeSignals.length) {
    proTip = `Tip: ${personalAffinity.negativeSignals[0]}. Try swapping an accessory if you prefer your classic routine.`;
  } else if (hasOuter && !isStatementWithNeutralAnchor) {
    proTip = 'Cuff the sleeves slightly for a modern, relaxed proportion.';
  }

  const footwearRelationship = hasShoes
    ? hasSneakersOrCasualShoes
      ? 'The sneakers keep the outfit relaxed, approachable, and comfortable.'
      : 'The structured footwear grounds the ensemble with a formal, polished finish.'
    : 'Adding footwear will define the complete silhouette.';

  const layeringNote = hasOuter
    ? 'Outerwear adds architectural structure and visual depth to the upper body.'
    : 'A single-layer foundation that keeps lines simple and uncluttered.';

  return {
    headline,
    summary,
    colorStory,
    silhouetteNote,
    occasionFit,
    proTip,
    whyThisWorks,
    whatCouldBeBetter,
    stylingTip,
    layeringNote,
    footwearRelationship,
  };
}
