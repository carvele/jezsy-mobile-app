import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { DeterministicFlatLayCanvas } from '../DeterministicFlatLayCanvas';

jest.mock('expo-image', () => ({
  Image: (props: any) => React.createElement('Image', props),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('DeterministicFlatLayCanvas Component (Phase B)', () => {
  it('returns null when items array is empty', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(DeterministicFlatLayCanvas, { items: [] }));
    });
    expect(root!.toJSON()).toBeNull();
  });

  it('renders centered single item when items length is 1', () => {
    const single = [{ id: 'top-1', category: 'Tops', garment_type: 'Shirt', image_url: 'https://example.com/top.png' }];
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(DeterministicFlatLayCanvas, { items: single }));
    });

    const instance = root!.root;
    const images = instance.findAllByType('Image' as any);
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({ uri: 'https://example.com/top.png' });
  });

  it('renders slot-positioned layout for top and bottom', () => {
    const outfit = [
      { id: 'top-1', category: 'Tops', garment_type: 'Shirt', image_url: 'https://example.com/top.png' },
      { id: 'bot-1', category: 'Bottoms', garment_type: 'Trousers', image_url: 'https://example.com/bot.png' },
      { id: 'shoe-1', category: 'Shoes', garment_type: 'Loafer', image_url: 'https://example.com/shoe.png' },
    ];
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(DeterministicFlatLayCanvas, { items: outfit }));
    });

    const instance = root!.root;
    const images = instance.findAllByType('Image' as any);
    expect(images).toHaveLength(3);
  });

  it('suppresses top and bottom slots when dress is present', () => {
    const outfitWithDress = [
      { id: 'dress-1', category: 'Dresses', garment_type: 'Midi Dress', image_url: 'https://example.com/dress.png' },
      { id: 'shoe-1', category: 'Shoes', garment_type: 'Heels', image_url: 'https://example.com/heels.png' },
      { id: 'top-ignored', category: 'Tops', garment_type: 'Shirt', image_url: 'https://example.com/top.png' },
    ];
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(DeterministicFlatLayCanvas, { items: outfitWithDress }));
    });

    const instance = root!.root;
    const images = instance.findAllByType('Image' as any);
    // Dress + Shoes rendered; top-ignored is suppressed
    expect(images).toHaveLength(2);
  });

  it('falls back to grid when majority of items are unresolvable', () => {
    const unknownItems = [
      { id: 'unk-1', category: 'Miscellaneous', garment_type: 'MysteryItem1', image_url: 'https://example.com/1.png' },
      { id: 'unk-2', category: 'Miscellaneous', garment_type: 'MysteryItem2', image_url: 'https://example.com/2.png' },
      { id: 'unk-3', category: 'Miscellaneous', garment_type: 'MysteryItem3', image_url: 'https://example.com/3.png' },
    ];
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(DeterministicFlatLayCanvas, { items: unknownItems }));
    });

    const instance = root!.root;
    const images = instance.findAllByType('Image' as any);
    expect(images).toHaveLength(3);
  });

  it('respects custom height prop', () => {
    const single = [{ id: 'top-1', category: 'Tops', garment_type: 'Shirt', image_url: 'https://example.com/top.png' }];
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(DeterministicFlatLayCanvas, { items: single, height: 400 }));
    });

    const instance = root!.root;
    const views = instance.findAllByType('View' as any);
    expect(views[0].props.style).toEqual(expect.arrayContaining([{ height: 400 }]));
  });
});
