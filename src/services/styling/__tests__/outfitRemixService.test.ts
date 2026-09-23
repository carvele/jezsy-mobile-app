import {
  applyCandidateToRemixState,
  toggleSlotLock,
  getCanonicalSlotReplacements,
  replaceSlotItemWithCandidate,
  switchBaseStructure,
  shuffleUnlockedSlots,
  addOuterwear,
  removeOuterwear,
  createRemixResult,
  adaptStyleAdvisorLookToRemix,
  adaptPassiveOutfitToRemix,
  adaptSavedOutfitToRemix,
} from '../outfitRemixService';
import { WardrobeItem, StylingIntent, CandidateOutfit, StylingOption } from '@/src/types/styleAdvisor';
import { localExposureService } from '../localExposureService';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';

function makeMockWardrobeItem(partial: Partial<WardrobeItem> & { id: string; category: string }): WardrobeItem {
  return {
    id: partial.id,
    user_id: 'user_phase_e',
    product_id: null,
    image_url: 'https://example.com/img.jpg',
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
    ai_attributes: null,
    occasions: partial.occasions || ['Work', 'Casual'],
    seasons: ['All'],
  } as WardrobeItem;
}

const mockWardrobe: WardrobeItem[] = [
  makeMockWardrobeItem({ id: 'top_1', category: 'Top', sub_category: 'Silk Shirt', color_tags: ['White'] }),
  makeMockWardrobeItem({ id: 'top_2', category: 'Top', sub_category: 'Cotton Tee', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'top_3', category: 'Top', sub_category: 'Red Blouse', color_tags: ['Red'] }),
  makeMockWardrobeItem({ id: 'bottom_1', category: 'Bottom', sub_category: 'Tailored Trousers', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'bottom_2', category: 'Bottom', sub_category: 'Denim Jeans', color_tags: ['Blue'] }),
  makeMockWardrobeItem({ id: 'dress_1', category: 'Dress', sub_category: 'Wrap Dress', color_tags: ['Navy'] }),
  makeMockWardrobeItem({ id: 'dress_2', category: 'Dress', sub_category: 'Shift Dress', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'shoes_1', category: 'Shoes', sub_category: 'Leather Loafers', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'shoes_2', category: 'Shoes', sub_category: 'White Sneakers', color_tags: ['White'] }),
  makeMockWardrobeItem({ id: 'shoes_3', category: 'Shoes', sub_category: 'Red Heels', color_tags: ['Red'] }),
  makeMockWardrobeItem({ id: 'outer_1', category: 'Outerwear', sub_category: 'Wool Blazer', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'outer_2', category: 'Outerwear', sub_category: 'Denim Jacket', color_tags: ['Blue'] }),
  makeMockWardrobeItem({ id: 'acc_1', category: 'Accessory', sub_category: 'Gold Watch', color_tags: ['Gold'] }),
  makeMockWardrobeItem({ id: 'unk_1', category: 'Accessory', sub_category: 'Family Brooch', garment_type: 'Accessory', color_tags: ['Silver'] }),
];

describe('Phase E: outfitRemixService (Pure Domain Service)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. init-separates
  it('1. initializes separates correctly into Top, Bottom, and Shoes', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]], // top_1, bottom_1, shoes_1
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Tailored Look',
      intentMatch: 'Matched context',
      whyThisWorks: { summary: 'Harmonious', palette: 'Monochrome', silhouette: 'Fitted', occasion: 'Work' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 90,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: 'Work outfit' });
    expect(state.slots.top?.item.id).toBe('top_1');
    expect(state.slots.bottom?.item.id).toBe('bottom_1');
    expect(state.slots.shoes?.item.id).toBe('shoes_1');
    expect(state.slots.dress).toBeNull();
    expect(state.slots.outerwear).toBeNull();
    expect(state.passthroughItems).toHaveLength(0);
  });

  // 2. init-dress
  it('2. initializes dress correctly into Dress and Shoes', () => {
    const look: StylingOption = {
      candidateId: 'c2',
      items: [mockWardrobe[5], mockWardrobe[7]], // dress_1, shoes_1
      key: 'dress_1|shoes_1',
      label: 'Elegant',
      headline: 'Navy Dress Ensemble',
      intentMatch: 'Matched context',
      whyThisWorks: { summary: 'Fluid line', palette: 'Navy', silhouette: 'One-piece', occasion: 'Dinner' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 92,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: 'Dinner' });
    expect(state.slots.dress?.item.id).toBe('dress_1');
    expect(state.slots.shoes?.item.id).toBe('shoes_1');
    expect(state.slots.top).toBeNull();
    expect(state.slots.bottom).toBeNull();
  });

  // 3. provenance-style-around
  it('3. assigns lockReason style-around and canUnlockInRemix false to session anchor', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' }, ['top_1']);
    expect(state.slots.top?.isLocked).toBe(true);
    expect(state.slots.top?.lockReason).toBe('style-around');
    expect(state.slots.top?.canUnlockInRemix).toBe(false);
  });

  // 4. provenance-parent-must-use
  it('4. assigns lockReason parent-must-use and canUnlockInRemix false to intent must-use piece', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { mustUseItemIds: ['bottom_1'], rawPrompt: '' });
    expect(state.slots.bottom?.isLocked).toBe(true);
    expect(state.slots.bottom?.lockReason).toBe('parent-must-use');
    expect(state.slots.bottom?.canUnlockInRemix).toBe(false);
  });

  // 5. provenance-local-remix
  it('5. assigns lockReason remix and canUnlockInRemix true to unconstrained items', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    expect(state.slots.top?.isLocked).toBe(false);
    expect(state.slots.top?.lockReason).toBe('remix');
    expect(state.slots.top?.canUnlockInRemix).toBe(true);
  });

  // 6. lock-toggle-success
  it('6. toggles local remix lock state successfully', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    let state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    state = toggleSlotLock(state, 'top');
    expect(state.slots.top?.isLocked).toBe(true);
    state = toggleSlotLock(state, 'top');
    expect(state.slots.top?.isLocked).toBe(false);
  });

  // 7. lock-toggle-blocked
  it('7. rejects unlocking authoritative parent constraints', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' }, ['top_1']);
    const afterAttempt = toggleSlotLock(state, 'top');
    expect(afterAttempt.slots.top?.isLocked).toBe(true);
    expect(afterAttempt.error).toContain('cannot be unlocked in Remix');
  });

  // 8. intent-preservation-avoided-colors
  it('8. strictly preserves avoidedColors during single-slot replacement', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]], // top_1 (white), bottom_1 (black), shoes_1 (black)
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { avoidedColors: ['red'], rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'shoes', mockWardrobe);

    // shoes_3 is Red Heels, must NOT be present in replacements
    const hasRedShoe = replacements.some((r) => r.replacementItem.id === 'shoes_3');
    expect(hasRedShoe).toBe(false);

    // shoes_2 is White Sneakers, should be present
    const hasWhiteShoe = replacements.some((r) => r.replacementItem.id === 'shoes_2');
    expect(hasWhiteShoe).toBe(true);
  });

  // 9. intent-preservation-formality
  it('9. preserves parent formality context during unlocked shuffle', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { formality: 'formal', rawPrompt: '' });
    const shuffled = shuffleUnlockedSlots(state, mockWardrobe);
    expect(shuffled.intent.formality).toBe('formal');
  });

  // 10. intent-preservation-exclusions
  it('10. preserves parent excludedItemIds across Remix operations', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { excludedItemIds: ['shoes_2'], rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'shoes', mockWardrobe);
    const hasExcludedShoe = replacements.some((r) => r.replacementItem.id === 'shoes_2');
    expect(hasExcludedShoe).toBe(false);
  });

  // 11. slot-swap-target-only
  it('11. swapping shoes modifies only shoes, preserving all other slots', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]], // top_1, bottom_1, shoes_1
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'shoes', mockWardrobe);
    expect(replacements.length).toBeGreaterThan(0);

    const targetReplacement = replacements[0];
    const updated = replaceSlotItemWithCandidate(state, targetReplacement.candidate);

    expect(updated.slots.top?.item.id).toBe('top_1');
    expect(updated.slots.bottom?.item.id).toBe('bottom_1');
    expect(updated.slots.shoes?.item.id).toBe(targetReplacement.replacementItem.id);
  });

  // 12. canonical-replacement-ranking
  it('12. extracted replacements are ordered by canonical candidate score', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'shoes', mockWardrobe);

    for (let i = 1; i < replacements.length; i++) {
      expect(replacements[i - 1].candidate.baseScore).toBeGreaterThanOrEqual(
        replacements[i].candidate.baseScore
      );
    }
  });

  // 13. wrong-category-rejection
  it('13. does not allow cross-category items in target slot', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'top', mockWardrobe);

    for (const r of replacements) {
      expect(resolveEffectiveGarmentBucket(r.replacementItem)).toBe('Top');
    }
  });

  // 14. stale-item-rejection
  it('14. does not return deleted/stale items in replacement candidates', () => {
    const wardrobeWithDeleted = [
      ...mockWardrobe,
      makeMockWardrobeItem({ id: 'top_deleted', category: 'Top', deleted: true } as any),
    ];
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, wardrobeWithDeleted, { rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'top', wardrobeWithDeleted);
    expect(replacements.some((r) => r.replacementItem.id === 'top_deleted')).toBe(false);
  });

  // 15. dress-to-separates-success
  it('15. atomically transitions unlocked dress to top+bottom separates', () => {
    const look: StylingOption = {
      candidateId: 'c2',
      items: [mockWardrobe[5], mockWardrobe[7]], // dress_1, shoes_1
      key: 'dress_1|shoes_1',
      label: 'Elegant',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 90,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const switched = switchBaseStructure(state, 'separates', mockWardrobe);

    expect(switched.slots.dress).toBeNull();
    expect(switched.slots.top).not.toBeNull();
    expect(switched.slots.bottom).not.toBeNull();
    expect(switched.slots.shoes?.item.id).toBe('shoes_1');
  });

  // 16. separates-to-dress-success
  it('16. atomically transitions unlocked top+bottom to dress', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]], // top_1, bottom_1, shoes_1
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const switched = switchBaseStructure(state, 'dress', mockWardrobe);

    expect(switched.slots.top).toBeNull();
    expect(switched.slots.bottom).toBeNull();
    expect(switched.slots.dress).not.toBeNull();
    expect(switched.slots.shoes?.item.id).toBe('shoes_1');
  });

  // 17. dress-to-separates-blocked-parent
  it('17. rejects transition when parent must-use dress is active', () => {
    const look: StylingOption = {
      candidateId: 'c2',
      items: [mockWardrobe[5], mockWardrobe[7]],
      key: 'dress_1|shoes_1',
      label: 'Elegant',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 90,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { mustUseItemIds: ['dress_1'], rawPrompt: '' });
    const switched = switchBaseStructure(state, 'separates', mockWardrobe);
    expect(switched.slots.dress).not.toBeNull();
    expect(switched.error).toContain('requires this dress');
  });

  // 18. separates-to-dress-blocked-parent
  it('18. rejects transition when parent must-use top or bottom is active', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' }, ['top_1']);
    const switched = switchBaseStructure(state, 'dress', mockWardrobe);
    expect(switched.slots.dress).toBeNull();
    expect(switched.error).toContain('requires this top/bottom');
  });

  // 19. outerwear-add
  it('19. adds compatible outerwear derived from canonical candidates', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    expect(state.slots.outerwear).toBeNull();

    const withOuter = addOuterwear(state, mockWardrobe);
    expect(withOuter.slots.outerwear).not.toBeNull();
    expect(withOuter.slots.top?.item.id).toBe('top_1');
    expect(withOuter.slots.bottom?.item.id).toBe('bottom_1');
  });

  // 20. outerwear-remove
  it('20. removes unlocked outerwear and updates active candidate', () => {
    const look: StylingOption = {
      candidateId: 'c3',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7], mockWardrobe[10]], // with outer_1
      key: 'bottom_1|outer_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 94,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    expect(state.slots.outerwear?.item.id).toBe('outer_1');

    const removed = removeOuterwear(state);
    expect(removed.slots.outerwear).toBeNull();
    expect(removed.slots.top?.item.id).toBe('top_1');
  });

  // 21. outerwear-remove-blocked
  it('21. rejects removing authoritatively locked outerwear', () => {
    const look: StylingOption = {
      candidateId: 'c3',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7], mockWardrobe[10]],
      key: 'bottom_1|outer_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 94,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' }, ['outer_1']);
    const attempt = removeOuterwear(state);
    expect(attempt.slots.outerwear).not.toBeNull();
    expect(attempt.error).toContain('Cannot remove outerwear required by your Style Advisor session');
  });

  // 22. passthrough-accessory-preserved
  it('22. preserves passthrough accessories across slot replacements and shuffles', () => {
    const lookWithAcc: StylingOption = {
      candidateId: 'c4',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7], mockWardrobe[12]], // with acc_1 (Gold Watch)
      key: 'acc_1|bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 90,
    };

    const state = adaptStyleAdvisorLookToRemix(lookWithAcc, mockWardrobe, { rawPrompt: '' });
    expect(state.passthroughItems).toHaveLength(1);
    expect(state.passthroughItems[0].id).toBe('acc_1');

    const shuffled = shuffleUnlockedSlots(state, mockWardrobe);
    expect(shuffled.passthroughItems).toHaveLength(1);
    expect(shuffled.passthroughItems[0].id).toBe('acc_1');

    const result = createRemixResult(shuffled);
    expect(result.items.some((i) => i.id === 'acc_1')).toBe(true);
  });

  // 23. passthrough-unknown-preserved
  it('23. preserves unknown legacy pieces in passthroughItems', () => {
    const saved = {
      id: 'saved_legacy_1',
      items: [
        { slot: 'top', id: 'top_1' },
        { slot: 'bottom', id: 'bottom_1' },
        { slot: 'custom_badge', id: 'unk_1' },
      ],
    };

    const state = adaptSavedOutfitToRemix(saved, mockWardrobe);
    expect(state.passthroughItems.some((i) => i.id === 'unk_1')).toBe(true);

    const result = createRemixResult(state);
    expect(result.items.some((i) => i.id === 'unk_1')).toBe(true);
  });

  // 24. sparse-wardrobe-zero-alternatives
  it('24. returns helpful empty message when 0 alternative items exist in category', () => {
    const sparseWardrobe = [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]]; // exactly 1 top, 1 bottom, 1 shoe
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, sparseWardrobe, { rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'shoes', sparseWardrobe);
    expect(replacements).toHaveLength(0);
  });

  // 25. zero-compatible-matches
  it('25. returns clean error message when no alternative combination satisfies constraints', () => {
    const sparseWardrobe = [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]];
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, sparseWardrobe, { rawPrompt: '' });
    const attempt = shuffleUnlockedSlots(state, sparseWardrobe);
    expect(attempt.error).toContain('No alternative combinations found');
  });

  // 26. all-slots-locked-guard
  it('26. returns informative error when shuffling with all slots locked', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    let state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    state = toggleSlotLock(state, 'top');
    state = toggleSlotLock(state, 'bottom');
    state = toggleSlotLock(state, 'shoes');

    const attempt = shuffleUnlockedSlots(state, mockWardrobe);
    expect(attempt.error).toContain('All slots are locked');
  });

  // 27. anti-repeat-unseen-first
  it('27. selects unseen candidate over candidates present in history', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    let state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const firstShuffle = shuffleUnlockedSlots(state, mockWardrobe);
    expect(firstShuffle.history).toContain(firstShuffle.activeCandidate?.key);

    const secondShuffle = shuffleUnlockedSlots(firstShuffle, mockWardrobe);
    expect(secondShuffle.activeCandidate?.key).not.toBe(firstShuffle.activeCandidate?.key);
  });

  // 28. anti-repeat-true-lru-fallback
  it('28. selects candidate with oldest position in history when all candidates seen (true LRU)', () => {
    const candidateA: CandidateOutfit = {
      candidateId: 'cand_a',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      baseScore: 95,
      colorMatchLabel: 'Match',
      formalityLevel: 'formal',
      hasDress: false,
      hasShoes: true,
      hasOuterwear: false,
    };

    const candidateB: CandidateOutfit = {
      candidateId: 'cand_b',
      items: [mockWardrobe[1], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_2',
      baseScore: 85,
      colorMatchLabel: 'Match',
      formalityLevel: 'formal',
      hasDress: false,
      hasShoes: true,
      hasOuterwear: false,
    };

    // History is newest-first: index 0 is most recent, index 1 is oldest seen.
    // cand_a was seen recently at index 0. cand_b was seen earlier at index 1.
    const state: any = {
      slots: {
        top: { item: mockWardrobe[0], isLocked: false },
        bottom: { item: mockWardrobe[3], isLocked: true },
        shoes: { item: mockWardrobe[7], isLocked: true },
        dress: null,
        outerwear: null,
      },
      passthroughItems: [],
      history: [candidateA.key, candidateB.key], // cand_a is index 0 (recent), cand_b is index 1 (older)
      intent: { rawPrompt: '' },
      profile: null,
      activeCandidate: candidateA,
      isDirty: false,
    };

    // When all candidates are seen, candidates[0] is cand_a (score 95).
    // But true LRU must pick cand_b because it sits at a larger index (seen longest ago)!
    const shuffled = shuffleUnlockedSlots(state, [mockWardrobe[0], mockWardrobe[1], mockWardrobe[3], mockWardrobe[7]]);
    expect(shuffled.activeCandidate?.key).toBe(candidateB.key);
  });

  // 29. refresh-score-and-key
  it('29. freshly computes score, label, and sorted key on remixed result', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const replacements = getCanonicalSlotReplacements(state, 'shoes', mockWardrobe);
    const updated = replaceSlotItemWithCandidate(state, replacements[0].candidate);

    const result = createRemixResult(updated);
    expect(result.score).toBe(replacements[0].candidate.baseScore);
    expect(result.outfitKey).toBe(replacements[0].candidate.key);
    expect(result.isRemixedDraft).toBe(true);
  });

  // 30. refresh-explanation
  it('30. freshly generates grounded explanation using canonical groundedExplainer', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { selectedOccasion: 'Dinner', rawPrompt: '' });
    const result = createRemixResult(state);

    expect(result.whyThisWorks.summary.length).toBeGreaterThan(10);
    expect(result.whyThisWorks.palette.length).toBeGreaterThan(5);
    expect(result.whyThisWorks.silhouette.length).toBeGreaterThan(5);
  });

  // 31. zero-exposure-writes-domain
  it('31. strictly performs 0 calls to localExposureService.logPresentation and logInteraction', () => {
    const spyPresentation = jest.spyOn(localExposureService, 'logPresentation');
    const spyInteraction = jest.spyOn(localExposureService, 'logInteraction');

    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    shuffleUnlockedSlots(state, mockWardrobe);
    getCanonicalSlotReplacements(state, 'shoes', mockWardrobe);
    switchBaseStructure(state, 'dress', mockWardrobe);

    expect(spyPresentation).not.toHaveBeenCalled();
    expect(spyInteraction).not.toHaveBeenCalled();
  });

  // 32. zero-wear-mutation-domain
  it('32. strictly asserts 0 mutations to wear_count or last_worn_at', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const initialWearCounts = mockWardrobe.map((w) => w.wear_count);
    const initialLastWorns = mockWardrobe.map((w) => w.last_worn_at);

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: '' });
    const shuffled = shuffleUnlockedSlots(state, mockWardrobe);
    createRemixResult(shuffled);

    for (let i = 0; i < mockWardrobe.length; i++) {
      expect(mockWardrobe[i].wear_count).toBe(initialWearCounts[i]);
      expect(mockWardrobe[i].last_worn_at).toBe(initialLastWorns[i]);
    }
  });

  // 33. adapt-passive-outfit
  it('33. adaptPassiveOutfitToRemix cleanly maps items and isolates accessory passthroughs', () => {
    const acc = makeMockWardrobeItem({ id: 'acc_1', category: 'Accessories', sub_category: 'Belt' });
    const outfit = {
      key: 'bottom_1|shoes_1|top_1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7], acc],
      score: 90,
      label: 'Casual Chic',
      headline: 'Effortless style',
      reason: 'Pairs nicely',
      isAiRanked: false,
      assessment: 'Great balance',
    };

    const state = adaptPassiveOutfitToRemix(outfit, [...mockWardrobe, acc]);
    expect(state.slots.top?.item.id).toBe('top_1');
    expect(state.slots.bottom?.item.id).toBe('bottom_1');
    expect(state.slots.shoes?.item.id).toBe('shoes_1');
    expect(state.passthroughItems).toHaveLength(1);
    expect(state.passthroughItems[0].id).toBe('acc_1');
    expect(state.sourceType).toBe('passive-outfit');
  });

  // 34. adapt-saved-outfit
  it('34. adaptSavedOutfitToRemix resolves live items, routes snapshots to passthrough, and tracks missing items', () => {
    const saved = {
      id: 'saved_1',
      name: 'Favorite Summer Look',
      items: [
        { id: 'top_1', slot: 'top' },
        { id: 'bottom_1', slot: 'bottom' },
        { id: 'shoes_1', slot: 'shoes' },
        { id: 'acc_1', slot: 'accessory', name: 'Gold Chain', image_url: 'https://example.com/chain.jpg' },
        { id: 'deleted_item_no_snapshot', slot: 'outerwear' },
      ],
    };

    const state = adaptSavedOutfitToRemix(saved, mockWardrobe);
    expect(state.slots.top?.item.id).toBe('top_1');
    expect(state.slots.bottom?.item.id).toBe('bottom_1');
    expect(state.slots.shoes?.item.id).toBe('shoes_1');
    // acc_1 has usable snapshot -> passthroughItems
    expect(state.passthroughItems).toHaveLength(1);
    expect(state.passthroughItems[0].id).toBe('acc_1');
    // deleted_item_no_snapshot has no snapshot -> missingItems
    expect(state.missingItems).toHaveLength(1);
    expect(state.missingItems![0].id).toBe('deleted_item_no_snapshot');
    expect(state.sourceType).toBe('saved-outfit');
  });

  // 35. apply-candidate-to-remix-state
  it('35. applyCandidateToRemixState preserves lock states and updates candidate reference', () => {
    const intent: StylingIntent = { rawPrompt: 'Relaxed weekend' };
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[3], mockWardrobe[7]],
      key: 'bottom_1|shoes_1|top_1',
      label: 'Classic',
      headline: 'Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'S', palette: 'P', silhouette: 'S', occasion: 'O' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 88,
    };

    const state = adaptStyleAdvisorLookToRemix(look, mockWardrobe, intent);
    const lockedState = toggleSlotLock(state, 'top');
    expect(lockedState.slots.top?.isLocked).toBe(true);

    const newCandidate: CandidateOutfit = {
      candidateId: 'c2',
      items: [mockWardrobe[0], mockWardrobe[4], mockWardrobe[7]],
      key: 'bottom_2|shoes_1|top_1',
      baseScore: 92,
      colorMatchLabel: 'Contrast',
      formalityLevel: 'casual',
      hasDress: false,
      hasShoes: true,
      hasOuterwear: false,
    };

    const updated = applyCandidateToRemixState(lockedState, newCandidate);
    expect(updated.slots.top?.isLocked).toBe(true);
    expect(updated.slots.bottom?.item.id).toBe('bottom_2');
    expect(updated.activeCandidate?.key).toBe(newCandidate.key);
    expect(updated.isDirty).toBe(true);
  });
});
