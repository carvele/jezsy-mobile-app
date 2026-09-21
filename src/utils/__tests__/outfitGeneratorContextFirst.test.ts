/**
 * Context-first generator behavior tests.
 *
 * Verifies that bySlot() pre-filters occasion-incompatible candidates using the
 * same Stylist contradiction engine as the Mannequin, ensuring "Style It For Me"
 * produces meaningfully different results per occasion.
 */

import { generateOutfits } from '../outfitGenerator';

function mockWardrobeItem(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    user_id: 'u1',
    garment_type: overrides.garment_type ?? overrides.category ?? 'Top',
    category: overrides.category ?? overrides.garment_type ?? 'Top',
    sub_category: overrides.sub_category ?? '',
    color: overrides.color ?? '',
    color_tags: overrides.color_tags ?? [],
    description: overrides.description ?? '',
    where_worn_often: overrides.where_worn_often ?? '',
    user_notes: overrides.user_notes ?? '',
    occasions: overrides.occasions ?? [],
    wear_count: overrides.wear_count ?? 0,
    last_worn_at: overrides.last_worn_at ?? null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ai_attributes: null,
  };
}

describe('Context-First Generator — bySlot Occasion Pre-filter', () => {
  // C1: Swimming occasion should include swimwear items over non-swimwear tops
  test('C1. Swimming occasion: generated outfits contain swimwear item when one exists', () => {
    const swimsuit = mockWardrobeItem('sw1', {
      category: 'Top',
      sub_category: 'Swimsuit',
      description: 'One-piece swimsuit for swimming',
    });
    const tshirt = mockWardrobeItem('t1', {
      category: 'Top',
      sub_category: 'T-Shirt',
      description: 'Cotton t-shirt',
    });
    const jeans = mockWardrobeItem('j1', {
      category: 'Bottom',
      sub_category: 'Jeans',
      description: 'Denim jeans',
    });

    const pool = [swimsuit, tshirt, jeans];
    const outfits = generateOutfits(pool, { occasion: 'Swimming', limit: 5 });

    // Must not crash and must be an array
    expect(Array.isArray(outfits)).toBe(true);
    // If outfits are returned, swimwear should appear (it is the only compatible top)
    if (outfits.length > 0) {
      const swimsuitInAny = outfits.some((o) => o.items.some((i: any) => i.id === 'sw1'));
      expect(swimsuitInAny).toBe(true);
    }
  });

  // C2: Swimming occasion — non-swimwear items excluded when swimwear exists
  test('C2. Swimming occasion: denim jeans excluded when swim bottom exists', () => {
    const swimTrunks = mockWardrobeItem('st1', {
      category: 'Bottom',
      sub_category: 'Swim Trunks',
      description: 'Boardshorts for swimming',
    });
    const jeans = mockWardrobeItem('j1', {
      category: 'Bottom',
      sub_category: 'Jeans',
      description: 'Denim jeans',
    });
    const rashGuard = mockWardrobeItem('rg1', {
      category: 'Top',
      sub_category: 'Rash Guard',
      description: 'Swim rash guard',
    });

    const pool = [rashGuard, swimTrunks, jeans];
    const outfits = generateOutfits(pool, { occasion: 'Swimming', limit: 10 });

    // Jeans must NOT appear when swim trunks are available
    const jeansInAny = outfits.some((o) => o.items.some((i: any) => i.id === 'j1'));
    expect(jeansInAny).toBe(false);
  });

  // C3: No occasion — all items eligible, backwards-compatible
  test('C3. No occasion: all wardrobe items remain eligible', () => {
    const blazer = mockWardrobeItem('bl1', { category: 'Top', sub_category: 'Blazer' });
    const jeans = mockWardrobeItem('j1', { category: 'Bottom', sub_category: 'Jeans' });
    const sneakers = mockWardrobeItem('sn1', { category: 'Shoes', sub_category: 'Sneakers' });

    const outfits = generateOutfits([blazer, jeans, sneakers], { limit: 3 });

    expect(outfits.length).toBeGreaterThan(0);
    const itemIds = new Set(outfits.flatMap((o) => o.items.map((i: any) => i.id)));
    expect(itemIds.has('bl1')).toBe(true);
    expect(itemIds.has('j1')).toBe(true);
  });

  // C4: Graceful fallback — no swimwear, must not crash
  test('C4. Swimming occasion with no swimwear: falls back gracefully without crashing', () => {
    const tshirt = mockWardrobeItem('t1', { category: 'Top', sub_category: 'T-Shirt' });
    const jeans = mockWardrobeItem('j1', { category: 'Bottom', sub_category: 'Jeans' });

    expect(() => {
      const outfits = generateOutfits([tshirt, jeans], { occasion: 'Swimming', limit: 3 });
      expect(Array.isArray(outfits)).toBe(true);
    }).not.toThrow();
  });

  // C5: All generated IDs come from the provided pool
  test('C5. Occasion-filtered outfits only contain IDs from the provided pool', () => {
    const bikiniTop = mockWardrobeItem('bk1', {
      category: 'Top',
      sub_category: 'Bikini Top',
      description: 'Bikini swimwear top',
    });
    const swimBottoms = mockWardrobeItem('sb1', {
      category: 'Bottom',
      sub_category: 'Bikini Bottom',
      description: 'Bikini swimwear bottom',
    });

    const pool = [bikiniTop, swimBottoms];
    const poolIds = new Set(pool.map((i) => i.id));

    const outfits = generateOutfits(pool, { occasion: 'Swimming', limit: 5 });
    for (const outfit of outfits) {
      for (const item of outfit.items) {
        expect(poolIds.has((item as any).id)).toBe(true);
      }
    }
  });

  // C6: additionalContext option accepted without error
  test('C6. additionalContext is accepted without error', () => {
    const top = mockWardrobeItem('t1', { category: 'Top', sub_category: 'Blouse' });
    const bottom = mockWardrobeItem('b1', { category: 'Bottom', sub_category: 'Trousers' });

    expect(() => {
      generateOutfits([top, bottom], {
        occasion: 'Work',
        additionalContext: 'Important client meeting this afternoon.',
        limit: 3,
      });
    }).not.toThrow();
  });

  // C7: Formal vs Casual — gym shorts should not appear in Formal as appropriate
  test('C7. Formal occasion: athletic items not rated as appropriate when formal alternatives exist', () => {
    const gown = mockWardrobeItem('gw1', {
      category: 'Dress',
      sub_category: 'Evening Gown',
      description: 'Formal ball gown',
    });
    const gymShorts = mockWardrobeItem('gs1', {
      category: 'Bottom',
      sub_category: 'Gym Shorts',
      where_worn_often: 'Gym, running',
    });
    const blouse = mockWardrobeItem('tp1', { category: 'Top', sub_category: 'Blouse' });

    const pool = [gown, gymShorts, blouse];
    const formalOutfits = generateOutfits(pool, { occasion: 'Formal', limit: 5 });

    expect(formalOutfits.length).toBeGreaterThan(0);

    // If gym shorts appear (fallback), they must not be Appropriate
    const formalWithShorts = formalOutfits.filter((o) =>
      o.items.some((i: any) => i.id === 'gs1')
    );
    if (formalWithShorts.length > 0) {
      const anyAppropriate = formalWithShorts.some(
        (o) => o.assessment === 'Appropriate for this occasion'
      );
      expect(anyAppropriate).toBe(false);
    }
  });
});
