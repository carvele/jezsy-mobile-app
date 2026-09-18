import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { SizeChartModal } from '../SizeChartModal';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('SizeChartModal Component', () => {
  const sampleMeasurements = {
    S: { waist: 68, hips: 92, inseam: 75 },
    M: { waist: 74, hips: 98, inseam: 76 },
    L: { waist: 80, hips: 104, inseam: 77 },
  };

  const defaultProps = {
    visible: true,
    measurements: sampleMeasurements as any,
    sizes: ['S', 'M', 'L'],
    recommendedSize: 'M',
    onClose: jest.fn(),
  };

  it('renders modal header, column labels with Inseam, and size rows', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(SizeChartModal, defaultProps));
    });

    const instance = root!.root;
    const allText = instance.findAllByType('Text' as any).flatMap((t) => {
      const c = t.props.children;
      return Array.isArray(c) ? c : [c];
    });

    expect(allText).toContain('Size Chart');
    expect(allText).toContain('Waist');
    expect(allText).toContain('Hips');
    expect(allText).toContain('Inseam');
    expect(allText).not.toContain('Pants');
    expect(allText).toContain('S');
    expect(allText).toContain('M');
    expect(allText).toContain('L');
  });

  it('switches between CM and IN units when toggled', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(SizeChartModal, defaultProps));
    });

    const instance = root!.root;
    // Initially CM: values include 68, 75
    let allText = instance.findAllByType('Text' as any).flatMap((t) => {
      const c = t.props.children;
      return Array.isArray(c) ? c : [c];
    });
    expect(allText).toContain('68');
    expect(allText).toContain('75');

    // Find the IN toggle button
    const touchables = instance.findAllByType('TouchableOpacity' as any);
    const inButton = touchables.find((t) => {
      const textChild = t.findAllByType('Text' as any);
      return textChild.some((tc) => tc.props.children === 'IN');
    });
    expect(inButton).toBeDefined();

    ReactTestRenderer.act(() => {
      inButton!.props.onPress();
    });

    allText = instance.findAllByType('Text' as any).flatMap((t) => {
      const c = t.props.children;
      return Array.isArray(c) ? c : [c];
    });
    // 68 cm * 1/2.54 = 26.8 in
    expect(allText).toContain('26.8');
    // 75 cm * 1/2.54 = 29.5 in
    expect(allText).toContain('29.5');
  });
});
