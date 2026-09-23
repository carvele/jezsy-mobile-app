import { generateCandidateOutfits } from '../candidateGenerator';
import { generateOutfits } from '@/src/utils/outfitGenerator';
import { WardrobeItem, StylingIntent } from '@/src/types/styleAdvisor';

function createMockItem(
  id: string,
  category: string,
  colors: string[] = ['black'],
  overrides: Record<string, any> = {}
): WardrobeItem {
  return {
    id,
    user_id: 'u1',
    category,
    sub_category: overrides.sub_category || category,
    color_tags: colors,
    garment_type: category,
    wear_count: overrides.wear_count ?? 1,
    last_worn_at: overrides.last_worn_at ?? '2026-09-01T00:00:00Z',
    description: overrides.description || '',
    user_notes: overrides.user_notes || '',
    occasions: overrides.occasions || ['Casual'],
    seasons: overrides.seasons || ['All'],
    ai_attributes: overrides.ai_attributes || null,
    created_at: '2026-09-01T00:00:00Z',
    deleted: false,
    embedding: null,
    image_url: overrides.image_url || 'https://example.com/item.png',
    product_id: null,
    ...(overrides.pattern ? { pattern: overrides.pattern } : {}),
  } as unknown as WardrobeItem;
}

describe('Phase A — Canonical Generator Characterization & Parity Test Suite', () => {
  // =========================================================================
  // FIXTURE 1: Sparse Wardrobe (8 items)
  // =========================================================================
  test('Fixture 1: Sparse wardrobe generates valid combinations under both profiles', () => {
    const sparseWardrobe: WardrobeItem[] = [
      createMockItem('t1', 'Top', ['white']),
      createMockItem('t2', 'Top', ['blue']),
      createMockItem('b1', 'Bottom', ['black']),
      createMockItem('b2', 'Bottom', ['navy']),
      createMockItem('d1', 'Dress', ['black']),
      createMockItem('s1', 'Shoes', ['black']),
      createMockItem('o1', 'Outerwear', ['gray']),
      createMockItem('a1', 'Accessory', ['gold']),
    ];

    const intent: StylingIntent = { rawPrompt: '', selectedOccasion: 'Casual' };

    const legacyOutfits = generateOutfits(sparseWardrobe, 10);
    const canonicalPassive = generateCandidateOutfits(sparseWardrobe, intent, {
      limit: 10,
      scoringProfile: 'legacy-passive',
    });
    const canonicalIntent = generateCandidateOutfits(sparseWardrobe, intent, {
      limit: 10,
      scoringProfile: 'intent-driven',
    });

    expect(legacyOutfits.length).toBeGreaterThan(0);
    expect(canonicalPassive.length).toBeGreaterThan(0);
    expect(canonicalIntent.length).toBeGreaterThan(0);

    // Verify combination completeness (Top+Bottom or Dress)
    for (const cand of canonicalPassive) {
      const cats = cand.items.map((i) => i.category);
      const isDress = cats.includes('Dress');
      const isTwoPiece = cats.includes('Top') && cats.includes('Bottom');
      expect(isDress || isTwoPiece).toBe(true);
    }
  });

  // =========================================================================
  // FIXTURE 2: Capsule Wardrobe (25 items) with Wear History & Neglect
  // =========================================================================
  test('Fixture 2: Capsule wardrobe surfaces neglected unworn items', () => {
    const capsuleWardrobe: WardrobeItem[] = [];
    const now = new Date().toISOString();
    // 8 tops (2 unworn)
    for (let i = 1; i <= 8; i++) {
      capsuleWardrobe.push(
        createMockItem(`top_${i}`, 'Top', [i % 2 === 0 ? 'white' : 'blue'], {
          wear_count: i <= 2 ? 0 : i * 2,
          last_worn_at: i <= 2 ? undefined : now,
        })
      );
    }
    // 6 bottoms
    for (let i = 1; i <= 6; i++) {
      capsuleWardrobe.push(createMockItem(`bot_${i}`, 'Bottom', ['black'], { wear_count: i, last_worn_at: now }));
    }
    // 3 dresses
    for (let i = 1; i <= 3; i++) {
      capsuleWardrobe.push(createMockItem(`dress_${i}`, 'Dress', ['navy'], { wear_count: i, last_worn_at: now }));
    }
    // 4 shoes
    for (let i = 1; i <= 4; i++) {
      capsuleWardrobe.push(createMockItem(`shoe_${i}`, 'Shoes', ['black'], { wear_count: i, last_worn_at: now }));
    }
    // 4 outer
    for (let i = 1; i <= 4; i++) {
      capsuleWardrobe.push(createMockItem(`outer_${i}`, 'Outerwear', ['gray'], { wear_count: i, last_worn_at: now }));
    }

    const intent: StylingIntent = { rawPrompt: '' };
    const candidates = generateCandidateOutfits(capsuleWardrobe, intent, { limit: 10 });

    expect(candidates.length).toBe(10);
    // Unworn tops (top_1, top_2) should receive neglect discovery boost
    const containsUnworn = candidates.some((c) =>
      c.items.some((it) => it.id === 'top_1' || it.id === 'top_2')
    );
    expect(containsUnworn).toBe(true);
  });

  // =========================================================================
  // FIXTURE 3: Large Wardrobe (120 items) — Bounded Scaling
  // =========================================================================
  test('Fixture 3: Large wardrobe scales cleanly within bounded limit', () => {
    const largeWardrobe: WardrobeItem[] = [];
    const categories = ['Top', 'Bottom', 'Dress', 'Shoes', 'Outerwear', 'Accessory'];
    for (let i = 1; i <= 120; i++) {
      const cat = categories[i % categories.length];
      largeWardrobe.push(createMockItem(`item_${i}`, cat, ['black', 'white']));
    }

    const intent: StylingIntent = { rawPrompt: 'Work' };
    const start = Date.now();
    const candidates = generateCandidateOutfits(largeWardrobe, intent, { limit: 12 });
    const duration = Date.now() - start;

    expect(candidates.length).toBe(12);
    // Assert on-device execution does not crawl (stays bounded below 5000ms in concurrent Jest runs)
    expect(duration).toBeLessThan(5000);
  });

  // =========================================================================
  // TARGETED EDGE 1: Missing Shoes Fixture
  // =========================================================================
  test('Edge 1: Generates valid outfits when shoes are missing', () => {
    const noShoes = [
      createMockItem('t1', 'Top', ['white']),
      createMockItem('b1', 'Bottom', ['black']),
    ];
    const intent: StylingIntent = { rawPrompt: '' };
    const candidates = generateCandidateOutfits(noShoes, intent);
    expect(candidates.length).toBe(1);
    expect(candidates[0].hasShoes).toBe(false);
  });

  // =========================================================================
  // TARGETED EDGE 2: Dress-Only Inventory
  // =========================================================================
  test('Edge 2: Dress-only inventory produces 100% dress candidates', () => {
    const dressOnly = [
      createMockItem('d1', 'Dress', ['black']),
      createMockItem('d2', 'Dress', ['red']),
      createMockItem('s1', 'Shoes', ['black']),
    ];
    const intent: StylingIntent = { rawPrompt: '' };
    const candidates = generateCandidateOutfits(dressOnly, intent);
    expect(candidates.length).toBe(2);
    for (const c of candidates) {
      expect(c.hasDress).toBe(true);
      expect(c.items.some((i) => i.category === 'Top')).toBe(false);
    }
  });

  // =========================================================================
  // TARGETED EDGE 3: Strict Avoided Colors (No Silent Violation)
  // =========================================================================
  test('Edge 3: Avoided colors are strictly honored; never violate constraint', () => {
    const wardrobeWithRed = [
      createMockItem('t1', 'Top', ['red']),
      createMockItem('t2', 'Top', ['blue']),
      createMockItem('b1', 'Bottom', ['black']),
    ];
    const intent: StylingIntent = { rawPrompt: '', avoidedColors: ['red'] };
    const candidates = generateCandidateOutfits(wardrobeWithRed, intent);

    // Only t2 (blue) can be used; t1 (red) must never appear
    expect(candidates.length).toBe(1);
    expect(candidates[0].items.some((i) => i.id === 't1')).toBe(false);
    expect(candidates[0].items.some((i) => i.id === 't2')).toBe(true);

    // If only red top exists, engine must return 0 candidates rather than violating "No red"
    const redOnlyTop = [
      createMockItem('t1', 'Top', ['red']),
      createMockItem('b1', 'Bottom', ['black']),
    ];
    const redOnlyCandidates = generateCandidateOutfits(redOnlyTop, intent);
    expect(redOnlyCandidates.length).toBe(0);
  });

  // =========================================================================
  // TARGETED EDGE 4: Excluded Items Fixture
  // =========================================================================
  test('Edge 4: Excluded item IDs are strictly omitted from all candidates', () => {
    const wardrobe = [
      createMockItem('t1', 'Top', ['white']),
      createMockItem('t2', 'Top', ['gray']),
      createMockItem('b1', 'Bottom', ['black']),
    ];
    const intent: StylingIntent = { rawPrompt: '', excludedItemIds: ['t1'] };
    const candidates = generateCandidateOutfits(wardrobe, intent);
    expect(candidates.length).toBe(1);
    expect(candidates[0].items.some((i) => i.id === 't1')).toBe(false);
  });

  // =========================================================================
  // TARGETED EDGE 5: Pattern Clash Penalty
  // =========================================================================
  test('Edge 5: Pattern clash is penalized in candidate scoring', () => {
    const wardrobe = [
      createMockItem('t_pat', 'Top', ['blue'], { pattern: 'Floral' }),
      createMockItem('t_solid', 'Top', ['blue'], { pattern: 'Solid' }),
      createMockItem('b_pat', 'Bottom', ['black'], { pattern: 'Plaid' }),
      createMockItem('s1', 'Shoes', ['black']),
    ];
    const intent: StylingIntent = { rawPrompt: '' };
    const candidates = generateCandidateOutfits(wardrobe, intent, { scoringProfile: 'intent-driven' });
    expect(candidates.length).toBe(2);

    const clashing = candidates.find((c) => c.items.some((i) => i.id === 't_pat'));
    const nonClashing = candidates.find((c) => c.items.some((i) => i.id === 't_solid'));

    expect(clashing).toBeDefined();
    expect(nonClashing).toBeDefined();
    // Non-clashing outfit must outscore clashing outfit
    expect(nonClashing!.baseScore).toBeGreaterThan(clashing!.baseScore);
  });

  // =========================================================================
  // TARGETED EDGE 6: Unfulfillable / Missing Required Item (Anti-Fabrication)
  // =========================================================================
  test('Edge 6: Unfulfillable must-use item returns empty result; never fabricates dummy ID', () => {
    const wardrobe = [
      createMockItem('t1', 'Top', ['white']),
      createMockItem('b1', 'Bottom', ['black']),
    ];
    const intent: StylingIntent = {
      rawPrompt: 'Style my blazer',
      mustUseItemIds: ['non_existent_blazer_999'],
    };
    const candidates = generateCandidateOutfits(wardrobe, intent);

    // Must return empty array so failure is distinguishable. Never fabricate the ID!
    expect(candidates).toEqual([]);
  });

  // =========================================================================
  // TARGETED EDGE 7: Structurally Incompatible Required Item
  // =========================================================================
  test('Edge 7: Handles accessory as required item gracefully without crashing', () => {
    const wardrobe = [
      createMockItem('t1', 'Top', ['white']),
      createMockItem('b1', 'Bottom', ['black']),
      createMockItem('acc1', 'Accessory', ['gold']),
    ];
    const intent: StylingIntent = {
      rawPrompt: 'Style my necklace',
      mustUseItemIds: ['acc1'],
    };
    const candidates = generateCandidateOutfits(wardrobe, intent);
    expect(Array.isArray(candidates)).toBe(true);
    // If returned, candidate must include the accessory
    if (candidates.length > 0) {
      expect(candidates[0].items.some((i) => i.id === 'acc1')).toBe(true);
    }
  });

  // =========================================================================
  // TARGETED EDGE 8: Malformed / Unknown Garment Category
  // =========================================================================
  test('Edge 8: Malformed garment category handles gracefully without runtime error', () => {
    const wardrobe = [
      createMockItem('t1', 'Top', ['white']),
      createMockItem('b1', 'Bottom', ['black']),
      createMockItem('weird1', 'CustomUnknownType', ['silver']),
    ];
    const intent: StylingIntent = { rawPrompt: '' };
    expect(() => generateCandidateOutfits(wardrobe, intent)).not.toThrow();
  });

  // =========================================================================
  // TARGETED EDGE 9: Duplicate Combinations Unique Keys
  // =========================================================================
  test('Edge 9: Candidate keys are strictly deduplicated', () => {
    const wardrobe = [
      createMockItem('t1', 'Top', ['white']),
      createMockItem('t1_dupe', 'Top', ['white']),
      createMockItem('b1', 'Bottom', ['black']),
    ];
    const intent: StylingIntent = { rawPrompt: '' };
    const candidates = generateCandidateOutfits(wardrobe, intent);
    const keys = candidates.map((c) => c.key);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  // =========================================================================
  // TARGETED EDGE 10: Overconstrained Zero Valid Combinations
  // =========================================================================
  test('Edge 10: Overconstrained search returns clean empty array', () => {
    const wardrobe = [
      createMockItem('t1', 'Top', ['black']),
      createMockItem('b1', 'Bottom', ['black']),
    ];
    // Exclude both items
    const intent: StylingIntent = {
      rawPrompt: 'No black',
      avoidedColors: ['black'],
    };
    const candidates = generateCandidateOutfits(wardrobe, intent);
    expect(candidates).toEqual([]);
  });
});
