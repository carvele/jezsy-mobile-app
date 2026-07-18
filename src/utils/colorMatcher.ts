/**
 * Rule-Based Color Compatibility Matrix
 * Evaluates color harmonies for wardrobe items.
 * Colors: Black, White, Red, Blue, Gold, Silver, Pink, Emerald
 */

export interface ColorMatchResult {
  score: number;       // 0 to 100
  label: 'Perfect Harmony' | 'Great Match' | 'Neutral / Balanced' | 'Clashing Colors';
  feedback: string;
}

// Harmony evaluation function
export function evaluateColors(colors: string[]): ColorMatchResult {
  const uniqueColors = Array.from(new Set(colors)).filter(Boolean);

  if (uniqueColors.length <= 1) {
    return {
      score: 100,
      label: 'Perfect Harmony',
      feedback: 'Single color outfits or monochromatic styles are always elegant and cohesive.',
    };
  }

  // Count types
  const neutrals = uniqueColors.filter(c => c === 'Black' || c === 'White');
  const brights = uniqueColors.filter(c => c !== 'Black' && c !== 'White' && c !== 'Gold' && c !== 'Silver');

  // Rule 1: Gold and Silver together is generally a clash in classic styling
  if (uniqueColors.includes('Gold') && uniqueColors.includes('Silver')) {
    return {
      score: 40,
      label: 'Clashing Colors',
      feedback: 'Combining Gold and Silver metallic tones can look busy. Try sticking to one metal accent.',
    };
  }

  // Rule 2: Neutral + anything is always a safe, great match
  if (neutrals.length === uniqueColors.length) {
    return {
      score: 95,
      label: 'Perfect Harmony',
      feedback: 'Black and White is the ultimate classic combination — sleek, high-contrast, and timeless.',
    };
  }

  // Rule 3: Complementary pairs
  // Red + Emerald
  if (uniqueColors.includes('Red') && uniqueColors.includes('Emerald')) {
    return {
      score: 85,
      label: 'Great Match',
      feedback: 'Red and Emerald are complementary colors. This creates a bold, festive, high-contrast statement.',
    };
  }

  // Blue + Gold
  if (uniqueColors.includes('Blue') && uniqueColors.includes('Gold')) {
    return {
      score: 90,
      label: 'Perfect Harmony',
      feedback: 'Blue and Gold are complementary on the luxury spectrum, offering a rich, royal aesthetic.',
    };
  }

  // Pink + Emerald
  if (uniqueColors.includes('Pink') && uniqueColors.includes('Emerald')) {
    return {
      score: 88,
      label: 'Great Match',
      feedback: 'Pink and Emerald is a vibrant, modern color block pairing that feels fresh and stylish.',
    };
  }

  // Rule 4: Too many bright colors
  if (brights.length >= 3) {
    return {
      score: 50,
      label: 'Clashing Colors',
      feedback: 'Too many bright colors (Red, Blue, Pink, Emerald) can compete. Try balancing them with Black or White.',
    };
  }

  // Rule 5: Standard safe pairings
  // Black + Gold / Silver
  if (uniqueColors.includes('Black') && (uniqueColors.includes('Gold') || uniqueColors.includes('Silver'))) {
    return {
      score: 95,
      label: 'Perfect Harmony',
      feedback: 'Black paired with metallic tones (Gold/Silver) creates an exceptionally premium, formal look.',
    };
  }

  // Emerald + Gold
  if (uniqueColors.includes('Emerald') && uniqueColors.includes('Gold')) {
    return {
      score: 92,
      label: 'Perfect Harmony',
      feedback: 'Emerald green and Gold is an elegant, jewel-toned pairing that exudes luxury.',
    };
  }

  // White + Blue / Emerald / Pink / Red
  if (uniqueColors.includes('White') && brights.length === 1) {
    return {
      score: 90,
      label: 'Great Match',
      feedback: `White acts as a clean canvas, making the vibrant ${brights[0]} pop beautifully.`,
    };
  }

  // Default balanced scoring
  return {
    score: 75,
    label: 'Neutral / Balanced',
    feedback: 'A balanced color combination. Accessories or layering can help tie the look together.',
  };
}
