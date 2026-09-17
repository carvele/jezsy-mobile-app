import {
  gradeOutfit,
  extractColors,
  interpretOutfitContext,
  buildGarmentSemanticProfile,
} from '../aiStylistAdvisor';
import { MannequinCanvasItem } from '../mannequinConfig';
import { DEFAULT_STYLE_PROFILE, updateProfileFromFeedback } from '../personalStyleEngine';

function mockItem(
  id: string,
  garment_type: string,
  name: string,
  options?: {
    color?: string;
    color_tags?: string[];
    category?: string;
    sub_category?: string;
    where_worn_often?: string;
    description?: string;
    user_notes?: string;
  }
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
      category: options?.category || garment_type,
      sub_category: options?.sub_category || '',
      color: options?.color || '',
      color_tags: options?.color_tags || (options?.color ? [options.color] : []),
      name,
      where_worn_often: options?.where_worn_often || '',
      description: options?.description || '',
      user_notes: options?.user_notes || '',
    },
  };
}

describe('aiStylistAdvisor - Critical Context & Garment Compatibility Engine', () => {
  // =========================================================================
  // Part 34: 12 REQUIRED REGRESSION TESTS
  // =========================================================================

  // TEST 1: Blazer + Running Shorts + Sneakers + no top + Wedding
  test('TEST 1: Blazer + running shorts + sneakers + no top for Wedding is NOT approved, identifies mismatch and missing base top, has NO numeric or letter grade', () => {
    const blazer = mockItem('1', 'Outerwear', 'Tailored Navy Blazer', {
      category: 'Outerwear',
      sub_category: 'Blazer',
      color: 'navy',
      description: 'Structured wool blend tailored blazer',
    });
    const shorts = mockItem('2', 'Bottom', 'Running Shorts', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      color: 'black',
      where_worn_often: 'Running, gym',
      description: 'Lightweight shorts for exercise and marathon training',
    });
    const sneakers = mockItem('3', 'Shoes', 'Athletic Running Sneakers', {
      category: 'Shoes',
      sub_category: 'Running Shoes',
      color: 'white',
      where_worn_often: 'Gym, running track',
      description: 'Cushioned athletic sneakers for running',
    });

    const lookup = {
      [blazer.wardrobeItem.id]: blazer.wardrobeItem,
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [sneakers.wardrobeItem.id]: sneakers.wardrobeItem,
    };

    const critique = gradeOutfit(
      [blazer.canvasItem, shorts.canvasItem, sneakers.canvasItem],
      lookup,
      { occasion: 'Wedding' }
    );

    // 1. Assessment must NOT be "Appropriate for this occasion"
    expect(critique.assessment).not.toBe('Appropriate for this occasion');
    expect(critique.assessment).toBe('Not appropriate for this occasion');

    // 2. NO user-facing numeric score or letter grade
    expect((critique as any).score).toBeUndefined();
    expect((critique as any).grade).toBeUndefined();

    // 3. No fake praise / "Why this works" strictly omitted
    expect(critique.whatWorks).toBeUndefined();
    expect(critique.verdict.toLowerCase()).not.toContain('good for wedding');
    expect(critique.verdict.toLowerCase()).not.toContain('solid combination');
    expect(critique.verdict.toLowerCase()).not.toContain('balanced');
    expect(critique.verdict.toLowerCase()).not.toContain('well-calibrated');
    expect(critique.headline.toLowerCase()).not.toContain('smart casual statement');
    expect(critique.stylistsTake.toLowerCase()).not.toContain('solid combination');
    expect(critique.stylistsTake.toLowerCase()).not.toContain('balanced');
    expect(critique.stylistsTake.toLowerCase()).not.toContain('cohesive ensemble');

    // 4. Identifies casual/athletic mismatch
    expect(critique.whatCouldBeBetter?.toLowerCase()).toMatch(/athletic|running|casual|conflict/);

    // 5. Identifies missing upper-body base layer
    expect(critique.whatsMissing?.toLowerCase()).toMatch(/upper-body base layer|base layer|shirt|blouse|underneath/);

    // 6. Honest stylist take communicates the contradiction
    expect(critique.stylistsTake.toLowerCase()).toMatch(/blazer/);
    expect(critique.stylistsTake.toLowerCase()).toMatch(/running shorts|athletic/);
  });

  // PART 24 TESTS: Context-as-a-constraint tests
  test('PART 24: Running Shorts + Running Shoes for Running context is activity-appropriate', () => {
    const shorts = mockItem('1', 'Bottom', 'Running Shorts', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      color: 'black',
      where_worn_often: 'Running, gym',
      description: 'Lightweight running shorts for exercise',
    });
    const shoes = mockItem('2', 'Shoes', 'Running Shoes', {
      category: 'Shoes',
      sub_category: 'Running Shoes',
      color: 'blue',
      where_worn_often: 'Running',
    });
    const lookup = {
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([shorts.canvasItem, shoes.canvasItem], lookup, { occasion: 'Running' });
    expect(critique.assessment).toBe('Appropriate for this occasion');
    expect(critique.headline).toBe('Functional Running Gear');
    expect(critique.verdict).toContain('Running');
  });

  test('PART 24: Running Shorts + Running Shoes for Casual day out is contextually evaluated, not automatically rejected', () => {
    const shorts = mockItem('1', 'Bottom', 'Running Shorts', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      color: 'black',
      where_worn_often: 'Running, gym',
    });
    const shoes = mockItem('2', 'Shoes', 'Running Shoes', {
      category: 'Shoes',
      sub_category: 'Running Shoes',
      color: 'black',
    });
    const lookup = {
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [shoes.wardrobeItem.id]: shorts.wardrobeItem,
    };

    const critique = gradeOutfit([shorts.canvasItem, shoes.canvasItem], lookup, { occasion: 'Casual day out' });
    expect(critique.assessment).toBe('Could work with changes');
    expect(critique.assessment).not.toBe('Not appropriate for this occasion');
    expect(critique.whatsMissing?.toLowerCase()).toMatch(/top|t-shirt|hoodie/);
  });

  test('PART 24: Running Shorts + Running Shoes for Wedding produces strong contextual mismatch', () => {
    const shorts = mockItem('1', 'Bottom', 'Running Shorts', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      color: 'black',
      where_worn_often: 'Running, gym',
    });
    const shoes = mockItem('2', 'Shoes', 'Running Shoes', {
      category: 'Shoes',
      sub_category: 'Running Shoes',
      color: 'black',
    });
    const lookup = {
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([shorts.canvasItem, shoes.canvasItem], lookup, { occasion: 'Wedding' });
    expect(critique.assessment).toBe('Not appropriate for this occasion');
    expect(critique.whatWorks).toBeUndefined();
    expect(critique.whatCouldBeBetter?.toLowerCase()).toMatch(/athletic|formal|trousers/);
  });

  test('PART 24: Tailored Shorts + Elevated Top + Loafers for Beach Wedding is NOT automatically rejected simply because shorts exist', () => {
    const shorts = mockItem('1', 'Bottom', 'Tailored Linen Shorts', {
      category: 'Bottom',
      sub_category: 'Tailored Shorts',
      color: 'beige',
      where_worn_often: 'Resort, summer outings',
      description: 'Linen tailored Bermuda shorts with pleat details',
    });
    const top = mockItem('2', 'Top', 'Linen Button-Down Shirt', {
      category: 'Top',
      sub_category: 'Button-Down',
      color: 'white',
      description: 'Crisp white breathable linen shirt',
    });
    const shoes = mockItem('3', 'Shoes', 'Suede Loafers', {
      category: 'Shoes',
      sub_category: 'Loafers',
      color: 'tan',
      description: 'Casual suede driving loafers',
    });
    const lookup = {
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [top.wardrobeItem.id]: top.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([shorts.canvasItem, top.canvasItem, shoes.canvasItem], lookup, { occasion: 'Beach Wedding' });
    expect(critique.assessment).toBe('Appropriate for this occasion');
    expect(critique.headline).toBe('Refined Resort Styling');
    expect(critique.whatWorks).toBeDefined();
  });

  // TEST 2: Same outfit + Casual day out
  test('TEST 2: Same outfit for Casual day out recognizes contextual difference but notes missing inner top', () => {
    const blazer = mockItem('1', 'Outerwear', 'Tailored Navy Blazer', {
      category: 'Outerwear',
      sub_category: 'Blazer',
      color: 'navy',
    });
    const shorts = mockItem('2', 'Bottom', 'Running Shorts', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      color: 'black',
      where_worn_often: 'Running, gym',
    });
    const sneakers = mockItem('3', 'Shoes', 'Athletic Running Sneakers', {
      category: 'Shoes',
      sub_category: 'Running Shoes',
      color: 'white',
    });

    const lookup = {
      [blazer.wardrobeItem.id]: blazer.wardrobeItem,
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [sneakers.wardrobeItem.id]: sneakers.wardrobeItem,
    };

    const critique = gradeOutfit(
      [blazer.canvasItem, shorts.canvasItem, sneakers.canvasItem],
      lookup,
      { occasion: 'Casual day out' }
    );

    // Recognizes high-low streetwear potential with changes
    expect(critique.assessment).toBe('Could work with changes');
    expect(critique.whatWorks).toBeDefined();
    expect(critique.whatWorks?.toLowerCase()).toMatch(/high-low|contrast|structure/);
    // Still identifies missing inner top
    expect(critique.whatsMissing?.toLowerCase()).toMatch(/base layer|top|tee/);
  });

  // TEST 3: Dress + shoes + Wedding
  test('TEST 3: Dress + shoes for Wedding recognizes complete one-piece foundation without claiming missing top/bottom', () => {
    const dress = mockItem('1', 'Dress', 'Floral Silk Midi Dress', {
      category: 'Dress',
      sub_category: 'Midi Dress',
      color: 'navy',
      description: 'Silk midi dress with floral embroidery, elegant waistline',
    });
    const shoes = mockItem('2', 'Shoes', 'Leather Block Heels', {
      category: 'Shoes',
      sub_category: 'Heels',
      color: 'nude',
      description: 'Comfortable formal block heel pumps',
    });

    const lookup = {
      [dress.wardrobeItem.id]: dress.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit(
      [dress.canvasItem, shoes.canvasItem],
      lookup,
      { occasion: 'Wedding' }
    );

    expect(critique.assessment).toBe('Appropriate for this occasion');
    // Must NOT say missing top or bottom
    expect(critique.whatsMissing).toBeUndefined();
    expect(critique.whatCouldBeBetter || '').not.toMatch(/missing top|missing bottom/i);
    expect(critique.whatWorks).toBeDefined();
  });

  // TEST 4: Jumpsuit + shoes + Wedding
  test('TEST 4: Jumpsuit + shoes for Wedding treats jumpsuit as complete one-piece garment', () => {
    const jumpsuit = mockItem('1', 'Dress', 'Tailored Black Jumpsuit', {
      category: 'Dress',
      sub_category: 'Jumpsuit',
      color: 'black',
      description: 'Wide-leg formal crepe jumpsuit with tailored waist',
    });
    const shoes = mockItem('2', 'Shoes', 'Strappy Evening Heels', {
      category: 'Shoes',
      sub_category: 'Heels',
      color: 'black',
    });

    const lookup = {
      [jumpsuit.wardrobeItem.id]: jumpsuit.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit(
      [jumpsuit.canvasItem, shoes.canvasItem],
      lookup,
      { occasion: 'Wedding' }
    );

    expect(critique.assessment).toBe('Appropriate for this occasion');
    expect(critique.whatsMissing).toBeUndefined();
    expect(critique.whatCouldBeBetter || '').not.toMatch(/missing top|missing bottom/i);
  });

  // TEST 5: Color "navy blue, white"
  test('TEST 5: Multi-color user entry "navy blue, white" preserves BOTH distinct colors without collapsing', () => {
    const item = mockItem('1', 'Top', 'Striped Sailor Tee', {
      color: 'navy blue, white',
    });
    const lookup = { [item.wardrobeItem.id]: item.wardrobeItem };

    const colors = extractColors([item.canvasItem], lookup);
    expect(colors).toContain('navy blue');
    expect(colors).toContain('white');
    expect(colors.length).toBeGreaterThanOrEqual(2);
  });

  // TEST 6: Where worn often "Running and gym"
  test('TEST 6: Where worn often "Running and gym" contributes strong athletic orientation evidence', () => {
    const shorts = mockItem('1', 'Bottom', 'Workout Shorts', {
      where_worn_often: 'Running and gym',
      category: 'Bottom',
    });
    const top = mockItem('2', 'Top', 'White T-Shirt', {
      color: 'white',
    });

    const lookup = {
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [top.wardrobeItem.id]: top.wardrobeItem,
    };

    const critique = gradeOutfit(
      [shorts.canvasItem, top.canvasItem],
      lookup,
      { occasion: 'Wedding' }
    );

    // Athletic evidence from where_worn_often creates contradiction with Wedding
    expect(critique.assessment).toBe('Not appropriate for this occasion');
    expect(critique.whatCouldBeBetter?.toLowerCase()).toMatch(/athletic|casual|wedding/);
  });

  // TEST 7: Detailed description reaches Stylist
  test('TEST 7: User enters detailed description which reaches Stylist and affects reasoning', () => {
    const top = mockItem('1', 'Top', 'Technical Running Top', {
      description: 'High-visibility fluorescent neon running jersey engineered for marathon training and extreme exercise',
      category: 'Top',
    });
    const bottom = mockItem('2', 'Bottom', 'Track Pants', {
      description: 'Compression sweatpants for gym workout sessions',
      category: 'Bottom',
    });

    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
    };

    const critique = gradeOutfit(
      [top.canvasItem, bottom.canvasItem],
      lookup,
      { occasion: 'Black tie wedding' }
    );

    expect(critique.assessment).toBe('Not appropriate for this occasion');
    expect(critique.whatCouldBeBetter?.toLowerCase()).toMatch(/athletic|casual|formal/);
  });

  // TEST 8: Empty description does not trigger hallucinations
  test('TEST 8: User leaves description empty; Stylist does not fabricate attributes', () => {
    const top = mockItem('1', 'Top', 'Cotton Shirt', {
      description: '',
      color: 'white',
    });
    const bottom = mockItem('2', 'Bottom', 'Chino Pants', {
      description: '',
      color: 'navy',
    });

    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
    };

    const critique = gradeOutfit(
      [top.canvasItem, bottom.canvasItem],
      lookup,
      { occasion: 'Dinner' }
    );

    expect(critique.assessment).toBe('Appropriate for this occasion');
    // Does not hallucinate non-existent descriptions
    expect(critique.stylistsTake).not.toContain('undefined');
    expect(critique.stylistsTake).not.toContain('null');
  });

  // TEST 9: ML unavailable fallback
  test('TEST 9: ML unavailable causes no crash and continues using structured wardrobe metadata', () => {
    const dress = mockItem('1', 'Dress', 'Cocktail Dress', {
      color: 'emerald',
      description: 'Emerald green silk cocktail dress',
    });
    const heels = mockItem('2', 'Shoes', 'Satin Heels', {
      color: 'black',
      category: 'Shoes',
      sub_category: 'Heels',
    });
    const lookup = {
      [dress.wardrobeItem.id]: dress.wardrobeItem,
      [heels.wardrobeItem.id]: heels.wardrobeItem,
    };

    // Evaluating without ML or when ML returns null
    const critique = gradeOutfit([dress.canvasItem, heels.canvasItem], lookup, { occasion: 'Cocktail party' });

    expect(critique).toBeDefined();
    expect(critique.assessment).toBe('Appropriate for this occasion');
    expect(critique.headline).toBeDefined();
    expect(critique.stylistsTake).toBeDefined();
    // Confirms no raw errors or stack traces are exposed
    expect(critique.verdict).not.toContain('Error');
    expect(critique.verdict).not.toContain('stack');
  });

  // TEST 10: Stale or deleted wardrobe item ID
  test('TEST 10: Stale or deleted wardrobe ID handled gracefully without crash or invented items', () => {
    const staleCanvasItem: MannequinCanvasItem = {
      id: 'stale_1',
      wardrobe_item_id: 'non_existent_uuid',
      image_url: '',
      name: 'Old Item',
      garment_type: 'Top',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      zIndex: 1,
    };

    // lookup has no entry for non_existent_uuid
    const critique = gradeOutfit([staleCanvasItem], {}, { occasion: 'Casual day out' });

    expect(critique).toBeDefined();
    expect(critique.assessment).toBe('Incomplete outfit');
    expect(critique.whatsMissing).toBeDefined();
  });

  // TEST 11: Empty mannequin
  test('TEST 11: Empty mannequin handled gracefully with Incomplete outfit and no fake praise', () => {
    const critique = gradeOutfit([]);

    expect(critique.assessment).toBe('Incomplete outfit');
    expect(critique.headline).toBe('Mannequin is Empty');
    expect(critique.whatWorks).toBeUndefined();
    expect(critique.tips.length).toBeGreaterThan(0);
  });

  // TEST 12: No suitable wardrobe replacement available
  test('TEST 12: When user owns no suitable formal replacement, Stylist explicitly says so and never invents one', () => {
    const blazer = mockItem('1', 'Outerwear', 'Navy Blazer', {
      sub_category: 'Blazer',
      category: 'Outerwear',
    });
    const shorts = mockItem('2', 'Bottom', 'Running Shorts', {
      where_worn_often: 'gym, running',
      sub_category: 'Running Shorts',
      category: 'Bottom',
    });
    const sneakers = mockItem('3', 'Shoes', 'Running Sneakers', {
      where_worn_often: 'gym, running',
      sub_category: 'Running Shoes',
      category: 'Shoes',
    });

    // Wardrobe only contains athletic shorts and sneakers (no trousers, no dress shoes)
    const lookup = {
      [blazer.wardrobeItem.id]: blazer.wardrobeItem,
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [sneakers.wardrobeItem.id]: sneakers.wardrobeItem,
    };

    const critique = gradeOutfit(
      [blazer.canvasItem, shorts.canvasItem, sneakers.canvasItem],
      lookup,
      { occasion: 'Wedding' }
    );

    expect(critique.whatsMissing).toContain('JeZsy could not find a suitable formal alternative in your current wardrobe');
    expect(critique.tips.some((t) => t.includes('could not find a suitable formal alternative') || t.includes('does not contain an obvious formal bottom'))).toBe(true);
  });

  // =========================================================================
  // ADDITIONAL REGRESSION & INTEGRATION TESTS
  // =========================================================================

  test('CONFIRMATION: score and grade are removed completely from all critique returns', () => {
    const top = mockItem('1', 'Top', 'White Blouse', { color: 'white' });
    const bottom = mockItem('2', 'Bottom', 'Navy Trousers', { color: 'navy' });
    const shoes = mockItem('3', 'Shoes', 'Black Loafers', { color: 'black' });
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit([top.canvasItem, bottom.canvasItem, shoes.canvasItem], lookup, { occasion: 'Office' });

    expect(critique.assessment).toBe('Appropriate for this occasion');
    expect((critique as any).score).toBeUndefined();
    expect((critique as any).grade).toBeUndefined();
  });

  test('Overcrowded mannequin flags too many competing tops with Incomplete outfit', () => {
    const top1 = mockItem('1', 'Top', 'White Tee');
    const top2 = mockItem('2', 'Top', 'Blue Blouse');
    const bottom = mockItem('3', 'Bottom', 'Jeans');
    const lookup = {
      [top1.wardrobeItem.id]: top1.wardrobeItem,
      [top2.wardrobeItem.id]: top2.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
    };

    const critique = gradeOutfit([top1.canvasItem, top2.canvasItem, bottom.canvasItem], lookup);
    expect(critique.assessment).toBe('Incomplete outfit');
    expect(critique.headline).toBe('Too Many Competing Garments');
    expect(critique.isOvercrowded).toBe(true);
  });

  test('Rain and walking additional context generates appropriate styling advisories', () => {
    const top = mockItem('1', 'Top', 'Blouse');
    const bottom = mockItem('2', 'Bottom', 'Trousers');
    const shoes = mockItem('3', 'Shoes', 'High Heel Pumps', {
      description: '4 inch stiletto high heels',
    });
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit(
      [top.canvasItem, bottom.canvasItem, shoes.canvasItem],
      lookup,
      { occasion: 'Dinner', additionalContext: 'It will rain and I will be walking a lot' }
    );

    expect(critique.tips.some((t) => t.toLowerCase().includes('rain') || t.toLowerCase().includes('umbrella'))).toBe(true);
    expect(critique.tips.some((t) => t.toLowerCase().includes('walking') || t.toLowerCase().includes('high heels'))).toBe(true);
  });

  test('Personal style engine feedback updates profile cleanly', () => {
    const top = mockItem('1', 'Top', 'Silk Camisole', { color: 'black' });
    const bottom = mockItem('2', 'Bottom', 'Tailored Pants', { color: 'black' });

    const updated = updateProfileFromFeedback(
      { ...DEFAULT_STYLE_PROFILE, userId: 'user_1' },
      'liked',
      [top.wardrobeItem, bottom.wardrobeItem],
      'Dinner'
    );

    expect(updated.feedbackCount).toBe(1);
    expect(updated.preferredColors).toContain('black');
  });

  // =========================================================================
  // PHASE 28-34: STYLIST INTELLIGENCE REBUILD REGRESSION SUITE
  // =========================================================================

  test('PHASE 28 REGRESSION: Active Swimming with Sweater + Denim Skirt + Suede Mary Janes is NOT APPROPRIATE', () => {
    const sweater = mockItem('sw_1', 'Top', 'Cropped Turtleneck Sweater', {
      category: 'Top',
      sub_category: 'Sweater',
      color: 'maroon, burgundy',
      description:
        'Maroon/burgundy ribbed-knit cropped turtleneck sweater featuring dropped shoulders and voluminous balloon sleeves with fitted cuffs.',
    });
    const skirt = mockItem('sk_1', 'Bottom', 'Denim Micro Mini Skirt', {
      category: 'Bottom',
      sub_category: 'Denim Skirt',
      color: 'blue denim',
      description:
        'Medium-to-dark wash blue denim micro mini skirt featuring classic five-pocket styling, contrast stitching, and a raw/finished bottom hem.',
    });
    const flats = mockItem('fl_1', 'Shoes', 'Mary Jane Ballet Flats', {
      category: 'Shoes',
      sub_category: 'Flats',
      color: 'chocolate brown',
      description:
        'Chocolate brown suede (or velvet) Mary Jane ballet flats featuring a rounded-square toe, low-profile sole, and an instep strap with a gold-tone buckle.',
    });

    const lookup = {
      [sweater.wardrobeItem.id]: sweater.wardrobeItem,
      [skirt.wardrobeItem.id]: skirt.wardrobeItem,
      [flats.wardrobeItem.id]: flats.wardrobeItem,
    };

    const critique = gradeOutfit(
      [sweater.canvasItem, skirt.canvasItem, flats.canvasItem],
      lookup,
      {
        occasion: 'Swimming',
        additionalContext: "I'll swimming a lot on the pool",
      }
    );

    // 1. Must produce "Not appropriate for this occasion"
    expect(critique.assessment).toBe('Not appropriate for this occasion');

    // 2. No numeric scores or letter grades
    expect((critique as any).score).toBeUndefined();
    expect((critique as any).grade).toBeUndefined();

    // 3. Must recognize active swimming
    expect(critique.contextInterpretation?.activity).toBe('activeSwimming');
    expect(critique.contextInterpretation?.waterExposure).toBe('high');

    // 4. Contradictions must identify multiple water incompatibilities
    expect(critique.contradictions && critique.contradictions.length >= 3).toBe(true);
    const joinedContradictions = critique.contradictions?.join(' ').toLowerCase() || '';
    expect(joinedContradictions).toMatch(/swim|water/);
    expect(joinedContradictions).toMatch(/knit|sweater/);
    expect(joinedContradictions).toMatch(/denim/);
    expect(joinedContradictions).toMatch(/suede|velvet|mary jane|flats|footwear/);

    // 5. Stylist's take explains why active swimming contradicts these fashion separates
    expect(critique.stylistsTake.toLowerCase()).toMatch(/active.*swimming|swimming.*pool/);
    expect(critique.stylistsTake.toLowerCase()).toMatch(/knit.*sweater|sweater/);
    expect(critique.stylistsTake.toLowerCase()).toMatch(/denim/);

    // 6. Visual palette coordination does NOT override contradiction
    if (critique.whatWorks) {
      expect(critique.whatWorks.toLowerCase()).toMatch(/palette|visual/);
      expect(critique.whatWorks.toLowerCase()).toMatch(/does not overcome|contradiction|activity mismatch/);
    }

    // 7. What's missing requires swim-appropriate clothing
    expect(critique.whatsMissing?.toLowerCase()).toMatch(/swim/);
  });

  test('PHASE 30 REGRESSION: Pool party distinguishes social gathering from active swimming', () => {
    const shirt = mockItem('sh_1', 'Top', 'Linen Shirt', {
      category: 'Top',
      sub_category: 'Linen Button-Down',
      color: 'white',
      description: 'Breezy lightweight linen shirt for summer',
    });
    const shorts = mockItem('sh_2', 'Bottom', 'Chino Shorts', {
      category: 'Bottom',
      sub_category: 'Chino Shorts',
      color: 'beige',
      description: 'Casual chino shorts for warm weather',
    });
    const sandals = mockItem('sh_3', 'Shoes', 'Slides', {
      category: 'Shoes',
      sub_category: 'Pool Slides',
      color: 'tan',
      description: 'Waterproof pool slides',
    });

    const lookup = {
      [shirt.wardrobeItem.id]: shirt.wardrobeItem,
      [shorts.wardrobeItem.id]: shorts.wardrobeItem,
      [sandals.wardrobeItem.id]: sandals.wardrobeItem,
    };

    const critique = gradeOutfit(
      [shirt.canvasItem, shorts.canvasItem, sandals.canvasItem],
      lookup,
      { occasion: 'Pool party' }
    );

    // Pool party social setting is NOT treated as active swimming
    expect(critique.contextInterpretation?.activity).toBe('poolsideSocial');
    expect(critique.assessment).toBe('Appropriate for this occasion');
    expect(critique.headline).toBe('Poolside Social Ensemble');
  });

  test('PHASE 29 REGRESSION: Same outfit evaluated differently for Casual day out vs Swimming', () => {
    const sweater = mockItem('sw_1', 'Top', 'Ribbed Sweater', {
      category: 'Top',
      sub_category: 'Sweater',
      color: 'burgundy',
      description: 'Ribbed knit sweater',
    });
    const skirt = mockItem('sk_1', 'Bottom', 'Denim Skirt', {
      category: 'Bottom',
      sub_category: 'Denim Skirt',
      color: 'blue denim',
      description: 'Denim mini skirt',
    });
    const flats = mockItem('fl_1', 'Shoes', 'Mary Jane Flats', {
      category: 'Shoes',
      sub_category: 'Flats',
      color: 'brown',
      description: 'Mary Jane ballet flats',
    });

    const lookup = {
      [sweater.wardrobeItem.id]: sweater.wardrobeItem,
      [skirt.wardrobeItem.id]: skirt.wardrobeItem,
      [flats.wardrobeItem.id]: flats.wardrobeItem,
    };

    const casualCritique = gradeOutfit(
      [sweater.canvasItem, skirt.canvasItem, flats.canvasItem],
      lookup,
      { occasion: 'Casual day out' }
    );

    const swimCritique = gradeOutfit(
      [sweater.canvasItem, skirt.canvasItem, flats.canvasItem],
      lookup,
      { occasion: 'Swimming', additionalContext: "I'll be swimming a lot in the pool" }
    );

    // Casual day out accepts the outfit; Swimming strictly rejects it
    expect(casualCritique.assessment).toBe('Appropriate for this occasion');
    expect(swimCritique.assessment).toBe('Not appropriate for this occasion');
    expect(casualCritique.verdict).not.toBe(swimCritique.verdict);
  });

  test('PHASE 19 REGRESSION: Spectating context "Watching my kids swim" does not require swimwear', () => {
    const top = mockItem('1', 'Top', 'Cotton T-shirt', { color: 'white', description: 'Casual tee' });
    const bottom = mockItem('2', 'Bottom', 'Denim Jeans', { color: 'blue', description: 'Blue jeans' });
    const shoes = mockItem('3', 'Shoes', 'Sneakers', { color: 'white' });
    const lookup = {
      [top.wardrobeItem.id]: top.wardrobeItem,
      [bottom.wardrobeItem.id]: bottom.wardrobeItem,
      [shoes.wardrobeItem.id]: shoes.wardrobeItem,
    };

    const critique = gradeOutfit(
      [top.canvasItem, bottom.canvasItem, shoes.canvasItem],
      lookup,
      { occasion: 'Community Pool', additionalContext: 'Watching my kids swim from the bench' }
    );

    expect(critique.contextInterpretation?.isSpectatingOnly).toBe(true);
    expect(critique.assessment).toBe('Appropriate for this occasion');
  });

  test('PHASE 33 REGRESSION: User subcategory "Running Shorts" retained in structured profile', () => {
    const shorts = mockItem('rs_1', 'Bottom', 'Shorts', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      color: 'black',
      description: 'Athletic running shorts',
    });

    const profile = buildGarmentSemanticProfile(shorts.canvasItem, shorts.wardrobeItem);
    expect(profile.rawUserData.subCategory).toBe('Running Shorts');
    expect(profile.styleSignals.athletic).toBe(true);
  });

  test('PHASE 33 REGRESSION: Multi-color user entry "Navy Blue, White" preserves both colors', () => {
    const item = mockItem('c_1', 'Top', 'Striped Polo', {
      color: 'Navy Blue, White',
    });
    const colors = extractColors([item.canvasItem], { [item.wardrobeItem.id]: item.wardrobeItem });
    expect(colors).toContain('Navy Blue');
    expect(colors).toContain('White');
  });

  test('PHASE 4 REGRESSION: interpretOutfitContext extracts structured signals cleanly', () => {
    const ctx = interpretOutfitContext({
      occasion: 'Swimming',
      additionalContext: "I'll be swimming a lot in the pool",
    });
    expect(ctx.activity).toBe('activeSwimming');
    expect(ctx.waterExposure).toBe('high');
    expect(ctx.mobilityRequirement).toBe('high');
  });

  // =========================================================================
  // DEEP AI STYLIST INTELLIGENCE OVERHAUL: TEST CASES A - F & CONTEXT REASONING
  // =========================================================================

  describe('Deep AI Stylist Context-Aware Reasoning', () => {
    const knitSweater = mockItem('sw_1', 'Top', 'Knit Sweater', {
      category: 'Top',
      sub_category: 'Sweater',
      color: 'cream',
      description: 'Chunky ribbed knit wool sweater',
    });

    const runningShorts = mockItem('rs_nike', 'Bottom', 'Running Shorts', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      color: 'black',
      where_worn_often: 'Running, gym',
      description:
        'Black 2-in-1 athletic running shorts (Nike) featuring a wide gathered elastic waistband, loose curved-hem outer shell, built-in undershorts, and a white swoosh logo.',
      user_notes: 'I love wearing this when exercising and running.',
    });

    const flats = mockItem('fl_1', 'Shoes', 'Flats', {
      category: 'Shoes',
      sub_category: 'Flats',
      color: 'black',
      description: 'Classic pointed leather flats',
    });

    const trousers = mockItem('tr_1', 'Bottom', 'Black Wide-Leg Trousers', {
      category: 'Bottom',
      sub_category: 'Trousers',
      color: 'black',
      description: 'Tailored wool-blend wide-leg trousers',
    });

    const baseLookup = {
      [knitSweater.wardrobeItem.id]: knitSweater.wardrobeItem,
      [runningShorts.wardrobeItem.id]: runningShorts.wardrobeItem,
      [flats.wardrobeItem.id]: flats.wardrobeItem,
      [trousers.wardrobeItem.id]: trousers.wardrobeItem,
    };

    // TEST CASE A: Knit Sweater + Running Shorts + Flats for "Cold Night Date"
    test('TEST CASE A: Cold Night Date with Running Shorts is NOT approved, notes thermal and occasion mismatch, NO generic daytime praise', () => {
      const critique = gradeOutfit(
        [knitSweater.canvasItem, runningShorts.canvasItem, flats.canvasItem],
        baseLookup,
        {
          occasion: 'Cold Night Date',
          additionalContext: 'It will get cold tonight',
        }
      );

      // 1. Must NOT simply return "Appropriate for this occasion"
      expect(critique.assessment).not.toBe('Appropriate for this occasion');
      expect(['Not appropriate for this occasion', 'Could work with changes']).toContain(critique.assessment);

      // 2. Must NOT emit generic "effortlessly daytime styling"
      expect(critique.whatWorks?.toLowerCase()).not.toContain('effortless daytime styling');
      expect(critique.whatWorks?.toLowerCase()).not.toContain('daytime styling');
      expect(critique.whyJezsySaysThis.toLowerCase()).not.toContain('effortlessly daytime');

      // 3. Must recognize running shorts, athletic identity, and cold night date conflict
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/running shorts|athletic|performance/);
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/cold|night|warmth|exposed/);
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/date/);

      // 4. What works acknowledges real positive aspects (sweater warmth, flats, color harmony)
      expect(critique.whatWorks).toBeDefined();
      expect(critique.whatWorks?.toLowerCase()).toMatch(/sweater|warmth|flats|color/);

      // 5. Wardrobe alternative recommends owned trousers from wardrobe
      const botAlt = critique.wardrobeAlternatives?.find((a) => a.slot === 'bottom');
      expect(botAlt?.found).toBe(true);
      expect(botAlt?.recommendationText).toMatch(/trousers|Black Wide-Leg Trousers/);
    });

    // TEST CASE B: Same outfit for "Swimming — I'll be swimming a lot in the pool."
    test('TEST CASE B: Same outfit for Swimming is rejected with aquatic-specific explanation distinct from Test Case A', () => {
      const critique = gradeOutfit(
        [knitSweater.canvasItem, runningShorts.canvasItem, flats.canvasItem],
        baseLookup,
        {
          occasion: 'Swimming',
          additionalContext: "I'll be swimming a lot in the pool",
        }
      );

      expect(critique.assessment).toBe('Not appropriate for this occasion');
      expect(critique.headline).toBe('Activity & Water Mismatch');
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/active swimming|pool|waterlogged|swimwear/);
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/knit sweater|flats/);

      // Explanation is distinct from Test Case A
      const critiqueA = gradeOutfit(
        [knitSweater.canvasItem, runningShorts.canvasItem, flats.canvasItem],
        baseLookup,
        { occasion: 'Cold Night Date', additionalContext: 'It will get cold tonight' }
      );
      expect(critique.whyJezsySaysThis).not.toBe(critiqueA.whyJezsySaysThis);
      expect(critique.verdict).not.toBe(critiqueA.verdict);
    });

    // TEST CASE C: Same outfit for "Casual afternoon walk"
    test('TEST CASE C: Same outfit for Casual afternoon walk recognizes casual walking appropriateness', () => {
      const critique = gradeOutfit(
        [knitSweater.canvasItem, runningShorts.canvasItem, flats.canvasItem],
        baseLookup,
        { occasion: 'Casual afternoon walk' }
      );

      // Same shorts that conflicted with Cold Night Date are appropriate for a casual afternoon walk
      expect(['Appropriate for this occasion', 'Could work with changes']).toContain(critique.assessment);
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/walk|walking|movement|casual/);
      expect(critique.whyJezsySaysThis).not.toBe(
        gradeOutfit(
          [knitSweater.canvasItem, runningShorts.canvasItem, flats.canvasItem],
          baseLookup,
          { occasion: 'Cold Night Date' }
        ).whyJezsySaysThis
      );
    });

    // TEST CASE D: Same running shorts for "Running 5km tonight"
    test('TEST CASE D: Same running shorts for Running 5km tonight are recognized as purpose-built athletic gear', () => {
      const runningShoes = mockItem('sh_run', 'Shoes', 'Running Shoes', {
        category: 'Shoes',
        sub_category: 'Running Shoes',
        color: 'blue',
      });
      const athleticTop = mockItem('tp_run', 'Top', 'Dri-Fit Running Tee', {
        category: 'Top',
        sub_category: 'T-Shirt',
        color: 'gray',
        description: 'Moisture wicking athletic technical tee',
      });

      const runLookup = {
        [runningShorts.wardrobeItem.id]: runningShorts.wardrobeItem,
        [runningShoes.wardrobeItem.id]: runningShoes.wardrobeItem,
        [athleticTop.wardrobeItem.id]: athleticTop.wardrobeItem,
      };

      const critique = gradeOutfit(
        [athleticTop.canvasItem, runningShorts.canvasItem, runningShoes.canvasItem],
        runLookup,
        { occasion: 'Running 5km tonight' }
      );

      expect(critique.assessment).toBe('Appropriate for this occasion');
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/athletic|mobility|running/);
      expect(critique.whatWorks?.toLowerCase()).toMatch(/activewear|movement|breathability|mobility/);
    });

    // TEST CASE E: Blazer + Running Shorts + Running Shoes + No top for Wedding
    test('TEST CASE E: Blazer + Running Shorts + Running Shoes + No top for Wedding produces Incomplete & major formality contradiction', () => {
      const blazer = mockItem('bz_1', 'Outerwear', 'Tailored Blazer', {
        category: 'Outerwear',
        sub_category: 'Blazer',
        color: 'navy',
      });
      const runningShoes = mockItem('sh_run', 'Shoes', 'Running Shoes', {
        category: 'Shoes',
        sub_category: 'Running Shoes',
        color: 'neon yellow',
      });

      const weddingLookup = {
        [blazer.wardrobeItem.id]: blazer.wardrobeItem,
        [runningShorts.wardrobeItem.id]: runningShorts.wardrobeItem,
        [runningShoes.wardrobeItem.id]: runningShoes.wardrobeItem,
      };

      const critique = gradeOutfit(
        [blazer.canvasItem, runningShorts.canvasItem, runningShoes.canvasItem],
        weddingLookup,
        { occasion: 'Wedding' }
      );

      expect(critique.assessment).toBe('Not appropriate for this occasion');
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/blazer/);
      expect(critique.whyJezsySaysThis.toLowerCase()).toMatch(/running shorts|athletic/);
      expect(critique.whatsMissing?.toLowerCase()).toMatch(/base layer|upper-body|shirt|blouse/);
    });

    // TEST CASE F: Dress + Flats for Cold Night Date
    test('TEST CASE F: Dress + Flats for Cold Night Date reasons with uncertainty and layering advice rather than hard rejection', () => {
      const dress = mockItem('dr_1', 'Dress', 'Midi Slip Dress', {
        category: 'Dress',
        sub_category: 'Midi Dress',
        color: 'burgundy',
        description: 'Silk midi evening slip dress',
      });

      const dressLookup = {
        [dress.wardrobeItem.id]: dress.wardrobeItem,
        [flats.wardrobeItem.id]: flats.wardrobeItem,
      };

      const critique = gradeOutfit(
        [dress.canvasItem, flats.canvasItem],
        dressLookup,
        { occasion: 'Cold Night Date', additionalContext: 'It will get chilly tonight' }
      );

      // Not automatically hard-rejected as impossible:
      expect(critique.assessment).toBe('Could work with changes');
      expect(critique.headline).toBe('Needs Cold-Weather Layering');
      expect(critique.whatWorks?.toLowerCase()).toMatch(/dress|silhouette|flats/);
      expect(critique.whatCouldBeBetter?.toLowerCase()).toMatch(/layer|coat|jacket|tights|warmth/);
    });

    // Contextual Exception: Indoor Override
    test('Contextual Exception: "Cold Night Date, but staying indoors" recognizes indoor exception and moderates weather contradiction', () => {
      const critique = gradeOutfit(
        [knitSweater.canvasItem, runningShorts.canvasItem, flats.canvasItem],
        baseLookup,
        { occasion: 'Cold Night Date', additionalContext: 'We will be staying indoors the whole time' }
      );

      expect(critique.contextInterpretation?.isIndoorOverride).toBe(true);
      expect(critique.contextInterpretation?.environment).toBe('indoors');
    });

    // Multi-Dimensional Parser Signals
    test('interpretOutfitContext correctly extracts time, weather, and occasion dimensions', () => {
      const ctx = interpretOutfitContext({
        occasion: 'Cold Night Date',
        additionalContext: 'It will get freezing tonight, dining outside',
      });

      expect(ctx.timeOfDay).toBe('night');
      expect(ctx.weather).toBe('cold');
      expect(ctx.temperatureRequirement).toBe('warmthNeeded');
      expect(ctx.occasionType).toBe('date');
      expect(ctx.isIndoorOverride).toBe(false);
    });

    // Wardrobe Grounding: When user owns no suitable replacement, stylist never hallucinates inventory
    test('When user owns no suitable cold-weather bottom, stylist states so and does not invent one', () => {
      const noTrousersLookup = {
        [knitSweater.wardrobeItem.id]: knitSweater.wardrobeItem,
        [runningShorts.wardrobeItem.id]: runningShorts.wardrobeItem,
        [flats.wardrobeItem.id]: flats.wardrobeItem,
      };

      const critique = gradeOutfit(
        [knitSweater.canvasItem, runningShorts.canvasItem, flats.canvasItem],
        noTrousersLookup,
        { occasion: 'Cold Night Date', additionalContext: 'Cold weather tonight' }
      );

      const botAlt = critique.wardrobeAlternatives?.find((a) => a.slot === 'bottom');
      expect(botAlt?.found).toBe(false);
      expect(botAlt?.recommendationText).toMatch(/I don't see a wardrobe item that resolves/);
    });
  });
});

