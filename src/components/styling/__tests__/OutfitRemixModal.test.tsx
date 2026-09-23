import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { OutfitRemixModal } from '../OutfitRemixModal';
import {
  adaptStyleAdvisorLookToRemix,
  adaptPassiveOutfitToRemix,
  adaptSavedOutfitToRemix,
} from '@/src/services/styling/outfitRemixService';
import { WardrobeItem, StylingOption } from '@/src/types/styleAdvisor';
import { localExposureService } from '@/src/services/styling/localExposureService';

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

function makeMockWardrobeItem(partial: Partial<WardrobeItem> & { id: string; category: string }): WardrobeItem {
  return {
    id: partial.id,
    user_id: 'user_remix_modal',
    product_id: null,
    image_url: 'https://example.com/img.jpg',
    category: partial.category,
    sub_category: partial.sub_category || partial.category,
    deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    color_tags: partial.color_tags || ['Black'],
    garment_type: partial.garment_type || partial.category,
    wear_count: 0,
    last_worn_at: null,
    description: null,
    user_notes: null,
    ai_attributes: null,
    occasions: ['Casual'],
    seasons: ['All'],
  } as WardrobeItem;
}

const mockWardrobe: WardrobeItem[] = [
  makeMockWardrobeItem({ id: 'top_1', category: 'Top', sub_category: 'White Linen Shirt', color_tags: ['White'] }),
  makeMockWardrobeItem({ id: 'top_2', category: 'Top', sub_category: 'Black Crewneck', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'bottom_1', category: 'Bottom', sub_category: 'Dark Denim Jeans', color_tags: ['Blue'] }),
  makeMockWardrobeItem({ id: 'bottom_2', category: 'Bottom', sub_category: 'Chino Trousers', color_tags: ['Beige'] }),
  makeMockWardrobeItem({ id: 'shoes_1', category: 'Shoes', sub_category: 'White Sneakers', color_tags: ['White'] }),
  makeMockWardrobeItem({ id: 'shoes_2', category: 'Shoes', sub_category: 'Leather Loafers', color_tags: ['Black'] }),
  makeMockWardrobeItem({ id: 'acc_1', category: 'Accessory', sub_category: 'Leather Watch', color_tags: ['Brown'] }),
];

describe('Phase E: OutfitRemixModal Component Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 33. style-advisor-apply-flow
  it('33. surfaces Style Advisor look and applies remixed draft', () => {
    const look: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[2], mockWardrobe[3]], // top_1, bottom_1, shoes_1
      key: 'bottom_1|shoes_1|top_1',
      label: 'Casual Classic',
      headline: 'Fresh Daytime Flow',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'Clean contrast', palette: 'Monochrome', silhouette: 'Balanced', occasion: 'Casual' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 92,
    };

    const initialState = adaptStyleAdvisorLookToRemix(look, mockWardrobe, { rawPrompt: 'Day out' });
    const onApply = jest.fn();
    const onClose = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(OutfitRemixModal, {
          visible: true,
          onClose,
          initialState,
          wardrobe: mockWardrobe,
          onApply,
        })
      );
    });

    const instance = root!.root;

    // Verify Title & Subtitle rendered
    const texts = instance.findAllByType('Text' as any);
    const titleText = texts.find((t) => t.props.children === 'Remix Outfit');
    expect(titleText).toBeDefined();

    // Trigger Shuffle Unlocked to remix the outfit
    const shuffleBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Shuffle all unlocked slots'
    );
    expect(shuffleBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      shuffleBtn.props.onPress();
    });

    // Trigger Apply Changes
    const applyBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Apply remix changes'
    );
    expect(applyBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      applyBtn.props.onPress();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    const appliedResult = onApply.mock.calls[0][0];
    expect(appliedResult.isRemixedDraft).toBe(true);
    expect(appliedResult.items).toHaveLength(3);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 34. passive-outfits-remixed-draft-isolation
  it('34. isolates passive outfit remix draft with zero exposure writes', () => {
    const spyPresentation = jest.spyOn(localExposureService, 'logPresentation');
    const spyInteraction = jest.spyOn(localExposureService, 'logInteraction');

    const passiveOutfit = {
      key: 'bottom_1|shoes_1|top_1',
      items: [mockWardrobe[0], mockWardrobe[2], mockWardrobe[3]],
      score: 88,
      label: 'Balanced',
      headline: 'Effortless',
      reason: 'Pairs well together',
    };

    const initialState = adaptPassiveOutfitToRemix(passiveOutfit, mockWardrobe);
    const onApply = jest.fn();
    const onClose = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(OutfitRemixModal, {
          visible: true,
          onClose,
          initialState,
          wardrobe: mockWardrobe,
          onApply,
        })
      );
    });

    const instance = root!.root;

    // Trigger Shuffle Unlocked
    const shuffleBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Shuffle all unlocked slots'
    );
    expect(shuffleBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      shuffleBtn.props.onPress();
    });

    // Strictly assert 0 calls to Phase B exposure service
    expect(spyPresentation).not.toHaveBeenCalled();
    expect(spyInteraction).not.toHaveBeenCalled();
  });

  // 35. saved-outfit-cancel-done-save-as-new
  it('35. allows dismissing without saving, and allows saving remixed look as new outfit', () => {
    const saved = {
      id: 'saved_outfit_123',
      name: 'Work Uniform',
      items: [
        { slot: 'top', id: 'top_1' },
        { slot: 'bottom', id: 'bottom_1' },
        { slot: 'shoes', id: 'shoes_1' },
      ],
    };

    const initialState = adaptSavedOutfitToRemix(saved, mockWardrobe);
    const onApply = jest.fn();
    const onSave = jest.fn();
    const onClose = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(OutfitRemixModal, {
          visible: true,
          onClose,
          initialState,
          wardrobe: mockWardrobe,
          onApply,
          onSave,
        })
      );
    });

    const instance = root!.root;

    // Dismiss via close button
    const closeBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Close remix editor'
    );
    expect(closeBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      closeBtn.props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    // Trigger Shuffle Unlocked to remix the outfit
    const shuffleBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Shuffle all unlocked slots'
    );
    expect(shuffleBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      shuffleBtn.props.onPress();
    });

    // Trigger Save Look
    const saveBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Save remixed look to your wardrobe'
    );
    expect(saveBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      saveBtn.props.onPress();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedResult = onSave.mock.calls[0][0];
    expect(savedResult.isRemixedDraft).toBe(true);
    expect(savedResult.items).toHaveLength(3);
  });

  // 36. transient-mannequin-transfer-with-passthrough
  it('36. transfers remixed garments and preserved passthrough accessories to Mannequin', () => {
    const lookWithAccessory: StylingOption = {
      candidateId: 'c1',
      items: [mockWardrobe[0], mockWardrobe[2], mockWardrobe[4], mockWardrobe[6]], // includes acc_1
      key: 'acc_1|bottom_1|shoes_1|top_1',
      label: 'Accessorized',
      headline: 'Elevated Look',
      intentMatch: 'Match',
      whyThisWorks: { summary: 'Gold accents', palette: 'Neutral', silhouette: 'Fitted', occasion: 'Casual' },
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      score: 95,
    };

    const initialState = adaptStyleAdvisorLookToRemix(lookWithAccessory, mockWardrobe, { rawPrompt: '' });
    expect(initialState.passthroughItems).toHaveLength(1);
    expect(initialState.passthroughItems[0].id).toBe('acc_1');

    const onOpenMannequin = jest.fn();
    const onApply = jest.fn();
    const onClose = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(OutfitRemixModal, {
          visible: true,
          onClose,
          initialState,
          wardrobe: mockWardrobe,
          onApply,
          onOpenMannequin,
        })
      );
    });

    const instance = root!.root;

    // Trigger Mannequin transfer
    const mannequinBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Preview remixed outfit on mannequin'
    );
    expect(mannequinBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      mannequinBtn.props.onPress();
    });

    expect(onOpenMannequin).toHaveBeenCalledTimes(1);
    const transferResult = onOpenMannequin.mock.calls[0][0];
    // Check that acc_1 is preserved in items sent to mannequin
    expect(transferResult.items.some((i: WardrobeItem) => i.id === 'acc_1')).toBe(true);
    expect(transferResult.items).toHaveLength(4);
  });
});
