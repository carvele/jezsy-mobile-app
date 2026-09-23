import AsyncStorage from '@react-native-async-storage/async-storage';

export type OutfitInteractionType = 'viewed' | 'saved' | 'passed' | 'remixed';

export interface OutfitExposureRecord {
  outfitKey: string;
  itemIds: string[];
  interaction: OutfitInteractionType;
  timestamp: number;
  coreLookKey?: string;
}

/**
 * Computes order-independent core-look exposure identity.
 * Filters out accessory items so an accessory-only variation (e.g. adding or swapping a watch/bag)
 * shares the same core-look identity and does NOT reset user fatigue or pass cooldowns in Phase B.
 */
export function computeCoreLookExposureKey(
  items: { id: string; category?: string | null; garment_type?: string | null; sub_category?: string | null }[]
): string {
  const coreItems = items.filter((item) => {
    const cat = (item.category || item.garment_type || '').toLowerCase();
    const sub = (item.sub_category || '').toLowerCase();
    return cat !== 'accessory' && cat !== 'accessories' && !sub.includes('bag') && !sub.includes('belt');
  });
  return coreItems.map((i) => i.id).sort().join('|');
}

export interface ItemExposureSummary {
  count: number;
  lastPresentedAt: number;
}

export interface LocalExposureHistory {
  userId: string;
  schemaVersion: number;
  recentOutfits: OutfitExposureRecord[];
  itemExposureCounts: Record<string, ItemExposureSummary>;
}

export interface ExposureDiversityConfig {
  viewedPenalty24h: number;
  viewedPenalty7d: number;
  sharedGarmentPenalty: number;
  itemFrequencyDecayWeight: number;
  passCooldownMs: number;
  maxExposureAgeMs: number;
  maxRecentOutfits: number;
  maxTrackedItems: number;
}

export const PROVISIONAL_EXPOSURE_CONFIG: ExposureDiversityConfig = {
  viewedPenalty24h: 15,
  viewedPenalty7d: 5,
  sharedGarmentPenalty: 10,
  itemFrequencyDecayWeight: 2,
  passCooldownMs: 14 * 24 * 60 * 60 * 1000,
  maxExposureAgeMs: 14 * 24 * 60 * 60 * 1000,
  maxRecentOutfits: 100,
  maxTrackedItems: 200,
};

export interface PassiveCandidateSummary {
  key: string;
  itemIds: string[];
  score: number;
  label: string;
  headline?: string;
  reason?: string;
  assessment?: string;
  whyThisWorks?: { summary: string; bullets: string[] };
  isAiRanked?: boolean;
}

export interface PassiveOutfitsCache {
  userId: string;
  schemaVersion: number;
  createdAt: number;
  expiresAt: number;
  wardrobeFingerprint: string;
  candidateSummaries: PassiveCandidateSummary[];
}

export const EXPOSURE_SCHEMA_VERSION = 1;
export const PASSIVE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const getExposureStorageKey = (userId: string) => `@jezsy:exposure_history:${userId}:v1`;
const getPassiveCacheStorageKey = (userId: string) => `@jezsy:passive_outfits:${userId}:v1`;
const getLegacyPassedStorageKey = (userId: string) => `jezsy_wardrobe_passed_suggestions_${userId}`;

function hashStringDjb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16);
}

export class LocalExposureService {
  private inMemoryHistories: Map<string, LocalExposureHistory> = new Map();

  /**
   * Deterministic generation fingerprint for wardrobe state.
   */
  computeWardrobeGenerationFingerprint(
    items: {
      id: string;
      category?: string | null;
      garment_type?: string | null;
      sub_category?: string | null;
      color_tags?: string[] | null;
      wear_count?: number | null;
      last_worn_at?: string | null;
      occasions?: string[] | null;
      seasons?: string[] | null;
    }[]
  ): string {
    const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
    const token = sorted
      .map(
        (i) =>
          `${i.id}|${i.category || ''}|${i.garment_type || ''}|${i.sub_category || ''}|${
            (i.color_tags || []).slice().sort().join(',')
          }|${i.wear_count ?? 0}|${i.last_worn_at || ''}|${
            (i.occasions || []).slice().sort().join(',')
          }|${(i.seasons || []).slice().sort().join(',')}`
      )
      .join(';');
    return hashStringDjb2(token);
  }

  /**
   * Non-destructive migration of legacy passed suggestion keys into v1 ledger.
   * Keeps legacy key intact for rollback safety.
   */
  async migrateLegacyPassedKeysNonDestructive(userId: string): Promise<LocalExposureHistory | null> {
    if (!userId) return null;
    try {
      const legacyRaw = await AsyncStorage.getItem(getLegacyPassedStorageKey(userId));
      if (!legacyRaw) return null;
      const parsed = JSON.parse(legacyRaw);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;

      const now = Date.now();
      const records: OutfitExposureRecord[] = parsed.map((k) => ({
        outfitKey: String(k),
        itemIds: [],
        interaction: 'passed',
        timestamp: now,
      }));

      const migrated: LocalExposureHistory = {
        userId,
        schemaVersion: EXPOSURE_SCHEMA_VERSION,
        recentOutfits: records,
        itemExposureCounts: {},
      };

      await AsyncStorage.setItem(getExposureStorageKey(userId), JSON.stringify(migrated));
      this.inMemoryHistories.set(userId, migrated);
      return migrated;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves exposure history for a user.
   */
  async getExposureHistory(
    userId: string,
    config: ExposureDiversityConfig = PROVISIONAL_EXPOSURE_CONFIG
  ): Promise<LocalExposureHistory> {
    if (!userId) {
      return {
        userId: '',
        schemaVersion: EXPOSURE_SCHEMA_VERSION,
        recentOutfits: [],
        itemExposureCounts: {},
      };
    }

    const inMemory = this.inMemoryHistories.get(userId);
    if (inMemory) {
      return inMemory;
    }

    try {
      const stored = await AsyncStorage.getItem(getExposureStorageKey(userId));
      if (stored) {
        const parsed: LocalExposureHistory = JSON.parse(stored);
        const pruned = this.pruneHistory(parsed, config);
        this.inMemoryHistories.set(userId, pruned);
        return pruned;
      }

      // Check legacy migration
      const migrated = await this.migrateLegacyPassedKeysNonDestructive(userId);
      if (migrated) {
        return migrated;
      }
    } catch {
      // Fallback on storage read error
    }

    const empty: LocalExposureHistory = {
      userId,
      schemaVersion: EXPOSURE_SCHEMA_VERSION,
      recentOutfits: [],
      itemExposureCounts: {},
    };
    this.inMemoryHistories.set(userId, empty);
    return empty;
  }

  /**
   * Logs an outfit presentation ('viewed') for both outfit and individual garments.
   */
  async logPresentation(
    userId: string,
    outfitKey: string,
    itemIds: string[],
    config: ExposureDiversityConfig = PROVISIONAL_EXPOSURE_CONFIG,
    now: number = Date.now(),
    coreLookKey?: string
  ): Promise<void> {
    if (!userId || !outfitKey) return;

    const history = await this.getExposureHistory(userId, config);
    const newRecord: OutfitExposureRecord = {
      outfitKey,
      itemIds: [...itemIds],
      interaction: 'viewed',
      timestamp: now,
      coreLookKey,
    };

    const nextOutfits = [newRecord, ...history.recentOutfits];
    const nextItemCounts = { ...history.itemExposureCounts };

    for (const itemId of itemIds) {
      const prev = nextItemCounts[itemId];
      nextItemCounts[itemId] = {
        count: (prev?.count ?? 0) + 1,
        lastPresentedAt: now,
      };
    }

    const updated: LocalExposureHistory = {
      ...history,
      recentOutfits: nextOutfits,
      itemExposureCounts: nextItemCounts,
    };

    const pruned = this.pruneHistory(updated, config, now);
    this.inMemoryHistories.set(userId, pruned);
    try {
      await AsyncStorage.setItem(getExposureStorageKey(userId), JSON.stringify(pruned));
    } catch {
      // Best effort write
    }
  }

  /**
   * Logs user interaction ('saved' | 'passed' | 'remixed').
   * Dual-writes 'passed' interaction to legacy key for rollback safety.
   */
  async logInteraction(
    userId: string,
    outfitKey: string,
    interaction: OutfitInteractionType,
    itemIds: string[] = [],
    config: ExposureDiversityConfig = PROVISIONAL_EXPOSURE_CONFIG,
    now: number = Date.now(),
    coreLookKey?: string
  ): Promise<void> {
    if (!userId || !outfitKey) return;

    const history = await this.getExposureHistory(userId, config);
    const newRecord: OutfitExposureRecord = {
      outfitKey,
      itemIds: [...itemIds],
      interaction,
      timestamp: now,
      coreLookKey,
    };

    const nextOutfits = [newRecord, ...history.recentOutfits];
    const updated: LocalExposureHistory = {
      ...history,
      recentOutfits: nextOutfits,
    };

    const pruned = this.pruneHistory(updated, config, now);
    this.inMemoryHistories.set(userId, pruned);

    try {
      await AsyncStorage.setItem(getExposureStorageKey(userId), JSON.stringify(pruned));

      // Dual-write 'passed' to legacy storage for backward compatibility and safe rollback
      if (interaction === 'passed') {
        const legacyRaw = await AsyncStorage.getItem(getLegacyPassedStorageKey(userId));
        let legacyKeys: string[] = [];
        if (legacyRaw) {
          try {
            const parsed = JSON.parse(legacyRaw);
            if (Array.isArray(parsed)) legacyKeys = parsed;
          } catch {
            legacyKeys = [];
          }
        }
        if (!legacyKeys.includes(outfitKey)) {
          legacyKeys.push(outfitKey);
          await AsyncStorage.setItem(getLegacyPassedStorageKey(userId), JSON.stringify(legacyKeys));
        }
      }
    } catch {
      // Best effort write
    }
  }

  /**
   * Checks whether outfit is under an active pass or save cooldown.
   * Matches on either exact ensemble outfitKey OR shared coreLookKey so accessory-only
   * variations of a passed/saved core look do not reset user fatigue cooldown.
   */
  isOutfitCooldownActive(
    outfitKey: string,
    history: LocalExposureHistory,
    config: ExposureDiversityConfig = PROVISIONAL_EXPOSURE_CONFIG,
    now: number = Date.now(),
    coreLookKey?: string
  ): boolean {
    for (const record of history.recentOutfits) {
      const match =
        record.outfitKey === outfitKey ||
        (Boolean(coreLookKey) && Boolean(record.coreLookKey) && record.coreLookKey === coreLookKey);
      if (match) {
        if (record.interaction === 'passed' || record.interaction === 'saved') {
          if (now - record.timestamp < config.passCooldownMs) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Calculates diversity penalty based on recent exposure of outfit and its individual pieces.
   */
  calculateExposurePenalty(
    outfitKey: string,
    itemIds: string[],
    history: LocalExposureHistory,
    config: ExposureDiversityConfig = PROVISIONAL_EXPOSURE_CONFIG,
    now: number = Date.now()
  ): number {
    let penalty = 0;

    // 1. Outfit-level recency penalty
    const lastViewed = history.recentOutfits.find(
      (r) => r.outfitKey === outfitKey && r.interaction === 'viewed'
    );
    if (lastViewed) {
      const elapsed = now - lastViewed.timestamp;
      if (elapsed < 24 * 60 * 60 * 1000) {
        penalty += config.viewedPenalty24h;
      } else if (elapsed < 7 * 24 * 60 * 60 * 1000) {
        penalty += config.viewedPenalty7d;
      }
    }

    // 2. Garment-level exposure frequency penalty
    for (const itemId of itemIds) {
      const itemSummary = history.itemExposureCounts[itemId];
      if (itemSummary) {
        penalty += itemSummary.count * config.itemFrequencyDecayWeight;
        if (now - itemSummary.lastPresentedAt < 24 * 60 * 60 * 1000) {
          penalty += config.sharedGarmentPenalty;
        }
      }
    }

    return penalty;
  }

  /**
   * Prunes history to enforce time limits, FIFO bounds, and max tracked items.
   */
  pruneHistory(
    history: LocalExposureHistory,
    config: ExposureDiversityConfig = PROVISIONAL_EXPOSURE_CONFIG,
    now: number = Date.now()
  ): LocalExposureHistory {
    // 1. Filter out outfits older than maxExposureAgeMs
    let validOutfits = history.recentOutfits.filter(
      (r) => now - r.timestamp <= config.maxExposureAgeMs
    );

    // 2. Bound to maxRecentOutfits (keep newest)
    if (validOutfits.length > config.maxRecentOutfits) {
      validOutfits = validOutfits.slice(0, config.maxRecentOutfits);
    }

    // 3. Filter item exposure summaries
    const validItems: Record<string, ItemExposureSummary> = {};
    for (const [id, summary] of Object.entries(history.itemExposureCounts)) {
      if (now - summary.lastPresentedAt <= config.maxExposureAgeMs) {
        validItems[id] = summary;
      }
    }

    // 4. Bound tracked items to maxTrackedItems
    const itemEntries = Object.entries(validItems);
    let boundedItems = validItems;
    if (itemEntries.length > config.maxTrackedItems) {
      itemEntries.sort((a, b) => b[1].lastPresentedAt - a[1].lastPresentedAt);
      boundedItems = Object.fromEntries(itemEntries.slice(0, config.maxTrackedItems));
    }

    return {
      ...history,
      recentOutfits: validOutfits,
      itemExposureCounts: boundedItems,
    };
  }

  /**
   * Purges only in-memory history cache. Never touches persistent storage.
   */
  purgeInMemoryForUser(userId: string): void {
    this.inMemoryHistories.delete(userId);
  }

  /**
   * Deletes persistent storage for test and reset workflows.
   */
  async deletePersistentExposureHistory(userId: string): Promise<void> {
    this.purgeInMemoryForUser(userId);
    try {
      await AsyncStorage.multiRemove([
        getExposureStorageKey(userId),
        getPassiveCacheStorageKey(userId),
      ]);
    } catch {
      // Best effort remove
    }
  }

  /**
   * Retrieves valid passive outfits cache if unexpired and fingerprint matches.
   */
  async getPassiveCache(
    userId: string,
    currentFingerprint?: string,
    now: number = Date.now()
  ): Promise<PassiveOutfitsCache | null> {
    if (!userId) return null;
    try {
      const raw = await AsyncStorage.getItem(getPassiveCacheStorageKey(userId));
      if (!raw) return null;
      const parsed: PassiveOutfitsCache = JSON.parse(raw);
      if (now > parsed.expiresAt) {
        await this.invalidatePassiveCache(userId);
        return null;
      }
      if (currentFingerprint && parsed.wardrobeFingerprint !== currentFingerprint) {
        await this.invalidatePassiveCache(userId);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Stores passive outfits cache.
   */
  async setPassiveCache(userId: string, cache: PassiveOutfitsCache): Promise<void> {
    if (!userId) return;
    try {
      await AsyncStorage.setItem(getPassiveCacheStorageKey(userId), JSON.stringify(cache));
    } catch {
      // Best effort cache write
    }
  }

  /**
   * Invalidates passive cache for user.
   */
  async invalidatePassiveCache(userId: string): Promise<void> {
    if (!userId) return;
    try {
      await AsyncStorage.removeItem(getPassiveCacheStorageKey(userId));
    } catch {
      // Best effort remove
    }
  }
}

export const localExposureService = new LocalExposureService();
