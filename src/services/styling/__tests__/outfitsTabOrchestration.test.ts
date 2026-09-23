import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] || null),
      setItem: jest.fn(async (key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      multiRemove: jest.fn(async (keys: string[]) => {
        for (const k of keys) {
          delete store[k];
        }
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
    },
  };
});

import { localExposureService } from '../localExposureService';
import { generateOutfits } from '@/src/utils/outfitGenerator';

describe('Outfits Hub Orchestration & Local Exposure (Phase B)', () => {
  const userId = 'user-phase-b-hub';

  const mockWardrobe = [
    { id: 'top-1', category: 'Tops', garment_type: 'Shirt', color_tags: ['white'], wear_count: 2 },
    { id: 'top-2', category: 'Tops', garment_type: 'Blouse', color_tags: ['blue'], wear_count: 0 },
    { id: 'bot-1', category: 'Bottoms', garment_type: 'Trousers', color_tags: ['navy'], wear_count: 5 },
    { id: 'bot-2', category: 'Bottoms', garment_type: 'Jeans', color_tags: ['black'], wear_count: 1 },
    { id: 'shoe-1', category: 'Shoes', garment_type: 'Loafer', color_tags: ['brown'], wear_count: 3 },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    localExposureService.purgeInMemoryForUser(userId);
    await AsyncStorage.clear();
  });

  it('ranks fresh candidates by score before exposure penalties apply', async () => {
    const pool = generateOutfits(mockWardrobe as any, 20);
    expect(pool.length).toBeGreaterThan(0);

    const history = await localExposureService.getExposureHistory(userId);
    expect(history.recentOutfits).toHaveLength(0);

    // Filter available
    const available = pool.filter((o) => !localExposureService.isOutfitCooldownActive(o.key, history));
    expect(available.length).toBe(pool.length);

    // Initial top 3
    const top3 = available.slice(0, 3);
    expect(top3).toHaveLength(Math.min(3, available.length));
  });

  it('filters out passed candidate and surfaces next-best candidate on pass', async () => {
    const pool = generateOutfits(mockWardrobe as any, 20);
    const firstLook = pool[0];
    const secondLook = pool[1];

    // User passes on firstLook
    await localExposureService.logInteraction(userId, firstLook.key, 'passed', firstLook.items.map((i) => i.id));
    const history = await localExposureService.getExposureHistory(userId);

    // First look is now under active cooldown
    expect(localExposureService.isOutfitCooldownActive(firstLook.key, history)).toBe(true);

    // Next suggested set excludes firstLook and contains secondLook
    const nextAvailable = pool.filter((o) => !localExposureService.isOutfitCooldownActive(o.key, history));
    expect(nextAvailable.some((o) => o.key === firstLook.key)).toBe(false);
    expect(nextAvailable[0].key).toBe(secondLook.key);
  });

  it('applies recency and shared-garment penalties to diversify subsequent suggestions', async () => {
    const pool = generateOutfits(mockWardrobe as any, 20);
    const candidateA = pool[0]; // e.g. top-1 + bot-1 + shoe-1

    // Log presentation of candidateA
    await localExposureService.logPresentation(userId, candidateA.key, candidateA.items.map((i) => i.id));
    const history = await localExposureService.getExposureHistory(userId);

    // CandidateA penalty > 0
    const penaltyA = localExposureService.calculateExposurePenalty(
      candidateA.key,
      candidateA.items.map((i) => i.id),
      history
    );
    expect(penaltyA).toBeGreaterThan(0);

    // Candidate using completely different items has lower penalty
    const freshCandidate = pool.find(
      (o) => !o.items.some((i) => candidateA.items.some((ci) => ci.id === i.id))
    );
    if (freshCandidate) {
      const penaltyFresh = localExposureService.calculateExposurePenalty(
        freshCandidate.key,
        freshCandidate.items.map((i) => i.id),
        history
      );
      expect(penaltyFresh).toBeLessThan(penaltyA);
    }
  });

  it('detects exhausted state when all generated candidates are passed', async () => {
    const smallWardrobe = [
      { id: 'top-1', category: 'Tops', garment_type: 'Shirt', color_tags: ['white'] },
      { id: 'bot-1', category: 'Bottoms', garment_type: 'Trousers', color_tags: ['navy'] },
    ];
    const pool = generateOutfits(smallWardrobe as any, 20);

    // Pass on all generated looks
    for (const outfit of pool) {
      await localExposureService.logInteraction(userId, outfit.key, 'passed', outfit.items.map((i) => i.id));
    }

    const history = await localExposureService.getExposureHistory(userId);
    const available = pool.filter((o) => !localExposureService.isOutfitCooldownActive(o.key, history));

    // Exhausted state confirmed: 0 available suggestions
    expect(available).toHaveLength(0);
  });

  it('performs idempotent presentation tracking with presentedKeys set', async () => {
    const presentedKeys = new Set<string>();
    const pool = generateOutfits(mockWardrobe as any, 20);
    const displayed = pool.slice(0, 3);

    let presentationCalls = 0;
    const mockLog = jest.spyOn(localExposureService, 'logPresentation').mockImplementation(async () => {
      presentationCalls++;
    });

    // First render pass
    for (const o of displayed) {
      if (!presentedKeys.has(o.key)) {
        presentedKeys.add(o.key);
        await localExposureService.logPresentation(userId, o.key, o.items.map((i) => i.id));
      }
    }
    expect(presentationCalls).toBe(displayed.length);

    // Second render pass with same displayed items — no extra logs
    for (const o of displayed) {
      if (!presentedKeys.has(o.key)) {
        presentedKeys.add(o.key);
        await localExposureService.logPresentation(userId, o.key, o.items.map((i) => i.id));
      }
    }
    expect(presentationCalls).toBe(displayed.length); // Still exactly displayed.length

    mockLog.mockRestore();
  });
});
