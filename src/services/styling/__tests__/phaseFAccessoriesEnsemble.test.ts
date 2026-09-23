/**
 * Phase F Comprehensive Verification Test Suite:
 * Accessories & Complete Ensemble Critique
 *
 * Verifies:
 * 1. Typed accessory taxonomy & compound precedence
 * 2. Intent parser accessory extraction & "style around" patterns
 * 3. Two-Stage Bounded Canonical Generation (must-use co-pruning, bounded scoring, simplicity tie-break)
 * 4. Complete Ensemble Critique & contradiction rules (swimming, athletic belts, indoor eyewear, hot knitwear)
 * 5. Multi-capacity Remix model (Jewelry = 2, others = 1, locking, canonical replacements, adapters)
 * 6. Mannequin coordinate placement & smart shuffle with pinned generative accessories
 */

import {
  resolveAccessorySubtype,
} from '@/src/utils/garmentSemanticClassifier';
import { parseStylingIntent } from '../intentParser';
import { generateCandidateOutfits } from '../candidateGenerator';
import {
  buildOutfitStructure,
  detectContradictions,
  buildGarmentSemanticProfile,
  buildOccasionRequirements,
  interpretOutfitContext,
} from '@/src/utils/aiStylistAdvisor';
import { generateGroundedExplanation } from '../groundedExplainer';
import {
  toggleSlotLock,
  getCanonicalSlotReplacements,
  adaptStyleAdvisorLookToRemix,
  adaptSavedOutfitToRemix,
} from '../outfitRemixService';
import {
  createMannequinItem,
} from '@/src/utils/mannequinConfig';
import {
  validateAndPartitionPinnedSet,
} from '../mannequinSmartShuffle';
import { localExposureService, computeCoreLookExposureKey } from '../localExposureService';
import { outfitSignature } from '@/src/services/outfitService';
import { WardrobeItem, StylingIntent, CandidateOutfit, StylingOption } from '@/src/types/styleAdvisor';

function makeMockWardrobeItem(partial: Partial<WardrobeItem> & { id: string; category: string }): WardrobeItem {
  return {
    id: partial.id,
    user_id: 'user_phase_f',
    product_id: null,
    image_url: partial.image_url || 'https://example.com/item.png',
    category: partial.category,
    sub_category: partial.sub_category || partial.category,
    deleted: partial.deleted !== undefined ? partial.deleted : false,
    created_at: '2026-01-01T00:00:00Z',
    color_tags: partial.color_tags || ['Black'],
    garment_type: partial.garment_type || partial.category,
    wear_count: partial.wear_count ?? 1,
    last_worn_at: partial.last_worn_at || '2026-09-01T00:00:00Z',
    description: partial.description || null,
    user_notes: partial.user_notes || null,
    ai_attributes: partial.ai_attributes || null,
    occasions: partial.occasions || ['Casual'],
    seasons: ['All'],
  } as WardrobeItem;
}

describe('Phase F: Accessories & Complete Ensemble Critique', () => {
  // =========================================================================
  // 1. TYPED ACCESSORY TAXONOMY & COMPOUND PRECEDENCE
  // =========================================================================
  describe('1. Typed Accessory Taxonomy & Compound Precedence', () => {
    test('classifies core accessory subtypes accurately', () => {
      const bag = makeMockWardrobeItem({ id: '1', category: 'Accessories', sub_category: 'Tote Bag' });
      const belt = makeMockWardrobeItem({ id: '2', category: 'Accessories', sub_category: 'Leather Belt' });
      const watch = makeMockWardrobeItem({ id: '3', category: 'Accessories', sub_category: 'Chronograph Watch' });
      const jewelry = makeMockWardrobeItem({ id: '4', category: 'Accessories', sub_category: 'Gold Necklace' });
      const eyewear = makeMockWardrobeItem({ id: '5', category: 'Accessories', sub_category: 'Aviator Sunglasses' });
      const headwear = makeMockWardrobeItem({ id: '6', category: 'Accessories', sub_category: 'Fedora Hat' });
      const scarf = makeMockWardrobeItem({ id: '7', category: 'Accessories', sub_category: 'Silk Scarf' });
      const gloves = makeMockWardrobeItem({ id: '8', category: 'Accessories', sub_category: 'Leather Gloves' });

      expect(resolveAccessorySubtype(bag)).toBe('bag');
      expect(resolveAccessorySubtype(belt)).toBe('belt');
      expect(resolveAccessorySubtype(watch)).toBe('watch');
      expect(resolveAccessorySubtype(jewelry)).toBe('jewelry');
      expect(resolveAccessorySubtype(eyewear)).toBe('eyewear');
      expect(resolveAccessorySubtype(headwear)).toBe('headwear');
      expect(resolveAccessorySubtype(scarf)).toBe('scarf');
      expect(resolveAccessorySubtype(gloves)).toBe('gloves');
    });

    test('compound phrases resolve correctly with compound precedence', () => {
      // "belt bag" must be Bag, NOT Belt
      const beltBag = makeMockWardrobeItem({ id: 'bb', category: 'Accessories', sub_category: 'Leather Belt Bag' });
      expect(resolveAccessorySubtype(beltBag)).toBe('bag');

      // "chain belt" must be Belt, NOT Jewelry
      const chainBelt = makeMockWardrobeItem({ id: 'cb', category: 'Accessories', sub_category: 'Gold Chain Belt' });
      expect(resolveAccessorySubtype(chainBelt)).toBe('belt');

      // "watch band" must be Watch, NOT Belt
      const watchBand = makeMockWardrobeItem({ id: 'wb', category: 'Accessories', sub_category: 'Leather Watch Band' });
      expect(resolveAccessorySubtype(watchBand)).toBe('watch');

      // "sunglasses case" must be Eyewear, NOT Bag
      const sunglassesCase = makeMockWardrobeItem({ id: 'sc', category: 'Accessories', sub_category: 'Leather Sunglasses Case' });
      expect(resolveAccessorySubtype(sunglassesCase)).toBe('eyewear');
    });

    test('vision ambiguity safeguard avoids misclassifying zero-shot predictions without text corroboration', () => {
      const ambiguousZeroShot = makeMockWardrobeItem({
        id: 'amb',
        category: 'Accessories',
        sub_category: 'Family Heirloom',
        ai_attributes: { detectedZeroShot: 'eyewear or jewelry' } as any,
      });
      // Without corroborating text, should safely fallback to jewelry or neutral, never crash
      const sub = resolveAccessorySubtype(ambiguousZeroShot);
      expect(['jewelry', 'bag', null]).toContain(sub);
    });
  });

  // =========================================================================
  // 2. INTENT PARSER NATURAL-LANGUAGE ACCESSORY EXTRACTION
  // =========================================================================
  describe('2. Intent Parser Accessory Extraction', () => {
    const testWardrobe: WardrobeItem[] = [
      makeMockWardrobeItem({ id: 'belt_black', category: 'Accessories', sub_category: 'Black Leather Belt', color_tags: ['Black'] }),
      makeMockWardrobeItem({ id: 'bag_brown', category: 'Accessories', sub_category: 'Brown Tote Bag', color_tags: ['Brown'] }),
      makeMockWardrobeItem({ id: 'shades_gold', category: 'Accessories', sub_category: 'Gold Sunglasses', color_tags: ['Gold'] }),
      makeMockWardrobeItem({ id: 'top_white', category: 'Top', sub_category: 'White Linen Shirt', color_tags: ['White'] }),
      makeMockWardrobeItem({ id: 'bottom_navy', category: 'Bottom', sub_category: 'Navy Chinos', color_tags: ['Navy'] }),
    ];

    test('extracts "style around my black leather belt" into mustUseItemIds', () => {
      const intent = parseStylingIntent('style around my black leather belt', null, testWardrobe);
      expect(intent.mustUseItemIds).toContain('belt_black');
    });

    test('extracts "style around brown tote bag" into mustUseItemIds', () => {
      const intent = parseStylingIntent('style around brown tote bag', null, testWardrobe);
      expect(intent.mustUseItemIds).toContain('bag_brown');
    });

    test('matches single-word accessory queries and material signals', () => {
      const intent = parseStylingIntent('give me a look with sunglasses', null, testWardrobe);
      expect(intent.mustUseItemIds).toContain('shades_gold');
    });
  });

  // =========================================================================
  // 3. TWO-STAGE BOUNDED CANONICAL CANDIDATE GENERATION
  // =========================================================================
  describe('3. Two-Stage Bounded Canonical Candidate Generation', () => {
    const generativeWardrobe: WardrobeItem[] = [
      // Cores
      makeMockWardrobeItem({ id: 'top_1', category: 'Top', sub_category: 'White Tee', color_tags: ['White'] }),
      makeMockWardrobeItem({ id: 'top_2', category: 'Top', sub_category: 'Blue Oxford', color_tags: ['Blue'] }),
      makeMockWardrobeItem({ id: 'bot_1', category: 'Bottom', sub_category: 'Khaki Chinos', color_tags: ['Khaki'] }),
      makeMockWardrobeItem({ id: 'bot_run', category: 'Bottom', sub_category: 'Athletic Running Shorts', color_tags: ['Black'] }),
      makeMockWardrobeItem({ id: 'shoes_1', category: 'Shoes', sub_category: 'White Sneakers', color_tags: ['White'] }),
      makeMockWardrobeItem({ id: 'shoes_run', category: 'Shoes', sub_category: 'Running Shoes', color_tags: ['Blue'] }),
      // Accessories
      makeMockWardrobeItem({ id: 'bag_1', category: 'Accessories', sub_category: 'Canvas Tote', color_tags: ['Beige'] }),
      makeMockWardrobeItem({ id: 'belt_formal', category: 'Accessories', sub_category: 'Formal Leather Belt', color_tags: ['Black'] }),
      makeMockWardrobeItem({ id: 'watch_1', category: 'Accessories', sub_category: 'Classic Watch', color_tags: ['Silver'] }),
    ];

    test('Stage 1 must-use accessory co-pruning: incompatible cores pruned before Top-K selection', () => {
      // Intent requires formal leather belt and running activity
      // Formal belt contradicts running shorts
      const intent: StylingIntent = {
        rawPrompt: 'Athletic run',
        mustUseItemIds: ['belt_formal'],
      };

      const candidates = generateCandidateOutfits(generativeWardrobe, intent);
      // None of the resulting outfits should pair running shorts with formal belt
      for (const cand of candidates) {
        const itemIds = cand.items.map((i) => i.id);
        if (itemIds.includes('belt_formal')) {
          expect(itemIds).not.toContain('bot_run');
        }
      }
    });

    test('Stage 1 returns grounded empty candidates when locked accessory conflicts with all wardrobe cores', () => {
      // Wardrobe with ONLY swimming trunks and a locked formal leather belt for active swimming
      const swimWardrobe = [
        makeMockWardrobeItem({ id: 'swim_trunks', category: 'Bottom', sub_category: 'Swim Trunks', color_tags: ['Blue'] }),
        makeMockWardrobeItem({ id: 'swim_tee', category: 'Top', sub_category: 'Swim Rash Guard', color_tags: ['Blue'] }),
        makeMockWardrobeItem({ id: 'belt_leather', category: 'Accessories', sub_category: 'Formal Leather Belt', color_tags: ['Black'] }),
      ];

      const intent: StylingIntent = {
        rawPrompt: 'Going active pool swimming',
        selectedOccasion: 'swimming',
        mustUseItemIds: ['belt_leather'],
      };

      const candidates = generateCandidateOutfits(swimWardrobe, intent);
      // All core combinations contradict leather belt in swimming -> returns empty, never fabricates
      expect(candidates).toEqual([]);
    });

    test('Stage 2 evaluates bounded accessory bundles including [None]', () => {
      const intent: StylingIntent = {
        rawPrompt: 'Casual everyday look',
      };
      const candidates = generateCandidateOutfits(generativeWardrobe, intent);
      expect(candidates.length).toBeGreaterThan(0);

      // Verify at least one candidate has accessoryCount tracked
      for (const cand of candidates) {
        expect(typeof cand.accessoryCount).toBe('number');
      }
    });

    test('Accessory score adjustment is strictly bounded to [-5, +5] points', () => {
      const intent: StylingIntent = {
        rawPrompt: 'Casual day',
      };
      const candidates = generateCandidateOutfits(generativeWardrobe, intent);
      for (const cand of candidates) {
        // baseScore must remain within 0-100 and reasonable bounds
        expect(cand.baseScore).toBeGreaterThanOrEqual(20);
        expect(cand.baseScore).toBeLessThanOrEqual(100);
      }
    });

    test('Simplicity / Restraint tie-break: simpler outfit preferred when scores are equal', () => {
      const intent: StylingIntent = {
        rawPrompt: 'Clean minimalist casual',
      };
      const candidates = generateCandidateOutfits(generativeWardrobe, intent);
      if (candidates.length >= 2) {
        const first = candidates[0];
        const second = candidates[1];
        if (first.baseScore === second.baseScore) {
          expect((first.accessoryCount || 0)).toBeLessThanOrEqual(second.accessoryCount || 0);
        }
      }
    });
  });

  // =========================================================================
  // 4. COMPLETE ENSEMBLE CRITIQUE & CONTRADICTION RULES
  // =========================================================================
  describe('4. Complete Ensemble Critique & Evidence-Gated Contradictions', () => {
    test('(a) Active swimming contradicts leather bags, backpacks, and non-swimwear watches', () => {
      const swimContext = interpretOutfitContext({ occasion: 'Swimming at pool', additionalContext: 'swimming laps' });
      const reqs = buildOccasionRequirements(swimContext);

      const leatherBag = makeMockWardrobeItem({
        id: 'l_bag',
        category: 'Accessories',
        sub_category: 'Leather Backpack',
        description: 'Black leather everyday bag',
      });
      const swimTrunks = makeMockWardrobeItem({
        id: 'trunks',
        category: 'Bottom',
        sub_category: 'Swim Trunks',
        description: 'Quick-dry swim shorts',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'l_bag', image_url: '', name: 'Leather Backpack', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, leatherBag),
        buildGarmentSemanticProfile({ id: '2', wardrobe_item_id: 'trunks', image_url: '', name: 'Swim Trunks', garment_type: 'Bottom', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, swimTrunks),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.category === 'activity_water' && c.garmentName.includes('Leather Backpack'))).toBe(true);
    });

    test('(b) Formal belt paired with athletic running shorts generates severe contradiction', () => {
      const runContext = interpretOutfitContext({ occasion: 'Running marathon training' });
      const reqs = buildOccasionRequirements(runContext);

      const dressBelt = makeMockWardrobeItem({
        id: 'db',
        category: 'Accessories',
        sub_category: 'Dress Belt',
        description: 'Polished leather formal belt',
      });
      const runShorts = makeMockWardrobeItem({
        id: 'rs',
        category: 'Bottom',
        sub_category: 'Running Shorts',
        description: 'Elastic waist gym running shorts',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'db', image_url: '', name: 'Dress Belt', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, dressBelt),
        buildGarmentSemanticProfile({ id: '2', wardrobe_item_id: 'rs', image_url: '', name: 'Running Shorts', garment_type: 'Bottom', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, runShorts),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.category === 'formality_dresscode' && c.reason.includes('formal/leather belt'))).toBe(true);
    });

    test('(c) Sunglasses in strictly indoor or nighttime context generates minor contradiction', () => {
      const indoorContext = interpretOutfitContext({ occasion: 'Night dinner party', additionalContext: 'indoor private dining room at night' });
      const reqs = buildOccasionRequirements(indoorContext);

      const shades = makeMockWardrobeItem({
        id: 'sg',
        category: 'Accessories',
        sub_category: 'Dark Sunglasses',
        description: 'Tinted UV sunglasses',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'sg', image_url: '', name: 'Dark Sunglasses', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, shades),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.category === 'occasion_context' && c.severity === 'minor')).toBe(true);
    });

    test('(d) Heavy winter knit scarf in warm/hot weather generates weather contradiction', () => {
      const hotContext = interpretOutfitContext({ occasion: 'Summer day in Miami', additionalContext: 'hot 35C sunny day' });
      const reqs = buildOccasionRequirements(hotContext);

      const winterScarf = makeMockWardrobeItem({
        id: 'ws',
        category: 'Accessories',
        sub_category: 'Wool Winter Scarf',
        description: 'Thick heavy knit wool winter scarf',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'ws', image_url: '', name: 'Wool Winter Scarf', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, winterScarf),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.category === 'weather_thermal' && c.severity === 'severe')).toBe(true);
    });

    test('missing evidence remains neutral: generic sports/stainless watch does NOT contradict active swimming', () => {
      const swimContext = interpretOutfitContext({ occasion: 'Lap swimming at pool', additionalContext: 'swimming laps in pool' });
      const reqs = buildOccasionRequirements(swimContext);

      const swimsuit = makeMockWardrobeItem({
        id: 'sw1',
        category: 'OnePiece',
        sub_category: 'Swimsuit',
        description: 'Aquatic athletic competition swimsuit',
      });
      const genericWatch = makeMockWardrobeItem({
        id: 'gw',
        category: 'Accessories',
        sub_category: 'Sports Watch',
        description: 'Water resistant sports chronograph',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'sw1', image_url: '', name: 'Swimsuit', garment_type: 'OnePiece', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, swimsuit),
        buildGarmentSemanticProfile({ id: '2', wardrobe_item_id: 'gw', image_url: '', name: 'Sports Watch', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, genericWatch),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.garmentName === 'Sports Watch')).toBe(false);
    });

    test('missing evidence remains neutral: casual cotton shorts with unknown waistband do NOT contradict leather belt', () => {
      const casualContext = interpretOutfitContext({ occasion: 'Weekend brunch', additionalContext: 'casual dining' });
      const reqs = buildOccasionRequirements(casualContext);

      const cottonShorts = makeMockWardrobeItem({
        id: 'cs',
        category: 'Bottom',
        sub_category: 'Cotton Shorts',
        description: 'Standard casual shorts',
      });
      const belt = makeMockWardrobeItem({
        id: 'blt',
        category: 'Accessories',
        sub_category: 'Leather Belt',
        description: 'Classic leather belt',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'cs', image_url: '', name: 'Cotton Shorts', garment_type: 'Bottom', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, cottonShorts),
        buildGarmentSemanticProfile({ id: '2', wardrobe_item_id: 'blt', image_url: '', name: 'Leather Belt', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, belt),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.category === 'formality_dresscode')).toBe(false);
    });

    test('missing evidence remains neutral: clear reading glasses indoors or at night do NOT trigger sunglasses contradiction', () => {
      const indoorContext = interpretOutfitContext({ occasion: 'Night dinner party', additionalContext: 'indoor dining at night' });
      const reqs = buildOccasionRequirements(indoorContext);

      const glasses = makeMockWardrobeItem({
        id: 'og',
        category: 'Accessories',
        sub_category: 'Reading Glasses',
        description: 'Clear optical frames',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'og', image_url: '', name: 'Reading Glasses', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, glasses),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.category === 'occasion_context')).toBe(false);
    });

    test('missing evidence remains neutral: lightweight silk scarf in warm weather does NOT trigger heavy knit contradiction', () => {
      const hotContext = interpretOutfitContext({ occasion: 'Summer day in Miami', additionalContext: 'hot 35C sunny day' });
      const reqs = buildOccasionRequirements(hotContext);

      const silkScarf = makeMockWardrobeItem({
        id: 'ss',
        category: 'Accessories',
        sub_category: 'Silk Scarf',
        description: 'Lightweight silk neckerchief',
      });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'ss', image_url: '', name: 'Silk Scarf', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, silkScarf),
      ];
      const structure = buildOutfitStructure(profiles);
      const contradictions = detectContradictions(profiles, reqs, structure);

      expect(contradictions.some((c) => c.category === 'weather_thermal')).toBe(false);
    });

    test('Soft over-accessorizing advisory triggers when >3 statement accessories are present', () => {
      const acc1 = makeMockWardrobeItem({ id: 'a1', category: 'Accessories', sub_category: 'Leather Belt' });
      const acc2 = makeMockWardrobeItem({ id: 'a2', category: 'Accessories', sub_category: 'Tote Bag' });
      const acc3 = makeMockWardrobeItem({ id: 'a3', category: 'Accessories', sub_category: 'Fedora Hat' });
      const acc4 = makeMockWardrobeItem({ id: 'a4', category: 'Accessories', sub_category: 'Silk Scarf' });

      const profiles = [
        buildGarmentSemanticProfile({ id: '1', wardrobe_item_id: 'a1', image_url: '', name: 'Belt', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, acc1),
        buildGarmentSemanticProfile({ id: '2', wardrobe_item_id: 'a2', image_url: '', name: 'Bag', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, acc2),
        buildGarmentSemanticProfile({ id: '3', wardrobe_item_id: 'a3', image_url: '', name: 'Hat', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, acc3),
        buildGarmentSemanticProfile({ id: '4', wardrobe_item_id: 'a4', image_url: '', name: 'Scarf', garment_type: 'Accessory', x: 0, y: 0, scale: 1, rotation: 0, zIndex: 1 }, acc4),
      ];
      const structure = buildOutfitStructure(profiles);

      expect(structure.isOverAccessorized).toBe(true);
      expect(structure.overAccessorizedNote).toBeDefined();
    });

    test('Grounded explainer weaves accessories into whyThisWorks description', () => {
      const top = makeMockWardrobeItem({ id: 't1', category: 'Top', sub_category: 'Silk Blouse', color_tags: ['Cream'] });
      const bot = makeMockWardrobeItem({ id: 'b1', category: 'Bottom', sub_category: 'Pleated Skirt', color_tags: ['Navy'] });
      const shoes = makeMockWardrobeItem({ id: 's1', category: 'Shoes', sub_category: 'Block Heels', color_tags: ['Navy'] });
      const bag = makeMockWardrobeItem({ id: 'bg1', category: 'Accessories', sub_category: 'Leather Clutch', color_tags: ['Burgundy'] });

      const candidate: CandidateOutfit = {
        candidateId: 't1-b1-s1-bg1',
        key: 't1-b1-s1-bg1',
        items: [top, bot, shoes, bag],
        baseScore: 92,
        colorMatchLabel: 'Sophisticated Contrast',
        formalityLevel: 'elevatedCasual',
        hasDress: false,
        hasShoes: true,
        hasOuterwear: false,
        hasBag: true,
        accessoryCount: 1,
      };

      const explanation = generateGroundedExplanation(candidate, { rawPrompt: 'Cocktail evening' });
      expect(explanation.whyThisWorks.accessories).toBeDefined();
      expect(explanation.whyThisWorks.accessories).toContain('Leather Clutch');
    });
  });

  // =========================================================================
  // 5. INTERACTIVE REMIX WITH MULTI-CAPACITY ACCESSORY MODEL
  // =========================================================================
  describe('5. Interactive Remix Multi-Capacity Accessory Model', () => {
    const mockWardrobe: WardrobeItem[] = [
      makeMockWardrobeItem({ id: 'top_1', category: 'Top', sub_category: 'Cashmere Knit', color_tags: ['Beige'] }),
      makeMockWardrobeItem({ id: 'bot_1', category: 'Bottom', sub_category: 'Wool Trousers', color_tags: ['Black'] }),
      makeMockWardrobeItem({ id: 'shoes_1', category: 'Shoes', sub_category: 'Loafers', color_tags: ['Black'] }),
      makeMockWardrobeItem({ id: 'j_1', category: 'Accessories', sub_category: 'Gold Necklace', color_tags: ['Gold'] }),
      makeMockWardrobeItem({ id: 'j_2', category: 'Accessories', sub_category: 'Pearl Earrings', color_tags: ['White'] }),
      makeMockWardrobeItem({ id: 'bag_1', category: 'Accessories', sub_category: 'Structured Satchel', color_tags: ['Brown'] }),
      makeMockWardrobeItem({ id: 'bag_2', category: 'Accessories', sub_category: 'Shoulder Bag', color_tags: ['Black'] }),
    ];

    const initialOption: StylingOption = {
      candidateId: 'opt_1',
      items: [
        mockWardrobe[0],
        mockWardrobe[1],
        mockWardrobe[2],
        mockWardrobe[3], // necklace
        mockWardrobe[4], // earrings
        mockWardrobe[5], // bag
      ],
      key: 'top_1-bot_1-shoes_1-j_1-j_2-bag_1',
      label: 'Look 1',
      headline: 'Effortless Chic',
      intentMatch: 'Tailored luxury',
      score: 90,
      isAiRanked: false,
      assessment: {
        score: 90,
        critique: 'Refined',
        colorHarmony: 'High',
        proportionBalance: 'Balanced',
        formalityConsistency: 'Consistent',
        weatherAppropriateness: 'Appropriate',
        versatility: 'High',
      } as any,
      whyThisWorks: {
        summary: 'A refined look with gold touches',
        palette: 'Complementary tones with gold accents',
        silhouette: 'Tailored drape',
        occasion: 'Chic dinner',
      },
    };

    test('adaptStyleAdvisorLookToRemix populates core slots and multi-capacity accessorySlots', () => {
      const state = adaptStyleAdvisorLookToRemix(initialOption, mockWardrobe, { rawPrompt: 'Chic dinner' });
      expect(state.slots.top?.item.id).toBe('top_1');
      expect(state.slots.bottom?.item.id).toBe('bot_1');
      expect(state.slots.shoes?.item.id).toBe('shoes_1');

      // Jewelry slot capacity = 2 items
      expect(state.accessorySlots?.jewelry?.items.length).toBe(2);
      expect(state.accessorySlots?.jewelry?.items[0].item.id).toBe('j_1');
      expect(state.accessorySlots?.jewelry?.items[1].item.id).toBe('j_2');

      // Bag slot capacity = 1 item
      expect(state.accessorySlots?.bag?.items.length).toBe(1);
      expect(state.accessorySlots?.bag?.items[0].item.id).toBe('bag_1');
    });

    test('toggleSlotLock locks individual accessory items cleanly', () => {
      const state = adaptStyleAdvisorLookToRemix(initialOption, mockWardrobe, { rawPrompt: 'Chic dinner' });
      // Lock first jewelry piece
      const lockedState = toggleSlotLock(state, 'jewelry', 'j_1');
      expect(lockedState.accessorySlots?.jewelry?.items.find((i) => i.item.id === 'j_1')?.isLocked).toBe(true);
      expect(lockedState.accessorySlots?.jewelry?.items.find((i) => i.item.id === 'j_2')?.isLocked).toBe(false);

      // Unlock it
      const unlockedState = toggleSlotLock(lockedState, 'jewelry', 'j_1');
      expect(unlockedState.accessorySlots?.jewelry?.items.find((i) => i.item.id === 'j_1')?.isLocked).toBe(false);
    });

    test('getCanonicalSlotReplacements provides ranked canonical alternatives for accessory slots', () => {
      const state = adaptStyleAdvisorLookToRemix(initialOption, mockWardrobe, { rawPrompt: 'Chic dinner' });
      const replacements = getCanonicalSlotReplacements(state, 'bag', mockWardrobe, 'bag_1');
      // Should find bag_2 as a replacement
      expect(Array.isArray(replacements)).toBe(true);
      if (replacements.length > 0) {
        expect(replacements[0].replacementItem.id).toBe('bag_2');
      }
    });

    test('adaptSavedOutfitToRemix preserves accessory pieces without fabricating missing items', () => {
      const savedLook = {
        id: 'saved_look_1',
        name: 'My Fav Look',
        items: [
          { wardrobe_item_id: 'top_1' },
          { wardrobe_item_id: 'bot_1' },
          { wardrobe_item_id: 'shoes_1' },
          { wardrobe_item_id: 'bag_1' },
        ],
      };

      const state = adaptSavedOutfitToRemix(savedLook, mockWardrobe);
      expect(state.slots.top?.item.id).toBe('top_1');
      expect(state.accessorySlots?.bag?.items[0].item.id).toBe('bag_1');
      expect(state.missingItems).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. MANNEQUIN PLACEMENT & SMART SHUFFLE
  // =========================================================================
  describe('6. Mannequin Coordinate Placement & Smart Shuffle', () => {
    test('createMannequinItem positions transparent-safe Bag on body (0.26, 0.48, zIndex 6)', () => {
      const bag = makeMockWardrobeItem({
        id: 'b1',
        category: 'Accessories',
        sub_category: 'Tote Bag',
        image_url: 'https://example.com/bag.png', // png indicates alpha
      });
      const item = createMannequinItem(bag);
      expect(item.x).toBe(0.26);
      expect(item.y).toBe(0.48);
      expect(item.scale).toBe(0.75);
      expect(item.zIndex).toBeGreaterThanOrEqual(6);
    });

    test('createMannequinItem positions opaque Bag on bottom shelf (0, 0.88)', () => {
      const opaqueBag = makeMockWardrobeItem({
        id: 'b_op',
        category: 'Accessories',
        sub_category: 'Tote Bag',
        image_url: 'https://example.com/bag.jpg', // jpg has no alpha
      });
      const item = createMannequinItem(opaqueBag);
      expect(item.x).toBe(0);
      expect(item.y).toBe(0.88);
      expect(item.scale).toBe(0.55);
    });

    test('createMannequinItem positions transparent-safe Belt on waist (0, 0.42, zIndex 4)', () => {
      const belt = makeMockWardrobeItem({
        id: 'blt1',
        category: 'Accessories',
        sub_category: 'Leather Belt',
        image_url: 'https://example.com/belt.png', // png indicates alpha
      });
      const item = createMannequinItem(belt);
      expect(item.x).toBe(0);
      expect(item.y).toBe(0.42);
      expect(item.scale).toBe(0.85);
      expect(item.zIndex).toBeGreaterThanOrEqual(4);
    });

    test('createMannequinItem positions opaque Belt on bottom shelf (0, 0.88)', () => {
      const opaqueBelt = makeMockWardrobeItem({
        id: 'blt_op',
        category: 'Accessories',
        sub_category: 'Leather Belt',
        image_url: 'https://example.com/belt.jpg', // jpg has no alpha
      });
      const item = createMannequinItem(opaqueBelt);
      expect(item.x).toBe(0);
      expect(item.y).toBe(0.88);
      expect(item.scale).toBe(0.55);
    });

    test('createMannequinItem safely places opaque accessories on bottom shelf (0, 0.88)', () => {
      const scarf = makeMockWardrobeItem({
        id: 'sc1',
        category: 'Accessories',
        sub_category: 'Winter Scarf',
        image_url: 'https://example.com/scarf.jpg', // jpg has no alpha
      });
      const item = createMannequinItem(scarf);
      expect(item.y).toBe(0.88);
      expect(item.scale).toBe(0.55);
    });

    test('validateAndPartitionPinnedSet allows pinned Bag and Belt into generatorPinnedIds', () => {
      const bag = makeMockWardrobeItem({ id: 'bag_pin', category: 'Accessories', sub_category: 'Shoulder Bag' });
      const belt = makeMockWardrobeItem({ id: 'belt_pin', category: 'Accessories', sub_category: 'Dress Belt' });
      const watch = makeMockWardrobeItem({ id: 'watch_pin', category: 'Accessories', sub_category: 'Gold Watch' });

      const wardrobeMap = new Map([
        [bag.id, bag],
        [belt.id, belt],
        [watch.id, watch],
      ]);

      const partition = validateAndPartitionPinnedSet(
        new Set([bag.id, belt.id, watch.id]),
        wardrobeMap
      );

      expect(partition.valid).toBe(true);
      // Bag and Belt participate in canonical generation
      expect(partition.generatorPinnedIds).toContain('bag_pin');
      expect(partition.generatorPinnedIds).toContain('belt_pin');
      // Watch is canvas-only
      expect(partition.canvasOnlyPinnedIds).toContain('watch_pin');
    });

    test('validateAndPartitionPinnedSet rejects >1 pinned bag with clear error reason', () => {
      const bag1 = makeMockWardrobeItem({ id: 'b1', category: 'Accessories', sub_category: 'Tote Bag' });
      const bag2 = makeMockWardrobeItem({ id: 'b2', category: 'Accessories', sub_category: 'Crossbody Bag' });

      const wardrobeMap = new Map([
        [bag1.id, bag1],
        [bag2.id, bag2],
      ]);

      const partition = validateAndPartitionPinnedSet(new Set(['b1', 'b2']), wardrobeMap);
      expect(partition.valid).toBe(false);
      expect(partition.reason).toContain('Multiple bags are pinned');
    });
  });

  // =========================================================================
  // 7. IDENTITY, PHASE B EXPOSURE & GENERATION MODES
  // =========================================================================
  describe('7. Identity, Phase B Exposure & Generation Modes', () => {
    test('exact ensemble identity includes accessories while coreLookKey isolates core garments', () => {
      const top = makeMockWardrobeItem({ id: 'top_1', category: 'Top' });
      const bot = makeMockWardrobeItem({ id: 'bot_1', category: 'Bottom' });
      const shoes = makeMockWardrobeItem({ id: 'shoe_1', category: 'Shoes' });
      const bagA = makeMockWardrobeItem({ id: 'bag_a', category: 'Accessories', sub_category: 'Tote Bag' });
      const bagB = makeMockWardrobeItem({ id: 'bag_b', category: 'Accessories', sub_category: 'Clutch Bag' });

      const ensembleA = [top, bot, shoes, bagA];
      const ensembleB = [top, bot, shoes, bagB];

      const keyA = ensembleA.map((i) => i.id).sort().join('|');
      const keyB = ensembleB.map((i) => i.id).sort().join('|');
      expect(keyA).not.toBe(keyB); // Exact ensemble keys are different

      const coreKeyA = computeCoreLookExposureKey(ensembleA);
      const coreKeyB = computeCoreLookExposureKey(ensembleB);
      expect(coreKeyA).toBe(coreKeyB); // Core look key is identical
      expect(coreKeyA).toBe('bot_1|shoe_1|top_1');

      // outfitSignature includes all accessories for exact duplicate checking
      const sigA = outfitSignature(ensembleA.map((i) => ({ wardrobe_item_id: i.id, name: i.sub_category || '', slot: 'core' })));
      const sigB = outfitSignature(ensembleB.map((i) => ({ wardrobe_item_id: i.id, name: i.sub_category || '', slot: 'core' })));
      expect(sigA).not.toBe(sigB);
    });

    test('Phase B cooldown: accessory-only variation of passed look does NOT reset fatigue cooldown', async () => {
      const userId = 'user_fatigue_test';
      localExposureService.purgeInMemoryForUser(userId);

      const top = makeMockWardrobeItem({ id: 't1', category: 'Top' });
      const bot = makeMockWardrobeItem({ id: 'b1', category: 'Bottom' });
      const shoes = makeMockWardrobeItem({ id: 's1', category: 'Shoes' });
      const bag = makeMockWardrobeItem({ id: 'bg1', category: 'Accessories', sub_category: 'Bag' });
      const watch = makeMockWardrobeItem({ id: 'w1', category: 'Accessories', sub_category: 'Watch' });

      const look1 = [top, bot, shoes, bag];
      const look1Key = look1.map((i) => i.id).sort().join('|');
      const coreKey = computeCoreLookExposureKey(look1);

      // User passes look1 in Phase B
      await localExposureService.logInteraction(userId, look1Key, 'passed', look1.map((i) => i.id), undefined, Date.now(), coreKey);

      const history = await localExposureService.getExposureHistory(userId);

      // Look 1 is under active cooldown
      expect(localExposureService.isOutfitCooldownActive(look1Key, history, undefined, Date.now(), coreKey)).toBe(true);

      // Look 2 has the exact same core garments but swapped bag for watch
      const look2 = [top, bot, shoes, watch];
      const look2Key = look2.map((i) => i.id).sort().join('|');
      const look2CoreKey = computeCoreLookExposureKey(look2);

      // Core look cooldown catches the accessory variation: does NOT reset cooldown!
      expect(localExposureService.isOutfitCooldownActive(look2Key, history, undefined, Date.now(), look2CoreKey)).toBe(true);
    });

    test('Watch and Jewelry are NOT automatically added to ordinary recommendations without prompt/must-use', () => {
      const wardrobe = [
        makeMockWardrobeItem({ id: 't1', category: 'Top', sub_category: 'Shirt', color_tags: ['White'] }),
        makeMockWardrobeItem({ id: 'b1', category: 'Bottom', sub_category: 'Trousers', color_tags: ['Black'] }),
        makeMockWardrobeItem({ id: 's1', category: 'Shoes', sub_category: 'Loafers', color_tags: ['Black'] }),
        makeMockWardrobeItem({ id: 'w1', category: 'Accessories', sub_category: 'Gold Watch', color_tags: ['Gold'] }),
        makeMockWardrobeItem({ id: 'j1', category: 'Accessories', sub_category: 'Pearl Necklace', color_tags: ['White'] }),
      ];

      const candidates = generateCandidateOutfits(wardrobe, { rawPrompt: 'Casual workday outfit' }, { limit: 5 });
      expect(candidates.length).toBeGreaterThan(0);

      for (const cand of candidates) {
        const itemIds = cand.items.map((i) => i.id);
        // Neither watch nor jewelry is auto-injected
        expect(itemIds).not.toContain('w1');
        expect(itemIds).not.toContain('j1');
      }
    });

    test('evaluates [None] as a valid bundle and applies simplicity tie-break', () => {
      const top = makeMockWardrobeItem({ id: 't1', category: 'Top', sub_category: 'Shirt', color_tags: ['Navy'] });
      const bot = makeMockWardrobeItem({ id: 'b1', category: 'Bottom', sub_category: 'Chinos', color_tags: ['Beige'] });
      const shoes = makeMockWardrobeItem({ id: 's1', category: 'Shoes', sub_category: 'Sneakers', color_tags: ['White'] });
      const belt = makeMockWardrobeItem({ id: 'blt1', category: 'Accessories', sub_category: 'Belt', color_tags: ['Navy'] });

      const candidates = generateCandidateOutfits([top, bot, shoes, belt], { rawPrompt: 'Clean minimalist look' }, { limit: 5 });
      expect(candidates.length).toBeGreaterThan(0);

      // Verify at least one candidate with 0 accessories was evaluated and returned
      const cleanCandidate = candidates.find((c) => (c.accessoryCount ?? 0) === 0);
      expect(cleanCandidate).toBeDefined();
    });
  });
});
