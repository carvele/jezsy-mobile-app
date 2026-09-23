import {
  buildPlannerItemSnapshots,
  buildPlannerItemSnapshotsDetailed,
  validateSavedOutfitAvailability,
} from '../plannerSnapshotAdapter';

describe('plannerSnapshotAdapter', () => {
  const authoritativeInventory = [
    { id: 'item-1', name: 'Silk Blouse' },
    { id: 'item-2', name: 'Pleated Trousers' },
    { id: 'item-3', name: 'Leather Loafers' },
    { id: 'item-4', name: 'Cashmere Cardigan' },
  ];

  it('prefers wardrobe_item_id when present over id', () => {
    const rawItems = [
      {
        id: 'some-other-id',
        wardrobe_item_id: 'item-1',
        name: 'Silk Blouse',
        category: 'Tops',
        image_url: 'https://example.com/blouse.png',
      },
    ];

    const snapshots = buildPlannerItemSnapshots(rawItems, { authoritativeInventory });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].id).toBe('item-1');
    expect(snapshots[0].name).toBe('Silk Blouse');
    expect(snapshots[0].category).toBe('Tops');
  });

  it('accepts id only when authoritative wardrobe inventory confirms it', () => {
    const rawItems = [
      {
        id: 'item-2',
        name: 'Pleated Trousers',
        category: 'Bottoms',
      },
      {
        id: 'unconfirmed-item-999',
        name: 'Ghost Jacket',
        category: 'Outerwear',
      },
    ];

    const result = buildPlannerItemSnapshotsDetailed(rawItems, { authoritativeInventory });
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].id).toBe('item-2');
    expect(result.rejectedItems).toHaveLength(1);
    expect(result.rejectedItems[0].item.id).toBe('unconfirmed-item-999');
    expect(result.rejectedItems[0].reason).toBe('unconfirmed_id');
  });

  it('strictly rejects product_id alone as catalog-only', () => {
    const rawItems = [
      {
        product_id: 'prod-123',
        name: 'Store Catalog Shirt',
        category: 'Tops',
      },
      {
        id: 'prod-456',
        product_id: 'prod-456',
        name: 'Catalog Only Item',
      },
    ];

    const result = buildPlannerItemSnapshotsDetailed(rawItems, { authoritativeInventory });
    expect(result.snapshots).toHaveLength(0);
    expect(result.rejectedItems).toHaveLength(2);
    expect(result.rejectedItems[0].reason).toBe('catalog_only_product');
    expect(result.rejectedItems[1].reason).toBe('catalog_only_product');
  });

  it('deduplicates items while strictly preserving source ensemble order', () => {
    const rawItems = [
      { wardrobe_item_id: 'item-3', name: 'Leather Loafers', category: 'Shoes' },
      { wardrobe_item_id: 'item-1', name: 'Silk Blouse', category: 'Tops' },
      { wardrobe_item_id: 'item-2', name: 'Pleated Trousers', category: 'Bottoms' },
      { wardrobe_item_id: 'item-1', name: 'Silk Blouse Duplicate', category: 'Tops' },
      { wardrobe_item_id: 'item-4', name: 'Cashmere Cardigan', category: 'Outerwear' },
    ];

    const snapshots = buildPlannerItemSnapshots(rawItems, { authoritativeInventory });
    expect(snapshots).toHaveLength(4);
    // Source order MUST be preserved: Shoes (item-3), Tops (item-1), Bottoms (item-2), Outerwear (item-4)
    expect(snapshots.map((s) => s.id)).toEqual(['item-3', 'item-1', 'item-2', 'item-4']);
  });

  it('extracts images from image_url or images array', () => {
    const rawItems = [
      {
        wardrobe_item_id: 'item-1',
        name: 'Silk Blouse',
        category: 'Tops',
        images: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
      },
    ];

    const snapshots = buildPlannerItemSnapshots(rawItems);
    expect(snapshots[0].image_url).toBe('https://example.com/img1.jpg');
  });

  it('strictly preserves source ensemble order (top -> bottom -> shoes -> bag) without alphabetical sorting', () => {
    // Alphabetical by category would be: Bags, Bottoms, Shoes, Tops.
    // Alphabetical by name would be: Amber Handbag, Cashmere Knit, Leather Loafers, Wool Trousers.
    // The canonical requirement is preserving the caller's styling sequence: top -> bottom -> shoes -> bag.
    const rawItems = [
      { wardrobe_item_id: 'id-top', name: 'Cashmere Knit', category: 'Tops' },
      { wardrobe_item_id: 'id-bottom', name: 'Wool Trousers', category: 'Bottoms' },
      { wardrobe_item_id: 'id-top', name: 'Duplicate Top', category: 'Tops' }, // duplicate to test deduplication order
      { wardrobe_item_id: 'id-shoes', name: 'Leather Loafers', category: 'Shoes' },
      { wardrobe_item_id: 'id-bag', name: 'Amber Handbag', category: 'Bags' },
    ];

    const snapshots = buildPlannerItemSnapshots(rawItems);

    expect(snapshots).toHaveLength(4);
    expect(snapshots.map((s) => s.id)).toEqual(['id-top', 'id-bottom', 'id-shoes', 'id-bag']);
    expect(snapshots.map((s) => s.category)).toEqual(['Tops', 'Bottoms', 'Shoes', 'Bags']);
    expect(snapshots.map((s) => s.name)).toEqual([
      'Cashmere Knit',
      'Wool Trousers',
      'Leather Loafers',
      'Amber Handbag',
    ]);
  });

  describe('validateSavedOutfitAvailability preflight', () => {
    it('returns valid when all items exist in authoritative inventory', () => {
      const check = validateSavedOutfitAvailability(['item-1', 'item-2'], authoritativeInventory);
      expect(check.isValid).toBe(true);
      expect(check.missingIds).toHaveLength(0);
    });

    it('returns invalid with missing IDs when item has been deleted from inventory', () => {
      const check = validateSavedOutfitAvailability(
        ['item-1', 'deleted-item-id'],
        authoritativeInventory
      );
      expect(check.isValid).toBe(false);
      expect(check.missingIds).toEqual(['deleted-item-id']);
    });
  });
});
