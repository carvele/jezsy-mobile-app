import { generateOutfits, computeStats } from './outfitGenerator';

describe('Outfit Generator & Wardrobe Stats', () => {
  const dummyItem = (id: string, type: string, colorTags: string[] = ['black'], wearCount = 0): any => ({
    id,
    user_id: 'u1',
    garment_type: type,
    name: `Item ${id}`,
    color_tags: colorTags,
    wear_count: wearCount,
    last_worn_at: null,
    created_at: new Date().toISOString(),
  });

  test('returns empty array when no base items exist', () => {
    expect(generateOutfits([])).toEqual([]);
  });

  test('generates valid outfit combinations from wardrobe items', () => {
    const items = [
      dummyItem('1', 'Top', ['white']),
      dummyItem('2', 'Bottom', ['black']),
      dummyItem('3', 'Shoes', ['black']),
    ];

    const outfits = generateOutfits(items);
    expect(outfits.length).toBeGreaterThan(0);
    expect(outfits[0].items.length).toBe(3);
    expect(outfits[0].score).toBeGreaterThan(0);
  });

  test('computes wardrobe wear statistics accurately', () => {
    const items = [
      dummyItem('1', 'Top', ['white'], 5),
      dummyItem('2', 'Bottom', ['black'], 0),
    ];

    const stats = computeStats(items);
    expect(stats.total).toBe(2);
    expect(stats.neverWorn).toBe(1);
    expect(stats.totalWears).toBe(5);
    expect(stats.mostWorn?.id).toBe('1');
  });
});
