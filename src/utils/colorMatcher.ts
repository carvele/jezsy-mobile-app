/**
 * Color harmony scoring based on HSL hue geometry.
 *
 * Replaces an earlier hardcoded matrix that compared eight literal colour
 * names, so anything outside that list scored as a default. Colours are
 * resolved to hex (via the managed palette, or a raw #rrggbb tag), converted
 * to HSL, and judged by the angle between hues -- the same relationships
 * classical colour theory names: monochromatic, analogous, triadic,
 * complementary. Any colour the palette grows later works without a code
 * change.
 */

import { DEFAULT_COLOR_OPTIONS } from './colorOptions';

export interface ColorMatchResult {
  score: number; // 0 to 100
  label: 'Perfect Harmony' | 'Great Match' | 'Neutral / Balanced' | 'Clashing Colors';
  feedback: string;
}

type Hsl = { h: number; s: number; l: number };

type ResolvedColor = {
  name: string;
  hsl: Hsl | null;
  isNeutral: boolean;
  isMetallic: boolean;
};

// Metallics read as neutrals but conflict with each other, so they are tracked
// apart from hue maths rather than being scored as ordinary colours.
const METALLICS = new Set(['gold', 'silver', 'bronze', 'copper', 'rose gold']);

const NAMED_HEX: Record<string, string> = {
  ...Object.fromEntries(DEFAULT_COLOR_OPTIONS.map((c) => [c.name.toLowerCase(), c.hex])),
  grey: '#808080',
  gray: '#808080',
  beige: '#D9C7A7',
  cream: '#F5F0E1',
  navy: '#1E3A5F',
  brown: '#6B4423',
  tan: '#C19A6B',
  charcoal: '#36454F',
  ivory: '#FFFFF0',
  burgundy: '#800020',
  olive: '#708238',
  mustard: '#D4A017',
  lavender: '#B57EDC',
  teal: '#008080',
  coral: '#FF7F50',
  purple: '#6B21A8',
  green: '#16A34A',
  yellow: '#EAB308',
  orange: '#EA580C',
};

function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let raw = m[1];
  if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');

  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

function resolve(input: string): ResolvedColor {
  const name = input.trim();
  const key = name.toLowerCase();
  const hex = key.startsWith('#') ? key : NAMED_HEX[key];
  const hsl = hex ? hexToHsl(hex) : null;

  // Desaturated or near black/white reads as a neutral regardless of hue --
  // that is what lets it anchor any palette.
  const isNeutral = !!hsl && (hsl.s < 0.15 || hsl.l < 0.12 || hsl.l > 0.92);

  return { name, hsl, isNeutral, isMetallic: METALLICS.has(key) };
}

// Shortest distance between two hues on the 360-degree wheel.
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

type Harmony = 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'discordant';

function classify(gap: number): Harmony {
  if (gap < 15) return 'monochromatic';
  if (gap < 50) return 'analogous';
  if (gap >= 150) return 'complementary';
  if (gap >= 100) return 'triadic';
  return 'discordant';
}

const HARMONY_SCORE: Record<Harmony, number> = {
  monochromatic: 95,
  analogous: 90,
  complementary: 88,
  triadic: 82,
  discordant: 55,
};

const HARMONY_NOTE: Record<Harmony, string> = {
  monochromatic: 'These sit within one hue family, so the look reads as deliberate and cohesive.',
  analogous: 'These hues neighbour each other on the colour wheel, which is why the pairing feels calm rather than busy.',
  complementary: 'These hues sit opposite each other on the colour wheel, giving the outfit deliberate contrast.',
  triadic: 'These hues are evenly spaced on the colour wheel -- lively, but still balanced.',
  discordant: 'These hues are close enough to compete but too far apart to read as intentional. A neutral between them settles it.',
};

/**
 * Scores a set of colours. Accepts palette names (case-insensitive) or raw
 * hex; unrecognised values are ignored rather than dragging the score down,
 * since an untagged item should not read as a styling mistake.
 */
export function evaluateColors(colors: string[]): ColorMatchResult {
  const resolved = Array.from(new Set(colors.filter(Boolean).map((c) => c.trim())))
    .map(resolve)
    .filter((c) => c.hsl !== null);

  if (resolved.length === 0) {
    return {
      score: 75,
      label: 'Neutral / Balanced',
      feedback: 'Add colour tags to these pieces to get harmony feedback.',
    };
  }

  const metallics = resolved.filter((c) => c.isMetallic);
  const neutrals = resolved.filter((c) => c.isNeutral && !c.isMetallic);
  const chromatics = resolved.filter((c) => !c.isNeutral && !c.isMetallic);

  // Two competing metals is the one combination classical styling treats as an
  // outright mistake, so it overrides whatever the hues are doing.
  if (metallics.length > 1) {
    return {
      score: 45,
      label: 'Clashing Colors',
      feedback: `Mixing ${metallics.map((m) => m.name).join(' and ')} splits the eye. Commit to one metal and let it lead.`,
    };
  }

  if (chromatics.length === 0) {
    const anchor = metallics.length
      ? `${metallics[0].name} against neutrals is a formal, high-polish combination.`
      : 'An all-neutral palette is the most reliable combination there is -- texture and fit carry the look.';
    return { score: 95, label: 'Perfect Harmony', feedback: anchor };
  }

  if (chromatics.length === 1) {
    const c = chromatics[0];
    const anchored = neutrals.length > 0 || metallics.length > 0;
    return {
      score: anchored ? 93 : 88,
      label: anchored ? 'Perfect Harmony' : 'Great Match',
      feedback: anchored
        ? `The neutrals stay quiet so the ${c.name.toLowerCase()} carries the outfit -- a single point of colour is the safest way to stand out.`
        : `A single ${c.name.toLowerCase()} hue throughout. Adding a neutral would give the eye somewhere to rest.`,
    };
  }

  // Judge the tightest pair: the two colours most likely to be read as a
  // deliberate combination, and the ones that clash hardest if they don't work.
  let worst: { gap: number; a: ResolvedColor; b: ResolvedColor } | null = null;
  for (let i = 0; i < chromatics.length; i++) {
    for (let j = i + 1; j < chromatics.length; j++) {
      const gap = hueGap(chromatics[i].hsl!.h, chromatics[j].hsl!.h);
      const harmony = classify(gap);
      if (!worst || HARMONY_SCORE[harmony] < HARMONY_SCORE[classify(worst.gap)]) {
        worst = { gap, a: chromatics[i], b: chromatics[j] };
      }
    }
  }

  const harmony = classify(worst!.gap);
  let score = HARMONY_SCORE[harmony];

  // Every additional saturated colour past two adds competition, whatever the
  // individual pairings do.
  if (chromatics.length >= 3) score -= (chromatics.length - 2) * 12;
  // A neutral gives busy palettes somewhere to breathe.
  if (neutrals.length > 0 && chromatics.length >= 2) score += 5;

  score = Math.max(20, Math.min(100, Math.round(score)));

  const label: ColorMatchResult['label'] =
    score >= 90 ? 'Perfect Harmony'
      : score >= 78 ? 'Great Match'
        : score >= 65 ? 'Neutral / Balanced'
          : 'Clashing Colors';

  const pair = `${worst!.a.name} and ${worst!.b.name}`;
  let feedback = `${pair}: ${HARMONY_NOTE[harmony]}`;
  if (chromatics.length >= 3) {
    feedback += ` With ${chromatics.length} saturated colours in play, dropping one would sharpen the look.`;
  }

  return { score, label, feedback };
}
