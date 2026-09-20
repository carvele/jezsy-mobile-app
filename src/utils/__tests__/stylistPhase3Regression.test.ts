import {
  gradeOutfit,
  gradeOutfitWithAI,
  evaluateWardrobeOutfit,
  interpretOutfitContext,
  buildGarmentSemanticProfile,
  computeOutfitHash,
  computeContextHash,
  STYLIST_ANALYSIS_VERSION,
} from '../aiStylistAdvisor';
import { generateOutfits } from '../outfitGenerator';
import { resolveEffectiveGarmentBucket, normalizeGarment } from '../garmentSemanticClassifier';
import { MannequinCanvasItem } from '../mannequinConfig';

function mockWardrobeItem(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    user_id: 'user_123',
    garment_type: overrides.garment_type ?? 'Top',
    category: overrides.category ?? overrides.garment_type ?? 'Top',
    sub_category: overrides.sub_category ?? '',
    color: overrides.color ?? '',
    color_tags: overrides.color_tags ?? (overrides.color ? [overrides.color] : []),
    description: overrides.description ?? '',
    where_worn_often: overrides.where_worn_often ?? '',
    user_notes: overrides.user_notes ?? '',
    image_url: overrides.image_url ?? 'https://example.com/item.png',
    wear_count: overrides.wear_count ?? 0,
    last_worn_at: overrides.last_worn_at ?? null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-09-01T00:00:00Z',
    ai_attributes: overrides.ai_attributes ?? null,
  };
}

function mockCanvasItem(wardrobeItem: any, slotOverride?: string): MannequinCanvasItem {
  return {
    id: `canvas_${wardrobeItem.id}`,
    wardrobe_item_id: wardrobeItem.id,
    image_url: wardrobeItem.image_url,
    name: wardrobeItem.sub_category || wardrobeItem.category || wardrobeItem.name || 'Item',
    garment_type: slotOverride || resolveEffectiveGarmentBucket(wardrobeItem),
    x: 0,
    y: 0.2,
    scale: 1,
    rotation: 0,
    zIndex: 1,
  };
}

describe('PHASE 3 — Stylist Intelligence & Context Engine Verification', () => {
  // 1. Wedding + blazer + running shorts + running sneakers
  test('1. Wedding + blazer + running shorts + running sneakers is NOT appropriate and flags contradictions', () => {
    const blazer = mockWardrobeItem('b1', { category: 'Outerwear', sub_category: 'Tailored Navy Blazer', garment_type: 'Outerwear' });
    const shorts = mockWardrobeItem('s1', { category: 'Bottom', sub_category: 'Running Shorts', where_worn_often: 'Running, gym', garment_type: 'Bottom' });
    const sneakers = mockWardrobeItem('sn1', { category: 'Shoes', sub_category: 'Running Shoes', where_worn_often: 'Running track', garment_type: 'Shoes' });
    const lookup = { [blazer.id]: blazer, [shorts.id]: shorts, [sneakers.id]: sneakers };

    const critique = evaluateWardrobeOutfit([blazer, shorts, sneakers], lookup, { occasion: 'Wedding' });
    expect(critique.assessment).not.toBe('Appropriate for this occasion');
    expect(critique.rawContradictions?.some((c) => c.severity === 'severe' || c.severity === 'major')).toBe(true);
    expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/wedding|formal|athletic|running/);
  });

  // 2. Wedding + incomplete outfit (e.g. blazer + trousers, but no base top)
  test('2. Wedding + blazer + trousers without base top is flagged as Incomplete outfit', () => {
    const blazer = mockWardrobeItem('b2', { category: 'Outerwear', sub_category: 'Blazer', garment_type: 'Outerwear' });
    const trousers = mockWardrobeItem('t2', { category: 'Bottom', sub_category: 'Dress Trousers', garment_type: 'Bottom' });
    const shoes = mockWardrobeItem('sh2', { category: 'Shoes', sub_category: 'Oxford Shoes', garment_type: 'Shoes' });
    const lookup = { [blazer.id]: blazer, [trousers.id]: trousers, [shoes.id]: shoes };

    const critique = evaluateWardrobeOutfit([blazer, trousers, shoes], lookup, { occasion: 'Wedding' });
    expect(critique.assessment).toBe('Incomplete outfit');
    expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/missing|inner|base|top/);
  });

  // 3. Swimming + sweater + denim skirt
  test('3. Swimming + sweater + denim skirt is rejected as Not appropriate for this occasion', () => {
    const sweater = mockWardrobeItem('sw3', { category: 'Top', sub_category: 'Cropped Knit Sweater', garment_type: 'Top' });
    const skirt = mockWardrobeItem('sk3', { category: 'Bottom', sub_category: 'Denim Mini Skirt', garment_type: 'Bottom' });
    const shoes = mockWardrobeItem('sh3', { category: 'Shoes', sub_category: 'Mary Jane Flats', garment_type: 'Shoes' });
    const lookup = { [sweater.id]: sweater, [skirt.id]: skirt, [shoes.id]: shoes };

    const critique = evaluateWardrobeOutfit([sweater, skirt, shoes], lookup, { occasion: 'Swimming' });
    expect(critique.assessment).toBe('Not appropriate for this occasion');
    expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/water|swim|pool|absorb|denim|knit/);
  });

  // 4. Swimming + context "I will swim a lot"
  test('4. Swimming + additional context "I will swim a lot" reinforces aquatic mismatch and does not offer generic praise', () => {
    const sweater = mockWardrobeItem('sw4', { category: 'Top', sub_category: 'Wool Sweater', garment_type: 'Top' });
    const skirt = mockWardrobeItem('sk4', { category: 'Bottom', sub_category: 'Pleated Skirt', garment_type: 'Bottom' });
    const lookup = { [sweater.id]: sweater, [skirt.id]: skirt };

    const critique = evaluateWardrobeOutfit([sweater, skirt], lookup, {
      occasion: 'Swimming',
      additionalContext: 'I will swim a lot in the pool',
    });
    expect(critique.assessment).toBe('Not appropriate for this occasion');
    expect(critique.whyJezsySaysThis).not.toMatch(/effortlessly stylish|perfect combination/);
  });

  // 5. Cold night date + running shorts
  test('5. Cold night date + running shorts flags thermal mismatch and athletic conflict', () => {
    const top = mockWardrobeItem('t5', { category: 'Top', sub_category: 'Silk Blouse', garment_type: 'Top' });
    const shorts = mockWardrobeItem('s5', { category: 'Bottom', sub_category: 'Running Shorts', where_worn_often: 'Running', garment_type: 'Bottom' });
    const shoes = mockWardrobeItem('sh5', { category: 'Shoes', sub_category: 'Heeled Boots', garment_type: 'Shoes' });
    const lookup = { [top.id]: top, [shorts.id]: shorts, [shoes.id]: shoes };

    const critique = evaluateWardrobeOutfit([top, shorts, shoes], lookup, {
      occasion: 'Date Night',
      additionalContext: 'It will be cold tonight outdoors',
    });
    expect(critique.assessment).not.toBe('Appropriate for this occasion');
    expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/cold|thermal|weather|chill|short/);
  });

  // 6. Missing base top under jacket
  test('6. Missing base top under leather jacket is structurally incomplete', () => {
    const jacket = mockWardrobeItem('j6', { category: 'Outerwear', sub_category: 'Leather Jacket', garment_type: 'Outerwear' });
    const jeans = mockWardrobeItem('jn6', { category: 'Bottom', sub_category: 'Straight Jeans', garment_type: 'Bottom' });
    const shoes = mockWardrobeItem('sh6', { category: 'Shoes', sub_category: 'Sneakers', garment_type: 'Shoes' });
    const lookup = { [jacket.id]: jacket, [jeans.id]: jeans, [shoes.id]: shoes };

    const critique = evaluateWardrobeOutfit([jacket, jeans, shoes], lookup, { occasion: 'Casual' });
    expect(critique.assessment).toBe('Incomplete outfit');
  });

  // 7. Dress as one-piece foundation
  test('7. Dress + shoes is evaluated as structurally complete without claiming missing top or bottom', () => {
    const dress = mockWardrobeItem('d7', { category: 'Dress', sub_category: 'Cocktail Dress', garment_type: 'Dress' });
    const shoes = mockWardrobeItem('sh7', { category: 'Shoes', sub_category: 'Heeled Sandals', garment_type: 'Shoes' });
    const lookup = { [dress.id]: dress, [shoes.id]: shoes };

    const critique = evaluateWardrobeOutfit([dress, shoes], lookup, { occasion: 'Dinner' });
    expect(critique.assessment).toBe('Appropriate for this occasion');
    expect(critique.whyJezsySaysThis.toLowerCase()).not.toMatch(/missing/);
  });

  // 8. Jumpsuit as one-piece foundation
  test('8. Jumpsuit + shoes is treated as a complete one-piece foundation', () => {
    const jumpsuit = mockWardrobeItem('j8', { category: 'Dress', sub_category: 'Tailored Jumpsuit', garment_type: 'Dress' });
    const shoes = mockWardrobeItem('sh8', { category: 'Shoes', sub_category: 'Pumps', garment_type: 'Shoes' });
    const lookup = { [jumpsuit.id]: jumpsuit, [shoes.id]: shoes };

    const critique = evaluateWardrobeOutfit([jumpsuit, shoes], lookup, { occasion: 'Party' });
    expect(critique.assessment).toBe('Appropriate for this occasion');
  });

  // 9. Valid formal outfit
  test('9. Valid formal outfit (Evening Gown + Heels) is evaluated as Appropriate for this occasion', () => {
    const gown = mockWardrobeItem('g9', { category: 'Dress', sub_category: 'Evening Gown', description: 'Floor length silk gown', garment_type: 'Dress' });
    const heels = mockWardrobeItem('h9', { category: 'Shoes', sub_category: 'Stiletto Pumps', garment_type: 'Shoes' });
    const lookup = { [gown.id]: gown, [heels.id]: heels };

    const critique = evaluateWardrobeOutfit([gown, heels], lookup, { occasion: 'Formal' });
    expect(critique.assessment).toBe('Appropriate for this occasion');
  });

  // 10. Valid casual outfit
  test('10. Valid casual outfit (T-Shirt + Jeans + Sneakers) is evaluated as Appropriate for this occasion', () => {
    const tee = mockWardrobeItem('t10', { category: 'Top', sub_category: 'Crewneck T-Shirt', garment_type: 'Top' });
    const jeans = mockWardrobeItem('j10', { category: 'Bottom', sub_category: 'Blue Jeans', garment_type: 'Bottom' });
    const sneakers = mockWardrobeItem('s10', { category: 'Shoes', sub_category: 'White Sneakers', garment_type: 'Shoes' });
    const lookup = { [tee.id]: tee, [jeans.id]: jeans, [sneakers.id]: sneakers };

    const critique = evaluateWardrobeOutfit([tee, jeans, sneakers], lookup, { occasion: 'Casual' });
    expect(critique.assessment).toBe('Appropriate for this occasion');
  });

  // 11. User context changes the analysis
  test('11. Same outfit evaluated for Casual vs Swimming produces completely different verdicts and reasons', () => {
    const tee = mockWardrobeItem('t11', { category: 'Top', sub_category: 'T-Shirt', garment_type: 'Top' });
    const shorts = mockWardrobeItem('s11', { category: 'Bottom', sub_category: 'Denim Shorts', garment_type: 'Bottom' });
    const slides = mockWardrobeItem('sl11', { category: 'Shoes', sub_category: 'Slides', garment_type: 'Shoes' });
    const lookup = { [tee.id]: tee, [shorts.id]: shorts, [slides.id]: slides };

    const casualCritique = evaluateWardrobeOutfit([tee, shorts, slides], lookup, { occasion: 'Casual day out' });
    const swimCritique = evaluateWardrobeOutfit([tee, shorts, slides], lookup, { occasion: 'Active Swimming' });

    expect(casualCritique.assessment).toBe('Appropriate for this occasion');
    expect(swimCritique.assessment).toBe('Not appropriate for this occasion');
    expect(casualCritique.whyJezsySaysThis).not.toEqual(swimCritique.whyJezsySaysThis);
  });

  // 12. Real wardrobe item ID enforcement
  test('12. Real wardrobe item IDs are preserved and returned in all critique results', () => {
    const tee = mockWardrobeItem('real_item_123', { category: 'Top', sub_category: 'Tee', garment_type: 'Top' });
    const pants = mockWardrobeItem('real_item_456', { category: 'Bottom', sub_category: 'Pants', garment_type: 'Bottom' });
    const lookup = { [tee.id]: tee, [pants.id]: pants };

    const critique = evaluateWardrobeOutfit([tee, pants], lookup, { occasion: 'Casual' });
    expect(critique.wardrobeItemIds).toContain('real_item_123');
    expect(critique.wardrobeItemIds).toContain('real_item_456');
  });

  // 13. No hallucinated wardrobe items
  test('13. Stylist alternatives only contain items that exist in the user lookup; never invents IDs', () => {
    const blazer = mockWardrobeItem('b13', { category: 'Outerwear', sub_category: 'Blazer', garment_type: 'Outerwear' });
    const shorts = mockWardrobeItem('s13', { category: 'Bottom', sub_category: 'Gym Shorts', garment_type: 'Bottom' });
    const lookup: Record<string, any> = { [blazer.id]: blazer, [shorts.id]: shorts };

    const critique = evaluateWardrobeOutfit([blazer, shorts], lookup, { occasion: 'Wedding' });
    if (critique.wardrobeAlternatives && critique.wardrobeAlternatives.length > 0) {
      for (const alt of critique.wardrobeAlternatives) {
        if (alt.found && alt.item) {
          expect(lookup[alt.item.id]).toBeDefined();
        }
      }
    }
  });

  // 14. Stale cache / context invalidation
  test('14. Modifying item updated_at or context produces a distinct hash to invalidate stale caches', () => {
    const itemA = mockWardrobeItem('item_14', { updated_at: '2026-09-01T00:00:00Z', description: 'Initial' });
    const canvasA = mockCanvasItem(itemA);
    const hash1 = computeOutfitHash([canvasA], { [itemA.id]: itemA });

    const itemB = mockWardrobeItem('item_14', { updated_at: '2026-09-20T00:00:00Z', description: 'Updated notes' });
    const canvasB = mockCanvasItem(itemB);
    const hash2 = computeOutfitHash([canvasB], { [itemB.id]: itemB });

    expect(hash1).not.toBe(hash2);

    const ctxHash1 = computeContextHash({ occasion: 'Work' });
    const ctxHash2 = computeContextHash({ occasion: 'Wedding' });
    expect(ctxHash1).not.toBe(ctxHash2);
  });

  // 15. LLM unavailable fallback
  test('15. When LLM provider fails, gradeOutfitWithAI cleanly falls back to ruleBasedFallback', async () => {
    const tee = mockWardrobeItem('t15', { category: 'Top', sub_category: 'T-Shirt', garment_type: 'Top' });
    const canvasTee = mockCanvasItem(tee);
    const lookup = { [tee.id]: tee };

    const failingProvider = {
      analyze: async () => ({
        success: false as const,
        analysisMode: 'ruleBasedFallback' as const,
        fallbackReason: 'Network error simulated',
      }),
    };

    const critique = await gradeOutfitWithAI([canvasTee], lookup, { occasion: 'Casual' }, null, failingProvider);
    expect(critique.analysisMode).toBe('ruleBasedFallback');
    expect(critique.assessment).toBeDefined();
    expect(critique.whyJezsySaysThis).toBeDefined();
  });

  // 16. Unknown material remains unknown
  test('16. Semantic classifier preserves unknown material as empty/unknown rather than inventing one', () => {
    const normalized = normalizeGarment('Top', 'T-Shirt', 'black', '', 'A simple top', '');
    expect(normalized.evidence.material.length).toBe(0);
  });

  // 17. Unknown pattern remains unknown
  test('17. Semantic classifier does not invent pattern when none is stated', () => {
    const normalized = normalizeGarment('Bottom', 'Pants', 'navy', '', 'Straight pants', '');
    expect(normalized.evidence.style.includes('patterned')).toBe(false);
  });

  // 18. Explicit Category/Sub Category overrides stale legacy garment_type
  test('18. Explicit Category=Bottom, SubCategory=Shorts overrides stale legacy garment_type=Top', () => {
    const item = mockWardrobeItem('item_18', {
      category: 'Bottom',
      sub_category: 'Bermuda Shorts',
      garment_type: 'Top', // Stale legacy value
    });

    const bucket = resolveEffectiveGarmentBucket(item);
    expect(bucket).toBe('Bottom');
  });

  // 19. Mannequin and Style Advisor use the same reasoning foundation
  test('19. Mannequin and Style Advisor generate consistent assessments for the same combination and context', () => {
    const blazer = mockWardrobeItem('b19', { category: 'Outerwear', sub_category: 'Blazer', garment_type: 'Outerwear' });
    const shorts = mockWardrobeItem('s19', { category: 'Bottom', sub_category: 'Running Shorts', garment_type: 'Bottom' });
    const sneakers = mockWardrobeItem('sn19', { category: 'Shoes', sub_category: 'Running Shoes', garment_type: 'Shoes' });
    const items = [blazer, shorts, sneakers];
    const lookup = Object.fromEntries(items.map((i) => [i.id, i]));

    // Mannequin evaluation
    const mannequinCritique = evaluateWardrobeOutfit(items, lookup, { occasion: 'Wedding' });

    // Style Advisor outfit generation evaluation
    const generated = generateOutfits(items, { occasion: 'Wedding', limit: 1 });

    expect(mannequinCritique.assessment).not.toBe('Appropriate for this occasion');
    if (generated.length > 0) {
      expect(generated[0].assessment).toEqual(mannequinCritique.assessment);
    }
  });

  // 20. Generated outfit contains only existing wardrobe item IDs
  test('20. Generated outfits only contain IDs from the provided wardrobe pool', () => {
    const pool = [
      mockWardrobeItem('p1', { category: 'Top', sub_category: 'Blouse', garment_type: 'Top' }),
      mockWardrobeItem('p2', { category: 'Bottom', sub_category: 'Trousers', garment_type: 'Bottom' }),
      mockWardrobeItem('p3', { category: 'Shoes', sub_category: 'Loafers', garment_type: 'Shoes' }),
    ];
    const poolIds = new Set(pool.map((i) => i.id));

    const outfits = generateOutfits(pool, { occasion: 'Work', limit: 5 });
    expect(outfits.length).toBeGreaterThan(0);
    for (const outfit of outfits) {
      for (const item of outfit.items) {
        expect(poolIds.has(item.id)).toBe(true);
      }
    }
  });
});
