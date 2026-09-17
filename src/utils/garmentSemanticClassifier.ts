/**
 * garmentSemanticClassifier.ts
 *
 * Semantic garment classification layer.
 * Replaces naive single-regex matching with structured evidence extraction.
 *
 * Principles:
 * - User-entered data is authoritative and preserved verbatim.
 * - Never use Top as a semantic fallback — prefer Unknown.
 * - Unknown attributes remain null rather than being invented.
 * - Every classification decision traces to an evidence source.
 */

// ============================================================================
// TYPES
// ============================================================================

export type GarmentFamily =
  | 'Top'
  | 'Bottom'
  | 'Dress'
  | 'Outerwear'
  | 'Footwear'
  | 'Accessory'
  | 'Unknown';

export type EvidenceSource = 'user' | 'visual' | 'ml' | 'inferred';

export type ThermalLevel = 'heavyWarmth' | 'moderateWarmth' | 'lightWarmth' | 'unknown';
export type CoverageLevel = 'full' | 'moderate' | 'minimal' | 'unknown';
export type FunctionalRole =
  | 'athleticPerformance'
  | 'formalTailored'
  | 'smartCasual'
  | 'casualEveryday'
  | 'swimwear'
  | 'lounge'
  | 'protective'
  | 'unknown';

export interface PersonalUsageSignal {
  activities: string[];
  rawText: string;
}

export interface GarmentEvidence {
  tokens: string[];
  family: GarmentFamily;
  type: string | null;
  subtype: string | null;
  style: string[];
  activity: string[];
  material: string[];
  colors: string[];
  thermal: ThermalLevel;
  coverage: CoverageLevel;
  functionalRole: FunctionalRole;
  personalUsage: PersonalUsageSignal;
  source: EvidenceSource;
}

export interface NormalizedGarment {
  family: GarmentFamily;
  type: string | null;
  subtype: string | null;
  style: string[];
  activity: string[];
  material: string[];
  colors: string[];
  thermal: ThermalLevel;
  coverage: CoverageLevel;
  functionalRole: FunctionalRole;
  personalUsage: PersonalUsageSignal;
  /** Bucket for mannequin placement (Top/Bottom/Dress/Outerwear/Shoes/Accessory) */
  systemBucket: string;
  evidence: GarmentEvidence;
}

// ============================================================================
// KEYWORD TABLES — specific subtypes before generic terms
// ============================================================================

type SubtypeRow = { pattern: RegExp; type: string; subtype: string | null };

const DRESS_SUBTYPES: SubtypeRow[] = [
  { pattern: /\bmaxi\s+dress\b/i,    type: 'Dress',     subtype: 'Maxi Dress' },
  { pattern: /\bmidi\s+dress\b/i,    type: 'Dress',     subtype: 'Midi Dress' },
  { pattern: /\bmini\s+dress\b/i,    type: 'Dress',     subtype: 'Mini Dress' },
  { pattern: /\bcocktail\s+dress\b/i,type: 'Dress',     subtype: 'Cocktail Dress' },
  { pattern: /\bevening\s+dress\b/i, type: 'Dress',     subtype: 'Evening Dress' },
  { pattern: /\bwrap\s+dress\b/i,    type: 'Dress',     subtype: 'Wrap Dress' },
  { pattern: /\bdress\b/i,           type: 'Dress',     subtype: null },
  { pattern: /\bgown\b/i,            type: 'Gown',      subtype: null },
  { pattern: /\bjumpsuit\b/i,        type: 'Jumpsuit',  subtype: null },
  { pattern: /\bromper\b/i,          type: 'Romper',    subtype: null },
  { pattern: /\bplaysuit\b/i,        type: 'Playsuit',  subtype: null },
  { pattern: /\bone.?piece\b/i,      type: 'One-Piece', subtype: null },
  { pattern: /\boveralls?\b/i,       type: 'Overalls',  subtype: null },
];

const OUTERWEAR_SUBTYPES: SubtypeRow[] = [
  { pattern: /\btrench\s+coat\b/i,   type: 'Coat',        subtype: 'Trench Coat' },
  { pattern: /\bbomber\s+jacket\b/i, type: 'Jacket',      subtype: 'Bomber Jacket' },
  { pattern: /\bblazers?\b/i,        type: 'Blazer',      subtype: null },
  { pattern: /\bjackets?\b/i,        type: 'Jacket',      subtype: null },
  { pattern: /\bcoats?\b/i,          type: 'Coat',        subtype: null },
  { pattern: /\bparka\b/i,           type: 'Parka',       subtype: null },
  { pattern: /\bwindbreaker\b/i,     type: 'Windbreaker', subtype: null },
  { pattern: /\bwaistcoat\b/i,       type: 'Vest',        subtype: 'Waistcoat' },
  { pattern: /\bvest\b/i,            type: 'Vest',        subtype: null },
  { pattern: /\bcardigan\b/i,        type: 'Cardigan',    subtype: null },
  { pattern: /\bhoodie\b/i,          type: 'Hoodie',      subtype: null },
  { pattern: /\bouterwear\b/i,       type: 'Outerwear',   subtype: null },
];

const FOOTWEAR_SUBTYPES: SubtypeRow[] = [
  { pattern: /\bmary\s+jane\s+ballet\s+flats?\b/i, type: 'Flats',   subtype: 'Mary Jane Ballet Flats' },
  { pattern: /\bmary\s+jane\s+flats?\b/i,          type: 'Flats',   subtype: 'Mary Jane Flats' },
  { pattern: /\bmary\s+janes?\b/i,                 type: 'Flats',   subtype: 'Mary Jane' },
  { pattern: /\bballet\s+flats?\b/i,               type: 'Flats',   subtype: 'Ballet Flats' },
  { pattern: /\bflats?\b/i,                        type: 'Flats',   subtype: null },
  { pattern: /\brunning\s+shoes?\b/i,              type: 'Sneakers',subtype: 'Running Shoes' },
  { pattern: /\btrainers?\b/i,                     type: 'Sneakers',subtype: 'Trainers' },
  { pattern: /\bsneakers?\b/i,                     type: 'Sneakers',subtype: null },
  { pattern: /\bstiletto\b/i,                      type: 'Heels',   subtype: 'Stiletto Heels' },
  { pattern: /\bpumps?\b/i,                        type: 'Heels',   subtype: 'Pumps' },
  { pattern: /\bheels?\b/i,                        type: 'Heels',   subtype: null },
  { pattern: /\boxfords?\b/i,                      type: 'Oxfords', subtype: null },
  { pattern: /\bloafers?\b/i,                      type: 'Loafers', subtype: null },
  { pattern: /\bboots?\b/i,                        type: 'Boots',   subtype: null },
  { pattern: /\bsandals?\b/i,                      type: 'Sandals', subtype: null },
  { pattern: /\bslides?\b/i,                       type: 'Slides',  subtype: null },
  { pattern: /\bmules?\b/i,                        type: 'Mules',   subtype: null },
  { pattern: /\bclogs?\b/i,                        type: 'Clogs',   subtype: null },
  { pattern: /\bshoes?\b/i,                        type: 'Shoes',   subtype: null },
  { pattern: /\bfootwear\b/i,                      type: 'Shoes',   subtype: null },
];

/** Bottom patterns — specific subtypes before generic. shorts/skirts must not fall through to Top. */
const BOTTOM_SUBTYPES: SubtypeRow[] = [
  { pattern: /\brunning\s+shorts?\b/i,        type: 'Shorts',    subtype: 'Running Shorts' },
  { pattern: /\bathletic\s+shorts?\b/i,       type: 'Shorts',    subtype: 'Athletic Shorts' },
  { pattern: /\bgym\s+shorts?\b/i,            type: 'Shorts',    subtype: 'Gym Shorts' },
  { pattern: /\bbasketball\s+shorts?\b/i,     type: 'Shorts',    subtype: 'Basketball Shorts' },
  { pattern: /\bcycling\s+shorts?\b/i,        type: 'Shorts',    subtype: 'Cycling Shorts' },
  { pattern: /\bcompression\s+shorts?\b/i,    type: 'Shorts',    subtype: 'Compression Shorts' },
  { pattern: /\bswim\s+shorts?\b/i,           type: 'Shorts',    subtype: 'Swim Shorts' },
  { pattern: /\bboard\s+shorts?\b/i,          type: 'Shorts',    subtype: 'Board Shorts' },
  { pattern: /\bcargo\s+shorts?\b/i,          type: 'Shorts',    subtype: 'Cargo Shorts' },
  { pattern: /\bdenim\s+shorts?\b/i,          type: 'Shorts',    subtype: 'Denim Shorts' },
  { pattern: /\bbermuda\s+shorts?\b/i,        type: 'Shorts',    subtype: 'Bermuda Shorts' },
  { pattern: /\btailored\s+shorts?\b/i,       type: 'Shorts',    subtype: 'Tailored Shorts' },
  { pattern: /\bmicro\s+mini\s+skirts?\b/i,   type: 'Skirt',     subtype: 'Micro Mini Skirt' },
  { pattern: /\bmaxi\s+skirts?\b/i,           type: 'Skirt',     subtype: 'Maxi Skirt' },
  { pattern: /\bmidi\s+skirts?\b/i,           type: 'Skirt',     subtype: 'Midi Skirt' },
  { pattern: /\bmini\s+skirts?\b/i,           type: 'Skirt',     subtype: 'Mini Skirt' },
  { pattern: /\bpencil\s+skirts?\b/i,         type: 'Skirt',     subtype: 'Pencil Skirt' },
  { pattern: /\bskirts?\b/i,                  type: 'Skirt',     subtype: null },
  { pattern: /\bskinny\s+jeans?\b/i,          type: 'Jeans',     subtype: 'Skinny Jeans' },
  { pattern: /\bwide.?leg\s+(?:jeans?|trousers?|pants?)\b/i, type: 'Pants', subtype: 'Wide Leg Pants' },
  { pattern: /\bjeans?\b/i,                   type: 'Jeans',     subtype: null },
  { pattern: /\bdress\s+pants?\b/i,           type: 'Trousers',  subtype: 'Dress Pants' },
  { pattern: /\btailored\s+pants?\b/i,        type: 'Trousers',  subtype: 'Tailored Pants' },
  { pattern: /\btrousers?\b/i,                type: 'Trousers',  subtype: null },
  { pattern: /\bslacks?\b/i,                  type: 'Trousers',  subtype: null },
  { pattern: /\bchinos?\b/i,                  type: 'Chinos',    subtype: null },
  { pattern: /\bleggings?\b/i,                type: 'Leggings',  subtype: null },
  { pattern: /\bculottes?\b/i,                type: 'Culottes',  subtype: null },
  { pattern: /\bskorts?\b/i,                  type: 'Skort',     subtype: null },
  { pattern: /\bshorts?\b/i,                  type: 'Shorts',    subtype: null },
  { pattern: /\bpants?\b/i,                   type: 'Pants',     subtype: null },
  { pattern: /\bbottoms?\b/i,                 type: 'Bottoms',   subtype: null },
];

/** Top: explicit match only — never a default fallback */
const TOP_SUBTYPES: SubtypeRow[] = [
  { pattern: /\bcropped\s+turtleneck\s+sweater\b/i, type: 'Sweater',  subtype: 'Cropped Turtleneck Sweater' },
  { pattern: /\bturtleneck\s+sweater\b/i,           type: 'Sweater',  subtype: 'Turtleneck Sweater' },
  { pattern: /\bturtleneck\b/i,                     type: 'Sweater',  subtype: 'Turtleneck' },
  { pattern: /\bcropped?\s+top\b/i,                 type: 'Top',      subtype: 'Crop Top' },
  { pattern: /\btank\s+top\b/i,                     type: 'Tank Top', subtype: null },
  { pattern: /\bhalter\s+top\b/i,                   type: 'Top',      subtype: 'Halter Top' },
  { pattern: /\btube\s+top\b/i,                     type: 'Top',      subtype: 'Tube Top' },
  { pattern: /\bt.?shirts?\b/i,                     type: 'T-Shirt',  subtype: null },
  { pattern: /\btee\s+shirts?\b/i,                  type: 'T-Shirt',  subtype: null },
  { pattern: /\btees?\b/i,                          type: 'T-Shirt',  subtype: null },
  { pattern: /\bbutton.?downs?\b/i,                 type: 'Shirt',    subtype: 'Button-Down Shirt' },
  { pattern: /\bbutton.?up\b/i,                     type: 'Shirt',    subtype: 'Button-Up Shirt' },
  { pattern: /\bbodysuits?\b/i,                     type: 'Bodysuit', subtype: null },
  { pattern: /\bcamisoles?\b/i,                     type: 'Camisole', subtype: null },
  { pattern: /\bpolos?\b/i,                         type: 'Polo',     subtype: null },
  { pattern: /\bblouses?\b/i,                       type: 'Blouse',   subtype: null },
  { pattern: /\bsweaters?\b/i,                      type: 'Sweater',  subtype: null },
  { pattern: /\bknitwear\b/i,                       type: 'Sweater',  subtype: null },
  { pattern: /\btanks?\b/i,                         type: 'Tank Top', subtype: null },
  { pattern: /\bshirts?\b/i,                        type: 'Shirt',    subtype: null },
  { pattern: /\btops?\b/i,                          type: 'Top',      subtype: null },
  { pattern: /\bbras?\b/i,                          type: 'Bra',      subtype: null },
];

const ACCESSORY_PATTERNS: RegExp[] = [
  /\bbags?\b/i, /\bpurses?\b/i, /\bclutch\b/i, /\btotes?\b/i,
  /\bbelts?\b/i, /\bhats?\b/i, /\bcaps?\b/i,
  /\bjewelry\b/i, /\bnecklaces?\b/i, /\bearrings?\b/i,
  /\bbracelets?\b/i, /\bwatches?\b/i, /\bscarves?\b/i, /\bscarf\b/i,
  /\bsunglasses?\b/i, /\bgloves?\b/i,
];

// ============================================================================
// SIGNAL TABLES
// ============================================================================

const STYLE_SIGNALS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bactivewear\b/i,    label: 'Activewear' },
  { pattern: /\bathletic\b/i,      label: 'Activewear' },
  { pattern: /\bformal\b/i,        label: 'Formal' },
  { pattern: /\bbusiness\b/i,      label: 'Business' },
  { pattern: /\bprofessional\b/i,  label: 'Professional' },
  { pattern: /\boffice\b/i,        label: 'Office' },
  { pattern: /\bsmart\s+casual\b/i,label: 'Smart Casual' },
  { pattern: /\bcasual\b/i,        label: 'Casual' },
  { pattern: /\bstreetw?ear\b/i,   label: 'Streetwear' },
  { pattern: /\bresort\b/i,        label: 'Resort' },
  { pattern: /\bbeach\b/i,         label: 'Beach' },
  { pattern: /\bevening\b/i,       label: 'Evening' },
  { pattern: /\bcocktail\b/i,      label: 'Cocktail' },
];

const ACTIVITY_SIGNALS: { pattern: RegExp; label: string }[] = [
  { pattern: /\brunning\b/i,   label: 'Running' },
  { pattern: /\bjogging\b/i,   label: 'Running' },
  { pattern: /\bmarathon\b/i,  label: 'Running' },
  { pattern: /\bgym\b/i,       label: 'Gym' },
  { pattern: /\bworkout\b/i,   label: 'Workout' },
  { pattern: /\bfitness\b/i,   label: 'Fitness' },
  { pattern: /\btraining\b/i,  label: 'Training' },
  { pattern: /\bexercis(?:ing|e)?\b/i, label: 'Exercise' },
  { pattern: /\bwalking\b/i,   label: 'Walking' },
  { pattern: /\bsport\b/i,     label: 'Sports' },
  { pattern: /\bswimming\b/i,  label: 'Swimming' },
  { pattern: /\bswim\b/i,      label: 'Swimming' },
  { pattern: /\bhiking\b/i,    label: 'Hiking' },
  { pattern: /\btennis\b/i,    label: 'Tennis' },
  { pattern: /\byoga\b/i,      label: 'Yoga' },
  { pattern: /\bcycling\b/i,   label: 'Cycling' },
];

const MATERIAL_SIGNALS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bdenim\b/i,       label: 'Denim' },
  { pattern: /\bribbed.?knit\b/i,label: 'Ribbed Knit' },
  { pattern: /\bknit\b/i,        label: 'Knit' },
  { pattern: /\bsuede\b/i,        label: 'Suede' },
  { pattern: /\bvelvet\b/i,       label: 'Velvet' },
  { pattern: /\bleather\b/i,      label: 'Leather' },
  { pattern: /\blinen\b/i,        label: 'Linen' },
  { pattern: /\bsilk\b/i,         label: 'Silk' },
  { pattern: /\bsatin\b/i,        label: 'Satin' },
  { pattern: /\bcotton\b/i,       label: 'Cotton' },
  { pattern: /\bwool\b/i,         label: 'Wool' },
  { pattern: /\bcashmere\b/i,     label: 'Cashmere' },
  { pattern: /\bpolyester\b/i,    label: 'Polyester' },
  { pattern: /\bnylon\b/i,        label: 'Nylon' },
  { pattern: /\bspandex\b/i,      label: 'Spandex' },
  { pattern: /\blycra\b/i,        label: 'Lycra' },
  { pattern: /\bchiffon\b/i,      label: 'Chiffon' },
];

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Extracts structured semantic evidence from user-entered garment fields.
 * Preserves all original user text — only extracts parallel evidence.
 */
export function extractGarmentEvidence(
  category: string,
  subCategory: string,
  color: string,
  whereWornOften: string,
  description: string,
  userNotes?: string
): GarmentEvidence {
  const combined = [category, subCategory, color, whereWornOften, description, userNotes ?? '']
    .filter(Boolean)
    .join(' ');

  const tokens = combined.toLowerCase().split(/[\s,/&]+/).filter((t) => t.length > 1);

  let family: GarmentFamily = 'Unknown';
  let type: string | null = null;
  let subtype: string | null = null;

  // Priority: Dress > Outerwear > Footwear > Bottom > Accessory > Top
  // Outerwear before Top: cardigan/hoodie would otherwise match Top first
  // Bottom before Top: shorts/skirts must not fall through
  function tryMatch(table: SubtypeRow[], fam: GarmentFamily): boolean {
    for (const row of table) {
      if (row.pattern.test(combined)) {
        family = fam;
        type = row.type;
        subtype = row.subtype;
        return true;
      }
    }
    return false;
  }

  tryMatch(DRESS_SUBTYPES, 'Dress') ||
  tryMatch(OUTERWEAR_SUBTYPES, 'Outerwear') ||
  tryMatch(FOOTWEAR_SUBTYPES, 'Footwear') ||
  tryMatch(BOTTOM_SUBTYPES, 'Bottom') ||
  (() => {
    for (const pat of ACCESSORY_PATTERNS) {
      if (pat.test(combined)) { family = 'Accessory'; type = 'Accessory'; return true; }
    }
    return false;
  })() ||
  tryMatch(TOP_SUBTYPES, 'Top');
  // If still Unknown — correct; do not invent a family

  const uniq = <T>(arr: T[]): T[] => [...new Set(arr)];

  const style = uniq(
    STYLE_SIGNALS.filter((s) => s.pattern.test(combined)).map((s) => s.label)
  );
  const activity = uniq(
    ACTIVITY_SIGNALS.filter((s) => s.pattern.test(combined)).map((s) => s.label)
  );
  const material = uniq(
    MATERIAL_SIGNALS.filter((s) => s.pattern.test(combined)).map((s) => s.label)
  );
  const colors = color
    ? color.split(/[,/&]|\band\b/i).map((c) => c.trim()).filter((c) => c.length > 0)
    : [];

  const thermal = inferThermalLevel(family, subtype, material, combined);
  const coverage = inferCoverageLevel(family, subtype, combined);
  const functionalRole = inferFunctionalRole(family, subtype, style, activity, combined);
  const personalUsage = extractPersonalUsage(whereWornOften, userNotes, uniq);

  return {
    tokens,
    family,
    type,
    subtype,
    style,
    activity,
    material,
    colors,
    thermal,
    coverage,
    functionalRole,
    personalUsage,
    source: 'user',
  };
}

function inferThermalLevel(
  family: GarmentFamily,
  subtype: string | null,
  material: string[],
  combined: string
): ThermalLevel {
  const hasKnit = material.some((m) => ['Knit', 'Ribbed Knit', 'Wool', 'Cashmere'].includes(m));
  const hasHeavyOuter = /\b(wool|down|puffer|parka|heavy|winter|fleece|shearling|turtleneck|sweater|cardigan|coat)\b/i.test(combined);
  if (hasKnit || hasHeavyOuter) return 'heavyWarmth';

  const isLight =
    /\b(shorts?|running shorts|swim|bikini|crop|tank|sleeveless|mini skirt|micro mini|sandals?|slides?|flip.?flops?)\b/i.test(combined) ||
    (subtype !== null && /\b(Shorts|Mini Skirt|Micro Mini Skirt|Tank|Crop)\b/i.test(subtype));
  if (isLight) return 'lightWarmth';

  if (family === 'Top' || family === 'Bottom' || family === 'Outerwear' || family === 'Dress') {
    return 'moderateWarmth';
  }
  return 'unknown';
}

function inferCoverageLevel(
  family: GarmentFamily,
  subtype: string | null,
  combined: string
): CoverageLevel {
  const isMinimal =
    /\b(shorts?|running shorts|bikini|swimsuit|crop top|tank top|sleeveless|mini skirt|micro mini|sandals?|bare.?legs?)\b/i.test(combined) ||
    (subtype !== null && /\b(Shorts|Mini Skirt|Micro Mini Skirt|Crop Top|Tank Top)\b/i.test(subtype));
  if (isMinimal) return 'minimal';

  const isFull =
    /\b(pants?|jeans?|trousers?|slacks|maxi dress|maxi skirt|long coat|parka|trench coat)\b/i.test(combined) ||
    (subtype !== null && /\b(Jeans|Pants|Trousers|Slacks|Maxi Dress|Maxi Skirt|Coat|Trench Coat)\b/i.test(subtype));
  if (isFull) return 'full';

  if (family === 'Dress' || family === 'Top' || family === 'Outerwear' || family === 'Bottom') {
    return 'moderate';
  }
  return 'unknown';
}

function inferFunctionalRole(
  family: GarmentFamily,
  subtype: string | null,
  style: string[],
  activity: string[],
  combined: string
): FunctionalRole {
  if (
    activity.some((a) => ['Running', 'Gym', 'Workout', 'Fitness', 'Training', 'Sports', 'Exercise'].includes(a)) ||
    style.includes('Activewear') ||
    /\b(athletic|running|exercise|gym|workout|compression|nike|adidas|under armour|lululemon|marathon|track pants?|activewear|dri.?fit|dry.?fit)\b/i.test(combined) ||
    (subtype !== null && /\b(Running Shorts|Athletic Shorts|Gym Shorts|Cycling Shorts|Compression Shorts|Running Shoes)\b/i.test(subtype))
  ) {
    return 'athleticPerformance';
  }

  if (activity.includes('Swimming') || /\b(swimsuit|bikini|swim trunks?|boardshorts?|rash guard|swimwear)\b/i.test(combined)) {
    return 'swimwear';
  }

  if (style.includes('Formal') || /\b(blazer|tuxedo|suit|gown|evening dress|cocktail dress|dress pants|tailored|stiletto|pumps?|oxfords?)\b/i.test(combined)) {
    return 'formalTailored';
  }

  if (style.includes('Smart Casual') || /\b(chinos|loafers?|button-down|blouse|cardigan|midi dress|pencil skirt)\b/i.test(combined)) {
    return 'smartCasual';
  }

  if (/\b(raincoat|waterproof|windbreaker|parka|trench coat)\b/i.test(combined)) {
    return 'protective';
  }

  if (/\b(pajamas?|robe|loungewear|sweatpants?|slippers?)\b/i.test(combined)) {
    return 'lounge';
  }

  if (family !== 'Unknown') {
    return 'casualEveryday';
  }

  return 'unknown';
}

function extractPersonalUsage(
  whereWornOften: string,
  userNotes: string | undefined,
  uniq: <T>(arr: T[]) => T[]
): PersonalUsageSignal {
  const text = [whereWornOften, userNotes ?? ''].filter(Boolean).join(' ');
  const activities = uniq(
    ACTIVITY_SIGNALS.filter((s) => s.pattern.test(text)).map((s) => s.label)
  );
  return {
    activities,
    rawText: text.trim(),
  };
}

const FAMILY_TO_BUCKET: Record<GarmentFamily, string> = {
  Top: 'Top',
  Bottom: 'Bottom',
  Dress: 'Dress',
  Outerwear: 'Outerwear',
  Footwear: 'Shoes',
  Accessory: 'Accessory',
  // For mannequin placement only — semantic family remains Unknown
  Unknown: 'Top',
};

/**
 * Produces a NormalizedGarment from user-entered fields.
 * systemBucket drives mannequin z-index placement; Unknown only falls back
 * to Top in that context — the semantic family stays Unknown.
 */
export function normalizeGarment(
  category: string,
  subCategory: string,
  color: string,
  whereWornOften: string,
  description: string,
  userNotes?: string
): NormalizedGarment {
  const evidence = extractGarmentEvidence(
    category, subCategory, color, whereWornOften, description, userNotes
  );
  return {
    family: evidence.family,
    type: evidence.type,
    subtype: evidence.subtype,
    style: evidence.style,
    activity: evidence.activity,
    material: evidence.material,
    colors: evidence.colors,
    thermal: evidence.thermal,
    coverage: evidence.coverage,
    functionalRole: evidence.functionalRole,
    personalUsage: evidence.personalUsage,
    systemBucket: FAMILY_TO_BUCKET[evidence.family],
    evidence,
  };
}

/**
 * Drop-in replacement for the old inferGarmentBucket().
 * Returns the system bucket string for backward-compatible mannequin placement.
 */
export function inferSystemBucket(
  category: string,
  subCategory: string,
  description: string
): string {
  return normalizeGarment(category, subCategory, '', '', description).systemBucket;
}

/**
 * Resolves the effective system bucket for an item, healing legacy items
 * that were saved with the naive fallback ('Top') when evidence shows
 * they are Bottom, Outerwear, Shoes, Dress, or Accessory.
 */
export function resolveEffectiveGarmentBucket(item: {
  garment_type?: string | null;
  category?: string | null;
  sub_category?: string | null;
  description?: string | null;
  color_tags?: string[] | null;
  where_worn_often?: string | null;
  user_notes?: string | null;
}): string {
  const colorStr = item.color_tags && item.color_tags.length > 0 ? item.color_tags.join(', ') : '';
  const norm = normalizeGarment(
    item.category || '',
    item.sub_category || '',
    colorStr,
    item.where_worn_often || '',
    item.description || '',
    item.user_notes || ''
  );
  if (norm.family !== 'Unknown') {
    if (!item.garment_type || item.garment_type === 'Top') {
      return norm.systemBucket;
    }
  }
  return item.garment_type || norm.systemBucket || 'Top';
}


