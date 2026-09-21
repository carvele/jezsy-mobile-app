import { parseStylingIntent } from '../intentParser';
import { generateCandidateOutfits } from '../candidateGenerator';
import { rankCandidatesWithAI } from '../aiCandidateRanker';
import { applyDiversityScoring, createStylingSession, refineStylingSession } from '../stylingSessionService';
import { WardrobeItem, CandidateOutfit, StylingIntent } from '@/src/types/styleAdvisor';
import { IAIStylistProvider } from '../../aiStylistProvider';

function makeMockWardrobeItem(partial: Partial<WardrobeItem> & { id: string; category: string }): WardrobeItem {
  return {
    id: partial.id,
    user_id: 'user_1',
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
  makeMockWardrobeItem({ id: 'top_2', category: 'Top', sub_category: 'White Linen Shirt', color_tags: ['White'], wear_count: 0 }),
  makeMockWardrobeItem({ id: 'top_3', category: 'Top', sub_category: 'Red T-Shirt', color_tags: ['Red'] }),
  makeMockWardrobeItem({ id: 'bottom_1', category: 'Bottom', sub_category: 'Black Slacks', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'bottom_2', category: 'Bottom', sub_category: 'Blue Jeans', color_tags: ['Blue'] }),
  makeMockWardrobeItem({ id: 'dress_1', category: 'Dress', sub_category: 'Navy Wrap Dress', color_tags: ['Navy'] }),
  makeMockWardrobeItem({ id: 'shoes_1', category: 'Shoes', sub_category: 'Black Loafers', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'shoes_2', category: 'Shoes', sub_category: 'White Sneakers', color_tags: ['White'] }),
  makeMockWardrobeItem({ id: 'outer_1', category: 'Outerwear', sub_category: 'Black Tailored Blazer', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'outer_2', category: 'Outerwear', sub_category: 'Denim Jacket', color_tags: ['Blue'] }),
];

describe('Style Advisor AI Overhaul - Domain Layer', () => {
  describe('1. Natural Language Intent Parsing', () => {
    test('parses free-text styling prompt and extracts occasion and formality', () => {
      const intent = parseStylingIntent(
        'I need something formal for dinner with clients',
        null,
        mockWardrobe
      );

      expect(intent.formality).toBe('formal');
      expect(intent.rawPrompt).toContain('formal for dinner with clients');
      expect(intent.conflictingConstraints).toBeUndefined();
    });

    test('extracts must-use piece referenced in user text', () => {
      const intent = parseStylingIntent(
        'Please use my black blazer and style me for a presentation',
        'Work',
        mockWardrobe
      );

      expect(intent.mustUseItemIds).toContain('outer_1');
      expect(intent.selectedOccasion).toBe('Work');
    });

    test('extracts avoided colors', () => {
      const intent = parseStylingIntent(
        'Dinner date, avoid red and no navy',
        'Date Night',
        mockWardrobe
      );

      expect(intent.avoidedColors).toContain('red');
      expect(intent.avoidedColors).toContain('navy');
    });

    test('detects direct contradictions and reports conflict without crashing', () => {
      const intent = parseStylingIntent(
        'All black outfit tonight but avoid black',
        null,
        mockWardrobe
      );

      expect(intent.conflictingConstraints).toBeDefined();
      expect(intent.conflictingConstraints?.[0]).toMatch(/contradictory color/i);
    });
  });

  describe('2. Wardrobe-Grounded Candidate Generation', () => {
    test('all generated candidate outfits contain only real IDs from the user wardrobe', () => {
      const intent = parseStylingIntent('Client dinner', 'Dinner', mockWardrobe);
      const candidates = generateCandidateOutfits(mockWardrobe, intent, { limit: 10 });

      expect(candidates.length).toBeGreaterThan(0);
      const wardrobeIds = new Set(mockWardrobe.map((w) => w.id));

      for (const cand of candidates) {
        expect(cand.items.length).toBeGreaterThanOrEqual(1);
        for (const it of cand.items) {
          expect(wardrobeIds.has(it.id)).toBe(true);
        }
      }
    });

    test('strictly enforces must-use item across all candidates', () => {
      const intent: StylingIntent = {
        rawPrompt: 'Use my black blazer',
        mustUseItemIds: ['outer_1'],
        formality: 'elevatedCasual',
      };

      const candidates = generateCandidateOutfits(mockWardrobe, intent, { limit: 5 });
      expect(candidates.length).toBeGreaterThan(0);

      for (const cand of candidates) {
        const itemIds = cand.items.map((i) => i.id);
        expect(itemIds).toContain('outer_1');
      }
    });

    test('strictly respects excluded colors and items', () => {
      const intent: StylingIntent = {
        rawPrompt: 'Avoid red',
        avoidedColors: ['red'],
        excludedItemIds: ['bottom_2'], // exclude blue jeans
      };

      const candidates = generateCandidateOutfits(mockWardrobe, intent, { limit: 5 });
      for (const cand of candidates) {
        const itemIds = cand.items.map((i) => i.id);
        expect(itemIds).not.toContain('top_3'); // top_3 is red
        expect(itemIds).not.toContain('bottom_2'); // bottom_2 was excluded
      }
    });
  });

  describe('3. AI Candidate Ranking & Grounding Validation', () => {
    test('validates candidateId grounding and rejects hallucinated candidate IDs', async () => {
      const intent: StylingIntent = { rawPrompt: 'Formal presentation', formality: 'formal' };
      const candidates = generateCandidateOutfits(mockWardrobe, intent, { limit: 5 });

      const mockProvider: IAIStylistProvider = {
        analyze: jest.fn(),
        rankCandidates: jest.fn().mockResolvedValue({
          success: true,
          recommendations: [
            {
              candidateId: 'hallucinated_candidate_999', // invalid candidate ID
              label: 'Fake',
              headline: 'Fake Headline',
              intentMatch: 'Fake match',
              whyThisWorks: { summary: 'Fake valid summary text for testing', palette: 'P', silhouette: 'S', occasion: 'O' },
            },
            {
              candidateId: candidates[0].candidateId, // valid candidate ID
              label: 'Polished',
              headline: 'Tailored Slacks and Blouse',
              intentMatch: 'Matches your formal presentation goals.',
              whyThisWorks: {
                summary: 'Structured black slacks with a refined silk blouse.',
                palette: 'Monochrome black.',
                silhouette: 'Tailored vertical line.',
                occasion: 'Appropriate for business.',
              },
              proTip: 'Push sleeves up slightly.',
            },
          ],
        }),
      };

      const wardrobeLookup = Object.fromEntries(mockWardrobe.map((w) => [w.id, w]));
      const options = await rankCandidatesWithAI(candidates, intent, wardrobeLookup, mockProvider);

      expect(options.length).toBeGreaterThan(0);
      // The hallucinated candidate must be rejected; valid candidate accepted
      expect(options[0].candidateId).toBe(candidates[0].candidateId);
      expect(options[0].label).toBe('Polished');
      expect(options[0].isAiRanked).toBe(true);
    });

    test('rejects generic filler boilerplate from AI responses and falls back cleanly', async () => {
      const intent: StylingIntent = { rawPrompt: 'Casual day', formality: 'casual' };
      const candidates = generateCandidateOutfits(mockWardrobe, intent, { limit: 3 });

      const mockProvider: IAIStylistProvider = {
        analyze: jest.fn(),
        rankCandidates: jest.fn().mockResolvedValue({
          success: true,
          recommendations: [
            {
              candidateId: candidates[0].candidateId,
              label: 'Casual',
              headline: 'casual everyday outfit', // banned phrase!
              intentMatch: 'Matches your request.',
              whyThisWorks: {
                summary: 'the pieces create a relaxed, wearable outfit for daily use', // banned phrase!
                palette: 'Neutral',
                silhouette: 'Relaxed',
                occasion: 'Casual',
              },
            },
          ],
        }),
      };

      const wardrobeLookup = Object.fromEntries(mockWardrobe.map((w) => [w.id, w]));
      const options = await rankCandidatesWithAI(candidates, intent, wardrobeLookup, mockProvider);

      // Generic filler is rejected; deterministic grounded explainer is used instead
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].whyThisWorks.summary).not.toMatch(/casual everyday outfit/i);
    });

    test('falls back gracefully to deterministic ranking when AI provider fails or times out', async () => {
      const intent: StylingIntent = { rawPrompt: 'Work meeting', formality: 'elevatedCasual' };
      const candidates = generateCandidateOutfits(mockWardrobe, intent, { limit: 3 });

      const failingProvider: IAIStylistProvider = {
        analyze: jest.fn(),
        rankCandidates: jest.fn().mockRejectedValue(new Error('Network timeout')),
      };

      const wardrobeLookup = Object.fromEntries(mockWardrobe.map((w) => [w.id, w]));
      const options = await rankCandidatesWithAI(candidates, intent, wardrobeLookup, failingProvider);

      expect(options.length).toBeGreaterThan(0);
      expect(options[0].isAiRanked).toBe(false);
      expect(options[0].whyThisWorks.summary.length).toBeGreaterThan(10);
    });
  });

  describe('4. Diversity Scoring & Interactive Refinements', () => {
    test('diversity scoring penalizes exact previous outfit by 100 points', () => {
      const candA: CandidateOutfit = {
        candidateId: 'cand_a',
        items: [mockWardrobe[0], mockWardrobe[3]],
        key: 'bottom_1|top_1',
        baseScore: 90,
        colorMatchLabel: 'Great Match',
        formalityLevel: 'formal',
        hasDress: false,
        hasShoes: false,
        hasOuterwear: false,
      };

      const candB: CandidateOutfit = {
        candidateId: 'cand_b',
        items: [mockWardrobe[1], mockWardrobe[4]],
        key: 'bottom_2|top_2',
        baseScore: 85,
        colorMatchLabel: 'Great Match',
        formalityLevel: 'casual',
        hasDress: false,
        hasShoes: false,
        hasOuterwear: false,
      };

      const seen = new Set<string>(['bottom_1|top_1']); // candA already seen
      const mustUse = new Set<string>();

      const scored = applyDiversityScoring([candA, candB], seen, mustUse);

      // candB should now rank first because candA received -100 penalty
      expect(scored[0].candidateId).toBe('cand_b');
    });

    test('must-use item is exempt from overlap penalties', () => {
      const candA: CandidateOutfit = {
        candidateId: 'cand_a',
        items: [mockWardrobe[8], mockWardrobe[0]], // outer_1 (must-use) + top_1
        key: 'outer_1|top_1',
        baseScore: 88,
        colorMatchLabel: 'Great Match',
        formalityLevel: 'formal',
        hasDress: false,
        hasShoes: false,
        hasOuterwear: true,
      };

      const seen = new Set<string>(['bottom_1|outer_1']);
      const mustUse = new Set<string>(['outer_1']); // outer_1 is must-use

      const scored = applyDiversityScoring([candA], seen, mustUse);
      // Overlap on outer_1 is ignored because it's must-use
      expect(scored[0].baseScore).toBe(88);
    });

    test('refining with moreFormal elevates formality constraint and regenerates', async () => {
      const session = await createStylingSession('Casual meeting', 'Casual', mockWardrobe);
      expect(session.options.length).toBeGreaterThan(0);

      const refined = await refineStylingSession(session, 'moreFormal');
      expect(refined.intent.formality).toBe('elevatedCasual');
      expect(refined.options.length).toBeGreaterThan(0);
    });

    test('refining with tryAnother diversifies recommendations using seen history', async () => {
      const session = await createStylingSession('Dinner look', 'Dinner', mockWardrobe);
      const initialKeys = session.options.map((o) => o.key);

      const nextSession = await refineStylingSession(session, 'tryAnother');
      expect(nextSession.seenOutfitKeys.size).toBeGreaterThanOrEqual(initialKeys.length);
    });
  });

  describe('5. Sparse Wardrobe & Edge States', () => {
    test('returns clean error state when wardrobe is completely empty', async () => {
      const session = await createStylingSession('Dinner with friends', null, []);
      expect(session.options).toHaveLength(0);
      expect(session.error).toMatch(/no viable outfit/i);
    });

    test('returns clean error state when prompt contains direct contradictions', async () => {
      const session = await createStylingSession('All black but avoid black', null, mockWardrobe);
      expect(session.options).toHaveLength(0);
      expect(session.error).toMatch(/contradictory/i);
    });
  });
});
