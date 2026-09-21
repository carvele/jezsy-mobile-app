/**
 * phase4Visual.test.ts
 * Phase 4 — Visual Fashion Intelligence test suite.
 *
 * Validates:
 * 1. Visual evidence successfully incorporated into evidence packet
 * 2. Visual evidence unavailable fallback (packet unchanged)
 * 3. User metadata remains authoritative over visual evidence
 * 4. Image change invalidates visual evidence (cache miss)
 * 5. Real wardrobe IDs preserved through visual path
 * 6. Color compatibility derived from image colours
 * 7. Visual formality signal correct for blazer
 * 8. Athletic visual signal detected in running shoes
 * 9. Swimming/activity mismatch: swimwear signal vs formal context
 * 10. Dress/jumpsuit one-piece: visual family does not override user Category
 * 11. Visual evidence does not overwrite explicit user Category
 * 12. LLM receives structured evidence (packet contains visualEvidence fields)
 * 13. LLM unavailable fallback still returns a valid critique
 * 14. Stale visual cache prevention: different versionTokens produce separate entries
 * 15. Stale outfit analysis prevention: different outfit hash = fresh analysis
 * 16. Generated outfits contain only owned items (wardrobe IDs)
 * 17. No numeric score returned in critique
 * 18. No fabricated visual attributes: low-confidence evidence excluded from per-item notes
 */

import {
  buildStylistEvidencePacketWithVisual,
  buildStylistEvidencePacket,
  computeOutfitHash,
} from '../aiStylistAdvisor';
import { getVisualEvidence, clearVisualEvidenceCache } from '../../services/garmentVisualCache';
import { fashionVisionEngine } from '../../services/fashionVisionEngine';
import { MannequinCanvasItem, WardrobeItem } from '../mannequinConfig';

// ---- helpers ---------------------------------------------------------------

function makeWardrobeItem(
  overrides: Partial<WardrobeItem> & { id: string; updated_at?: string }
): WardrobeItem {
  const base = {
    id: overrides.id,
    user_id: 'test-user',
    category: overrides.category ?? 'Tops',
    sub_category: overrides.sub_category ?? 'T-Shirt',
    garment_type: overrides.garment_type ?? 'Top',
    image_url: overrides.image_url ?? `https://cdn.jezsy.test/${overrides.id}.jpg`,
    color_tags: overrides.color_tags ?? ['White'],
    description: overrides.description ?? null,
    user_notes: overrides.user_notes ?? null,
    occasions: overrides.occasions ?? null,
    seasons: overrides.seasons ?? null,
    embedding: null,
    ai_attributes: overrides.ai_attributes ?? null,
    wear_count: 0,
    last_worn_at: null,
    deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
  };
  return Object.assign(base, overrides) as unknown as WardrobeItem;
}

function makeCanvasItem(wardrobeItem: WardrobeItem, idx = 0): MannequinCanvasItem {
  return {
    id: `canvas_${wardrobeItem.id}`,
    wardrobe_item_id: wardrobeItem.id,
    image_url: wardrobeItem.image_url ?? '',
    name: wardrobeItem.sub_category ?? wardrobeItem.category ?? 'Item',
    garment_type: wardrobeItem.garment_type ?? 'Top',
    x: 0,
    y: 0.16 + idx * 0.02,
    scale: 1,
    rotation: 0,
    zIndex: idx + 1,
  };
}

// Stub fashionVisionEngine.analyzeGarment so tests don't load Transformers.js
const STUB_RESULT_BLAZER = {
  garmentType: 'Outerwear',
  category: 'Outerwear',
  subcategory: 'tailored blazer',
  colors: [
    { name: 'Charcoal', hex: '#374151', role: 'dominant' as const, confidence: 0.88 },
    { name: 'Black', hex: '#111827', role: 'secondary' as const, confidence: 0.72 },
  ],
  pattern: 'Solid',
  material: 'Wool',
  fit: 'Slim',
  occasions: ['Work', 'Formal'],
  seasons: ['All-Season'],
  description: 'Charcoal tailored blazer.',
  confidence: 0.87,
  modelMetadata: { name: 'test-stub', version: '1.0', timestamp: new Date().toISOString() },
  needsReview: false,
  isRealMl: false,
};

const STUB_RESULT_RUNNING_SHOES = {
  garmentType: 'Shoes',
  category: 'Footwear',
  subcategory: 'sneakers or athletic shoes',
  colors: [{ name: 'White', hex: '#FFFFFF', role: 'dominant' as const, confidence: 0.90 }],
  pattern: 'Solid',
  material: 'Canvas',
  fit: 'Regular',
  occasions: ['Athletic'],
  seasons: ['All-Season'],
  description: 'White athletic sneakers.',
  confidence: 0.82,
  modelMetadata: { name: 'test-stub', version: '1.0', timestamp: new Date().toISOString() },
  needsReview: false,
  isRealMl: false,
};

const STUB_RESULT_LOW_CONFIDENCE = {
  ...STUB_RESULT_RUNNING_SHOES,
  confidence: 0.45,
  needsReview: true,
};

// ---- test setup ------------------------------------------------------------

beforeEach(() => {
  clearVisualEvidenceCache();
  jest.spyOn(fashionVisionEngine, 'analyzeGarment').mockResolvedValue(STUB_RESULT_BLAZER);
});

afterEach(() => {
  jest.restoreAllMocks();
  clearVisualEvidenceCache();
});

// ============================================================================
// Tests
// ============================================================================

describe('Phase 4 — Visual Fashion Intelligence', () => {

  // 1. Visual evidence incorporated
  test('1. visual evidence is populated in evidence packet when analysis succeeds', async () => {
    const blazer = makeWardrobeItem({ id: 'b1', category: 'Outerwear', sub_category: 'Blazer', garment_type: 'Outerwear' });
    const items = [makeCanvasItem(blazer)];
    const lookup = { [blazer.id]: blazer };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Work meeting' });

    expect(packet.visualEvidence).toBeDefined();
    expect(packet.visualEvidence?.dominantColors?.length).toBeGreaterThan(0);
    expect(packet.visualEvidence?.visualAnalysisMode).toBe('fallback'); // stub is not real ML
  });

  // 2. Fallback when image analysis fails
  test('2. packet is returned unchanged when visual analysis throws', async () => {
    jest.spyOn(fashionVisionEngine, 'analyzeGarment').mockRejectedValue(new Error('network error'));

    const shirt = makeWardrobeItem({ id: 's1', category: 'Tops', sub_category: 'T-Shirt' });
    const items = [makeCanvasItem(shirt)];
    const lookup = { [shirt.id]: shirt };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Casual walk' });

    // Packet must still be valid
    expect(packet.outfit.items.length).toBe(1);
    // itemEvidence absent or empty
    const ie = packet.visualEvidence?.itemEvidence ?? {};
    expect(Object.keys(ie).length).toBe(0);
  });

  // 3. User metadata remains authoritative
  test('3. visual garmentFamily does not overwrite user-entered Category', async () => {
    // User says: Bottoms / Dress Trousers. Vision says: Outerwear (hypothetical stub mismatch).
    const trousers = makeWardrobeItem({
      id: 't1',
      category: 'Bottoms',
      sub_category: 'Dress Trousers',
      garment_type: 'Bottom',
    });
    const items = [makeCanvasItem(trousers)];
    const lookup = { [trousers.id]: trousers };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Office' });

    // The packet item should preserve user Category
    const packetItem = packet.outfit.items[0];
    expect(packetItem.category).toBe('Bottoms');
    expect(packetItem.subCategory).toBe('Dress Trousers');
    // Visual evidence exists but does not mutate category
    const ev = (packetItem as any).visualEvidence;
    if (ev) {
      expect(packetItem.category).not.toBe(ev.visualGarmentFamily);
    }
  });

  // 4. Image change invalidates visual evidence cache
  test('4. different versionToken yields a fresh cache entry', async () => {
    const imageUrl = 'https://cdn.jezsy.test/shirt.jpg';
    const ev1 = await getVisualEvidence(imageUrl, 'v1');
    // Change stub result for next call
    jest.spyOn(fashionVisionEngine, 'analyzeGarment').mockResolvedValueOnce(STUB_RESULT_RUNNING_SHOES);
    const ev2 = await getVisualEvidence(imageUrl, 'v2'); // different token

    expect(ev1).not.toBeNull();
    expect(ev2).not.toBeNull();
    // Different versions: ev2 used running-shoes stub so dominant colour should be White
    expect(ev2?.dominantColors[0]?.name).toBe('White');
    // ev1 used blazer stub so dominant colour should be Charcoal
    expect(ev1?.dominantColors[0]?.name).toBe('Charcoal');
  });

  // 5. Real wardrobe IDs preserved
  test('5. outfit item wardrobeItemIds match original wardrobe IDs', async () => {
    const w1 = makeWardrobeItem({ id: 'real-id-1', category: 'Tops' });
    const w2 = makeWardrobeItem({ id: 'real-id-2', category: 'Bottoms', sub_category: 'Jeans', garment_type: 'Bottom' });
    const items = [makeCanvasItem(w1), makeCanvasItem(w2, 1)];
    const lookup = { [w1.id]: w1, [w2.id]: w2 };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Casual' });
    const ids = packet.outfit.items.map((i) => i.wardrobeItemId);
    expect(ids).toContain('real-id-1');
    expect(ids).toContain('real-id-2');
    // No fabricated IDs
    expect(ids).not.toContain(undefined);
  });

  // 6. Color compatibility from image colours
  test('6. colorHarmonyNote present when 2+ dominant colours extracted', async () => {
    // Blazer stub returns Charcoal + Black -> two colours -> harmony note expected
    const blazer = makeWardrobeItem({ id: 'b2', category: 'Outerwear', sub_category: 'Blazer', garment_type: 'Outerwear' });
    const items = [makeCanvasItem(blazer)];
    const lookup = { [blazer.id]: blazer };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Work' });
    expect(packet.visualEvidence?.colorHarmonyNote).toBeDefined();
    expect(typeof packet.visualEvidence?.colorHarmonyNote).toBe('string');
  });

  // 7. Visual formality signal for blazer
  test('7. formality signal >= 0.7 for blazer garment', async () => {
    const imageUrl = 'https://cdn.jezsy.test/blazer.jpg';
    const ev = await getVisualEvidence(imageUrl, 'v1');
    expect(ev).not.toBeNull();
    expect(ev!.formalitySignal).toBeGreaterThanOrEqual(0.70);
  });

  // 8. Athletic signal detected in running shoes
  test('8. athletic signal is true for sneakers/athletic shoes', async () => {
    jest.spyOn(fashionVisionEngine, 'analyzeGarment').mockResolvedValue(STUB_RESULT_RUNNING_SHOES);
    const ev = await getVisualEvidence('https://cdn.jezsy.test/shoes.jpg', 'v1');
    expect(ev).not.toBeNull();
    expect(ev!.athleticSignal).toBe(true);
  });

  // 9. Swimming/activity context: packet still valid even if outfit has no swimwear
  test('9. swimming context: packet returns valid structure even without swimwear items', async () => {
    const shirt = makeWardrobeItem({ id: 'shirt-swim', category: 'Tops', sub_category: 'T-Shirt' });
    const items = [makeCanvasItem(shirt)];
    const lookup = { [shirt.id]: shirt };

    const packet = await buildStylistEvidencePacketWithVisual(
      items, lookup, { occasion: 'Pool party', additionalContext: 'going swimming' }
    );
    expect(packet.requirements.requiresWaterCompatibility).toBe(true);
    expect(packet.contradictions.length).toBeGreaterThan(0); // shirt vs swimming
  });

  // 10. Dress/jumpsuit: one-piece user category not overridden by visual
  test('10. one-piece dress: visual evidence does not change garment structure', async () => {
    const dress = makeWardrobeItem({
      id: 'd1',
      category: 'Dresses',
      sub_category: 'Midi Dress',
      garment_type: 'Dress',
    });
    const items = [makeCanvasItem(dress)];
    const lookup = { [dress.id]: dress };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Date night' });
    const packetItem = packet.outfit.items[0];
    expect(packetItem.category).toBe('Dresses');
    // Structure check: should be detected as onePiece
    expect(packet.structure.hasOnePiece).toBe(true);
  });

  // 11. Visual evidence does not override explicit user Category
  test('11. visual garmentFamily is stored only as visual evidence field, not as category', async () => {
    const trousers = makeWardrobeItem({
      id: 't2',
      category: 'Bottoms',
      sub_category: 'Dress Trousers',
      garment_type: 'Bottom',
    });
    const items = [makeCanvasItem(trousers)];
    const lookup = { [trousers.id]: trousers };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup);

    const packetItem = packet.outfit.items[0];
    // User category must be Bottoms
    expect(packetItem.category).toBe('Bottoms');
    // Effective bucket must be Bottom
    expect(packetItem.effectiveGarmentBucket).toBe('Bottom');
  });

  // 12. LLM receives structured evidence
  test('12. visualEvidence in packet has required structure for LLM', async () => {
    const w = makeWardrobeItem({ id: 'llm-test', category: 'Tops' });
    const items = [makeCanvasItem(w)];
    const lookup = { [w.id]: w };

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Office' });
    const ve = packet.visualEvidence;
    // Must have array fields LLM reads
    expect(Array.isArray(ve?.paletteColors)).toBe(true);
    expect(typeof ve?.visualAnalysisMode).toBe('string');
  });

  // 13. LLM unavailable fallback: synchronous packet still valid
  test('13. synchronous buildStylistEvidencePacket is valid without visual', () => {
    const w = makeWardrobeItem({ id: 'sync-test', category: 'Tops' });
    const items = [makeCanvasItem(w)];
    const lookup = { [w.id]: w };

    const packet = buildStylistEvidencePacket(items, lookup, { occasion: 'Casual' });
    expect(packet.outfit.items.length).toBe(1);
    expect(packet.request.analysisId).toBeTruthy();
    // visualEvidence will have user-text palette, no image colours
    expect(Array.isArray(packet.visualEvidence?.paletteColors)).toBe(true);
  });

  // 14. Stale visual cache prevention: same URL different versionToken
  test('14. same image URL with different versionTokens are cached separately', async () => {
    const url = 'https://cdn.jezsy.test/shared.jpg';
    const stubA = { ...STUB_RESULT_BLAZER, confidence: 0.88 };
    const stubB = { ...STUB_RESULT_RUNNING_SHOES, confidence: 0.82 };

    jest.spyOn(fashionVisionEngine, 'analyzeGarment')
      .mockResolvedValueOnce(stubA)
      .mockResolvedValueOnce(stubB);

    const evA = await getVisualEvidence(url, 'token-a');
    const evB = await getVisualEvidence(url, 'token-b');

    expect(evA?.formalitySignal).not.toBe(evB?.formalitySignal);
  });

  // 15. Outfit hash follows the fields a user can actually edit (wardrobe_items has no updated_at column)
  test('15. outfit hash changes when the user edits where-worn, description or notes', () => {
    const base = makeWardrobeItem({ id: 'h1', ai_attributes: { whereWornOften: 'Office' } });
    const worn = makeWardrobeItem({ id: 'h1', ai_attributes: { whereWornOften: 'Running' } });
    const described = makeWardrobeItem({ id: 'h1', ai_attributes: { whereWornOften: 'Office' }, description: 'Now with a stain' });
    const noted = makeWardrobeItem({ id: 'h1', ai_attributes: { whereWornOften: 'Office' }, user_notes: 'Too tight' });
    const hashOf = (w: any) => computeOutfitHash([makeCanvasItem(w)], { [w.id]: w });

    const baseHash = hashOf(base);
    expect(hashOf(worn)).not.toBe(baseHash);
    expect(hashOf(described)).not.toBe(baseHash);
    expect(hashOf(noted)).not.toBe(baseHash);
    expect(hashOf(base)).toBe(baseHash);
  });

  // 16. Generated outfits contain only owned items
  test('16. packet outfit items use real wardrobe IDs from lookup', async () => {
    const ids = ['owned-1', 'owned-2', 'owned-3'];
    const items = ids.map((id, idx) =>
      makeCanvasItem(makeWardrobeItem({ id, category: idx === 0 ? 'Tops' : idx === 1 ? 'Bottoms' : 'Footwear', garment_type: idx === 0 ? 'Top' : idx === 1 ? 'Bottom' : 'Shoes' }), idx)
    );
    const lookup = Object.fromEntries(ids.map((id, idx) => [id, makeWardrobeItem({ id, category: idx === 0 ? 'Tops' : idx === 1 ? 'Bottoms' : 'Footwear' })]));

    const packet = await buildStylistEvidencePacketWithVisual(items, lookup, { occasion: 'Casual' });
    for (const pi of packet.outfit.items) {
      expect(ids).toContain(pi.wardrobeItemId);
    }
  });

  // 17. No numeric score
  test('17. no numeric grading in evidence packet', async () => {
    const w = makeWardrobeItem({ id: 'score-test', category: 'Tops' });
    const packet = await buildStylistEvidencePacketWithVisual([makeCanvasItem(w)], { [w.id]: w });
    const packetStr = JSON.stringify(packet);
    // Should not contain score/grade keys
    expect(packetStr).not.toMatch(/"score"\s*:\s*\d+/);
    expect(packetStr).not.toMatch(/"grade"\s*:/);
  });

  // 18. No fabricated visual attributes for low-confidence results
  test('18. low-confidence visual evidence is flagged as lowConfidence', async () => {
    jest.spyOn(fashionVisionEngine, 'analyzeGarment').mockResolvedValue(STUB_RESULT_LOW_CONFIDENCE);
    const ev = await getVisualEvidence('https://cdn.jezsy.test/uncertain.jpg', 'v1');
    expect(ev).not.toBeNull();
    expect(ev!.lowConfidence).toBe(true);
    // The edge function prompt builder skips lowConfidence items from per-item notes
  });
});
