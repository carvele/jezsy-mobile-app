import { gradeOutfitWithAI, evaluateWardrobeOutfit } from '../aiStylistAdvisor';
import { IAIStylistProvider } from '../../services/aiStylistProvider';
import { AIAnalysisResult, StructuredAIResponse } from '../../types/aiStylist';
import { resolveEffectiveGarmentBucket } from '../garmentSemanticClassifier';
import { MannequinCanvasItem } from '../mannequinConfig';

function wardrobeItem(id: string, o: Record<string, any>): any {
  return {
    id,
    user_id: 'user_123',
    garment_type: o.garment_type ?? 'Top',
    category: o.category ?? o.garment_type ?? 'Top',
    sub_category: o.sub_category ?? '',
    color_tags: o.color_tags ?? [],
    description: o.description ?? '',
    user_notes: '',
    image_url: 'https://example.com/item.png',
    wear_count: 0,
    last_worn_at: null,
    created_at: '2026-09-01T00:00:00Z',
    occasions: o.occasions ?? null,
    ai_attributes: o.ai_attributes ?? null,
  };
}

function canvasItem(w: any): MannequinCanvasItem {
  return {
    id: `canvas_${w.id}`,
    wardrobe_item_id: w.id,
    image_url: w.image_url,
    name: w.sub_category || w.category,
    garment_type: resolveEffectiveGarmentBucket(w),
    x: 0,
    y: 0.2,
    scale: 1,
    rotation: 0,
    zIndex: 1,
  };
}

function aiResponse(assessment: StructuredAIResponse['assessment'], text: string): StructuredAIResponse {
  return {
    assessment,
    headline: 'Looks great for this occasion',
    whyJezsySaysThis: `${text} The wedding dress code, the pool, and the cold night are all handled here.`,
    stylistTake: 'A confident, cohesive combination that suits the wedding, swim, and cold weather brief.',
    improvements: [],
  };
}

function stubProvider(result: AIAnalysisResult): IAIStylistProvider & { calls: number } {
  const provider = {
    calls: 0,
    async analyze() {
      provider.calls += 1;
      return result;
    },
  };
  return provider;
}

const lenient = (assessment: StructuredAIResponse['assessment'], text = 'Everything works.'): AIAnalysisResult => ({
  success: true,
  analysisMode: 'hybridLLM',
  provider: 'stub',
  model: 'stub-model',
  data: aiResponse(assessment, text),
});

describe('PHASE 5 — deterministic evidence is authoritative over AI wording', () => {
  test('wedding: AI cannot call blazer + running shorts + sneakers "appropriate"', async () => {
    const blazer = wardrobeItem('b1', { category: 'Outerwear', sub_category: 'Tailored Navy Blazer', garment_type: 'Outerwear' });
    const shorts = wardrobeItem('s1', { category: 'Bottom', sub_category: 'Running Shorts', garment_type: 'Bottom' });
    const shoes = wardrobeItem('sn1', { category: 'Shoes', sub_category: 'Running Shoes', garment_type: 'Shoes' });
    const lookup = { [blazer.id]: blazer, [shorts.id]: shorts, [shoes.id]: shoes };
    const items = [blazer, shorts, shoes].map(canvasItem);

    const deterministic = evaluateWardrobeOutfit([blazer, shorts, shoes], lookup, { occasion: 'Wedding' });
    expect(deterministic.assessment).not.toBe('Appropriate for this occasion');

    const provider = stubProvider(lenient('Appropriate for this occasion'));
    const critique = await gradeOutfitWithAI(items, lookup, { occasion: 'Wedding' }, null, provider);

    expect(provider.calls).toBe(1);
    expect(critique.analysisMode).toBe('ruleBasedFallback');
    expect(critique.assessment).toBe(deterministic.assessment);
    expect(critique.assessment).not.toBe('Appropriate for this occasion');
    expect(critique.aiProvider).toBe('deterministic-local');
    expect(critique.fallbackReason).toMatch(/more lenient/i);
  });

  test('wedding: AI "could work with changes" cannot soften a deterministic "not appropriate"', async () => {
    const blazer = wardrobeItem('b2', { category: 'Outerwear', sub_category: 'Tailored Navy Blazer', garment_type: 'Outerwear' });
    const shorts = wardrobeItem('s2', { category: 'Bottom', sub_category: 'Running Shorts', garment_type: 'Bottom' });
    const shoes = wardrobeItem('sn2', { category: 'Shoes', sub_category: 'Running Shoes', garment_type: 'Shoes' });
    const lookup = { [blazer.id]: blazer, [shorts.id]: shorts, [shoes.id]: shoes };
    const deterministic = evaluateWardrobeOutfit([blazer, shorts, shoes], lookup, { occasion: 'Wedding' });

    const critique = await gradeOutfitWithAI(
      [blazer, shorts, shoes].map(canvasItem),
      lookup,
      { occasion: 'Wedding' },
      null,
      stubProvider(lenient('Could work with changes'))
    );

    if (deterministic.assessment === 'Not appropriate for this occasion') {
      expect(critique.analysisMode).toBe('ruleBasedFallback');
      expect(critique.assessment).toBe('Not appropriate for this occasion');
    } else {
      // Whatever the engine decides is the floor: the result may never be more lenient than it.
      expect(critique.assessment).not.toBe('Appropriate for this occasion');
    }
  });

  test('swimming: AI cannot approve a knit top + denim skirt + flats for the pool', async () => {
    const top = wardrobeItem('t3', { category: 'Top', sub_category: 'Maroon Cropped Turtleneck', garment_type: 'Top' });
    const skirt = wardrobeItem('k3', { category: 'Bottom', sub_category: 'Denim Micro Mini Skirt', garment_type: 'Bottom' });
    const shoes = wardrobeItem('f3', { category: 'Shoes', sub_category: 'Mary Jane Flats', garment_type: 'Shoes' });
    const lookup = { [top.id]: top, [skirt.id]: skirt, [shoes.id]: shoes };
    const ctx = { occasion: 'Swimming', additionalContext: "I'll swim a lot in the pool" };

    const deterministic = evaluateWardrobeOutfit([top, skirt, shoes], lookup, ctx);
    expect(deterministic.assessment).toBe('Not appropriate for this occasion');

    const critique = await gradeOutfitWithAI(
      [top, skirt, shoes].map(canvasItem),
      lookup,
      ctx,
      null,
      stubProvider(lenient('Appropriate for this occasion', 'Great swim outfit for the pool.'))
    );

    expect(critique.analysisMode).toBe('ruleBasedFallback');
    expect(critique.assessment).toBe('Not appropriate for this occasion');
  });

  test('cold night date: AI cannot approve athletic shorts, and the engine flags both athletic and thermal conflicts', async () => {
    const top = wardrobeItem('t5', { category: 'Top', sub_category: 'Silk Blouse', garment_type: 'Top' });
    const shorts = wardrobeItem('s5', {
      category: 'Bottom',
      sub_category: 'Running Shorts',
      garment_type: 'Bottom',
      ai_attributes: { whereWornOften: 'Running' },
    });
    const shoes = wardrobeItem('h5', { category: 'Shoes', sub_category: 'Heeled Boots', garment_type: 'Shoes' });
    const lookup = { [top.id]: top, [shorts.id]: shorts, [shoes.id]: shoes };
    const ctx = { occasion: 'Date Night', additionalContext: 'It will be cold tonight outdoors' };

    const deterministic = evaluateWardrobeOutfit([top, shorts, shoes], lookup, ctx);
    expect(deterministic.assessment).not.toBe('Appropriate for this occasion');
    const dimensions = (deterministic.rawContradictions ?? []).map((c) => `${c.category} ${c.reason}`.toLowerCase()).join(' ');
    expect(dimensions).toMatch(/athletic|sport|running/);
    expect(dimensions).toMatch(/cold|thermal|warm|weather/);

    const critique = await gradeOutfitWithAI(
      [top, shorts, shoes].map(canvasItem),
      lookup,
      ctx,
      null,
      stubProvider(lenient('Appropriate for this occasion', 'Warm and cold-proof.'))
    );
    expect(critique.analysisMode).toBe('ruleBasedFallback');
    expect(critique.assessment).not.toBe('Appropriate for this occasion');
  });

  test('an AI verdict at least as strict as the evidence is accepted and labelled hybrid', async () => {
    const blazer = wardrobeItem('b6', { category: 'Outerwear', sub_category: 'Tailored Navy Blazer', garment_type: 'Outerwear' });
    const shorts = wardrobeItem('s6', { category: 'Bottom', sub_category: 'Running Shorts', garment_type: 'Bottom' });
    const shoes = wardrobeItem('sn6', { category: 'Shoes', sub_category: 'Running Shoes', garment_type: 'Shoes' });
    const lookup = { [blazer.id]: blazer, [shorts.id]: shorts, [shoes.id]: shoes };

    const critique = await gradeOutfitWithAI(
      [blazer, shorts, shoes].map(canvasItem),
      lookup,
      { occasion: 'Wedding' },
      null,
      stubProvider(lenient('Not appropriate for this occasion', 'The running shorts clash with the wedding dress code.'))
    );

    expect(critique.analysisMode).toBe('hybridLLM');
    expect(critique.assessment).toBe('Not appropriate for this occasion');
    expect(critique.aiModel).toBe('stub-model');
  });

  test('provider failure falls back to the deterministic critique and says so', async () => {
    const top = wardrobeItem('t7', { category: 'Top', sub_category: 'T-Shirt', garment_type: 'Top' });
    const jeans = wardrobeItem('j7', { category: 'Bottom', sub_category: 'Jeans', garment_type: 'Bottom' });
    const lookup = { [top.id]: top, [jeans.id]: jeans };

    const critique = await gradeOutfitWithAI(
      [top, jeans].map(canvasItem),
      lookup,
      { occasion: 'Casual' },
      null,
      stubProvider({ success: false, analysisMode: 'ruleBasedFallback', fallbackReason: 'LLM_MODEL_NOT_CONFIGURED' })
    );

    expect(critique.analysisMode).toBe('ruleBasedFallback');
    expect(critique.aiProvider).toBe('deterministic-local');
    expect(critique.fallbackReason).toBe('LLM_MODEL_NOT_CONFIGURED');
  });

  test('a provider that throws still yields the deterministic critique', async () => {
    const top = wardrobeItem('t8', { category: 'Top', sub_category: 'T-Shirt', garment_type: 'Top' });
    const jeans = wardrobeItem('j8', { category: 'Bottom', sub_category: 'Jeans', garment_type: 'Bottom' });
    const lookup = { [top.id]: top, [jeans.id]: jeans };
    const provider: IAIStylistProvider = {
      analyze: async () => {
        throw new Error('network down');
      },
    };

    const critique = await gradeOutfitWithAI([top, jeans].map(canvasItem), lookup, { occasion: 'Casual' }, null, provider);
    expect(critique.analysisMode).toBe('ruleBasedFallback');
    expect(critique.aiProvider).toBe('deterministic-local');
  });
});
