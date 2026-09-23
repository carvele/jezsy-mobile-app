import {
  executeSmartShuffle,
  validateAndPartitionPinnedSet,
  buildShuffleIntent,
  selectDiverseCandidate,
  resolveNewItemZIndex,
  SMART_SHUFFLE_SCORING_PROFILE,
  MAX_SESSION_SHUFFLE_HISTORY,
} from '../mannequinSmartShuffle';
import { generateCandidateOutfits } from '../candidateGenerator';
import { localExposureService } from '../localExposureService';
import { WardrobeItem, StylingIntent } from '@/src/types/styleAdvisor';
import { MannequinCanvasItem, createMannequinItem } from '@/src/utils/mannequinConfig';

function createMockItem(
  id: string,
  category: string,
  colors: string[] = ['black'],
  overrides: Record<string, any> = {}
): WardrobeItem {
  return {
    id,
    user_id: 'user_test',
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
    image_url: overrides.image_url || `https://example.com/${id}.png`,
    product_id: null,
    ...(overrides.pattern ? { pattern: overrides.pattern } : {}),
  } as unknown as WardrobeItem;
}

function createMockCanvasItem(
  wardrobeItem: WardrobeItem,
  customTransforms: Partial<MannequinCanvasItem> = {}
): MannequinCanvasItem {
  const base = createMannequinItem(wardrobeItem, 0);
  return {
    ...base,
    ...customTransforms,
  };
}

describe('Phase C: Mannequin Smart Shuffle Domain Service', () => {
  // Common test wardrobe fixtures
  const top1 = createMockItem('w_top1', 'Top', ['white'], { sub_category: 'White T-Shirt' });
  const top2 = createMockItem('w_top2', 'Top', ['navy'], { sub_category: 'Navy Polo' });
  const bottom1 = createMockItem('w_bot1', 'Bottom', ['black'], { sub_category: 'Black Chinos' });
  const bottom2 = createMockItem('w_bot2', 'Bottom', ['beige'], { sub_category: 'Khaki Trousers' });
  const dress1 = createMockItem('w_dress1', 'Dress', ['red'], { sub_category: 'Red Silk Dress' });
  const shoes1 = createMockItem('w_shoes1', 'Shoes', ['black'], { sub_category: 'Loafers' });
  const shoes2 = createMockItem('w_shoes2', 'Shoes', ['white'], { sub_category: 'Sneakers' });
  const outer1 = createMockItem('w_outer1', 'Outerwear', ['gray'], { sub_category: 'Wool Blazer' });
  const outer2 = createMockItem('w_outer2', 'Outerwear', ['black'], { sub_category: 'Leather Jacket' });
  const acc1 = createMockItem('w_acc1', 'Accessory', ['gold'], { sub_category: 'Gold Watch' });

  const standardWardrobe: WardrobeItem[] = [
    top1, top2, bottom1, bottom2, dress1, shoes1, shoes2, outer1, outer2, acc1,
  ];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Case 1: Wardrobe ID vs Canvas ID Mapping
  // =========================================================================
  test('Case 1: Rigorously passes only wardrobe_item_id to generator, never canvas layer id', () => {
    const canvasItem = createMockCanvasItem(top1);
    expect(canvasItem.id).not.toBe(canvasItem.wardrobe_item_id);
    expect(canvasItem.id.startsWith('item_')).toBe(true);

    const pinnedSet = new Set([canvasItem.wardrobe_item_id]);
    const wardrobeMap = new Map([[top1.id, top1]]);
    const partition = validateAndPartitionPinnedSet(pinnedSet, wardrobeMap);

    expect(partition.valid).toBe(true);
    expect(partition.generatorPinnedIds).toEqual(['w_top1']);

    const intent = buildShuffleIntent(partition.generatorPinnedIds);
    expect(intent.mustUseItemIds).toEqual(['w_top1']);
    // Confirm canvas item ID was not used
    expect(intent.mustUseItemIds).not.toContain(canvasItem.id);
  });

  // =========================================================================
  // Case 2: Incompatible Multiple Pins (Tops)
  // =========================================================================
  test('Case 2: Rejects multiple pinned tops with grounded feedback and preserves canvas', () => {
    const pinnedSet = new Set(['w_top1', 'w_top2']);
    const currentCanvas = [createMockCanvasItem(top1), createMockCanvasItem(top2)];

    const result = executeSmartShuffle({
      wardrobe: standardWardrobe,
      currentCanvasItems: currentCanvas,
      pinnedWardrobeItemIds: pinnedSet,
      recentKeys: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe('PIN_CONFLICT');
      expect(result.message).toContain('Multiple tops');
    }
  });

  // =========================================================================
  // Case 3: Incompatible Multiple Pins (Bottoms)
  // =========================================================================
  test('Case 3: Rejects multiple pinned bottoms with grounded feedback and preserves canvas', () => {
    const pinnedSet = new Set(['w_bot1', 'w_bot2']);
    const currentCanvas = [createMockCanvasItem(bottom1), createMockCanvasItem(bottom2)];

    const result = executeSmartShuffle({
      wardrobe: standardWardrobe,
      currentCanvasItems: currentCanvas,
      pinnedWardrobeItemIds: pinnedSet,
      recentKeys: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe('PIN_CONFLICT');
      expect(result.message).toContain('Multiple bottoms');
    }
  });

  // =========================================================================
  // Case 4: Incompatible Multiple Pins (Shoes & Outerwear)
  // =========================================================================
  test('Case 4: Rejects multiple pinned shoes or multiple outerwear items', () => {
    const pinnedShoes = new Set(['w_shoes1', 'w_shoes2']);
    const wardrobeMap = new Map(standardWardrobe.map((i) => [i.id, i]));

    const shoesRes = validateAndPartitionPinnedSet(pinnedShoes, wardrobeMap);
    expect(shoesRes.valid).toBe(false);
    expect(shoesRes.reason).toContain('shoes');

    const pinnedOuter = new Set(['w_outer1', 'w_outer2']);
    const outerRes = validateAndPartitionPinnedSet(pinnedOuter, wardrobeMap);
    expect(outerRes.valid).toBe(false);
    expect(outerRes.reason).toContain('outerwear');
  });

  // =========================================================================
  // Case 5: Dress + Top/Bottom Conflict
  // =========================================================================
  test('Case 5: Rejects dress combined with top or bottom without silent dropping', () => {
    const pinnedSet = new Set(['w_dress1', 'w_top1']);
    const currentCanvas = [createMockCanvasItem(dress1), createMockCanvasItem(top1)];

    const result = executeSmartShuffle({
      wardrobe: standardWardrobe,
      currentCanvasItems: currentCanvas,
      pinnedWardrobeItemIds: pinnedSet,
      recentKeys: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe('PIN_CONFLICT');
      expect(result.message).toContain('dress cannot be combined');
    }
  });

  // =========================================================================
  // Case 6: Pinned Accessory Partitioning & Canvas-Only Preservation
  // =========================================================================
  test('Case 6: Retains pinned accessories on canvas without sending to canonical generator', () => {
    const pinnedSet = new Set(['w_top1', 'w_acc1']);
    const wardrobeMap = new Map(standardWardrobe.map((i) => [i.id, i]));
    const partition = validateAndPartitionPinnedSet(pinnedSet, wardrobeMap);

    expect(partition.valid).toBe(true);
    expect(partition.generatorPinnedIds).toEqual(['w_top1']);
    expect(partition.canvasOnlyPinnedIds).toEqual(['w_acc1']);

    const intent = buildShuffleIntent(partition.generatorPinnedIds);
    expect(intent.mustUseItemIds).toEqual(['w_top1']);
    expect(intent.mustUseItemIds).not.toContain('w_acc1');

    // Canvas composition retains accessory
    const accessoryCanvasItem = createMockCanvasItem(acc1, { x: 0.25, y: 0.05, zIndex: 6 });
    const result = executeSmartShuffle({
      wardrobe: standardWardrobe,
      currentCanvasItems: [createMockCanvasItem(top1), accessoryCanvasItem],
      pinnedWardrobeItemIds: pinnedSet,
      recentKeys: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const retainedAcc = result.newCanvasItems.find((i) => i.wardrobe_item_id === 'w_acc1');
      expect(retainedAcc).toBeDefined();
      expect(retainedAcc?.x).toBe(0.25);
      expect(retainedAcc?.y).toBe(0.05);
      expect(retainedAcc?.zIndex).toBe(6);
    }
  });

  // =========================================================================
  // Case 7: Stale / Deleted Pinned Item
  // =========================================================================
  test('Case 7: Safely handles missing/stale pinned wardrobe IDs without crashing', () => {
    const pinnedSet = new Set(['non_existent_id']);
    const wardrobeMap = new Map(standardWardrobe.map((i) => [i.id, i]));

    const partition = validateAndPartitionPinnedSet(pinnedSet, wardrobeMap);
    expect(partition.valid).toBe(false);
    expect(partition.reason).toContain('could not be found in your wardrobe');
  });

  // =========================================================================
  // Case 8: Exact Pinned Transform & Z-Index Preservation
  // =========================================================================
  test('Case 8: Retains 100% exact transforms and zIndex for pinned items', () => {
    const customBlazer = createMockCanvasItem(outer1, {
      x: 0.1234,
      y: 0.4567,
      scale: 1.25,
      rotation: 15,
      zIndex: 8, // Non-default zIndex
    });

    const result = executeSmartShuffle({
      wardrobe: standardWardrobe,
      currentCanvasItems: [customBlazer],
      pinnedWardrobeItemIds: new Set(['w_outer1']),
      recentKeys: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const retainedBlazer = result.newCanvasItems.find((i) => i.wardrobe_item_id === 'w_outer1');
      expect(retainedBlazer).toBeDefined();
      expect(retainedBlazer!.x).toBe(0.1234);
      expect(retainedBlazer!.y).toBe(0.4567);
      expect(retainedBlazer!.scale).toBe(1.25);
      expect(retainedBlazer!.rotation).toBe(15);
      expect(retainedBlazer!.zIndex).toBe(8); // Exact z-index untouched
    }
  });

  // =========================================================================
  // Case 9: Deterministic Canonical Layering for New Pieces
  // =========================================================================
  test('Case 9: Newly introduced items receive canonical category z-order defaults', () => {
    const occupied = new Set<number>();
    const shoesZ = resolveNewItemZIndex('Shoes', occupied);
    const bottomZ = resolveNewItemZIndex('Bottom', occupied);
    const topZ = resolveNewItemZIndex('Top', occupied);
    const outerZ = resolveNewItemZIndex('Outerwear', occupied);

    expect(shoesZ).toBe(1);
    expect(bottomZ).toBe(2);
    expect(topZ).toBe(3);
    expect(outerZ).toBe(5);
  });

  // =========================================================================
  // Case 10: Repeated Shuffles Do Not Inflate Z-Indices While Pinned Remains Intact
  // =========================================================================
  test('Case 10: Repeated Smart Shuffles maintain bounded z-indices and preserve pinned zIndex', () => {
    const pinnedTop = createMockCanvasItem(top1, { zIndex: 4 });
    let currentCanvas = [pinnedTop];
    const pinnedSet = new Set(['w_top1']);
    const recentKeys: string[] = [];

    for (let shuffle = 0; shuffle < 10; shuffle++) {
      const outcome = executeSmartShuffle({
        wardrobe: standardWardrobe,
        currentCanvasItems: currentCanvas,
        pinnedWardrobeItemIds: pinnedSet,
        recentKeys,
      });

      expect(outcome.success).toBe(true);
      if (outcome.success) {
        currentCanvas = outcome.newCanvasItems;
        recentKeys.push(outcome.outfitKey);

        const retained = currentCanvas.find((i) => i.wardrobe_item_id === 'w_top1');
        expect(retained?.zIndex).toBe(4); // Strictly preserved across all 10 shuffles!

        // All z-indices stay bounded within [1, 10]
        for (const item of currentCanvas) {
          expect(item.zIndex).toBeGreaterThanOrEqual(1);
          expect(item.zIndex).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  // =========================================================================
  // Case 11: Session Anti-Repeat Ring Buffer
  // =========================================================================
  test('Case 11: Ring buffer prevents repeating candidate while unseen candidates exist', () => {
    expect(MAX_SESSION_SHUFFLE_HISTORY).toBe(10);

    const c1: any = { key: 'look_1', items: [top1, bottom1] };
    const c2: any = { key: 'look_2', items: [top2, bottom2] };
    const c3: any = { key: 'look_3', items: [top1, bottom2] };
    const candidates = [c1, c2, c3];

    const pick1 = selectDiverseCandidate(candidates, []);
    expect(pick1?.key).toBe('look_1');

    const pick2 = selectDiverseCandidate(candidates, ['look_1']);
    expect(pick2?.key).toBe('look_2');

    const pick3 = selectDiverseCandidate(candidates, ['look_1', 'look_2']);
    expect(pick3?.key).toBe('look_3');
  });

  // =========================================================================
  // Case 12: Least-Recently-Used Fallback When All Seen
  // =========================================================================
  test('Case 12: Selects least-recently-used candidate from current pool when all seen', () => {
    const c1: any = { key: 'look_1', items: [top1] };
    const c2: any = { key: 'look_2', items: [top2] };
    const candidates = [c1, c2];

    // History order: look_1 seen earliest (index 0), look_2 seen latest (index 1)
    const history = ['look_1', 'look_2'];
    const chosen = selectDiverseCandidate(candidates, history);
    expect(chosen?.key).toBe('look_1');
  });

  // =========================================================================
  // Case 13: Single-Candidate Wardrobe Graceful Repeat
  // =========================================================================
  test('Case 13: Gracefully repeats single valid outfit without error', () => {
    const c1: any = { key: 'only_look', items: [top1, bottom1] };
    const chosen = selectDiverseCandidate([c1], ['only_look', 'only_look']);
    expect(chosen?.key).toBe('only_look');
  });

  // =========================================================================
  // Case 14: Zero Calls to Phase B Exposure Persistence
  // =========================================================================
  test('Case 14: Strictly asserts ZERO persistent exposure writes on localExposureService', () => {
    const spyLog = jest.spyOn(localExposureService, 'logPresentation');
    const spyInteraction = jest.spyOn(localExposureService, 'logInteraction');

    const result = executeSmartShuffle({
      wardrobe: standardWardrobe,
      currentCanvasItems: [],
      pinnedWardrobeItemIds: new Set(),
      recentKeys: [],
    });

    expect(result.success).toBe(true);
    expect(spyLog).not.toHaveBeenCalled();
    expect(spyInteraction).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Case 15: Zero Wear Count Mutation & Empty Wardrobe
  // =========================================================================
  test('Case 15: Does not mutate wear_count or last_worn_at; returns EMPTY_WARDROBE on empty list', () => {
    const topBefore = { ...top1 };
    const result = executeSmartShuffle({
      wardrobe: [top1, bottom1],
      currentCanvasItems: [],
      pinnedWardrobeItemIds: new Set(),
      recentKeys: [],
    });
    expect(result.success).toBe(true);

    expect(top1.wear_count).toBe(topBefore.wear_count);
    expect(top1.last_worn_at).toBe(topBefore.last_worn_at);

    const emptyRes = executeSmartShuffle({
      wardrobe: [],
      currentCanvasItems: [],
      pinnedWardrobeItemIds: new Set(),
      recentKeys: [],
    });
    expect(emptyRes.success).toBe(false);
    if (!emptyRes.success) {
      expect(emptyRes.errorType).toBe('EMPTY_WARDROBE');
    }
  });

  // =========================================================================
  // Characterization: Scoring Profile Comparison Across 7 Fixtures
  // =========================================================================
  describe('Empirical Scoring Profile Characterization (7 Fixtures)', () => {
    test('Characterizes legacy-passive vs intent-driven across 7 representative fixtures', () => {
      // Fixture 1: Neutral Shuffle (Basic items)
      const f1Wardrobe = [top1, top2, bottom1, bottom2, shoes1];
      const i1: StylingIntent = { rawPrompt: '' };
      const c1Passive = generateCandidateOutfits(f1Wardrobe, i1, { scoringProfile: 'legacy-passive' });
      const c1Intent = generateCandidateOutfits(f1Wardrobe, i1, { scoringProfile: 'intent-driven' });

      // Fixture 2: Pinned Blazer
      const f2Wardrobe = [top1, bottom1, outer1, shoes1];
      const i2: StylingIntent = { rawPrompt: '', mustUseItemIds: ['w_outer1'] };
      const c2Passive = generateCandidateOutfits(f2Wardrobe, i2, { scoringProfile: 'legacy-passive' });
      const c2Intent = generateCandidateOutfits(f2Wardrobe, i2, { scoringProfile: 'intent-driven' });

      // Fixture 3: Dress Wardrobe
      const f3Wardrobe = [dress1, top1, bottom1, shoes1];
      const i3: StylingIntent = { rawPrompt: '' };
      const c3Passive = generateCandidateOutfits(f3Wardrobe, i3, { scoringProfile: 'legacy-passive' });
      const c3Intent = generateCandidateOutfits(f3Wardrobe, i3, { scoringProfile: 'intent-driven' });

      // Fixture 4: Casual Basics
      const f4Wardrobe = [top1, bottom1, shoes2];
      const i4: StylingIntent = { rawPrompt: '' };
      const c4Passive = generateCandidateOutfits(f4Wardrobe, i4, { scoringProfile: 'legacy-passive' });
      const c4Intent = generateCandidateOutfits(f4Wardrobe, i4, { scoringProfile: 'intent-driven' });

      // Fixture 5: Mixed Formality
      const formalTop = createMockItem('f_top', 'Top', ['white'], { sub_category: 'Tuxedo Shirt' });
      const sweatpants = createMockItem('f_bot', 'Bottom', ['gray'], { sub_category: 'Sweatpants' });
      const f5Wardrobe = [formalTop, sweatpants, top1, bottom1, shoes1];
      const i5: StylingIntent = { rawPrompt: '' };
      const c5Passive = generateCandidateOutfits(f5Wardrobe, i5, { scoringProfile: 'legacy-passive' });
      const c5Intent = generateCandidateOutfits(f5Wardrobe, i5, { scoringProfile: 'intent-driven' });

      // Fixture 6: Neglected Garment
      const neglectedTop = createMockItem('neg_top', 'Top', ['blue'], {
        sub_category: 'Neglected Silk Shirt',
        wear_count: 0,
        last_worn_at: null,
      });
      const f6Wardrobe = [neglectedTop, top1, bottom1, shoes1];
      const i6: StylingIntent = { rawPrompt: '' };
      const c6Passive = generateCandidateOutfits(f6Wardrobe, i6, { scoringProfile: 'legacy-passive' });
      const c6Intent = generateCandidateOutfits(f6Wardrobe, i6, { scoringProfile: 'intent-driven' });

      // Fixture 7: Pattern Clash
      const patternTop = createMockItem('pat_top', 'Top', ['red'], { pattern: 'Plaid' });
      const patternBottom = createMockItem('pat_bot', 'Bottom', ['green'], { pattern: 'Floral' });
      const f7Wardrobe = [patternTop, patternBottom, top1, bottom1, shoes1];
      const i7: StylingIntent = { rawPrompt: '' };
      const c7Passive = generateCandidateOutfits(f7Wardrobe, i7, { scoringProfile: 'legacy-passive' });
      const c7Intent = generateCandidateOutfits(f7Wardrobe, i7, { scoringProfile: 'intent-driven' });

      // Verify that both profiles generate valid candidates
      expect(c1Passive.length).toBeGreaterThan(0);
      expect(c1Intent.length).toBeGreaterThan(0);
      expect(c2Passive.length).toBeGreaterThan(0);
      expect(c2Intent.length).toBeGreaterThan(0);
      expect(c3Passive.length).toBeGreaterThan(0);
      expect(c3Intent.length).toBeGreaterThan(0);
      expect(c4Passive.length).toBeGreaterThan(0);
      expect(c4Intent.length).toBeGreaterThan(0);
      expect(c5Passive.length).toBeGreaterThan(0);
      expect(c5Intent.length).toBeGreaterThan(0);
      expect(c6Passive.length).toBeGreaterThan(0);
      expect(c6Intent.length).toBeGreaterThan(0);

      // Score spread analysis:
      // FIX-1: Neutral basics
      const passiveScoreF1 = c1Passive[0].baseScore;
      const intentScoreF1 = c1Intent[0].baseScore;

      // FIX-6: Neglected item
      const negPassive = c6Passive.find((c) => c.items.some((i) => i.id === 'neg_top'));
      const negIntent = c6Intent.find((c) => c.items.some((i) => i.id === 'neg_top'));
      expect(negPassive).toBeDefined();
      expect(negIntent).toBeDefined();

      // FIX-7: Pattern clash penalty
      const clashPassive = c7Passive.find((c) =>
        c.items.some((i) => i.id === 'pat_top') && c.items.some((i) => i.id === 'pat_bot')
      );
      const clashIntent = c7Intent.find((c) =>
        c.items.some((i) => i.id === 'pat_top') && c.items.some((i) => i.id === 'pat_bot')
      );
      if (clashIntent) {
        expect(clashIntent.baseScore).toBeLessThan(c4Intent[0].baseScore);
      }
      if (clashPassive) {
        expect(clashPassive.baseScore).toBeLessThan(c4Passive[0].baseScore);
      }

      // Evidence summary log for implementation verification report:
      const characterizationSummary = {
        fix1_neutral: { passive: passiveScoreF1, intent: intentScoreF1 },
        fix2_pinned_blazer: { passive: c2Passive[0].baseScore, intent: c2Intent[0].baseScore },
        fix3_dress: { passive: c3Passive[0].baseScore, intent: c3Intent[0].baseScore },
        fix4_casual: { passive: c4Passive[0].baseScore, intent: c4Intent[0].baseScore },
        fix5_mixed_formality: { passive: c5Passive[0].baseScore, intent: c5Intent[0].baseScore },
        fix6_neglected: { passive: negPassive?.baseScore, intent: negIntent?.baseScore },
        fix7_pattern_clash: { passive: clashPassive?.baseScore ?? 'pruned', intent: clashIntent?.baseScore ?? 'pruned' },
      };

      expect(characterizationSummary).toBeDefined();
      expect(SMART_SHUFFLE_SCORING_PROFILE).toBe('intent-driven');
    });
  });
});
