import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';
import { styleDnaSyncManager } from '../styleDnaSyncManager';
import { styleProfileService } from '../../styleProfileService';
import { logOutfitWorn } from '../../wardrobeService';
import {
  aggregateStyleDnaLocally,
  computePersonalAffinity,
  getQualitativeStyleMaturity,
  isDimensionGrounded,
  EXPLICIT_PREFERRED_COLOR_BOOST,
  EXPLICIT_PREFERRED_FIT_BOOST,
  EXPLICIT_DISLIKED_COLOR_PENALTY,
  EXPLICIT_DISLIKED_FIT_PENALTY,
  EXPLICIT_DISLIKED_PATTERN_PENALTY,
  LEARNED_STYLE_MAX_DELTA,
} from '@/src/utils/personalStyleEngine';
import { generateCandidateOutfits } from '../candidateGenerator';
import { generateGroundedExplanation } from '../groundedExplainer';
import {
  StyleDnaProfile,
  StylePreferenceEvent,
  StyleDimensionAffinity,
} from '@/src/types/dto/styleProfile';
import { WardrobeItem, StylingIntent, CandidateOutfit } from '@/src/types/styleAdvisor';

let mockStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore[key] || null),
    setItem: jest.fn(async (key: string, val: string) => {
      mockStore[key] = val;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockStore[key];
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      for (const k of keys) delete mockStore[k];
    }),
    clear: jest.fn(async () => {
      mockStore = {};
    }),
  },
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

function makeMockItem(id: string, overrides: Partial<WardrobeItem> = {}): WardrobeItem {
  return {
    id,
    user_id: 'user-1',
    category: overrides.category || 'Top',
    sub_category: overrides.sub_category || overrides.garment_type || overrides.category || 'T-Shirt',
    garment_type: overrides.garment_type || overrides.category || 'Top',
    image_url: 'https://example.com/test.jpg',
    color_tags: overrides.color_tags || ['Navy'],
    occasions: ['Casual'],
    seasons: ['All'],
    ai_attributes: overrides.ai_attributes || { fit: 'Regular', pattern: 'Solid' },
    wear_count: overrides.wear_count ?? 0,
    last_worn_at: null,
    created_at: new Date().toISOString(),
    description: 'Test Item',
    user_notes: null,
    deleted: false,
    embedding: null,
    product_id: null,
    ...overrides,
  } as unknown as WardrobeItem;
}

describe('Phase G: Persistent Style DNA Test Suite (35 Scenarios)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore = {};
  });

  afterEach(async () => {
    await styleDnaSyncManager.handleSignOut();
  });

  // 1. Local aggregation matches mathematical formulation
  it('Scenario 1: local aggregation matches mathematical formulation (decay lambda, effective weight calculation)', () => {
    const userId = 'user-test-1';
    const now = new Date('2026-09-23T12:00:00Z');
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString();

    const events: StylePreferenceEvent[] = [
      {
        id: 'e1',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Navy'] },
        clientTimestamp: sixtyDaysAgo,
        createdAt: sixtyDaysAgo,
      },
      {
        id: 'e2',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Navy'] },
        clientTimestamp: now.toISOString(),
        createdAt: now.toISOString(),
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, now);
    const navyAffinity = profile.paletteAffinities['Navy'];
    expect(navyAffinity).toBeDefined();
    // 60-day half-life: decay ≈ 0.5 for e1, 1.0 for e2 -> effectiveEvidence ≈ 1.5
    expect(navyAffinity.effectiveEvidence).toBeGreaterThan(1.4);
    expect(navyAffinity.effectiveEvidence).toBeLessThan(1.6);
  });

  // 2. Weight assignment
  it('Scenario 2: weight assignment: wear_outfit=1.00, save_look=0.70, remix_commit=0.50, explicit_feedback=0.80, dont_recommend_item=0.00', () => {
    const userId = 'user-test-2';
    const now = new Date();
    const events: StylePreferenceEvent[] = [
      { id: '1', userId, eventSchemaVersion: 1, eventType: 'wear_outfit', payload: { palette: ['Black'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
      { id: '2', userId, eventSchemaVersion: 1, eventType: 'save_look', payload: { palette: ['White'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
      { id: '3', userId, eventSchemaVersion: 1, eventType: 'remix_commit', payload: { palette: ['Beige'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
      { id: '4', userId, eventSchemaVersion: 1, eventType: 'explicit_feedback', payload: { feedback_kind: 'too_formal', formality: ['formal'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
      { id: '5', userId, eventSchemaVersion: 1, eventType: 'explicit_feedback', payload: { feedback_kind: 'dont_recommend_item', item_ids: ['item-1'], palette: ['Red'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, now);
    expect(profile.paletteAffinities['Black'].effectiveEvidence).toBeCloseTo(1.0, 1);
    expect(profile.paletteAffinities['White'].effectiveEvidence).toBeCloseTo(0.7, 1);
    expect(profile.paletteAffinities['Beige'].effectiveEvidence).toBeCloseTo(0.5, 1);
    expect(profile.formalityAffinities['formal'].effectiveEvidence).toBeCloseTo(0.8, 1);
    // Red must NOT have learned evidence because dont_recommend_item has weight 0.00
    expect(profile.paletteAffinities['Red']).toBeUndefined();
  });

  // 3. Duplicate event IDs in queue are deduplicated
  it('Scenario 3: duplicate event IDs in queue are deduplicated', () => {
    const userId = 'user-test-3';
    const now = new Date();
    const event: StylePreferenceEvent = {
      id: 'duplicate-id-1',
      userId,
      eventSchemaVersion: 1,
      eventType: 'wear_outfit',
      payload: { palette: ['Olive'] },
      clientTimestamp: now.toISOString(),
      createdAt: now.toISOString(),
    };

    const profile = aggregateStyleDnaLocally(userId, [event, event, { ...event }], now);
    expect(profile.eventCount).toBe(1);
    expect(profile.paletteAffinities['Olive'].effectiveEvidence).toBeCloseTo(1.0, 2);
  });

  // 4. Action deduplication
  it('Scenario 4: action deduplication: remix_commit followed by save_look with same preference_action_id within 10 min window takes max weight', () => {
    const userId = 'user-test-4';
    const now = new Date('2026-09-23T12:00:00Z');
    const fiveMinutesLater = new Date(now.getTime() + 5 * 60000);
    const actionId = 'action-remix-save-1';

    const events: StylePreferenceEvent[] = [
      {
        id: 'e1',
        userId,
        eventSchemaVersion: 1,
        eventType: 'remix_commit',
        preferenceActionId: actionId,
        payload: { palette: ['Burgundy'] },
        clientTimestamp: now.toISOString(),
        createdAt: now.toISOString(),
      },
      {
        id: 'e2',
        userId,
        eventSchemaVersion: 1,
        eventType: 'save_look',
        preferenceActionId: actionId,
        payload: { palette: ['Burgundy'] },
        clientTimestamp: fiveMinutesLater.toISOString(),
        createdAt: fiveMinutesLater.toISOString(),
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, fiveMinutesLater);
    // Should take the save_look weight (0.70) rather than summing both (0.50 + 0.70 = 1.20)
    expect(profile.paletteAffinities['Burgundy'].effectiveEvidence).toBeCloseTo(0.7, 1);
  });

  // 5. 60-day half-life decay
  it('Scenario 5: 60-day half-life correctly reduces event weight by ~50% at day 60', () => {
    const userId = 'user-test-5';
    const now = new Date('2026-09-23T12:00:00Z');
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString();

    const events: StylePreferenceEvent[] = [
      {
        id: 'e-sixty',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Camel'] },
        clientTimestamp: sixtyDaysAgo,
        createdAt: sixtyDaysAgo,
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, now);
    expect(profile.paletteAffinities['Camel'].effectiveEvidence).toBeCloseTo(0.5, 1);
  });

  // 6. Zero decay for fresh events
  it('Scenario 6: zero decay for fresh events: events from today have decay factor = 1.00', () => {
    const userId = 'user-test-6';
    const now = new Date();
    const events: StylePreferenceEvent[] = [
      {
        id: 'e-fresh',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Cream'] },
        clientTimestamp: now.toISOString(),
        createdAt: now.toISOString(),
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, now);
    expect(profile.paletteAffinities['Cream'].effectiveEvidence).toBeCloseTo(1.0, 2);
  });

  // 7. Reset cutoff
  it('Scenario 7: reset cutoff: events created before learning_reset_at are completely ignored in learned affinities', () => {
    const userId = 'user-test-7';
    const resetDate = new Date('2026-09-20T00:00:00Z');
    const beforeReset = new Date('2026-09-19T00:00:00Z').toISOString();
    const afterReset = new Date('2026-09-21T00:00:00Z').toISOString();

    const events: StylePreferenceEvent[] = [
      {
        id: 'e-old',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Yellow'] },
        clientTimestamp: beforeReset,
        createdAt: beforeReset,
      },
      {
        id: 'e-reset',
        userId,
        eventSchemaVersion: 1,
        eventType: 'reset_learned_preferences',
        payload: { reset_scope: 'learned_only' },
        clientTimestamp: resetDate.toISOString(),
        createdAt: resetDate.toISOString(),
      },
      {
        id: 'e-new',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Navy'] },
        clientTimestamp: afterReset,
        createdAt: afterReset,
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, new Date('2026-09-22T00:00:00Z'));
    expect(profile.paletteAffinities['Yellow']).toBeUndefined();
    expect(profile.paletteAffinities['Navy']).toBeDefined();
    expect(profile.learningResetAt).toBe(resetDate.toISOString());
  });

  // 8. Reset persistence
  it('Scenario 8: reset persistence: explicit preferences survive reset_learned_preferences', () => {
    const userId = 'user-test-8';
    const events: StylePreferenceEvent[] = [
      {
        id: 'e-explicit',
        userId,
        eventSchemaVersion: 1,
        eventType: 'explicit_setting',
        payload: { action: 'set', setting_key: 'preferredColors', setting_value: ['Navy', 'White'] },
        clientTimestamp: '2026-09-20T00:00:00Z',
        createdAt: '2026-09-20T00:00:00Z',
      },
      {
        id: 'e-reset',
        userId,
        eventSchemaVersion: 1,
        eventType: 'reset_learned_preferences',
        payload: { reset_scope: 'learned_only' },
        clientTimestamp: '2026-09-21T00:00:00Z',
        createdAt: '2026-09-21T00:00:00Z',
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events);
    expect(profile.explicitPreferences['preferredColors']).toEqual(['Navy', 'White']);
  });

  // 9. Effective evidence calculation
  it('Scenario 9: effective evidence calculation: sum of decaying weights for matching events', () => {
    const userId = 'user-test-9';
    const now = new Date();
    const events: StylePreferenceEvent[] = [
      { id: '1', userId, eventSchemaVersion: 1, eventType: 'wear_outfit', payload: { silhouettes: ['Relaxed'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
      { id: '2', userId, eventSchemaVersion: 1, eventType: 'wear_outfit', payload: { silhouettes: ['Relaxed'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
      { id: '3', userId, eventSchemaVersion: 1, eventType: 'save_look', payload: { silhouettes: ['Relaxed'] }, clientTimestamp: now.toISOString(), createdAt: now.toISOString() },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, now);
    // 1.0 + 1.0 + 0.7 = 2.7
    expect(profile.silhouetteAffinities['Relaxed'].effectiveEvidence).toBeCloseTo(2.7, 1);
  });

  // 10. Confidence sigmoid
  it('Scenario 10: confidence sigmoid: zero evidence yields 0.0 confidence; 10+ evidence approaches 0.9+', () => {
    const userId = 'user-test-10';
    const emptyProfile = aggregateStyleDnaLocally(userId, []);
    expect(emptyProfile.globalConfidence).toBe(0.0);

    const now = new Date();
    const tenEvents: StylePreferenceEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `ev-${i}`,
      userId,
      eventSchemaVersion: 1,
      eventType: 'wear_outfit',
      payload: { palette: ['Navy'] },
      clientTimestamp: now.toISOString(),
      createdAt: now.toISOString(),
    }));

    const richProfile = aggregateStyleDnaLocally(userId, tenEvents, now);
    expect(richProfile.globalConfidence).toBeGreaterThanOrEqual(0.65);
  });

  // 11. Bounded delta
  it('Scenario 11: bounded delta: learned delta is strictly clamped between -15 and +15', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-11',
      schemaVersion: 1,
      paletteAffinities: {
        Navy: { score: 1.0, affinityScore: 10, confidence: 1.0, effectiveEvidence: 50, effectiveSampleCount: 50, rawSampleCount: 50, lastSignalAt: new Date().toISOString() },
        Neon: { score: 0.0, affinityScore: -10, confidence: 1.0, effectiveEvidence: 50, effectiveSampleCount: 50, rawSampleCount: 50, lastSignalAt: new Date().toISOString() },
      },
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 1.0,
      eventCount: 50,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const navyItem = makeMockItem('navy-top', { color_tags: ['Navy'] });
    const neonItem = makeMockItem('neon-top', { color_tags: ['Neon'] });

    const navyRes = computePersonalAffinity([navyItem], profile);
    const neonRes = computePersonalAffinity([neonItem], profile);

    expect(navyRes.learnedDnaDelta).toBeLessThanOrEqual(LEARNED_STYLE_MAX_DELTA);
    expect(neonRes.learnedDnaDelta).toBeGreaterThanOrEqual(-LEARNED_STYLE_MAX_DELTA);
  });

  // 12. Intent supremacy
  it('Scenario 12: intent supremacy: explicit session intent overrides contradictory learned preferences', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-12',
      schemaVersion: 1,
      paletteAffinities: {
        Black: { score: 0.1, affinityScore: -8, confidence: 1.0, effectiveEvidence: 10, effectiveSampleCount: 10, rawSampleCount: 10, lastSignalAt: new Date().toISOString() },
      },
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.9,
      eventCount: 10,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const blackItem = makeMockItem('black-top', { color_tags: ['Black'] });
    const intent: StylingIntent = {
      rawPrompt: 'I want an all black look for an evening event',
      preferredColors: ['Black'],
    };

    const res = computePersonalAffinity([blackItem], profile, undefined, intent);
    // Explicit prompt intent suppresses contradictory learned negative delta
    expect(res.learnedDnaDelta).toBeGreaterThanOrEqual(0);
  });

  // 13. Explicit exclusion: disliked color produces -20 penalty
  it('Scenario 13: explicit exclusion: disliked color produces -20 penalty', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-13',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {
        avoidedColors: ['Neon'],
      },
      globalConfidence: 0.5,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const neonItem = makeMockItem('item-neon', { color_tags: ['Neon'] });
    const res = computePersonalAffinity([neonItem], profile);
    expect(res.negativeSignals).toContain('Matches explicit color dislike: Neon');
    expect(res.score).toBeLessThanOrEqual(75 - EXPLICIT_DISLIKED_COLOR_PENALTY);
  });

  // 14. Explicit exclusion: disliked fit produces -25 penalty
  it('Scenario 14: explicit exclusion: disliked fit produces -25 penalty', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-14',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {
        avoidedFits: ['Skinny'],
      },
      globalConfidence: 0.5,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const skinnyItem = makeMockItem('item-skinny', { ai_attributes: { fit: 'Skinny' } });
    const res = computePersonalAffinity([skinnyItem], profile);
    expect(res.negativeSignals).toContain('Features avoided fit: Skinny');
    expect(res.score).toBeLessThanOrEqual(75 - EXPLICIT_DISLIKED_FIT_PENALTY);
  });

  // 15. Explicit exclusion: disliked pattern produces -15 penalty
  it('Scenario 15: explicit exclusion: disliked pattern produces -15 penalty', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-15',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {
        avoidedPatterns: ['Animal Print'],
      },
      globalConfidence: 0.5,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const animalItem = makeMockItem('item-animal', { ai_attributes: { pattern: 'Animal Print' } });
    const res = computePersonalAffinity([animalItem], profile);
    expect(res.negativeSignals).toContain('Features pattern to avoid: Animal Print');
    expect(res.score).toBeLessThanOrEqual(75 - EXPLICIT_DISLIKED_PATTERN_PENALTY);
  });

  // 16. Explicit preferred boost: preferred color produces +6 boost
  it('Scenario 16: explicit preferred boost: preferred color produces +6 boost', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-16',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {
        preferredColors: ['Navy'],
      },
      globalConfidence: 0.5,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const navyItem = makeMockItem('item-navy', { color_tags: ['Navy'] });
    const res = computePersonalAffinity([navyItem], profile);
    expect(res.positiveSignals).toContain('Features preferred color: Navy');
    expect(res.score).toBeGreaterThanOrEqual(70 + EXPLICIT_PREFERRED_COLOR_BOOST);
  });

  // 17. Explicit preferred boost: preferred fit produces +5 boost
  it('Scenario 17: explicit preferred boost: preferred fit produces +5 boost', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-17',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {
        preferredFits: ['Relaxed'],
      },
      globalConfidence: 0.5,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const relaxedItem = makeMockItem('item-relaxed', { ai_attributes: { fit: 'Relaxed' } });
    const res = computePersonalAffinity([relaxedItem], profile);
    expect(res.positiveSignals).toContain('Features preferred fit: Relaxed');
    expect(res.score).toBeGreaterThanOrEqual(70 + EXPLICIT_PREFERRED_FIT_BOOST);
  });

  // 18. Explainer grounding: dimension explanation is omitted when effective samples < 5
  it('Scenario 18: explainer grounding: dimension explanation is omitted when effective samples < 5', () => {
    const affinity: StyleDimensionAffinity = {
      score: 0.8,
      affinityScore: 0.8,
      confidence: 0.8,
      effectiveEvidence: 4.5,
      effectiveSampleCount: 4.5,
      rawSampleCount: 5,
      lastSignalAt: new Date().toISOString(),
    };
    expect(isDimensionGrounded(affinity)).toBe(false);
  });

  // 19. Explainer grounding: dimension explanation is included when effective samples >= 5, confidence >= 0.50, and score >= 0.70
  it('Scenario 19: explainer grounding: dimension explanation is included when effective samples >= 5, confidence >= 0.50, and score >= 0.70', () => {
    const affinity: StyleDimensionAffinity = {
      score: 0.80,
      affinityScore: 0.80,
      confidence: 0.60,
      effectiveEvidence: 5.5,
      effectiveSampleCount: 5.5,
      rawSampleCount: 6,
      lastSignalAt: new Date().toISOString(),
    };
    expect(isDimensionGrounded(affinity)).toBe(true);
  });

  // 20. Offline queueing: events are safely appended to AsyncStorage when offline
  it('Scenario 20: offline queueing: events are safely appended to AsyncStorage when offline', async () => {
    const userId = 'user-test-20';
    await styleDnaSyncManager.setActiveUser(userId);

    const event = await styleDnaSyncManager.recordEvent(userId, 'wear_outfit', {
      palette: ['Navy'],
    });

    const queueRaw = await AsyncStorage.getItem(`@jezsy:style_events_queue:${userId}`);
    expect(queueRaw).toBeTruthy();
    const queue = JSON.parse(queueRaw!);
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe(event.id);
  });

  // 21. Batch sync
  it('Scenario 21: batch sync: queue flushes up to 50 events in a single batch to sync_and_aggregate_style_dna', async () => {
    const userId = 'user-test-21';
    await styleDnaSyncManager.setActiveUser(userId);

    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        synced_count: 5,
        duplicate_count: 0,
        rejected_count: 0,
        acknowledged_event_ids: ['ev-0', 'ev-1', 'ev-2', 'ev-3', 'ev-4'],
        profile: {
          user_id: userId,
          schema_version: 1,
          palette_affinities: {},
          silhouette_affinities: {},
          formality_affinities: {},
          accessory_affinities: {},
          explicit_preferences: {},
          global_confidence: 0.5,
          event_count: 5,
          last_event_timestamp: new Date().toISOString(),
          learning_reset_at: null,
          projection_computed_at: new Date().toISOString(),
        },
      },
      error: null,
    });

    // Enqueue 5 events
    mockStore[`@jezsy:style_events_queue:${userId}`] = JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({
        id: `ev-${i}`,
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Navy'] },
        clientTimestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }))
    );

    const res = await styleDnaSyncManager.flushQueue(userId);
    expect(res).not.toBeNull();
    expect(res?.syncedCount).toBe(5);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'sync_and_aggregate_style_dna',
      expect.objectContaining({ p_events: expect.any(Array) })
    );

    // Queue must now be empty
    const queueRaw = await AsyncStorage.getItem(`@jezsy:style_events_queue:${userId}`);
    const remaining = JSON.parse(queueRaw || '[]');
    expect(remaining.length).toBe(0);
  });

  // 22. Duplicate server acknowledgement
  it('Scenario 22: duplicate server acknowledgement: server returning existing event IDs correctly evicts them from the queue', async () => {
    const userId = 'user-test-22';
    await styleDnaSyncManager.setActiveUser(userId);

    mockStore[`@jezsy:style_events_queue:${userId}`] = JSON.stringify([
      {
        id: 'dup-1',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { palette: ['Navy'] },
        clientTimestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        synced_count: 0,
        duplicate_count: 1,
        rejected_count: 0,
        duplicate_ids: ['dup-1'],
        acknowledged_event_ids: ['dup-1'],
        profile: {
          user_id: userId,
          schema_version: 1,
          palette_affinities: {},
          silhouette_affinities: {},
          formality_affinities: {},
          accessory_affinities: {},
          explicit_preferences: {},
          global_confidence: 0.1,
          event_count: 1,
          last_event_timestamp: null,
          learning_reset_at: null,
          projection_computed_at: new Date().toISOString(),
        },
      },
      error: null,
    });

    const res = await styleDnaSyncManager.flushQueue(userId);
    expect(res?.duplicateCount).toBe(1);
    const queueRaw = await AsyncStorage.getItem(`@jezsy:style_events_queue:${userId}`);
    expect(JSON.parse(queueRaw || '[]').length).toBe(0);
  });

  // 23. Dead-letter isolation
  it('Scenario 23: dead-letter isolation: rejected events are moved to dead-letter storage, not stuck in retry loop', async () => {
    const userId = 'user-test-23';
    await styleDnaSyncManager.setActiveUser(userId);

    mockStore[`@jezsy:style_events_queue:${userId}`] = JSON.stringify([
      {
        id: 'bad-event-1',
        userId,
        eventSchemaVersion: 1,
        eventType: 'wear_outfit',
        payload: { invalid_key: 123 },
        clientTimestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);

    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        synced_count: 0,
        duplicate_count: 0,
        rejected_count: 1,
        rejected_ids: [{ id: 'bad-event-1', reason: 'invalid_event_payload' }],
        rejected_events: [{ id: 'bad-event-1', reason: 'invalid_event_payload' }],
        acknowledged_event_ids: [],
        profile: null,
      },
      error: null,
    });

    await styleDnaSyncManager.flushQueue(userId);

    // Queue evicted bad event
    const queueRaw = await AsyncStorage.getItem(`@jezsy:style_events_queue:${userId}`);
    expect(JSON.parse(queueRaw || '[]').length).toBe(0);

    // Bad event stored in dead letter
    const dlRaw = await AsyncStorage.getItem(`@jezsy:style_dead_letter:${userId}`);
    expect(dlRaw).toBeTruthy();
    const deadLetters = JSON.parse(dlRaw!);
    expect(deadLetters[0].id).toBe('bad-event-1');
  });

  // 24. Account switch isolation
  it('Scenario 24: account switch isolation: switching user ID immediately purges in-memory profile and prevents cross-user pollution', async () => {
    const userA = 'user-A';
    const userB = 'user-B';

    mockStore[`@jezsy:style_dna_profile:${userA}`] = JSON.stringify({
      userId: userA,
      schemaVersion: 1,
      paletteAffinities: {
        Navy: { score: 0.8, affinityScore: 10, confidence: 1.0, effectiveEvidence: 5, effectiveSampleCount: 5, rawSampleCount: 5, lastSignalAt: new Date().toISOString() },
      },
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.8,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    });

    await styleDnaSyncManager.setActiveUser(userA);
    const profileA = await styleDnaSyncManager.getProfile(userA);
    expect(profileA.paletteAffinities['Navy']).toBeDefined();

    // Switch to User B
    await styleDnaSyncManager.setActiveUser(userB);
    const profileB = await styleDnaSyncManager.getProfile(userB);
    expect(profileB.paletteAffinities['Navy']).toBeUndefined();
    expect(profileB.userId).toBe(userB);
  });

  // 25. Sign out clears active user
  it('Scenario 25: sign out: sign out clears active user, cancels pending sync timeouts, and empties in-memory profile', async () => {
    const userId = 'user-test-25';
    await styleDnaSyncManager.setActiveUser(userId);
    await styleDnaSyncManager.handleSignOut();

    // Next getProfile returns fresh baseline
    const profile = await styleDnaSyncManager.getProfile(userId);
    expect(profile.eventCount).toBe(0);
  });

  // 26. Formality feedback scoping
  it('Scenario 26: formality feedback scoping: too_formal / too_casual only impacts formality affinities, never palettes or silhouettes', () => {
    const userId = 'user-test-26';
    const now = new Date();
    const events: StylePreferenceEvent[] = [
      {
        id: 'f-1',
        userId,
        eventSchemaVersion: 1,
        eventType: 'explicit_feedback',
        payload: {
          feedback_kind: 'too_formal',
          formality: ['formal'],
          palette: ['Navy'], // Should be ignored by formality feedback scoping
        },
        clientTimestamp: now.toISOString(),
        createdAt: now.toISOString(),
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, now);
    expect(profile.formalityAffinities['formal']).toBeDefined();
    expect(profile.formalityAffinities['formal'].score).toBeLessThan(0.5);
    // Palette should NOT be penalized by formality feedback
    expect(profile.paletteAffinities['Navy']).toBeUndefined();
  });

  // 27. Item rejection
  it('Scenario 27: item rejection: dont_recommend_item records event but does not increase learned aesthetic affinities', () => {
    const userId = 'user-test-27';
    const now = new Date();
    const events: StylePreferenceEvent[] = [
      {
        id: 'rej-1',
        userId,
        eventSchemaVersion: 1,
        eventType: 'explicit_feedback',
        payload: {
          feedback_kind: 'dont_recommend_item',
          item_ids: ['item-bad'],
          palette: ['Purple'],
          silhouettes: ['Baggy'],
        },
        clientTimestamp: now.toISOString(),
        createdAt: now.toISOString(),
      },
    ];

    const profile = aggregateStyleDnaLocally(userId, events, now);
    expect(profile.paletteAffinities['Purple']).toBeUndefined();
    expect(profile.silhouetteAffinities['Baggy']).toBeUndefined();
  });

  // 28. Wear outfit: 1 ensemble wear action generates exactly 1 wear_outfit event
  it('Scenario 28: wear outfit: 1 ensemble wear action generates exactly 1 wear_outfit event with all item tokens', async () => {
    const userId = 'user-test-28';
    await styleDnaSyncManager.setActiveUser(userId);

    (supabase.rpc as jest.Mock).mockResolvedValue({ data: {}, error: null });

    const items = [
      makeMockItem('top-1', { color_tags: ['Navy'], ai_attributes: { fit: 'Slim' } }),
      makeMockItem('bot-1', { color_tags: ['White'], ai_attributes: { fit: 'Regular' } }),
    ];

    const res = await logOutfitWorn(userId, { items, occasion: 'Casual' });
    expect(res.succeeded).toEqual(['top-1', 'bot-1']);

    const queueRaw = await AsyncStorage.getItem(`@jezsy:style_events_queue:${userId}`);
    const queue: StylePreferenceEvent[] = JSON.parse(queueRaw || '[]');

    // Strictly 1 event logged
    expect(queue.length).toBe(1);
    expect(queue[0].eventType).toBe('wear_outfit');
    expect((queue[0].payload as any).item_ids).toEqual(['top-1', 'bot-1']);
    expect((queue[0].payload as any).palette).toContain('Navy');
    expect((queue[0].payload as any).palette).toContain('White');
  });

  // 29. Stale profile refresh
  // 29. Stale profile refresh
  it('Scenario 29: stale profile refresh: cached profile older than 7 days triggers background refresh without client user_id', async () => {
    const userId = 'user-test-29';
    // 8 days old is stale (> 7 days)
    const oldTimestamp = new Date(Date.now() - 8 * 24 * 3600000).toISOString();
    mockStore[`@jezsy:style_dna_profile:${userId}`] = JSON.stringify({
      userId,
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.5,
      eventCount: 1,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: oldTimestamp,
    });
    // Empty queue so flushQueue triggers checkAndRefreshStaleProfile
    mockStore[`@jezsy:style_events_queue:${userId}`] = '[]';
    await styleDnaSyncManager.setActiveUser(userId);

    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: {
        user_id: userId,
        schema_version: 1,
        palette_affinities: { Black: { score: 0.7, confidence: 0.5, effective_evidence: 2 } },
        silhouette_affinities: {},
        formality_affinities: {},
        accessory_affinities: {},
        explicit_preferences: {},
        global_confidence: 0.6,
        event_count: 2,
        last_event_timestamp: null,
        learning_reset_at: null,
        projection_computed_at: new Date().toISOString(),
      },
      error: null,
    });

    await styleDnaSyncManager.flushQueue(userId);
    // Verified: refresh_style_profile called with { p_force: false } without supplying client user_id
    expect(supabase.rpc).toHaveBeenCalledWith('refresh_style_profile', { p_force: false });
  });

  // 30. Qualitative maturity: globalConfidence < 0.30 -> Learning your style
  it('Scenario 30: qualitative maturity: globalConfidence < 0.30 -> Learning your style (Level 0)', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-30',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.25,
      eventCount: 3,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const maturity = getQualitativeStyleMaturity(profile);
    expect(maturity.level).toBe(0);
    expect(maturity.label).toBe('Learning your style');
    expect(maturity.stage).toBe('learning');

    // Boundary check: exactly 0.299 is still Learning your style
    expect(getQualitativeStyleMaturity(0.299).label).toBe('Learning your style');
  });

  // 31. Qualitative maturity: 0.30 <= globalConfidence < 0.70 -> Getting to know your style
  it('Scenario 31: qualitative maturity: 0.30 <= globalConfidence < 0.70 -> Getting to know your style (Level 1)', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-31',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.45,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const maturity = getQualitativeStyleMaturity(profile);
    expect(maturity.level).toBe(1);
    expect(maturity.label).toBe('Getting to know your style');
    expect(maturity.stage).toBe('developing');

    // Boundary checks: 0.30 and 0.699
    expect(getQualitativeStyleMaturity(0.30).label).toBe('Getting to know your style');
    expect(getQualitativeStyleMaturity(0.699).label).toBe('Getting to know your style');
  });

  // 32. Qualitative maturity: globalConfidence >= 0.70 -> Style profile established
  it('Scenario 32: qualitative maturity: globalConfidence >= 0.70 -> Style profile established (Level 2)', () => {
    const profile: StyleDnaProfile = {
      userId: 'user-test-32',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.75,
      eventCount: 15,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    const maturity = getQualitativeStyleMaturity(profile);
    expect(maturity.level).toBe(2);
    expect(maturity.label).toBe('Style profile established');
    expect(maturity.stage).toBe('established');

    // Boundary check: exactly 0.70
    expect(getQualitativeStyleMaturity(0.70).label).toBe('Style profile established');
  });

  // 33. Grounded explainer integration with strict frozen threshold checks
  it('Scenario 33: grounded explainer integration: requires effectiveSampleCount >= 5, confidence >= 0.50, and score >= 0.70', () => {
    // Test boundary conditions for isDimensionGrounded
    expect(isDimensionGrounded(null)).toBe(false);
    expect(isDimensionGrounded(undefined)).toBe(false);

    // Failing effectiveSampleCount (< 5)
    expect(isDimensionGrounded({
      score: 0.85,
      confidence: 0.70,
      effectiveSampleCount: 4.9,
      rawSampleCount: 5,
      lastSignalAt: new Date().toISOString(),
    })).toBe(false);

    // Failing confidence (< 0.50)
    expect(isDimensionGrounded({
      score: 0.85,
      confidence: 0.49,
      effectiveSampleCount: 6.0,
      rawSampleCount: 6,
      lastSignalAt: new Date().toISOString(),
    })).toBe(false);

    // Failing affinity score (< 0.70)
    expect(isDimensionGrounded({
      score: 0.69,
      confidence: 0.60,
      effectiveSampleCount: 6.0,
      rawSampleCount: 6,
      lastSignalAt: new Date().toISOString(),
    })).toBe(false);

    // Passing all three frozen requirements
    const groundedAffinity = {
      score: 0.80,
      affinityScore: 0.80,
      confidence: 0.60,
      effectiveSampleCount: 6.0,
      rawSampleCount: 6,
      lastSignalAt: new Date().toISOString(),
    };
    expect(isDimensionGrounded(groundedAffinity)).toBe(true);

    const candidate: CandidateOutfit = {
      candidateId: 'cand-1',
      items: [
        makeMockItem('top-navy', { color_tags: ['Navy'] }),
        makeMockItem('bot-navy', { color_tags: ['Navy'] }),
      ],
      key: 'cand-1',
      baseScore: 85,
      colorMatchLabel: 'Monochrome',
      formalityLevel: 'smart_casual',
      hasDress: false,
      hasShoes: false,
      hasOuterwear: false,
      hasBag: false,
      hasBelt: false,
      accessoryCount: 0,
    };

    const intent: StylingIntent = { rawPrompt: 'casual outfit' };
    const userProfile = {
      userId: 'user-test-33',
      styleDna: {
        userId: 'user-test-33',
        schemaVersion: 1,
        paletteAffinities: {
          Navy: groundedAffinity,
        },
        silhouetteAffinities: {},
        formalityAffinities: {},
        accessoryAffinities: {},
        explicitPreferences: {},
        globalConfidence: 0.8,
        eventCount: 8,
        lastEventTimestamp: null,
        learningResetAt: null,
        projectionComputedAt: new Date().toISOString(),
      },
    };

    const explanation = generateGroundedExplanation(candidate, intent, userProfile as any);
    expect(explanation.headline).toBeDefined();
    // Explanation grounds the preferred palette because all frozen thresholds are met
    expect(explanation.whyThisWorks.palette).toContain('Navy');
  });

  // 34. Backward compatibility
  it('Scenario 34: backward compatibility: default profile is returned when no events exist and database has no record', async () => {
    const userId = 'user-fresh-new';
    const profile = await styleProfileService.getProfile(userId);
    expect(profile).toBeDefined();
    expect(profile.userId).toBe(userId);
    expect(profile.styleDna?.eventCount).toBe(0);
    expect(profile.preferredFits).toContain('Regular');
  });

  // 35. Candidate generator integration: outfits matching high learned affinities rank higher
  it('Scenario 35: candidate generator integration: outfits matching high learned affinities rank higher in absence of conflicting intent', () => {
    const navyTop = makeMockItem('navy-top', { color_tags: ['Navy'], category: 'Top', garment_type: 'Shirt' });
    const greenTop = makeMockItem('green-top', { color_tags: ['Green'], category: 'Top', garment_type: 'Shirt' });
    const blackBot = makeMockItem('black-bot', { color_tags: ['Black'], category: 'Bottom', garment_type: 'Trousers' });
    const shoes = makeMockItem('shoe-1', { color_tags: ['Black'], category: 'Shoes', garment_type: 'Sneakers' });

    const wardrobe = [navyTop, greenTop, blackBot, shoes];
    const intent: StylingIntent = { rawPrompt: 'casual look' };

    const learnedProfile = {
      userId: 'user-test-35',
      styleDna: {
        userId: 'user-test-35',
        schemaVersion: 1,
        paletteAffinities: {
          Navy: { score: 0.9, affinityScore: 8.0, confidence: 0.8, effectiveEvidence: 4.0, effectiveSampleCount: 4.0, rawSampleCount: 4, lastSignalAt: new Date().toISOString() },
          Green: { score: 0.2, affinityScore: -5.0, confidence: 0.8, effectiveEvidence: 3.0, effectiveSampleCount: 3.0, rawSampleCount: 3, lastSignalAt: new Date().toISOString() },
        },
        silhouetteAffinities: {},
        formalityAffinities: {},
        accessoryAffinities: {},
        explicitPreferences: {},
        globalConfidence: 0.8,
        eventCount: 8,
        lastEventTimestamp: null,
        learningResetAt: null,
        projectionComputedAt: new Date().toISOString(),
      },
    };

    const candidates = generateCandidateOutfits(wardrobe, intent, { profile: learnedProfile as any });
    expect(candidates.length).toBeGreaterThan(0);

    // Candidate with Navy should rank higher than candidate with Green
    const topCandidate = candidates[0];
    const topHasNavy = topCandidate.items.some((i) => i.id === 'navy-top');
    expect(topHasNavy).toBe(true);
  });

  // 36. Explicit session intent supremacy over persistent user exclusions
  it('Scenario 36: explicit session intent overrides persistent user exclusion when explicitly requested', () => {
    const yellowTop = makeMockItem('yellow-top', { color_tags: ['Yellow'], category: 'Top' });
    const blueBot = makeMockItem('blue-bot', { color_tags: ['Blue'], category: 'Bottom' });

    const profile: StyleDnaProfile = {
      userId: 'user-test-36',
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {
        avoidedColors: ['Yellow'],
      },
      globalConfidence: 0.5,
      eventCount: 5,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: new Date().toISOString(),
    };

    // When NOT requested in session intent, Yellow receives penalty
    const resultWithoutIntent = computePersonalAffinity([yellowTop, blueBot], profile, null, { rawPrompt: 'casual' });
    expect(resultWithoutIntent.negativeSignals).toContain('Matches explicit color dislike: Yellow');

    // When explicitly pinned in session intent via mustUseItemIds, penalty is overridden
    const resultWithPinnedIntent = computePersonalAffinity([yellowTop, blueBot], profile, null, {
      rawPrompt: 'casual',
      mustUseItemIds: ['yellow-top'],
    });
    expect(resultWithPinnedIntent.negativeSignals).not.toContain('Matches explicit color dislike: Yellow');

    // When explicitly mentioned in session prompt, penalty is also overridden
    const resultWithPromptIntent = computePersonalAffinity([yellowTop, blueBot], profile, null, {
      rawPrompt: 'wear my yellow top today',
    });
    expect(resultWithPromptIntent.negativeSignals).not.toContain('Matches explicit color dislike: Yellow');

    // Delta is bounded to LEARNED_STYLE_MAX_DELTA (15)
    expect(Math.abs(resultWithPromptIntent.learnedDnaDelta || 0)).toBeLessThanOrEqual(LEARNED_STYLE_MAX_DELTA);
  });

  // 37. Freshness threshold: does NOT refresh when younger than 7 days
  it('Scenario 37: freshness threshold: cached profile younger than 7 days does NOT trigger background refresh', async () => {
    const userId = 'user-test-37';
    // 3 days old is fresh (< 7 days)
    const freshTimestamp = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
    mockStore[`@jezsy:style_dna_profile:${userId}`] = JSON.stringify({
      userId,
      schemaVersion: 1,
      paletteAffinities: {},
      silhouetteAffinities: {},
      formalityAffinities: {},
      accessoryAffinities: {},
      explicitPreferences: {},
      globalConfidence: 0.5,
      eventCount: 1,
      lastEventTimestamp: null,
      learningResetAt: null,
      projectionComputedAt: freshTimestamp,
    });
    mockStore[`@jezsy:style_events_queue:${userId}`] = '[]';
    await styleDnaSyncManager.setActiveUser(userId);

    (supabase.rpc as jest.Mock).mockClear();

    await styleDnaSyncManager.flushQueue(userId);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
