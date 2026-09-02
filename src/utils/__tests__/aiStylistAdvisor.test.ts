import { gradeOutfit } from '../aiStylistAdvisor';
import { MannequinCanvasItem } from '../mannequinConfig';

function mockItem(
  id: string,
  garment_type: string,
  name: string,
  color?: string
): { canvasItem: MannequinCanvasItem; wardrobeItem: any } {
  return {
    canvasItem: {
      id,
      wardrobe_item_id: `w_${id}`,
      image_url: 'https://example.com/item.png',
      name,
      garment_type,
      x: 0,
      y: 0.2,
      scale: 1.0,
      rotation: 0,
      zIndex: 1,
    },
    wardrobeItem: {
      id: `w_${id}`,
      garment_type,
      color: color || '',
      color_tags: color ? [color] : [],
      name,
    },
  };
}

describe('aiStylistAdvisor - Deterministic Outfit Grader', () => {
  // Test 1: Empty Canvas
  test('returns 0 score and Grade D for empty canvas', () => {
    const critique = gradeOutfit([]);
    expect(critique.score).toBe(0);
    expect(critique.grade).toBe('D');
    expect(critique.headline).toBe('Mannequin is Empty');
    expect(critique.pillars.compositionAndLayers.status).toBe('alert');
  });

  // Test 2: Single-item incomplete outfit (e.g. Top only)
  test('flags single top as incomplete with capped score and guidance', () => {
    const top = mockItem('1', 'Top', 'Linen Blouse', 'white');
    const lookup = { [top.wardrobeItem.id]: top.wardrobeItem };

    const critique = gradeOutfit([top.canvasItem], lookup);
    expect(critique.score).toBeLessThanOrEqual(65);
    expect(critique.pillars.compositionAndLayers.title).toBe('Incomplete Ensemble');
    expect(critique.tips.some((t) => t.includes('bottoms') || t.includes('trousers'))).toBe(true);
  });

  // Test 3: Missing shoes penalty (Top + Bottom without shoes)
  test('flags missing shoes and prompts user to add footwear', () => {
    const top = mockItem('1', 'Top', 'Cream Blouse', 'cream');
    const bottom = mockItem('2', 'Bottom', 'Navy Trousers', 'navy');
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
    };

    const critique = gradeOutfit([top.canvasItem, bottom.canvasItem], lookup);
    expect(critique.tips.some((t) => t.toLowerCase().includes('shoes') || t.toLowerCase().includes('footwear'))).toBe(true);
    expect(critique.pillars.compositionAndLayers.feedback).toContain('footwear');
  });

  // Test 4: All-neutral combination (Cream top + Charcoal trousers + Black shoes)
  test('awards Grade A for an all-neutral tailored palette', () => {
    const top = mockItem('1', 'Top', 'Cream Knit Top', 'cream');
    const bottom = mockItem('2', 'Bottom', 'Charcoal Trousers', 'charcoal');
    const shoes = mockItem('3', 'Shoes', 'Black Leather Loafers', 'black');
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([top.canvasItem, bottom.canvasItem, shoes.canvasItem], lookup);
    expect(critique.score).toBeGreaterThanOrEqual(90);
    expect(['A+', 'A', 'A-']).toContain(critique.grade);
    expect(critique.pillars.colorHarmony.title).toBe('Perfect Harmony');
  });

  // Test 5: Monochromatic palette (Sky blue top + Navy pants + Blue shoes)
  test('awards high score for monochromatic harmony', () => {
    const top = mockItem('1', 'Top', 'Light Blue Shirt', '#87CEEB'); // H ~197
    const bottom = mockItem('2', 'Bottom', 'Navy Trousers', '#1E3A5F'); // H ~214 (gap < 20)
    const shoes = mockItem('3', 'Shoes', 'Cobalt Sneakers', '#0047AB');
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([top.canvasItem, bottom.canvasItem, shoes.canvasItem], lookup);
    expect(critique.score).toBeGreaterThanOrEqual(85);
    expect(critique.pillars.colorHarmony.score).toBeGreaterThanOrEqual(88);
  });

  // Test 6: Clashing saturated colors (Orange top + Neon green bottom)
  test('penalizes clashing saturated colors and provides constructive anchor advice', () => {
    const top = mockItem('1', 'Top', 'Vibrant Orange Top', '#EA580C'); // Orange
    const bottom = mockItem('2', 'Bottom', 'Neon Green Skirt', '#39FF14'); // Neon green (discordant hue gap ~80)
    const shoes = mockItem('3', 'Shoes', 'Yellow Shoes', 'yellow');
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([top.canvasItem, bottom.canvasItem, shoes.canvasItem], lookup);
    expect(critique.pillars.colorHarmony.title).toBe('Clashing Colors');
    expect(critique.score).toBeLessThan(75);
    expect(critique.tips[0]).toContain('neutral');
  });

  // Test 7: Competing metallics (Gold accessory + Silver jewelry)
  test('penalizes competing metallics (Gold + Silver)', () => {
    const top = mockItem('1', 'Top', 'Black Dress', 'black');
    const acc1 = mockItem('2', 'Accessory', 'Gold Belt', 'gold');
    const acc2 = mockItem('3', 'Accessory', 'Silver Necklace', 'silver');
    const shoes = mockItem('4', 'Shoes', 'Black Heels', 'black');
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [acc1.wardrobeItem.id]: acc1.wardrobeItem,
      [acc2.wardrobeItem.id]: acc2.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([top.canvasItem, acc1.canvasItem, acc2.canvasItem, shoes.canvasItem], lookup);
    expect(critique.pillars.colorHarmony.title).toBe('Clashing Colors');
    expect(critique.pillars.colorHarmony.feedback).toContain('splits the eye');
  });

  // Test 8: Complementary harmony (Navy + Mustard/Orange)
  test('recognizes complementary color harmony', () => {
    const top = mockItem('1', 'Top', 'Mustard Sweater', 'mustard');
    const bottom = mockItem('2', 'Bottom', 'Navy Pants', 'navy');
    const shoes = mockItem('3', 'Shoes', 'Brown Boots', 'brown');
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([top.canvasItem, bottom.canvasItem, shoes.canvasItem], lookup);
    expect(critique.score).toBeGreaterThanOrEqual(80);
    expect(['A+', 'A', 'A-', 'B+']).toContain(critique.grade);
  });

  // Test 10: Overcrowded canvas with 3 tops simultaneously (user scenario)
  test('flags 3 competing tops on the mannequin as overcrowded and severely docks score', () => {
    const top1 = mockItem('1', 'Top', 'Black Tee', 'black');
    const top2 = mockItem('2', 'Top', 'Navy Blouse', 'navy');
    const top3 = mockItem('3', 'Top', 'Burgundy Longsleeve', 'burgundy');
    const bottom = mockItem('4', 'Bottom', 'Black Skirt', 'black');
    const lookup = {
      [top1.wardrobeItem.id]: top1.wardrobeItem,
      [top2.wardrobeItem.id]: top2.wardrobeItem,
      [top3.wardrobeItem.id]: top3.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
    };

    const critique = gradeOutfit([top1.canvasItem, top2.canvasItem, top3.canvasItem, bottom.canvasItem], lookup);
    expect(critique.isOvercrowded).toBe(true);
    expect(critique.score).toBeLessThanOrEqual(68);
    expect(['C+', 'C', 'C-', 'D']).toContain(critique.grade);
    expect(critique.headline).toBe('Overcrowded Top Half');
    expect(critique.verdict).toContain('competing tops');
    expect(critique.tips[0]).toContain('extra top');
  });
});
