import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { styleDnaSyncManager } from '../styling/styleDnaSyncManager';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

describe('Closure Item 10: Phase G queued-event identity', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const planId = 'aaaa1111-1111-4111-8111-111111111111';
  const item1 = 'a1111111-0000-0000-0000-000000000001';
  const item2 = 'a1111111-0000-0000-0000-000000000002';
  const effectiveWearAt = '2026-09-20T12:00:00.000Z';

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('produces exactly one wear_outfit event with chronological client_timestamp and active items only', async () => {
    // Call recordWearOutfit with confirmed wear snapshot payload
    const event = await styleDnaSyncManager.recordWearOutfit(
      userId,
      planId,
      [item1, item2],
      {
        palette: ['Navy', 'White', 'Beige'],
        silhouettes: ['Slim', 'Relaxed'],
        formality: ['smart_casual'],
        accessories: [],
      },
      effectiveWearAt
    );

    // 1. Exactly one event for the ensemble
    expect(event).toBeDefined();

    // 2. event_type = wear_outfit
    expect(event.eventType).toBe('wear_outfit');
    expect(event.userId).toBe(userId);
    expect(event.eventSchemaVersion).toBe(1);

    // 3. client_timestamp matches effective wear chronology
    expect(event.clientTimestamp).toBe(effectiveWearAt);

    // 4. item IDs exactly equal confirmed worn snapshot (zero deleted/unavailable items)
    expect(event.payload.item_ids).toEqual([item1, item2]);
    expect(event.payload.outfit_id).toBe(planId);

    // 5. Palettes, silhouettes, formality extracted
    expect(event.payload.palette).toEqual(['Navy', 'White', 'Beige']);
    expect(event.payload.silhouettes).toEqual(['Slim', 'Relaxed']);
    expect(event.payload.formality).toEqual(['smart_casual']);

    // 6. Inspect AsyncStorage queue
    const queueKey = `@jezsy:style_events_queue:${userId}`;
    const rawQueue = await AsyncStorage.getItem(queueKey);
    expect(rawQueue).toBeTruthy();
    const queue = JSON.parse(rawQueue!);
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(event.id);
  });
});
