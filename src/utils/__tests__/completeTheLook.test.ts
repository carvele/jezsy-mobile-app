import {
  recommendCompleteTheLook,
  classifyClothingSlot,
  classifyOccasion,
  getOccasionCompatibility,
  CatalogItem,
} from '../completeTheLook';

describe('completeTheLook Stylist Engine', () => {
  const topProduct: CatalogItem = {
    id: 'top-1',
    name: 'Silk Charmeuse Blouse',
    category: 'Tops',
    color: 'Champagne',
    price: 3200,
    image_url: 'https://example.com/blouse.jpg',
  };

  const blazerProduct: CatalogItem = {
    id: 'blazer-1',
    name: 'Structured Tailored Blazer',
    category: 'Outerwear',
    color: 'Black',
    price: 5800,
    image_url: 'https://example.com/blazer.jpg',
  };

  const gownProduct: CatalogItem = {
    id: 'gown-1',
    name: 'Emerald Evening Gala Gown',
    category: 'Dresses',
    color: 'Emerald',
    price: 9500,
    image_url: 'https://example.com/gown.jpg',
  };

  const leggingsProduct: CatalogItem = {
    id: 'active-bottom-1',
    name: 'High-Waist Performance Gym Leggings',
    category: 'Activewear',
    color: 'Black',
    price: 1800,
    image_url: 'https://example.com/leggings.jpg',
  };

  const miniSkirtProduct: CatalogItem = {
    id: 'bottom-skirt-1',
    name: 'A-Line Tailored Mini Skirt',
    category: 'Bottoms',
    color: 'Black',
    price: 2400,
    image_url: 'https://example.com/skirt.jpg',
  };

  const heelsProduct: CatalogItem = {
    id: 'heels-1',
    name: 'Pointed Toe Stiletto Heels',
    category: 'Footwear',
    color: 'Nude',
    price: 3600,
    image_url: 'https://example.com/heels.jpg',
  };

  const clutchProduct: CatalogItem = {
    id: 'bag-1',
    name: 'Gold Envelope Clutch',
    category: 'Bags',
    color: 'Gold',
    price: 2900,
    image_url: 'https://example.com/clutch.jpg',
  };

  const intimatesProduct: CatalogItem = {
    id: 'intimates-1',
    name: 'Seamless Lace Panties',
    category: 'Lingerie',
    color: 'Black',
    price: 650,
    image_url: 'https://example.com/panties.jpg',
  };

  describe('Classification', () => {
    it('correctly classifies clothing slots based on category and name', () => {
      expect(classifyClothingSlot(topProduct)).toBe('top');
      expect(classifyClothingSlot(blazerProduct)).toBe('outerwear');
      expect(classifyClothingSlot(gownProduct)).toBe('one_piece');
      expect(classifyClothingSlot(leggingsProduct)).toBe('bottom');
      expect(classifyClothingSlot(miniSkirtProduct)).toBe('bottom');
      expect(classifyClothingSlot(heelsProduct)).toBe('footwear');
      expect(classifyClothingSlot(clutchProduct)).toBe('bag');
      expect(classifyClothingSlot(intimatesProduct)).toBe('intimates');
    });

    it('correctly classifies occasion archetypes', () => {
      expect(classifyOccasion(leggingsProduct)).toBe('active');
      expect(classifyOccasion(blazerProduct)).toBe('tailored');
      expect(classifyOccasion(gownProduct)).toBe('formal');
    });

    it('respects explicit metadata over name heuristics', () => {
      const customItem: CatalogItem = {
        id: 'custom-1',
        name: 'Gym Tee Shirt',
        category: 'Tops',
        color: 'White',
        price: 1000,
        image_url: 'https://example.com/img.jpg',
        style_slot: 'one_piece',
        occasion_tags: ['formal'],
      };
      expect(classifyClothingSlot(customItem)).toBe('one_piece');
      expect(classifyOccasion(customItem)).toBe('formal');
    });
  });

  describe('Occasion Compatibility Matrix', () => {
    it('strictly forbids activewear pairing with tailored or formal items', () => {
      expect(getOccasionCompatibility('active', 'tailored')).toBe(0.0);
      expect(getOccasionCompatibility('tailored', 'active')).toBe(0.0);
      expect(getOccasionCompatibility('active', 'formal')).toBe(0.0);
      expect(getOccasionCompatibility('formal', 'active')).toBe(0.0);
    });

    it('allows high compatibility within same occasion', () => {
      expect(getOccasionCompatibility('formal', 'formal')).toBe(1.0);
      expect(getOccasionCompatibility('tailored', 'tailored')).toBe(1.0);
      expect(getOccasionCompatibility('active', 'active')).toBe(1.0);
    });
  });

  describe('Outfit Blueprints & Slot Deduplication', () => {
    it('never recommends two bottoms in the same look (e.g. no gym leggings + mini skirt collision)', () => {
      const catalog = [
        leggingsProduct,
        miniSkirtProduct,
        blazerProduct,
        heelsProduct,
        clutchProduct,
      ];

      const recommendations = recommendCompleteTheLook(topProduct, catalog, 4);

      const slots = recommendations.map((r) => r.slot);
      const bottomCount = slots.filter((s) => s === 'bottom').length;

      expect(bottomCount).toBeLessThanOrEqual(1);
      // Leggings are activewear and should be rejected or outscored by tailored skirt for silk top
      expect(recommendations.some((r) => r.product.id === leggingsProduct.id)).toBe(false);
      expect(recommendations.some((r) => r.product.id === miniSkirtProduct.id)).toBe(true);
    });

    it('never recommends activewear gym leggings with a tailored blazer anchor', () => {
      const catalog = [
        topProduct,
        miniSkirtProduct,
        leggingsProduct,
        heelsProduct,
      ];

      const recommendations = recommendCompleteTheLook(blazerProduct, catalog, 4);

      expect(recommendations.some((r) => r.product.id === leggingsProduct.id)).toBe(false);
    });

    it('never recommends tops or bottoms when anchor is a one-piece dress/gown', () => {
      const catalog = [
        topProduct,
        miniSkirtProduct,
        blazerProduct,
        heelsProduct,
        clutchProduct,
      ];

      const recommendations = recommendCompleteTheLook(gownProduct, catalog, 4);

      const slots = recommendations.map((r) => r.slot);
      expect(slots).not.toContain('top');
      expect(slots).not.toContain('bottom');
      expect(slots).toContain('footwear');
      expect(slots).toContain('bag');
    });

    it('strictly excludes intimates/lingerie from outerwear looks', () => {
      const catalog = [
        miniSkirtProduct,
        intimatesProduct,
        heelsProduct,
      ];

      const recommendations = recommendCompleteTheLook(topProduct, catalog, 4);

      expect(recommendations.some((r) => r.product.id === intimatesProduct.id)).toBe(false);
    });

    it('produces deterministic output across multiple runs', () => {
      const catalog = [
        miniSkirtProduct,
        blazerProduct,
        heelsProduct,
        clutchProduct,
      ];

      const run1 = recommendCompleteTheLook(topProduct, catalog, 4);
      const run2 = recommendCompleteTheLook(topProduct, catalog, 4);

      expect(run1.map((r) => r.product.id)).toEqual(run2.map((r) => r.product.id));
    });
  });
});
