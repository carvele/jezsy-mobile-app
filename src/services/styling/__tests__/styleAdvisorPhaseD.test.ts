import {
  parseExplicitUserText,
  mergeIntentWithChips,
  parseStylingIntent,
} from '../intentParser';
import {
  computeTargetLookCount,
  rankCandidatesWithAI,
} from '../aiCandidateRanker';
import {
  createStylingSession,
  refineStylingSession,
} from '../stylingSessionService';
import {
  WardrobeItem,
  StylingIntent,
  StyleAdvisorChipContext,
  CandidateOutfit,
} from '@/src/types/styleAdvisor';
import { IAIStylistProvider } from '../../aiStylistProvider';

function makeMockWardrobeItem(partial: Partial<WardrobeItem> & { id: string; category: string }): WardrobeItem {
  return {
    id: partial.id,
    user_id: 'user_phase_d',
    product_id: null,
    image_url: 'https://example.com/img.jpg',
    category: partial.category,
    sub_category: partial.sub_category || partial.category,
    deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    color_tags: partial.color_tags || ['Black'],
    garment_type: partial.garment_type || partial.category,
    wear_count: partial.wear_count ?? 2,
    last_worn_at: partial.last_worn_at || '2026-09-01T00:00:00Z',
    description: partial.description || null,
    user_notes: partial.user_notes || null,
    ai_attributes: null,
    occasions: partial.occasions || ['Work', 'Casual'],
    seasons: ['All'],
  } as WardrobeItem;
}

const mockWardrobe: WardrobeItem[] = [
  makeMockWardrobeItem({ id: 'top_1', category: 'Top', sub_category: 'Black Silk Blouse', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'top_2', category: 'Top', sub_category: 'White Linen Shirt', color_tags: ['White'] }),
  makeMockWardrobeItem({ id: 'top_3', category: 'Top', sub_category: 'Red Cotton T-Shirt', color_tags: ['Red'] }),
  makeMockWardrobeItem({ id: 'bottom_1', category: 'Bottom', sub_category: 'Black Wool Slacks', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'bottom_2', category: 'Bottom', sub_category: 'Blue Slim Denim', color_tags: ['Blue'] }),
  makeMockWardrobeItem({ id: 'bottom_3', category: 'Bottom', sub_category: 'Khaki Chinos', color_tags: ['Khaki'] }),
  makeMockWardrobeItem({ id: 'dress_1', category: 'Dress', sub_category: 'Navy Silk Wrap Dress', color_tags: ['Navy'] }),
  makeMockWardrobeItem({ id: 'shoes_1', category: 'Shoes', sub_category: 'Black Leather Loafers', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'shoes_2', category: 'Shoes', sub_category: 'White Tennis Sneakers', color_tags: ['White'] }),
  makeMockWardrobeItem({ id: 'outer_1', category: 'Outerwear', sub_category: 'Black Tailored Blazer', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'outer_2', category: 'Outerwear', sub_category: 'Denim Trucker Jacket', color_tags: ['Blue'] }),
];

describe('Phase D: Style Advisor & Natural Language Precedence', () => {
  describe('1. Natural Language & Chip Merging Precedence', () => {
    it('parses text-only inputs with accurate field provenance', () => {
      const { intent, provenance } = parseExplicitUserText(
        'I need an ultra formal outfit for a black-tie gala dinner. Avoid red, prefer black.',
        mockWardrobe
      );

      expect(provenance.hasExplicitOccasion).toBe(true);
      expect(provenance.hasExplicitFormality).toBe(true);
      expect(provenance.hasExplicitColors).toBe(true);
      expect(intent.formality).toBe('formal');
      expect(intent.avoidedColors).toContain('red');
      expect(intent.preferredColors).toContain('black');
      expect(['gala', 'dinner']).toContain(intent.selectedOccasion?.toLowerCase());
    });

    it('parses clean chips-only submission without string prefixing', () => {
      const chipContext: StyleAdvisorChipContext = {
        occasion: 'Work',
        vibe: 'polished',
        weather: 'chilly',
        temperature: 'mild',
        comfort: true,
      };

      const intent = parseStylingIntent('', chipContext, mockWardrobe);

      expect(intent.selectedOccasion).toBe('Work');
      expect(intent.formality).toBe('elevatedCasual');
      expect(intent.weather).toBe('chilly');
      expect(intent.temperatureNeeds).toBe('mild');
      expect(intent.comfortPriority).toBe(true);
      expect(intent.rawPrompt).toBe('');
    });

    it('strictly enforces explicit text precedence over conflicting helper chips', () => {
      // User typed "casual" in free text, but tapped "Formal" or "polished" chip
      const conflictingChips: StyleAdvisorChipContext = {
        occasion: 'Formal Gala',
        vibe: 'polished',
      };

      const intent = parseStylingIntent(
        'Super casual outfit for relaxing at home',
        conflictingChips,
        mockWardrobe
      );

      // Explicit text must win over chip!
      expect(intent.formality).toBe('casual');
      expect(intent.selectedOccasion).not.toBe('Formal Gala');
    });

    it('detects and flags conflict between locked garment and free-text constraints', () => {
      // Locked item is top_3 (Red Cotton T-Shirt)
      const lockedIds = ['top_3'];
      const intent = parseStylingIntent(
        'Formal dinner, please avoid red completely',
        null,
        mockWardrobe,
        null,
        lockedIds
      );

      expect(intent.conflictingConstraints).toBeDefined();
      expect(intent.conflictingConstraints?.length).toBeGreaterThan(0);
      expect(intent.conflictingConstraints?.[0]).toMatch(/conflicts with locked garment/i);
    });
  });

  describe('2. Durable Locked Garment Session State', () => {
    it('initializes session with durable locked item in both state and mustUseItemIds', async () => {
      const lockedIds = ['top_1']; // Black Silk Blouse
      const session = await createStylingSession(
        'Dinner date',
        'Date Night',
        mockWardrobe,
        undefined,
        undefined,
        lockedIds
      );

      expect(session.lockedWardrobeItemIds).toEqual(['top_1']);
      expect(session.intent.mustUseItemIds).toContain('top_1');

      for (const opt of session.options) {
        const itemIds = opt.items.map((i) => i.id);
        expect(itemIds).toContain('top_1');
      }
    });

    it('durably retains locked item across all refinement operations', async () => {
      const lockedIds = ['outer_1']; // Black Tailored Blazer
      const session = await createStylingSession(
        'Business meeting',
        'Work',
        mockWardrobe,
        undefined,
        undefined,
        lockedIds
      );

      // Refinement 1: tryAnother
      const refinedAnother = await refineStylingSession(session, 'tryAnother');
      expect(refinedAnother.lockedWardrobeItemIds).toEqual(['outer_1']);
      expect(refinedAnother.intent.mustUseItemIds).toContain('outer_1');
      for (const opt of refinedAnother.options) {
        expect(opt.items.map((i) => i.id)).toContain('outer_1');
      }

      // Refinement 2: moreFormal
      const refinedFormal = await refineStylingSession(refinedAnother, 'moreFormal');
      expect(refinedFormal.lockedWardrobeItemIds).toEqual(['outer_1']);
      expect(refinedFormal.intent.mustUseItemIds).toContain('outer_1');
      for (const opt of refinedFormal.options) {
        expect(opt.items.map((i) => i.id)).toContain('outer_1');
      }

      // Refinement 3: moreRelaxed
      const refinedRelaxed = await refineStylingSession(refinedFormal, 'moreRelaxed');
      expect(refinedRelaxed.lockedWardrobeItemIds).toEqual(['outer_1']);
      expect(refinedRelaxed.intent.mustUseItemIds).toContain('outer_1');

      // Refinement 4: moreComfortable
      const refinedComfort = await refineStylingSession(refinedRelaxed, 'moreComfortable');
      expect(refinedComfort.lockedWardrobeItemIds).toEqual(['outer_1']);
      expect(refinedComfort.intent.mustUseItemIds).toContain('outer_1');
    });

    it('rejects avoidItem refinement on a locked garment and preserves lock', async () => {
      const lockedIds = ['outer_1'];
      const session = await createStylingSession(
        'Business meeting',
        'Work',
        mockWardrobe,
        undefined,
        undefined,
        lockedIds
      );

      // Attempt to avoid the locked blazer
      const avoidResult = await refineStylingSession(session, 'avoidItem', 'outer_1');
      expect(avoidResult.error).toMatch(/garment is currently locked/i);
      expect(avoidResult.lockedWardrobeItemIds).toEqual(['outer_1']);
      expect(avoidResult.intent.excludedItemIds || []).not.toContain('outer_1');
    });
  });

  describe('3. Deterministic Look-Count Algorithm', () => {
    it('maps candidate pool sizes to deterministic target look counts strictly', () => {
      // 0 candidates -> 0
      expect(computeTargetLookCount(0)).toBe(0);
      expect(computeTargetLookCount(-5)).toBe(0);

      // 1 candidate -> 1
      expect(computeTargetLookCount(1)).toBe(1);

      // 2 candidates -> 2
      expect(computeTargetLookCount(2)).toBe(2);

      // 3..5 candidates -> 3
      expect(computeTargetLookCount(3)).toBe(3);
      expect(computeTargetLookCount(4)).toBe(3);
      expect(computeTargetLookCount(5)).toBe(3);

      // 6..8 candidates -> 4
      expect(computeTargetLookCount(6)).toBe(4);
      expect(computeTargetLookCount(7)).toBe(4);
      expect(computeTargetLookCount(8)).toBe(4);

      // 9+ candidates -> 5
      expect(computeTargetLookCount(9)).toBe(5);
      expect(computeTargetLookCount(10)).toBe(5);
      expect(computeTargetLookCount(15)).toBe(5);
    });
  });

  describe('4. AI Recommendation Validation & Deterministic Supplemental Fill', () => {
    function makeCandidate(id: string, baseScore: number, items: WardrobeItem[]): CandidateOutfit {
      return {
        candidateId: id,
        items,
        key: items.map((i) => i.id).sort().join('|'),
        baseScore,
        colorMatchLabel: 'Cohesive',
        formalityLevel: 'elevatedCasual',
        hasDress: false,
        hasShoes: true,
        hasOuterwear: false,
      };
    }

    const testCandidates: CandidateOutfit[] = [
      makeCandidate('c1', 95, [mockWardrobe[0], mockWardrobe[3]]),
      makeCandidate('c2', 90, [mockWardrobe[1], mockWardrobe[3]]),
      makeCandidate('c3', 85, [mockWardrobe[0], mockWardrobe[4]]),
      makeCandidate('c4', 80, [mockWardrobe[1], mockWardrobe[4]]),
      makeCandidate('c5', 75, [mockWardrobe[2], mockWardrobe[3]]),
      makeCandidate('c6', 70, [mockWardrobe[2], mockWardrobe[4]]),
      makeCandidate('c7', 65, [mockWardrobe[0], mockWardrobe[5]]),
      makeCandidate('c8', 60, [mockWardrobe[1], mockWardrobe[5]]),
      makeCandidate('c9', 55, [mockWardrobe[2], mockWardrobe[5]]),
      makeCandidate('c10', 50, [mockWardrobe[8], mockWardrobe[3]]),
    ];

    const wardrobeLookup: Record<string, WardrobeItem> = {};
    for (const w of mockWardrobe) wardrobeLookup[w.id] = w;

    const intent: StylingIntent = { rawPrompt: 'Work presentation', formality: 'elevatedCasual' };

    it('supplements partial AI recommendations up to target count using deterministic ranking', async () => {
      // AI provider returns only 1 valid recommendation out of 10 candidates
      const mockPartialProvider: IAIStylistProvider = {
        analyze: jest.fn(),
        rankCandidates: jest.fn().mockResolvedValue({
          success: true,
          recommendations: [
            {
              candidateId: 'c1',
              label: 'Power Classic',
              headline: 'Tailored and elevated',
              intentMatch: 'Perfect match for work.',
              whyThisWorks: {
                summary: 'Structured black slacks with a polished silk blouse.',
                palette: 'Monochrome black.',
                silhouette: 'Clean tailored line.',
                occasion: 'Business meeting.',
              },
            },
          ],
        }),
      };

      const options = await rankCandidatesWithAI(testCandidates, intent, wardrobeLookup, mockPartialProvider);

      // Target count for pool size 10 is 5
      expect(options).toHaveLength(5);

      // First option is the AI-ranked look
      expect(options[0].candidateId).toBe('c1');
      expect(options[0].isAiRanked).toBe(true);
      expect(options[0].label).toBe('Power Classic');

      // Remaining 4 options are filled deterministically from the remaining candidates
      expect(options[1].isAiRanked).toBe(false);
      expect(options[2].isAiRanked).toBe(false);
      expect(options[3].isAiRanked).toBe(false);
      expect(options[4].isAiRanked).toBe(false);

      // All candidate IDs in the returned options are unique
      const uniqueIds = new Set(options.map((o) => o.candidateId));
      expect(uniqueIds.size).toBe(5);
    });

    it('falls back completely to deterministic fill up to target count on AI provider failure', async () => {
      const mockFailingProvider: IAIStylistProvider = {
        analyze: jest.fn(),
        rankCandidates: jest.fn().mockRejectedValue(new Error('Provider timeout after 20s')),
      };

      const options = await rankCandidatesWithAI(testCandidates, intent, wardrobeLookup, mockFailingProvider);

      expect(options).toHaveLength(5);
      for (const opt of options) {
        expect(opt.isAiRanked).toBe(false);
        expect(opt.whyThisWorks.summary.length).toBeGreaterThan(10);
      }
    });
  });

  describe('5. Helper Chip Cardinality & Cross-Group Semantics', () => {
    it('enforces single semantic selection per group and clean replacement on toggle', () => {
      // Step 1: User selected 'Dinner'
      const context1: StyleAdvisorChipContext = { occasion: 'Dinner' };
      const intent1 = parseStylingIntent('', context1, mockWardrobe);
      expect(intent1.selectedOccasion).toBe('Dinner');

      // Step 2: User toggles to 'Work' (replacement, never concatenation)
      const context2: StyleAdvisorChipContext = { occasion: 'Work' };
      const intent2 = parseStylingIntent('', context2, mockWardrobe);
      expect(intent2.selectedOccasion).toBe('Work');
      expect(intent2.selectedOccasion).not.toContain('Dinner');
    });

    it('supports cross-group composition: Dinner + Cool + Polished + Comfortable', () => {
      const crossGroupContext: StyleAdvisorChipContext = {
        occasion: 'Dinner',
        temperature: 'cool',
        vibe: 'polished',
        comfort: true,
      };

      const intent = parseStylingIntent('', crossGroupContext, mockWardrobe);

      expect(intent.selectedOccasion).toBe('Dinner');
      expect(intent.temperatureNeeds).toBe('cool');
      expect(intent.formality).toBe('elevatedCasual'); // 'polished' maps to elevatedCasual
      expect(intent.comfortPriority).toBe(true);
    });
  });

  describe('6. Style Around Lock Removal & Free Wardrobe Exploration', () => {
    it('completely clears lockedWardrobeItemIds and mustUseItemIds when lock is removed', async () => {
      const lockedId = 'outer_1'; // Black Tailored Blazer
      const session = await createStylingSession(
        'Formal meeting',
        null,
        mockWardrobe,
        undefined,
        undefined,
        [lockedId]
      );

      // Verify lock is active
      expect(session.lockedWardrobeItemIds).toContain(lockedId);
      expect(session.intent.mustUseItemIds).toContain(lockedId);

      // Simulate lock removal affordance [✕]
      const unlockedIntent: StylingIntent = {
        ...session.intent,
        mustUseItemIds: (session.intent.mustUseItemIds || []).filter((id) => id !== lockedId),
      };
      const unlockedSession = {
        ...session,
        lockedWardrobeItemIds: [],
        intent: unlockedIntent,
      };

      expect(unlockedSession.lockedWardrobeItemIds).toHaveLength(0);
      expect(unlockedSession.intent.mustUseItemIds).not.toContain(lockedId);

      // Subsequent refinement/regeneration explores wardrobe freely without blazer
      const nextSession = await refineStylingSession(unlockedSession, 'tryAnother');
      expect(nextSession.lockedWardrobeItemIds).toHaveLength(0);
      expect(nextSession.intent.mustUseItemIds || []).not.toContain(lockedId);
    });
  });
});
