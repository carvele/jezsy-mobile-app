import {
  extractGarmentEvidence,
  normalizeGarment,
  inferSystemBucket,
  resolveEffectiveGarmentBucket,
} from '../garmentSemanticClassifier';

// Helper — classify by subCategory + description, mimicking add-item flow
function classify(subCategory: string, description = '', category = 'Clothing', color = '', whereWorn = '') {
  return extractGarmentEvidence(category, subCategory, color, whereWorn, description);
}

describe('garmentSemanticClassifier', () => {

  // =========================================================================
  // BOTTOM — the original regression (shorts must never be Top)
  // =========================================================================
  describe('Bottoms', () => {
    const bottomCases: Array<[string, string]> = [
      ['short', ''],
      ['shorts', ''],
      ['running shorts', ''],
      ['black running shorts', ''],
      ['athletic shorts', ''],
      ['gym shorts', ''],
      ['swim shorts', ''],
      ['cycling shorts', ''],
      ['compression shorts', ''],
      ['cargo shorts', ''],
      ['denim shorts', ''],
      ['bermuda shorts', ''],
      ['basketball shorts', ''],
      ['tailored shorts', ''],
      ['pants', ''],
      ['trousers', ''],
      ['jeans', ''],
      ['skirt', ''],
      ['skirts', ''],
      ['micro mini skirt', ''],
      ['mini skirt', ''],
      ['midi skirt', ''],
      ['maxi skirt', ''],
      ['pencil skirt', ''],
      ['leggings', ''],
      ['culottes', ''],
      ['skorts', ''],
      ['chinos', ''],
      ['slacks', ''],
      ['trousers', 'office trousers'],
      ['Activewear / Shorts', 'Running shorts for exercise'],
    ];

    test.each(bottomCases)('classifies "%s" (desc: "%s") as Bottom', (sub, desc) => {
      const ev = classify(sub, desc);
      expect(ev.family).toBe('Bottom');
    });

    test('inferSystemBucket returns "Bottom" for shorts', () => {
      expect(inferSystemBucket('Clothing', 'Running Shorts', 'Black running shorts for exercise')).toBe('Bottom');
    });

    test('inferSystemBucket returns "Bottom" for pants', () => {
      expect(inferSystemBucket('Clothing', 'Pants', '')).toBe('Bottom');
    });

    test('detects Running Shorts subtype', () => {
      const ev = classify('Running Shorts', 'Lightweight running shorts');
      expect(ev.type).toBe('Shorts');
      expect(ev.subtype).toBe('Running Shorts');
    });

    test('detects Micro Mini Skirt subtype', () => {
      const ev = classify('Micro Mini Skirt', 'Denim micro mini skirt');
      expect(ev.family).toBe('Bottom');
      expect(ev.type).toBe('Skirt');
      expect(ev.subtype).toBe('Micro Mini Skirt');
    });

    test('detects Tailored Shorts subtype from description', () => {
      const ev = classify('', 'Tailored linen Bermuda shorts with pleat details');
      expect(ev.family).toBe('Bottom');
    });
  });

  // =========================================================================
  // TOPS
  // =========================================================================
  describe('Tops', () => {
    const topCases: Array<[string, string]> = [
      ['shirt', ''],
      ['shirts', ''],
      ['t-shirt', ''],
      ['tee', ''],
      ['tee shirt', ''],
      ['blouse', ''],
      ['sweater', ''],
      ['turtleneck', ''],
      ['crop top', ''],
      ['cropped top', ''],
      ['tank top', ''],
      ['camisole', ''],
      ['polo', ''],
      ['button-down', ''],
      ['button up', ''],
      ['tube top', ''],
      ['halter top', ''],
      ['bodysuit', ''],
      ['knitwear', ''],
      ['bra', ''],
    ];

    test.each(topCases)('classifies "%s" (desc: "%s") as Top', (sub, desc) => {
      const ev = classify(sub, desc);
      expect(ev.family).toBe('Top');
    });

    test('detects Cropped Turtleneck Sweater subtype', () => {
      const ev = classify('Cropped Turtleneck Sweater', 'Ribbed knit sweater');
      expect(ev.family).toBe('Top');
      expect(ev.type).toBe('Sweater');
      expect(ev.subtype).toBe('Cropped Turtleneck Sweater');
    });
  });

  // =========================================================================
  // OUTERWEAR — must not resolve as Top
  // =========================================================================
  describe('Outerwear', () => {
    const outerCases: Array<[string, string]> = [
      ['blazer', ''],
      ['jacket', ''],
      ['coat', ''],
      ['trench coat', ''],
      ['windbreaker', ''],
      ['parka', ''],
      ['vest', ''],
      ['waistcoat', ''],
      ['cardigan', ''],
      ['hoodie', ''],
    ];

    test.each(outerCases)('classifies "%s" as Outerwear (not Top)', (sub, desc) => {
      const ev = classify(sub, desc);
      expect(ev.family).toBe('Outerwear');
    });

    test('detects Blazer type', () => {
      const ev = classify('Blazer', 'Structured tailored blazer');
      expect(ev.type).toBe('Blazer');
    });
  });

  // =========================================================================
  // FOOTWEAR
  // =========================================================================
  describe('Footwear', () => {
    const footCases: Array<[string, string]> = [
      ['flats', ''],
      ['ballet flats', ''],
      ['Mary Jane flats', ''],
      ['Mary Jane Ballet Flats', ''],
      ['running shoes', ''],
      ['sneakers', ''],
      ['heels', ''],
      ['boots', ''],
      ['sandals', ''],
      ['loafers', ''],
    ];

    test.each(footCases)('classifies "%s" as Footwear', (sub, desc) => {
      const ev = classify(sub, desc);
      expect(ev.family).toBe('Footwear');
    });

    test('detects Mary Jane Ballet Flats full subtype', () => {
      const ev = classify(
        'Mary Jane Ballet Flats',
        'Chocolate brown suede/velvet Mary Jane ballet flats'
      );
      expect(ev.family).toBe('Footwear');
      expect(ev.subtype).toBe('Mary Jane Ballet Flats');
    });

    test('detects Running Shoes subtype', () => {
      const ev = classify('Running Shoes', 'Cushioned athletic sneakers for running');
      expect(ev.family).toBe('Footwear');
      expect(ev.subtype).toBe('Running Shoes');
    });

    test('inferSystemBucket returns "Shoes" for footwear', () => {
      expect(inferSystemBucket('Shoes', 'Mary Jane Ballet Flats', 'Chocolate brown suede flats')).toBe('Shoes');
    });
  });

  // =========================================================================
  // ONE-PIECE / DRESS
  // =========================================================================
  describe('One-piece garments', () => {
    const dressCases: Array<[string, string]> = [
      ['dress', ''],
      ['gown', ''],
      ['jumpsuit', ''],
      ['romper', ''],
      ['playsuit', ''],
      ['maxi dress', ''],
      ['midi dress', ''],
      ['mini dress', ''],
      ['cocktail dress', ''],
    ];

    test.each(dressCases)('classifies "%s" as Dress', (sub, desc) => {
      const ev = classify(sub, desc);
      expect(ev.family).toBe('Dress');
    });

    test('inferSystemBucket returns "Dress" for jumpsuit', () => {
      expect(inferSystemBucket('Dress', 'Jumpsuit', 'Tailored black jumpsuit')).toBe('Dress');
    });
  });

  // =========================================================================
  // CONFLICT CASES — specific regression scenarios from spec §48
  // =========================================================================
  describe('Conflict regression tests', () => {
    test('Activewear / Shorts + Running description → Bottom/Shorts/Running Shorts (not Top)', () => {
      const norm = normalizeGarment(
        'Clothing',
        'Activewear / Shorts',
        'Black',
        'Running / Gym',
        'Black running shorts designed for running and exercise'
      );
      expect(norm.family).toBe('Bottom');
      expect(norm.type).toBe('Shorts');
      expect(norm.subtype).toBe('Running Shorts');
      expect(norm.systemBucket).toBe('Bottom');
    });

    test('Micro Mini Skirt + Denim description → Bottom/Skirt (not Top)', () => {
      const norm = normalizeGarment(
        'Clothing',
        'Micro Mini Skirt',
        'Blue',
        'Casual',
        'Medium-to-dark wash blue denim micro mini skirt'
      );
      expect(norm.family).toBe('Bottom');
      expect(norm.type).toBe('Skirt');
      expect(norm.subtype).toBe('Micro Mini Skirt');
    });

    test('Cropped Turtleneck Sweater → Top/Sweater', () => {
      const norm = normalizeGarment(
        'Clothing',
        'Cropped Turtleneck Sweater',
        'Maroon',
        'Casual',
        'Ribbed knit sweater'
      );
      expect(norm.family).toBe('Top');
      expect(norm.type).toBe('Sweater');
      expect(norm.subtype).toBe('Cropped Turtleneck Sweater');
    });

    test('Mary Jane Ballet Flats + chocolate brown suede → Footwear', () => {
      const norm = normalizeGarment(
        'Shoes',
        'Mary Jane Ballet Flats',
        'Chocolate Brown',
        '',
        'Chocolate brown suede/velvet Mary Jane ballet flats'
      );
      expect(norm.family).toBe('Footwear');
      expect(norm.subtype).toBe('Mary Jane Ballet Flats');
    });

    test('Blazer → Outerwear (not Top)', () => {
      const norm = normalizeGarment('Outerwear', 'Blazer', 'Navy', '', 'Structured wool blend tailored blazer');
      expect(norm.family).toBe('Outerwear');
    });
  });

  // =========================================================================
  // MULTI-COLOR PRESERVATION
  // =========================================================================
  describe('Color handling', () => {
    test('preserves multiple colors from "Navy Blue, White"', () => {
      const ev = extractGarmentEvidence('Clothing', 'Shirt', 'Navy Blue, White', '', '');
      expect(ev.colors).toContain('Navy Blue');
      expect(ev.colors).toContain('White');
      expect(ev.colors.length).toBe(2);
    });

    test('preserves colors from "Black and Red"', () => {
      const ev = extractGarmentEvidence('Clothing', 'Shorts', 'Black and Red', '', '');
      expect(ev.colors).toContain('Black');
      expect(ev.colors).toContain('Red');
    });

    test('preserves single color', () => {
      const ev = extractGarmentEvidence('Clothing', 'Dress', 'Maroon', '', '');
      expect(ev.colors).toEqual(['Maroon']);
    });
  });

  // =========================================================================
  // ACTIVITY / STYLE SIGNALS
  // =========================================================================
  describe('Activity and style signals', () => {
    test('detects Running activity from description', () => {
      const ev = classify('Running Shorts', 'Black running shorts for marathon training');
      expect(ev.activity).toContain('Running');
    });

    test('detects Gym activity from whereWornOften', () => {
      const ev = extractGarmentEvidence('Clothing', 'Shorts', '', 'Gym, workout', '');
      expect(ev.activity).toContain('Gym');
    });

    test('detects Activewear style from subCategory', () => {
      const ev = classify('Activewear / Shorts', '');
      expect(ev.style).toContain('Activewear');
    });

    test('detects Formal style from description', () => {
      const ev = classify('Blazer', 'Formal tailored blazer for office');
      expect(ev.style).toContain('Formal');
    });
  });

  // =========================================================================
  // MATERIAL SIGNALS
  // =========================================================================
  describe('Material signals', () => {
    test('detects Suede from description', () => {
      const ev = classify('Ballet Flats', 'Chocolate brown suede ballet flats');
      expect(ev.material).toContain('Suede');
    });

    test('detects Denim from subCategory', () => {
      const ev = classify('Denim Micro Mini Skirt', '');
      expect(ev.material).toContain('Denim');
    });

    test('detects Ribbed Knit from description', () => {
      const ev = classify('Turtleneck Sweater', 'Ribbed-knit cropped turtleneck');
      expect(ev.material).toContain('Ribbed Knit');
    });
  });

  // =========================================================================
  // UNKNOWN FALLBACK — no spurious Top classification
  // =========================================================================
  describe('Unknown fallback', () => {
    test('unknown garment remains Unknown (not Top)', () => {
      const ev = extractGarmentEvidence('Clothing', 'Clothing', '', 'Casual', 'comfortable everyday item');
      // "comfortable everyday item" has no recognizable garment keyword
      expect(ev.family).toBe('Unknown');
    });

    test('inferSystemBucket defaults to "Top" for placement of Unknown (mannequin compat)', () => {
      const bucket = inferSystemBucket('Clothing', 'Clothing', 'comfortable everyday item');
      expect(bucket).toBe('Top');
    });

    test('normalizeGarment family is Unknown even when systemBucket falls back', () => {
      const norm = normalizeGarment('Clothing', 'Clothing', '', 'Casual', 'comfortable everyday item');
      expect(norm.family).toBe('Unknown');
      expect(norm.systemBucket).toBe('Top'); // placement only
    });
  });

  // =========================================================================
  // PRIORITY ORDER — outerwear beats top; bottom beats top
  // =========================================================================
  describe('Classification priority', () => {
    test('cardigan classifies as Outerwear (not Top) even though sweater-adjacent', () => {
      const ev = classify('Cardigan', 'Open front cardigan');
      expect(ev.family).toBe('Outerwear');
    });

    test('hoodie classifies as Outerwear (not Top)', () => {
      const ev = classify('Hoodie', 'Pullover fleece hoodie');
      expect(ev.family).toBe('Outerwear');
    });

    test('"shorts" alone classifies as Bottom (not Top fallback)', () => {
      const ev = classify('shorts', '');
      expect(ev.family).toBe('Bottom');
    });

    test('"short" singular also classifies as Bottom', () => {
      const ev = classify('short', '');
      expect(ev.family).toBe('Bottom');
    });
  });

  // =========================================================================
  // HEALING LEGACY ITEMS — resolveEffectiveGarmentBucket
  // =========================================================================
  describe('resolveEffectiveGarmentBucket', () => {
    test('corrects legacy item with garment_type "Top" and sub_category "Activewear / Shorts" to "Bottom"', () => {
      const legacyShorts = {
        garment_type: 'Top',
        category: 'Clothing',
        sub_category: 'Activewear / Shorts',
        description: '',
      };
      expect(resolveEffectiveGarmentBucket(legacyShorts)).toBe('Bottom');
    });

    test('corrects legacy item with garment_type "Top" and sub_category "Cardigan" to "Outerwear"', () => {
      const legacyCardigan = {
        garment_type: 'Top',
        category: 'Clothing',
        sub_category: 'Cardigan',
        description: '',
      };
      expect(resolveEffectiveGarmentBucket(legacyCardigan)).toBe('Outerwear');
    });

    test('corrects legacy item with garment_type "Top" and sub_category "Running Shoes" to "Shoes"', () => {
      const legacyShoes = {
        garment_type: 'Top',
        category: 'Footwear',
        sub_category: 'Running Shoes',
        description: '',
      };
      expect(resolveEffectiveGarmentBucket(legacyShoes)).toBe('Shoes');
    });

    test('retains "Top" when item is genuinely a top', () => {
      const genuineTop = {
        garment_type: 'Top',
        category: 'Clothing',
        sub_category: 'T-Shirt',
        description: '',
      };
      expect(resolveEffectiveGarmentBucket(genuineTop)).toBe('Top');
    });

    test('retains already correct garment_type "Bottom"', () => {
      const correctBottom = {
        garment_type: 'Bottom',
        category: 'Clothing',
        sub_category: 'Activewear / Shorts',
        description: '',
      };
      expect(resolveEffectiveGarmentBucket(correctBottom)).toBe('Bottom');
    });

    // =========================================================================
    // PHASE 20 MANDATORY TESTS
    // =========================================================================
    describe('Phase 20 Authoritative Semantic Resolver Test Cases', () => {
      test('TEST 1: category = Tops, sub_category = T-Shirt, garment_type = Bottom -> Top', () => {
        const item = {
          category: 'Tops',
          sub_category: 'T-Shirt',
          garment_type: 'Bottom',
        };
        expect(resolveEffectiveGarmentBucket(item)).toBe('Top');
      });

      test('TEST 2: category = Tops, sub_category = T-Shirt, garment_type = Top -> Top', () => {
        const item = {
          category: 'Tops',
          sub_category: 'T-Shirt',
          garment_type: 'Top',
        };
        expect(resolveEffectiveGarmentBucket(item)).toBe('Top');
      });

      test('TEST 3: category = Bottoms, sub_category = Running Shorts, garment_type = Top -> Bottom', () => {
        const item = {
          category: 'Bottoms',
          sub_category: 'Running Shorts',
          garment_type: 'Top',
        };
        expect(resolveEffectiveGarmentBucket(item)).toBe('Bottom');
      });

      test('TEST 4: category = Dresses, sub_category = Maxi Dress, garment_type = Bottom -> Dress', () => {
        const item = {
          category: 'Dresses',
          sub_category: 'Maxi Dress',
          garment_type: 'Bottom',
        };
        expect(resolveEffectiveGarmentBucket(item)).toBe('Dress');
      });

      test('TEST 5: category = Outerwear, sub_category = Blazer, garment_type = Bottom -> Outerwear', () => {
        const item = {
          category: 'Outerwear',
          sub_category: 'Blazer',
          garment_type: 'Bottom',
        };
        expect(resolveEffectiveGarmentBucket(item)).toBe('Outerwear');
      });

      test('TEST 6: Edit: Tops / T-Shirt -> Bottoms / Running Shorts changes bucket Top -> Bottom', () => {
        const before = { category: 'Tops', sub_category: 'T-Shirt', garment_type: 'Top' };
        expect(resolveEffectiveGarmentBucket(before)).toBe('Top');

        const after = { ...before, category: 'Bottoms', sub_category: 'Running Shorts' };
        expect(resolveEffectiveGarmentBucket(after)).toBe('Bottom');
      });

      test('TEST 7: Edit: Bottoms / Running Shorts -> Tops / T-Shirt changes bucket Bottom -> Top', () => {
        const before = { category: 'Bottoms', sub_category: 'Running Shorts', garment_type: 'Bottom' };
        expect(resolveEffectiveGarmentBucket(before)).toBe('Bottom');

        const after = { ...before, category: 'Tops', sub_category: 'T-Shirt' };
        expect(resolveEffectiveGarmentBucket(after)).toBe('Top');
      });

      test('TEST 8: Color "Navy Blue, White" raw value remains exactly unchanged', () => {
        const rawColor = 'Navy Blue, White';
        const ev = extractGarmentEvidence('Tops', 'T-Shirt', rawColor, '', '');
        expect(ev.colors).toEqual(['Navy Blue', 'White']);
      });

      test('TEST 9: Where worn "Daily Activity out door" raw text is preserved verbatim', () => {
        const whereWorn = 'Daily Activity out door';
        const ev = extractGarmentEvidence('Tops', 'T-Shirt', '', whereWorn, '');
        expect(ev.personalUsage.rawText).toBe(whereWorn);
      });

      test('TEST 10: Description and Personal Notes remain separate and preserved', () => {
        const desc = 'Y2K-style layered short-sleeve top';
        const notes = 'I love wearing this every day without much active activity.';
        const ev = extractGarmentEvidence('Tops', 'T-Shirt', '', '', desc, notes);
        expect(ev.personalUsage.rawText).toBe(notes);
      });

      test('TEST 11: Unknown Material leaves material evidence empty', () => {
        const ev = extractGarmentEvidence('Tops', 'T-Shirt', '', '', 'A simple plain top');
        expect(ev.material).toEqual([]);
      });

      test('TEST 12: Unknown Style leaves style evidence empty', () => {
        const ev = extractGarmentEvidence('Tops', 'T-Shirt', '', '', 'A simple plain top');
        expect(ev.style).toEqual([]);
      });

      test('TEST 13: Unknown Activity leaves activity evidence empty', () => {
        const ev = extractGarmentEvidence('Tops', 'T-Shirt', '', '', 'A simple plain top');
        expect(ev.activity).toEqual([]);
      });

      test('TEST 14: Legacy item with stale garment_type heals to current semantic result', () => {
        const staleItem = {
          garment_type: 'Bottom',
          category: 'Tops',
          sub_category: 'T-Shirt',
          description: 'White cotton t-shirt',
        };
        expect(resolveEffectiveGarmentBucket(staleItem)).toBe('Top');
      });

      test('TEST 15: Item Details, Mannequin and Stylist all resolve the same effective bucket', () => {
        const garment = {
          category: 'Tops',
          sub_category: 'T-Shirt',
          garment_type: 'Bottom', // stale in DB
          description: 'Casual cotton t-shirt',
          color_tags: ['Navy Blue', 'White'],
          occasions: ['Daily Activity'],
        };
        const bucket = resolveEffectiveGarmentBucket(garment);
        const norm = normalizeGarment(
          garment.category,
          garment.sub_category,
          'Navy Blue, White',
          'Daily Activity',
          garment.description
        );
        expect(bucket).toBe('Top');
        expect(norm.systemBucket).toBe('Top');
        expect(norm.family).toBe('Top');
      });

      test('Conflict detection: flags conflict when Category is Tops but Sub Category is Running Shorts', () => {
        const norm = normalizeGarment('Tops', 'Running Shorts', '', '', '');
        expect(norm.conflict?.hasConflict).toBe(true);
        expect(norm.family).toBe('Bottom'); // concrete garment determines bucket
        expect(norm.conflict?.message).toContain('Category is Tops but Sub Category indicates Bottom');
      });
    });
  });
});

