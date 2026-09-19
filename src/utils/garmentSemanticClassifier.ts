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

export interface GarmentConflict {
  hasConflict: boolean;
  message: string | null;
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
  conflict?: GarmentConflict;
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
  conflict?: GarmentConflict;
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
  { pattern: /\bhenleys?\b/i,                       type: 'Henley',   subtype: null },
  { pattern: /\bhoodies?\b/i,                       type: 'Hoodie',   subtype: null },
  { pattern: /\bsweatshirts?\b/i,                   type: 'Sweatshirt', subtype: null },
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
  // Physical / Athletic (preserved)
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
  { pattern: /\bbiking\b/i,    label: 'Cycling' },
  { pattern: /\bloung(?:ing|e)?\b/i, label: 'Lounging' },

  // Everyday / Lifestyle / Professional (enhanced)
  { pattern: /\b(?:team|client|office|business|staff|board|conference)?\s*meetings?\b/i, label: 'Meetings' },
  { pattern: /\bpresentation\b/i,  label: 'Meetings' },
  { pattern: /\bconference\b/i,    label: 'Meetings' },
  { pattern: /\b(?:office\s+work|at\s+work|for\s+work|working)\b/i, label: 'Work' },
  { pattern: /\b(?:travel(?:ing|ling)?|airport\s+travel|going\s+on\s+a\s+trip|business\s+travel)\b/i, label: 'Travel' },
  { pattern: /\b(?:dining|dinner|going\s+to\s+dinner|restaurants?|going\s+out\s+to\s+eat)\b/i, label: 'Dining' },
  { pattern: /\b(?:school|classes?|studying|university|college)\b/i, label: 'School' },
  { pattern: /\b(?:errands?|grocery\s+shopping|shopping)\b/i, label: 'Errands' },
  { pattern: /\b(?:social\s+gathering|gala|party)\b/i, label: 'Events' },
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

export function inferFamilyFromCategory(cat: string): GarmentFamily {
  const c = cat.trim().toLowerCase();
  if (!c) return 'Unknown';
  if (/\b(tops?|shirts?|blouses?|upperwear)\b/i.test(c)) return 'Top';
  if (/\b(bottoms?|pants?|trousers?|shorts?|skirts?|jeans?|lowerwear)\b/i.test(c)) return 'Bottom';
  if (/\b(dresses?|one.?pieces?|jumpsuits?|rompers?|gowns?)\b/i.test(c)) return 'Dress';
  if (/\b(outerwears?|coats?|jackets?|blazers?)\b/i.test(c)) return 'Outerwear';
  if (/\b(shoes?|footwear|sneakers?|boots?|heels?|sandals?|flats?)\b/i.test(c)) return 'Footwear';
  if (/\b(accessories|accessory|bags?|purses?|belts?|hats?|jewelr(?:y|ies))\b/i.test(c)) return 'Accessory';
  return 'Unknown';
}

function matchSubtypeInTable(text: string, table: SubtypeRow[]): { type: string; subtype: string | null } | null {
  for (const row of table) {
    if (row.pattern.test(text)) {
      return { type: row.type, subtype: row.subtype };
    }
  }
  return null;
}

function sanitizeDescriptionForActivities(description: string): string {
  return description
    .replace(/\b(?:graphic|print|picture|image|photo|illustration|drawing)?\s*(?:shirt|tee|top|garment|clothing)?\s*(?:showing|depicting|featuring)\s+[^,.]*/gi, '')
    .replace(/\b(?:movie|film|book|show|documentary|song)\s+(?:about|featuring)\s+[^,.]*/gi, '')
    .replace(/\b(?:this\s+)?(?:shirt|tee|top|hoodie|sweater|garment)?\s*(?:says?|saying|text|words?|slogan|quote)\s+["']?[^,.]*["']?/gi, '')
    .replace(/\b(?:art\s*work|patch\s*work|needle\s*work)\b/gi, '');
}

export function extractActivitiesFromWearSources(
  whereWornOften: string,
  userNotes: string | undefined,
  subCategory: string,
  description: string,
  uniq: <T>(arr: T[]) => T[]
): string[] {
  const results: string[] = [];

  // 1. Direct user wear statement: Where I Wear This (authoritative primary input)
  const whereWorn = (whereWornOften || '').trim();
  if (whereWorn) {
    for (const s of ACTIVITY_SIGNALS) {
      if (s.pattern.test(whereWorn)) results.push(s.label);
    }
    if (/\bwork\b/i.test(whereWorn) && !/\bworkwear\b/i.test(whereWorn)) {
      results.push('Work');
    }
  }

  // 2. Personal Notes (direct user statement on wear habits)
  const notes = (userNotes || '').trim();
  if (notes) {
    for (const s of ACTIVITY_SIGNALS) {
      if (s.pattern.test(notes)) results.push(s.label);
    }
    if (
      /\b(?:wear|wear(?:ing)?|use|use(?:d)?)\s+.*(?:for|to|at)\s+work\b/i.test(notes) ||
      /\b(?:for|to|at)\s+work\b/i.test(notes)
    ) {
      results.push('Work');
    }
  }

  // 3. Subcategory (concrete athletic / functional garment type)
  const sub = (subCategory || '').trim();
  if (sub) {
    for (const s of ACTIVITY_SIGNALS) {
      if (s.pattern.test(sub)) results.push(s.label);
    }
  }

  // 4. Description with false-positive protection
  const rawDesc = (description || '').trim();
  if (rawDesc) {
    const cleanDesc = sanitizeDescriptionForActivities(rawDesc);
    for (const s of ACTIVITY_SIGNALS) {
      if (s.pattern.test(cleanDesc)) results.push(s.label);
    }
    if (/\b(?:office\s+work|working|for\s+work|wear\s+to\s+work|wear\s+for\s+work)\b/i.test(cleanDesc)) {
      results.push('Work');
    }
  }

  return uniq(results);
}

/**
 * Extracts structured semantic evidence from user-entered garment fields.
 * Follows strict authoritative priority: Category -> Sub Category -> Description.
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
  let conflict: GarmentConflict = { hasConflict: false, message: null };

  const catFamily = inferFamilyFromCategory(category);
  const subText = subCategory.trim();
  const descText = description.trim();

  // Helper to match across subcategory or description for a given family
  const checkSubAndDesc = (text: string) => {
    // 1. Dress
    const dressMatch = matchSubtypeInTable(text, DRESS_SUBTYPES);
    if (dressMatch) return { fam: 'Dress' as GarmentFamily, ...dressMatch };

    // 2. Outerwear (except when category explicitly says Tops and item is a topwear sweater/hoodie)
    const outMatch = matchSubtypeInTable(text, OUTERWEAR_SUBTYPES);
    if (outMatch) return { fam: 'Outerwear' as GarmentFamily, ...outMatch };

    // 3. Footwear
    const footMatch = matchSubtypeInTable(text, FOOTWEAR_SUBTYPES);
    if (footMatch) return { fam: 'Footwear' as GarmentFamily, ...footMatch };

    // 4. Bottom
    const botMatch = matchSubtypeInTable(text, BOTTOM_SUBTYPES);
    if (botMatch) return { fam: 'Bottom' as GarmentFamily, ...botMatch };

    // 5. Accessory
    if (ACCESSORY_PATTERNS.some((p) => p.test(text))) {
      return { fam: 'Accessory' as GarmentFamily, type: 'Accessory', subtype: null };
    }

    // 6. Top
    const topMatch = matchSubtypeInTable(text, TOP_SUBTYPES);
    if (topMatch) return { fam: 'Top' as GarmentFamily, ...topMatch };

    return null;
  };

  // 1. Check Subcategory
  const subMatch = subText ? checkSubAndDesc(subText) : null;

  if (catFamily !== 'Unknown') {
    if (subMatch) {
      // Special case: Category = Tops with Hoodie / Cardigan / Vest
      if (catFamily === 'Top' && (subMatch.fam === 'Outerwear' || subMatch.fam === 'Top')) {
        family = 'Top';
        type = subMatch.type;
        subtype = subMatch.subtype;
      } else if (catFamily === subMatch.fam) {
        family = catFamily;
        type = subMatch.type;
        subtype = subMatch.subtype;
      } else {
        // Conflict! e.g. Category = Tops, Sub Category = Running Shorts (Bottom)
        // Sub Category is the concrete garment item, so it takes precedence for semantics
        family = subMatch.fam;
        type = subMatch.type;
        subtype = subMatch.subtype;
        conflict = {
          hasConflict: true,
          message: `Category is ${category.trim()} but Sub Category indicates ${subMatch.fam} (${subText})`,
        };
      }
    } else {
      // Sub Category doesn't match any specific subtype; Category is authoritative
      family = catFamily;
      type = subText || catFamily;
      subtype = null;
    }
  } else if (subMatch) {
    // Category is generic ('Clothing' or ''), Sub Category is authoritative
    family = subMatch.fam;
    type = subMatch.type;
    subtype = subMatch.subtype;
  } else if (descText) {
    // Both Category and Sub Category are generic; evaluate Description
    const descMatch = checkSubAndDesc(descText);
    if (descMatch) {
      family = descMatch.fam;
      type = descMatch.type;
      subtype = descMatch.subtype;
    }
  }

  // Refine subtype from description if subcategory only gave a generic type without subtype
  if (family !== 'Unknown' && !subtype && descText) {
    const descMatch = checkSubAndDesc(descText);
    if (descMatch && descMatch.fam === family && descMatch.subtype) {
      subtype = descMatch.subtype;
      if (descMatch.type) type = descMatch.type;
    }
  }

  // Fallback: If family is known but type is null, use family
  if (family !== 'Unknown' && !type) {
    type = family === 'Footwear' ? 'Shoes' : family;
  }
  const uniq = <T>(arr: T[]): T[] => [...new Set(arr)];

  const style = uniq(
    STYLE_SIGNALS.filter((s) => s.pattern.test(combined)).map((s) => s.label)
  );
  const activity = extractActivitiesFromWearSources(
    whereWornOften,
    userNotes,
    subCategory,
    description,
    uniq
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
    conflict,
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
  const activities = extractActivitiesFromWearSources(whereWornOften, userNotes, '', '', uniq);
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
    conflict: evidence.conflict,
  };
}

/**
 * Drop-in replacement for the old inferGarmentBucket().
 * Returns the system bucket string for backward-compatible mannequin placement.
 */
export function inferSystemBucket(
  category: string,
  subCategory: string,
  description: string,
  color?: string,
  whereWornOften?: string,
  userNotes?: string
): string {
  return normalizeGarment(category, subCategory, color || '', whereWornOften || '', description, userNotes).systemBucket;
}

/**
 * Resolves the effective system bucket for an item.
 * User-entered category, subcategory, and description are strictly authoritative.
 * Legacy garment_type in the database is only a fallback when current metadata is uninformative.
 */
export function resolveEffectiveGarmentBucket(item: {
  garment_type?: string | null;
  category?: string | null;
  sub_category?: string | null;
  description?: string | null;
  color_tags?: string[] | null;
  where_worn_often?: string | null;
  user_notes?: string | null;
  occasions?: string[] | null;
  ai_attributes?: any;
}): string {
  const colorStr =
    (item as any)?.ai_attributes?.rawColor ||
    (item.color_tags && item.color_tags.length > 0 ? item.color_tags.join(', ') : '');
  const whereWornStr =
    (item as any)?.ai_attributes?.whereWornOften ||
    (Array.isArray((item as any)?.occasions) && (item as any).occasions.length > 0
      ? (item as any).occasions.join(', ')
      : '') ||
    item.where_worn_often ||
    '';
  const descStr = item.description || (item as any)?.ai_attributes?.description || '';
  const notesStr = item.user_notes || (item as any)?.ai_attributes?.userNotes || '';

  const norm = normalizeGarment(
    item.category || '',
    item.sub_category || '',
    colorStr,
    whereWornStr,
    descStr,
    notesStr
  );

  // Current user-entered data is authoritative! If a valid family was derived, return its systemBucket.
  if (norm.family !== 'Unknown') {
    return norm.systemBucket;
  }

  // Legacy garment_type ONLY as a fallback when current user metadata is insufficient
  if (item.garment_type && item.garment_type.trim() && item.garment_type !== 'Unknown') {
    const trimmed = item.garment_type.trim();
    const match = ['Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes', 'Accessory'].find(
      (b) => b.toLowerCase() === trimmed.toLowerCase()
    );
    if (match) return match;
  }

  return norm.systemBucket || 'Top';
}


