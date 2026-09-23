import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { supabase } from '@/src/lib/supabase';
import {
  StyleDnaProfile,
  StylePreferenceEvent,
  StylePreferenceEventType,
  SyncStyleDnaResponse,
  ExplicitSettingKey,
  ExplicitSettingAction,
  ExplicitFeedbackKind,
} from '../../types/dto/styleProfile';
import { aggregateStyleDnaLocally } from '../../utils/personalStyleEngine';

const QUEUE_STORAGE_PREFIX = '@jezsy:style_events_queue:';
const PROFILE_STORAGE_PREFIX = '@jezsy:style_dna_profile:';
const DEAD_LETTER_PREFIX = '@jezsy:style_dead_letter:';
const MAX_BATCH_SIZE = 50;
const MAX_DEAD_LETTER_ENTRIES = 50;

/**
 * Manages the client-side lifecycle of Persistent Style DNA:
 * - Appends preference events to an offline per-user queue.
 * - Computes optimistic local projections with exact PostgreSQL parity.
 * - Flushes queued events to the server-authoritative sync RPC.
 * - Handles idempotent acknowledgements, duplicate detection, and dead-letter isolation.
 * - Provides absolute account-switch memory isolation.
 */
class StyleDnaSyncManager {
  private activeUserId: string | null = null;
  private inMemoryProfile: StyleDnaProfile | null = null;
  private syncInProgress: boolean = false;
  private syncTimeout: NodeJS.Timeout | null = null;

  /**
   * Sets the active authenticated user and loads their cached profile.
   */
  public async setActiveUser(userId: string | null): Promise<void> {
    if (this.activeUserId === userId) return;

    // Purge previous user's in-memory state to guarantee account isolation
    this.activeUserId = userId;
    this.inMemoryProfile = null;

    if (userId) {
      await this.getProfile(userId);
      this.scheduleSync(userId);
    }
  }

  /**
   * Purges all in-memory state on sign out.
   * Best effort sync attempt if network is available.
   */
  public async handleSignOut(): Promise<void> {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    this.activeUserId = null;
    this.inMemoryProfile = null;
  }

  /**
   * Retrieves the current user's Style DNA profile.
   * Priority: In-Memory -> Local AsyncStorage -> Default Baseline.
   */
  public async getProfile(userId: string): Promise<StyleDnaProfile> {
    if (this.inMemoryProfile && this.activeUserId === userId) {
      return this.inMemoryProfile;
    }

    const cacheKey = `${PROFILE_STORAGE_PREFIX}${userId}`;
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as StyleDnaProfile;
        if (this.activeUserId === userId) {
          this.inMemoryProfile = parsed;
        }
        return parsed;
      }
    } catch {
      // Ignore read error; fall back to baseline
    }

    const baseline: StyleDnaProfile = {
      userId,
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.0,
      eventCount: 0,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    if (this.activeUserId === userId) {
      this.inMemoryProfile = baseline;
    }
    return baseline;
  }

  /**
   * Enqueues a preference event with a client-generated UUID,
   * updates the local projection optimistically, and schedules a remote sync.
   */
  public async recordEvent(
    userId: string,
    eventType: StylePreferenceEventType,
    payload: Record<string, unknown>,
    preferenceActionId?: string | null
  ): Promise<StylePreferenceEvent> {
    const event: StylePreferenceEvent = {
      id: randomUUID(),
      userId,
      eventSchemaVersion: 1,
      eventType,
      preferenceActionId: preferenceActionId || null,
      payload,
      clientTimestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const queueKey = `${QUEUE_STORAGE_PREFIX}${userId}`;
    let queue: StylePreferenceEvent[] = [];
    try {
      const raw = await AsyncStorage.getItem(queueKey);
      if (raw) queue = JSON.parse(raw);
    } catch {
      queue = [];
    }

    queue.push(event);
    await AsyncStorage.setItem(queueKey, JSON.stringify(queue));

    // Update optimistic local profile
    const currentProfile = await this.getProfile(userId);
    const updated = aggregateStyleDnaLocally(userId, queue, new Date(), currentProfile);
    this.inMemoryProfile = updated;
    await AsyncStorage.setItem(`${PROFILE_STORAGE_PREFIX}${userId}`, JSON.stringify(updated));

    this.scheduleSync(userId);
    return event;
  }

  /**
   * Helper to record an ensemble wear event (one event per wear action).
   */
  public async recordWearOutfit(
    userId: string,
    outfitId: string | null,
    itemIds: string[],
    aestheticTokens: {
      palette?: string[];
      silhouettes?: string[];
      formality?: string[];
      accessories?: string[];
    }
  ): Promise<StylePreferenceEvent> {
    return this.recordEvent(userId, 'wear_outfit', {
      outfit_id: outfitId,
      item_ids: itemIds,
      palette: aestheticTokens.palette || [],
      silhouettes: aestheticTokens.silhouettes || [],
      formality: aestheticTokens.formality || [],
      accessories: aestheticTokens.accessories || [],
    });
  }

  /**
   * Helper to record a saved ensemble with action deduplication support.
   */
  public async recordSaveLook(
    userId: string,
    outfitId: string | null,
    aestheticTokens: {
      palette?: string[];
      silhouettes?: string[];
      formality?: string[];
      accessories?: string[];
    },
    preferenceActionId?: string | null
  ): Promise<StylePreferenceEvent> {
    return this.recordEvent(
      userId,
      'save_look',
      {
        outfit_id: outfitId,
        palette: aestheticTokens.palette || [],
        silhouettes: aestheticTokens.silhouettes || [],
        formality: aestheticTokens.formality || [],
        accessories: aestheticTokens.accessories || [],
      },
      preferenceActionId
    );
  }

  /**
   * Helper to record a Remix commit with action deduplication support.
   */
  public async recordRemixCommit(
    userId: string,
    outfitId: string | null,
    replacedSlots: string[],
    aestheticTokens: {
      palette?: string[];
      silhouettes?: string[];
      formality?: string[];
      accessories?: string[];
    },
    preferenceActionId: string
  ): Promise<StylePreferenceEvent> {
    return this.recordEvent(
      userId,
      'remix_commit',
      {
        outfit_id: outfitId,
        replaced_slots: replacedSlots,
        palette: aestheticTokens.palette || [],
        silhouettes: aestheticTokens.silhouettes || [],
        formality: aestheticTokens.formality || [],
        accessories: aestheticTokens.accessories || [],
      },
      preferenceActionId
    );
  }

  /**
   * Helper to record explicit user feedback.
   */
  public async recordExplicitFeedback(
    userId: string,
    feedbackKind: ExplicitFeedbackKind,
    aestheticTokens?: {
      palette?: string[];
      silhouettes?: string[];
      formality?: string[];
      accessories?: string[];
    }
  ): Promise<StylePreferenceEvent> {
    const payload: Record<string, unknown> = {
      feedback_kind: feedbackKind,
    };
    if (aestheticTokens?.palette) payload.palette = aestheticTokens.palette;
    if (aestheticTokens?.silhouettes) payload.silhouettes = aestheticTokens.silhouettes;
    if (aestheticTokens?.formality) payload.formality = aestheticTokens.formality;
    if (aestheticTokens?.accessories) payload.accessories = aestheticTokens.accessories;

    return this.recordEvent(userId, 'explicit_feedback', payload);
  }

  /**
   * Helper to record an explicit setting change.
   */
  public async recordExplicitSetting(
    userId: string,
    key: ExplicitSettingKey,
    value: unknown,
    action: ExplicitSettingAction = 'set'
  ): Promise<StylePreferenceEvent> {
    return this.recordEvent(userId, 'explicit_setting', {
      action,
      setting_key: key,
      setting_value: action === 'clear' ? null : value,
    });
  }

  /**
   * Helper to reset learned preferences.
   */
  public async resetLearnedPreferences(userId: string): Promise<StylePreferenceEvent> {
    return this.recordEvent(userId, 'reset_learned_preferences', {
      reset_scope: 'learned_only',
    });
  }

  /**
   * Debounced sync trigger.
   */
  private scheduleSync(userId: string): void {
    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
      this.flushQueue(userId).catch(() => {});
    }, 1500);
  }

  /**
   * Flushes up to MAX_BATCH_SIZE events to the server.
   */
  public async flushQueue(userId: string): Promise<SyncStyleDnaResponse | null> {
    if (this.syncInProgress) return null;
    this.syncInProgress = true;

    try {
      const queueKey = `${QUEUE_STORAGE_PREFIX}${userId}`;
      let queue: StylePreferenceEvent[] = [];
      try {
        const raw = await AsyncStorage.getItem(queueKey);
        if (raw) queue = JSON.parse(raw);
      } catch {
        queue = [];
      }

      if (queue.length === 0) {
        // If queue is empty, check if projection is stale (> 7 days) and refresh
        await this.checkAndRefreshStaleProfile(userId);
        return null;
      }

      const batch = queue.slice(0, MAX_BATCH_SIZE);
      const { data, error } = await supabase.rpc('sync_and_aggregate_style_dna' as any, {
        p_events: batch,
      });

      if (error) {
        // Offline / network failure: leave queue intact
        return null;
      }

      const resp = data as any;
      const acceptedIds = resp.accepted_ids || resp.acknowledged_event_ids || [];
      const duplicateIds = resp.duplicate_ids || [];
      const rejectedList: { id: string; reason: string }[] = resp.rejected_ids || resp.rejected_events || [];

      const acknowledgedSet = new Set<string>([
        ...acceptedIds,
        ...duplicateIds,
      ]);
      const rejectedSet = new Set<string>(rejectedList.map((r: any) => (typeof r === 'string' ? r : r.id)));

      // Handle dead-letter entries for permanently rejected events
      if (rejectedList.length > 0) {
        await this.recordDeadLetters(userId, rejectedList);
      }

      // Remove acknowledged and permanently rejected events from queue
      const remainingQueue = queue.filter(
        (e) => !acknowledgedSet.has(e.id) && !rejectedSet.has(e.id)
      );

      await AsyncStorage.setItem(queueKey, JSON.stringify(remainingQueue));

      // Update local cache with authoritative server projection
      if (resp.profile) {
        const formattedProfile: StyleDnaProfile = {
          userId: resp.profile.user_id || userId,
          schemaVersion: resp.profile.schema_version || 1,
          paletteAffinities: resp.profile.palette_affinities || {},
          silhouetteAffinities: resp.profile.silhouette_affinities || {},
          formalityAffinities: resp.profile.formality_affinities || {},
          accessoryAffinities: resp.profile.accessory_affinities || {},
          explicitPreferences: resp.profile.explicit_preferences || {},
          globalConfidence: resp.profile.global_confidence || 0.0,
          eventCount: resp.profile.event_count || 0,
          lastEventTimestamp: resp.profile.last_event_timestamp || null,
          learningResetAt: resp.profile.learning_reset_at || null,
          projectionComputedAt: resp.profile.projection_computed_at || new Date().toISOString(),
        };

        if (this.activeUserId === userId) {
          this.inMemoryProfile = formattedProfile;
        }
        await AsyncStorage.setItem(`${PROFILE_STORAGE_PREFIX}${userId}`, JSON.stringify(formattedProfile));
      }

      const resultResp: SyncStyleDnaResponse = {
        syncedCount: resp.synced_count ?? resp.syncedCount ?? (acceptedIds.length - duplicateIds.length),
        duplicateCount: resp.duplicate_count ?? resp.duplicateCount ?? duplicateIds.length,
        rejectedCount: resp.rejected_count ?? resp.rejectedCount ?? rejectedList.length,
        acknowledgedEventIds: Array.from(acknowledgedSet),
        rejectedEvents: rejectedList,
        profile: resp.profile,
        server_time: resp.server_time || new Date().toISOString(),
        schema_version: resp.schema_version || 1,
        ...resp,
      };

      return resultResp;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Refreshes the profile if stale (> 24 hours) even if zero new events were emitted.
   */
  private async checkAndRefreshStaleProfile(userId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    if (!profile.projectionComputedAt) return;

    const computedTime = new Date(profile.projectionComputedAt).getTime();
    const isStale = Date.now() - computedTime > 24 * 3600000;

    if (isStale) {
      try {
        const { data, error } = await supabase.rpc('refresh_style_profile' as any, {
          p_user_id: userId,
          p_force: false,
        });
        if (!error && data) {
          const raw = data as any;
          const updated: StyleDnaProfile = {
            userId: raw.user_id || userId,
            schemaVersion: raw.schema_version || 1,
            paletteAffinities: raw.palette_affinities || {},
            silhouetteAffinities: raw.silhouette_affinities || {},
            formalityAffinities: raw.formality_affinities || {},
            accessoryAffinities: raw.accessory_affinities || {},
            explicitPreferences: raw.explicit_preferences || {},
            globalConfidence: raw.global_confidence || 0.0,
            eventCount: raw.event_count || 0,
            lastEventTimestamp: raw.last_event_timestamp || null,
            learningResetAt: raw.learning_reset_at || null,
            projectionComputedAt: raw.projection_computed_at || new Date().toISOString(),
          };
          if (this.activeUserId === userId) {
            this.inMemoryProfile = updated;
          }
          await AsyncStorage.setItem(`${PROFILE_STORAGE_PREFIX}${userId}`, JSON.stringify(updated));
        }
      } catch {
        // Fall back gracefully
      }
    }
  }

  /**
   * Stores rejected events in a diagnostic dead-letter queue (max 50 entries).
   */
  private async recordDeadLetters(
    userId: string,
    rejected: { id: string; reason: string }[]
  ): Promise<void> {
    const deadLetterKey = `${DEAD_LETTER_PREFIX}${userId}`;
    try {
      const raw = await AsyncStorage.getItem(deadLetterKey);
      let list: { id: string; reason: string; timestamp: string }[] = raw ? JSON.parse(raw) : [];
      for (const r of rejected) {
        list.push({ ...r, timestamp: new Date().toISOString() });
      }
      if (list.length > MAX_DEAD_LETTER_ENTRIES) {
        list = list.slice(list.length - MAX_DEAD_LETTER_ENTRIES);
      }
      await AsyncStorage.setItem(deadLetterKey, JSON.stringify(list));
    } catch {
      // Ignore dead-letter write error
    }
  }
}

export const styleDnaSyncManager = new StyleDnaSyncManager();
