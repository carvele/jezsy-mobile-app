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

import {
  localExposureService,
  PROVISIONAL_EXPOSURE_CONFIG,
  EXPOSURE_SCHEMA_VERSION,
  PASSIVE_CACHE_TTL_MS,
  LocalExposureHistory,
  PassiveOutfitsCache,
} from '../localExposureService';

describe('LocalExposureService (Phase B)', () => {
  const userId = 'user-test-phase-b';

  beforeEach(async () => {
    jest.clearAllMocks();
    localExposureService.purgeInMemoryForUser(userId);
    await AsyncStorage.clear();
  });

  describe('Configuration invariants', () => {
    it('enforces passCooldownMs <= maxExposureAgeMs', () => {
      expect(PROVISIONAL_EXPOSURE_CONFIG.passCooldownMs).toBeLessThanOrEqual(
        PROVISIONAL_EXPOSURE_CONFIG.maxExposureAgeMs
      );
    });

    it('has valid positive penalty and bounding constants', () => {
      expect(PROVISIONAL_EXPOSURE_CONFIG.viewedPenalty24h).toBeGreaterThan(0);
      expect(PROVISIONAL_EXPOSURE_CONFIG.viewedPenalty7d).toBeGreaterThan(0);
      expect(PROVISIONAL_EXPOSURE_CONFIG.sharedGarmentPenalty).toBeGreaterThan(0);
      expect(PROVISIONAL_EXPOSURE_CONFIG.itemFrequencyDecayWeight).toBeGreaterThan(0);
      expect(PROVISIONAL_EXPOSURE_CONFIG.maxRecentOutfits).toBeGreaterThan(0);
      expect(PROVISIONAL_EXPOSURE_CONFIG.maxTrackedItems).toBeGreaterThan(0);
    });
  });

  describe('Deterministic Wardrobe Fingerprint', () => {
    const itemA = {
      id: 'item-1',
      category: 'Tops',
      garment_type: 'Shirt',
      sub_category: 'Button-down',
      color_tags: ['white', 'cotton'],
      wear_count: 2,
      last_worn_at: '2026-09-01T00:00:00Z',
      occasions: ['work', 'casual'],
      seasons: ['all'],
    };

    const itemB = {
      id: 'item-2',
      category: 'Bottoms',
      garment_type: 'Trousers',
      sub_category: 'Chino',
      color_tags: ['navy'],
      wear_count: 5,
      last_worn_at: '2026-09-10T00:00:00Z',
      occasions: ['work'],
      seasons: ['all'],
    };

    it('produces identical fingerprints regardless of array order', () => {
      const fp1 = localExposureService.computeWardrobeGenerationFingerprint([itemA, itemB]);
      const fp2 = localExposureService.computeWardrobeGenerationFingerprint([itemB, itemA]);
      expect(fp1).toBe(fp2);
      expect(typeof fp1).toBe('string');
      expect(fp1.length).toBeGreaterThan(0);
    });

    it('produces different fingerprints when item attributes change', () => {
      const fpBase = localExposureService.computeWardrobeGenerationFingerprint([itemA, itemB]);
      const modifiedA = { ...itemA, wear_count: 3 };
      const fpModified = localExposureService.computeWardrobeGenerationFingerprint([modifiedA, itemB]);
      expect(fpBase).not.toBe(fpModified);
    });

    it('produces different fingerprints when items are added or removed', () => {
      const fpPair = localExposureService.computeWardrobeGenerationFingerprint([itemA, itemB]);
      const fpSingle = localExposureService.computeWardrobeGenerationFingerprint([itemA]);
      expect(fpPair).not.toBe(fpSingle);
    });
  });

  describe('Legacy migration & Non-destructive rollback safety', () => {
    it('migrates legacy passed keys into v1 ledger without deleting legacy key', async () => {
      const legacyKey = `jezsy_wardrobe_passed_suggestions_${userId}`;
      const legacyPassed = ['outfit-key-1', 'outfit-key-2'];
      await AsyncStorage.setItem(legacyKey, JSON.stringify(legacyPassed));

      const history = await localExposureService.getExposureHistory(userId);
      expect(history.recentOutfits).toHaveLength(2);
      expect(history.recentOutfits.map((r) => r.outfitKey)).toEqual(['outfit-key-1', 'outfit-key-2']);
      expect(history.recentOutfits.every((r) => r.interaction === 'passed')).toBe(true);

      // Verify legacy key remains intact for safe rollback
      const legacyStillThere = await AsyncStorage.getItem(legacyKey);
      expect(legacyStillThere).not.toBeNull();
      expect(JSON.parse(legacyStillThere!)).toEqual(legacyPassed);
    });

    it('dual-writes passed suggestions to legacy key for backward compatibility', async () => {
      await localExposureService.logInteraction(userId, 'outfit-pass-xyz', 'passed', ['item-1', 'item-2']);

      const legacyKey = `jezsy_wardrobe_passed_suggestions_${userId}`;
      const legacyRaw = await AsyncStorage.getItem(legacyKey);
      expect(legacyRaw).not.toBeNull();
      const legacyParsed = JSON.parse(legacyRaw!);
      expect(legacyParsed).toContain('outfit-pass-xyz');
    });

    it('does not write saved or remixed to legacy passed key', async () => {
      await localExposureService.logInteraction(userId, 'outfit-saved-abc', 'saved', ['item-1']);
      const legacyKey = `jezsy_wardrobe_passed_suggestions_${userId}`;
      const legacyRaw = await AsyncStorage.getItem(legacyKey);
      expect(legacyRaw).toBeNull();
    });
  });

  describe('Presentation logging & Bounded Exposure', () => {
    it('logs presentation and increments per-item counts', async () => {
      await localExposureService.logPresentation(userId, 'outfit-1', ['item-a', 'item-b']);
      const history = await localExposureService.getExposureHistory(userId);

      expect(history.recentOutfits).toHaveLength(1);
      expect(history.recentOutfits[0].outfitKey).toBe('outfit-1');
      expect(history.recentOutfits[0].interaction).toBe('viewed');
      expect(history.itemExposureCounts['item-a'].count).toBe(1);
      expect(history.itemExposureCounts['item-b'].count).toBe(1);

      // Log again with shared garment item-a
      await localExposureService.logPresentation(userId, 'outfit-2', ['item-a', 'item-c']);
      const history2 = await localExposureService.getExposureHistory(userId);

      expect(history2.recentOutfits).toHaveLength(2);
      expect(history2.itemExposureCounts['item-a'].count).toBe(2);
      expect(history2.itemExposureCounts['item-b'].count).toBe(1);
      expect(history2.itemExposureCounts['item-c'].count).toBe(1);
    });

    it('bounds history to maxRecentOutfits via FIFO pruning', async () => {
      const config = { ...PROVISIONAL_EXPOSURE_CONFIG, maxRecentOutfits: 3 };
      const now = 1000000;

      for (let i = 1; i <= 5; i++) {
        await localExposureService.logPresentation(userId, `outfit-${i}`, [`item-${i}`], config, now + i * 1000);
      }

      const history = await localExposureService.getExposureHistory(userId, config);
      expect(history.recentOutfits).toHaveLength(3);
      expect(history.recentOutfits.map((r) => r.outfitKey)).toEqual(['outfit-5', 'outfit-4', 'outfit-3']);
    });

    it('prunes items and outfits exceeding maxExposureAgeMs', async () => {
      const now = Date.now();
      const expiredTime = now - (PROVISIONAL_EXPOSURE_CONFIG.maxExposureAgeMs + 1000);

      const staleHistory: LocalExposureHistory = {
        userId,
        schemaVersion: EXPOSURE_SCHEMA_VERSION,
        recentOutfits: [
          { outfitKey: 'stale-1', itemIds: ['item-old'], interaction: 'viewed', timestamp: expiredTime },
          { outfitKey: 'fresh-1', itemIds: ['item-new'], interaction: 'viewed', timestamp: now },
        ],
        itemExposureCounts: {
          'item-old': { count: 3, lastPresentedAt: expiredTime },
          'item-new': { count: 1, lastPresentedAt: now },
        },
      };

      const pruned = localExposureService.pruneHistory(staleHistory, PROVISIONAL_EXPOSURE_CONFIG, now);
      expect(pruned.recentOutfits).toHaveLength(1);
      expect(pruned.recentOutfits[0].outfitKey).toBe('fresh-1');
      expect(pruned.itemExposureCounts['item-old']).toBeUndefined();
      expect(pruned.itemExposureCounts['item-new']).toBeDefined();
    });

    it('bounds tracked items to maxTrackedItems', async () => {
      const now = Date.now();
      const config = { ...PROVISIONAL_EXPOSURE_CONFIG, maxTrackedItems: 2 };

      const wideHistory: LocalExposureHistory = {
        userId,
        schemaVersion: EXPOSURE_SCHEMA_VERSION,
        recentOutfits: [],
        itemExposureCounts: {
          'item-1': { count: 1, lastPresentedAt: now - 3000 },
          'item-2': { count: 1, lastPresentedAt: now - 1000 }, // newest
          'item-3': { count: 1, lastPresentedAt: now - 2000 }, // second newest
        },
      };

      const pruned = localExposureService.pruneHistory(wideHistory, config, now);
      const keys = Object.keys(pruned.itemExposureCounts);
      expect(keys).toHaveLength(2);
      expect(keys).toContain('item-2');
      expect(keys).toContain('item-3');
      expect(keys).not.toContain('item-1');
    });
  });

  describe('Cooldown and Diversity Scoring', () => {
    it('detects active cooldown for passed outfits', async () => {
      const now = Date.now();
      const history: LocalExposureHistory = {
        userId,
        schemaVersion: EXPOSURE_SCHEMA_VERSION,
        recentOutfits: [
          { outfitKey: 'outfit-passed', itemIds: ['1'], interaction: 'passed', timestamp: now - 1000 },
        ],
        itemExposureCounts: {},
      };

      expect(localExposureService.isOutfitCooldownActive('outfit-passed', history, PROVISIONAL_EXPOSURE_CONFIG, now)).toBe(true);
      expect(localExposureService.isOutfitCooldownActive('outfit-other', history, PROVISIONAL_EXPOSURE_CONFIG, now)).toBe(false);

      // Cooldown expired
      const expiredNow = now + PROVISIONAL_EXPOSURE_CONFIG.passCooldownMs + 1000;
      expect(localExposureService.isOutfitCooldownActive('outfit-passed', history, PROVISIONAL_EXPOSURE_CONFIG, expiredNow)).toBe(false);
    });

    it('calculates recency and item frequency decay penalties correctly', () => {
      const now = Date.now();
      const history: LocalExposureHistory = {
        userId,
        schemaVersion: EXPOSURE_SCHEMA_VERSION,
        recentOutfits: [
          { outfitKey: 'outfit-recent', itemIds: ['item-1', 'item-2'], interaction: 'viewed', timestamp: now - (2 * 60 * 60 * 1000) }, // 2h ago
        ],
        itemExposureCounts: {
          'item-1': { count: 2, lastPresentedAt: now - (2 * 60 * 60 * 1000) }, // 2h ago
          'item-2': { count: 1, lastPresentedAt: now - (2 * 60 * 60 * 1000) },
        },
      };

      const penalty = localExposureService.calculateExposurePenalty(
        'outfit-recent',
        ['item-1', 'item-2'],
        history,
        PROVISIONAL_EXPOSURE_CONFIG,
        now
      );

      // Expected:
      // viewedPenalty24h = 15
      // item-1: 2 * 2 (freq) + 10 (shared < 24h) = 14
      // item-2: 1 * 2 (freq) + 10 (shared < 24h) = 12
      // Total = 15 + 14 + 12 = 41
      expect(penalty).toBe(15 + (2 * 2 + 10) + (1 * 2 + 10));
    });

    it('returns zero penalty for completely fresh outfit and items', () => {
      const history: LocalExposureHistory = {
        userId,
        schemaVersion: EXPOSURE_SCHEMA_VERSION,
        recentOutfits: [],
        itemExposureCounts: {},
      };

      const penalty = localExposureService.calculateExposurePenalty('brand-new', ['x', 'y'], history);
      expect(penalty).toBe(0);
    });
  });

  describe('Passive Outfits Cache', () => {
    const mockCache: PassiveOutfitsCache = {
      userId,
      schemaVersion: 1,
      createdAt: Date.now(),
      expiresAt: Date.now() + PASSIVE_CACHE_TTL_MS,
      wardrobeFingerprint: 'fp-12345',
      candidateSummaries: [
        { key: 'outfit-1', itemIds: ['1', '2'], score: 92, label: 'Perfect Harmony' },
      ],
    };

    it('stores and retrieves passive cache with valid fingerprint', async () => {
      await localExposureService.setPassiveCache(userId, mockCache);
      const retrieved = await localExposureService.getPassiveCache(userId, 'fp-12345');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.candidateSummaries).toHaveLength(1);
      expect(retrieved?.candidateSummaries[0].key).toBe('outfit-1');
    });

    it('invalidates cache when fingerprint mismatches', async () => {
      await localExposureService.setPassiveCache(userId, mockCache);
      const retrieved = await localExposureService.getPassiveCache(userId, 'fp-different');
      expect(retrieved).toBeNull();

      // Subsequent read should also be null because it was invalidated
      const again = await localExposureService.getPassiveCache(userId);
      expect(again).toBeNull();
    });

    it('invalidates cache when expired', async () => {
      const expiredCache = { ...mockCache, expiresAt: Date.now() - 1000 };
      await localExposureService.setPassiveCache(userId, expiredCache);

      const retrieved = await localExposureService.getPassiveCache(userId, 'fp-12345');
      expect(retrieved).toBeNull();
    });
  });
});
