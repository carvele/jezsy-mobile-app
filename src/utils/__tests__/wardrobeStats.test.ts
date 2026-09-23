import { computeStats } from '../wardrobeStats';

describe('wardrobeStats extraction tests', () => {
  const dummyItem = (id: string, wearCount = 0, lastWornAt: string | null = null): any => ({
    id,
    user_id: 'u1',
    garment_type: 'Top',
    name: `Item ${id}`,
    color_tags: ['black'],
    wear_count: wearCount,
    last_worn_at: lastWornAt,
    created_at: new Date().toISOString(),
  });

  test('computes statistics for empty wardrobe', () => {
    const stats = computeStats([]);
    expect(stats).toEqual({
      total: 0,
      neverWorn: 0,
      neglected: 0,
      mostWorn: null,
      totalWears: 0,
    });
  });

  test('computes wear statistics accurately across diverse items', () => {
    const sixtyFiveDaysAgo = new Date(Date.now() - 65 * 86_400_000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();

    const items = [
      dummyItem('1', 5, twoDaysAgo),          // worn recently
      dummyItem('2', 0, null),                // never worn
      dummyItem('3', 2, sixtyFiveDaysAgo),     // neglected (worn, but > 60 days ago)
      dummyItem('4', 12, twoDaysAgo),         // most worn
    ];

    const stats = computeStats(items);
    expect(stats.total).toBe(4);
    expect(stats.neverWorn).toBe(1);
    expect(stats.neglected).toBe(1);
    expect(stats.mostWorn?.id).toBe('4');
    expect(stats.totalWears).toBe(19);
  });
});
