import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { SuggestedOutfitCard } from '../SuggestedOutfitCard';

jest.mock('expo-image', () => ({
  Image: (props: any) => React.createElement('Image', props),
}));

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/src/utils/haptics', () => ({
  tapMedium: jest.fn(),
  tapLight: jest.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('SuggestedOutfitCard Component (Phase B)', () => {
  const mockOutfit = {
    key: 'test-outfit-key-1',
    items: [
      { id: '1', category: 'Tops', garment_type: 'Shirt', image_url: 'https://example.com/top.png', wear_count: 0 },
      { id: '2', category: 'Bottoms', garment_type: 'Trousers', image_url: 'https://example.com/bot.png', wear_count: 5, last_worn_at: '2026-09-01T00:00:00Z' },
    ],
    score: 95,
    label: 'Perfect Harmony',
    headline: 'Timeless Monochromatic Flow',
    reason: 'Balanced proportions with clean contrast.',
    assessment: 'Appropriate for this occasion',
    isAiRanked: true,
  };

  it('renders legacy variant with horizontal thumbnails by default', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(SuggestedOutfitCard, {
          outfit: mockOutfit,
          onSave: jest.fn(),
        })
      );
    });

    const instance = root!.root;
    // Flat lay canvas should NOT be rendered in legacy variant
    const flatLay = instance.findAll((node) => node.props && node.props['testID'] === 'flat-lay-canvas');
    expect(flatLay).toHaveLength(0);

    const images = instance.findAllByType('Image' as any);
    expect(images).toHaveLength(2); // 2 thumbnails
  });

  it('renders atelier variant with flat-lay canvas and grounded bullets', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(SuggestedOutfitCard, {
          outfit: mockOutfit,
          onSave: jest.fn(),
          onPass: jest.fn(),
          variant: 'atelier',
        })
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Timeless Monochromatic Flow');
    expect(texts).toContain('Appropriate for this occasion');
    expect(texts).toContain('AI Ranked');
    expect(texts).toContain('Pass');
    expect(texts).toContain('Save Outfit');

    // Grounded bullet checks
    const hasUnwornBullet = texts.some(
      (t) => typeof t === 'string' && t.includes('Features a new, unworn')
    );
    expect(hasUnwornBullet).toBe(true);
  });

  it('triggers onSave callback when Save Outfit button is pressed', () => {
    const onSave = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(SuggestedOutfitCard, {
          outfit: mockOutfit,
          onSave,
          variant: 'atelier',
        })
      );
    });

    const instance = root!.root;
    const touchables = instance.findAllByType('TouchableOpacity' as any);
    const saveBtn = touchables.find((t) => t.props.accessibilityLabel === 'Save outfit to wardrobe');
    expect(saveBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      saveBtn!.props.onPress();
    });
    expect(onSave).toHaveBeenCalledWith(mockOutfit);
  });

  it('triggers onPass callback when Pass button is pressed', () => {
    const onPass = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(SuggestedOutfitCard, {
          outfit: mockOutfit,
          onSave: jest.fn(),
          onPass,
          variant: 'atelier',
        })
      );
    });

    const instance = root!.root;
    const touchables = instance.findAllByType('TouchableOpacity' as any);
    const passBtn = touchables.find((t) => t.props.accessibilityLabel === 'Pass on this look');
    expect(passBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      passBtn!.props.onPress();
    });
    expect(onPass).toHaveBeenCalledWith(mockOutfit);
  });

  it('disables save button and indicates Saved when alreadySaved is true', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(SuggestedOutfitCard, {
          outfit: mockOutfit,
          onSave: jest.fn(),
          alreadySaved: true,
          variant: 'atelier',
        })
      );
    });

    const instance = root!.root;
    const touchables = instance.findAllByType('TouchableOpacity' as any);
    const savedBtn = touchables.find((t) => t.props.accessibilityLabel === 'Already saved to your outfits');
    expect(savedBtn).toBeDefined();
    expect(savedBtn!.props.disabled).toBe(true);

    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Saved');
  });

  it('renders Plan Look CTA only when caller supplies a truthful planLaterPayload', () => {
    const onPlanLater = jest.fn();
    const truthfulPayload = {
      items: [
        { id: '1', name: 'Shirt', category: 'Tops' },
        { id: '2', name: 'Trousers', category: 'Bottoms' },
      ],
      sourceType: 'saved_outfit' as const,
      sourceRefId: 'saved_123',
    };

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(SuggestedOutfitCard, {
          outfit: mockOutfit,
          onSave: jest.fn(),
          onPlanLater,
          planLaterPayload: truthfulPayload,
          variant: 'atelier',
        })
      );
    });

    const instance = root!.root;
    const planBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Plan this outfit for an upcoming day'
    );
    expect(planBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      planBtn.props.onPress();
    });
    expect(onPlanLater).toHaveBeenCalledWith(truthfulPayload);
  });

  it('strictly hides Plan Look CTA when planLaterPayload is omitted (no fabricated provenance)', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(SuggestedOutfitCard, {
          outfit: mockOutfit,
          onSave: jest.fn(),
          onPlanLater: jest.fn(),
          planLaterPayload: undefined, // no truthful source payload
          variant: 'atelier',
        })
      );
    });

    const instance = root!.root;
    const planBtn = instance.findAll(
      (node) => node.props && node.props.accessibilityLabel === 'Plan this outfit for an upcoming day'
    );
    expect(planBtn).toHaveLength(0);
  });
});
