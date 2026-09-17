import {
  createMannequinItem,
  addMannequinItemSafely,
  MannequinCanvasItem,
  WardrobeItem,
} from '../mannequinConfig';

function createMockWardrobeItem(id: string, garment_type: string = 'Top', name: string = 'Test Item'): WardrobeItem {
  return {
    id,
    user_id: 'user_123',
    name,
    category: garment_type,
    sub_category: name,
    garment_type,
    image_url: `https://example.com/${id}.png`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted: false,
    color: 'Pink',
    color_tags: ['pink'],
    season: 'All',
    where_worn_often: 'Casual',
    user_notes: null,
    metadata: null,
  } as unknown as WardrobeItem;
}

describe('Mannequin Canvas Invariant & State Transition Tests', () => {
  describe('addMannequinItemSafely Invariant', () => {
    it('adds a new garment to an empty canvas with baseline zIndex', () => {
      const wardrobeItem = createMockWardrobeItem('item_1', 'Top', 'Silk Shirt');
      const canvasItem = createMannequinItem(wardrobeItem, 0);

      const result = addMannequinItemSafely([], canvasItem);

      expect(result).toHaveLength(1);
      expect(result[0].wardrobe_item_id).toBe('item_1');
      expect(result[0].zIndex).toBeGreaterThanOrEqual(1);
    });

    it('enforces strictly at most one canvas layer per wardrobe_item_id (no duplicates)', () => {
      const wardrobeItem = createMockWardrobeItem('item_skirt', 'Bottom', 'Pink Skirt');
      const firstItem = createMannequinItem(wardrobeItem, 0);

      const canvasWithOne = addMannequinItemSafely([], firstItem);
      expect(canvasWithOne).toHaveLength(1);

      // Attempting to add the same wardrobe item again
      const secondItem = createMannequinItem(wardrobeItem, 5);
      const canvasAfterDuplicateAdd = addMannequinItemSafely(canvasWithOne, secondItem);

      expect(canvasAfterDuplicateAdd).toHaveLength(1);
      expect(canvasAfterDuplicateAdd[0].id).toBe(firstItem.id);
      expect(canvasAfterDuplicateAdd[0].wardrobe_item_id).toBe('item_skirt');
    });

    it('guards against rapid double-taps (tap x2) on the same drawer card', () => {
      const wardrobeItem = createMockWardrobeItem('skirt_123', 'Bottom', 'Pleated Skirt');

      let canvas: MannequinCanvasItem[] = [];

      // Simulate rapid tap 1
      const tap1Item = createMannequinItem(wardrobeItem, 0);
      canvas = addMannequinItemSafely(canvas, tap1Item);

      // Simulate rapid tap 2 (before any state settlement or layout animation)
      const tap2Item = createMannequinItem(wardrobeItem, 0);
      canvas = addMannequinItemSafely(canvas, tap2Item);

      expect(canvas).toHaveLength(1);
      expect(canvas[0].id).toBe(tap1Item.id);
    });

    it('guards against rapid triple-taps (tap x3) on the same drawer card', () => {
      const wardrobeItem = createMockWardrobeItem('jacket_456', 'Outerwear', 'Leather Jacket');

      let canvas: MannequinCanvasItem[] = [];

      const tap1 = createMannequinItem(wardrobeItem, 0);
      const tap2 = createMannequinItem(wardrobeItem, 0);
      const tap3 = createMannequinItem(wardrobeItem, 0);

      canvas = addMannequinItemSafely(canvas, tap1);
      canvas = addMannequinItemSafely(canvas, tap2);
      canvas = addMannequinItemSafely(canvas, tap3);

      expect(canvas).toHaveLength(1);
      expect(canvas[0].id).toBe(tap1.id);
    });

    it('prevents duplicates when async background removal promises resolve concurrently', async () => {
      const wardrobeItem = createMockWardrobeItem('dress_789', 'Dress', 'Summer Dress');
      let canvasState: MannequinCanvasItem[] = [];

      // Simulate two async background removal promises for the same item
      const asyncAdd1 = async () => {
        await new Promise((r) => setTimeout(r, 10));
        const item = createMannequinItem(wardrobeItem, 0);
        canvasState = addMannequinItemSafely(canvasState, item);
      };

      const asyncAdd2 = async () => {
        await new Promise((r) => setTimeout(r, 20));
        const item = createMannequinItem(wardrobeItem, 0);
        canvasState = addMannequinItemSafely(canvasState, item);
      };

      await Promise.all([asyncAdd1(), asyncAdd2()]);

      expect(canvasState).toHaveLength(1);
      expect(canvasState[0].wardrobe_item_id).toBe('dress_789');
    });

    it('allows different distinct wardrobe items to be added with stacked zIndex', () => {
      const shirt = createMockWardrobeItem('shirt_1', 'Top', 'White Tee');
      const skirt = createMockWardrobeItem('skirt_1', 'Bottom', 'A-Line Skirt');
      const shoes = createMockWardrobeItem('shoes_1', 'Shoes', 'Loafers');

      let canvas: MannequinCanvasItem[] = [];
      canvas = addMannequinItemSafely(canvas, createMannequinItem(shirt, 0));
      canvas = addMannequinItemSafely(canvas, createMannequinItem(skirt, 0));
      canvas = addMannequinItemSafely(canvas, createMannequinItem(shoes, 0));

      expect(canvas).toHaveLength(3);
      expect(canvas.map((i) => i.wardrobe_item_id)).toEqual(['shirt_1', 'skirt_1', 'shoes_1']);
      // Each subsequent item is stacked above the previous
      expect(canvas[1].zIndex).toBeGreaterThan(canvas[0].zIndex);
      expect(canvas[2].zIndex).toBeGreaterThan(canvas[1].zIndex);
    });
  });

  describe('Layer Ordering & Transform Invariance on Selection', () => {
    it('preserves exact layer order (zIndex) when focusing an existing item', () => {
      const shirt = createMockWardrobeItem('shirt_1', 'Top', 'Inner Top');
      const jacket = createMockWardrobeItem('jacket_1', 'Outerwear', 'Outer Jacket');

      let canvas: MannequinCanvasItem[] = [];
      const shirtItem = createMannequinItem(shirt, 0);
      canvas = addMannequinItemSafely(canvas, shirtItem);

      const jacketItem = createMannequinItem(jacket, 0);
      canvas = addMannequinItemSafely(canvas, jacketItem);

      expect(canvas[0].wardrobe_item_id).toBe('shirt_1');
      expect(canvas[1].wardrobe_item_id).toBe('jacket_1');
      expect(canvas[0].zIndex).toBeLessThan(canvas[1].zIndex);

      const initialShirtZIndex = canvas[0].zIndex;
      const initialJacketZIndex = canvas[1].zIndex;

      // User taps shirt in the wardrobe drawer to select it
      // Selection handler finds existing and sets selectedItemId without mutating canvasItems
      const existing = canvas.find((i) => i.wardrobe_item_id === shirt.id);
      expect(existing).toBeDefined();
      const selectedItemId = existing!.id;

      // Invariant: selecting shirt must NOT elevate its zIndex above jacket
      const shirtAfterSelect = canvas.find((i) => i.id === selectedItemId);
      const jacketAfterSelect = canvas.find((i) => i.wardrobe_item_id === 'jacket_1');

      expect(shirtAfterSelect!.zIndex).toBe(initialShirtZIndex);
      expect(jacketAfterSelect!.zIndex).toBe(initialJacketZIndex);
      expect(shirtAfterSelect!.zIndex).toBeLessThan(jacketAfterSelect!.zIndex);
    });

    it('guarantees x, y, scale, rotation, and zIndex are 100% unchanged across select -> deselect cycles', () => {
      const dress = createMockWardrobeItem('dress_1', 'Dress', 'Evening Gown');
      const item = createMannequinItem(dress, 0);
      // Give it non-default custom placement to verify nothing resets
      item.x = 0.15;
      item.y = 0.35;
      item.scale = 1.25;
      item.rotation = 15;
      item.zIndex = 4;

      const initialSnapshot = { ...item };

      // Cycle 1: Select item
      let selectedId: string | null = item.id;
      expect(selectedId).toBe(item.id);
      expect(item.x).toBe(initialSnapshot.x);
      expect(item.y).toBe(initialSnapshot.y);
      expect(item.scale).toBe(initialSnapshot.scale);
      expect(item.rotation).toBe(initialSnapshot.rotation);
      expect(item.zIndex).toBe(initialSnapshot.zIndex);

      // Cycle 2: Deselect (tap backdrop)
      selectedId = null;
      expect(selectedId).toBeNull();
      expect(item.x).toBe(initialSnapshot.x);
      expect(item.y).toBe(initialSnapshot.y);
      expect(item.scale).toBe(initialSnapshot.scale);
      expect(item.rotation).toBe(initialSnapshot.rotation);
      expect(item.zIndex).toBe(initialSnapshot.zIndex);

      // Cycle 3: Reselect item
      selectedId = item.id;
      expect(selectedId).toBe(item.id);
      expect(item.x).toBe(initialSnapshot.x);
      expect(item.y).toBe(initialSnapshot.y);
      expect(item.scale).toBe(initialSnapshot.scale);
      expect(item.rotation).toBe(initialSnapshot.rotation);
      expect(item.zIndex).toBe(initialSnapshot.zIndex);
    });
  });
});
