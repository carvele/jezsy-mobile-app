import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { LegalReaderModal } from '../LegalReaderModal';
import { legalService } from '../../services/legalService';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

jest.mock('../../services/legalService', () => ({
  legalService: {
    getActiveDocument: jest.fn().mockResolvedValue({
      id: 'doc-1',
      title: 'Terms of Service',
      version: '1.0',
      content_markdown: '# Terms of Service\n\nFull terms content here.',
    }),
    recordLegalDocumentView: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('LegalReaderModal Component', () => {
  const defaultProps = {
    visible: true,
    title: 'Terms of Service',
    version: '1.0',
    content: 'Full terms content here.',
    documentId: 'doc-1',
    initialViewed: false,
    onClose: jest.fn(),
    onViewCompleted: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title, version, and initial scroll-to-bottom prompt', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(LegalReaderModal, defaultProps));
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Terms of Service');

    // Done button is disabled when not scrolled to bottom
    const doneButton = instance.findAllByProps({ accessibilityLabel: 'Scroll to bottom to review' });
    expect(doneButton.length).toBe(1);
    expect(doneButton[0].props.disabled).toBe(true);
  });

  it('closes when the close button is pressed regardless of scroll status', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(LegalReaderModal, defaultProps));
    });

    const instance = root!.root;
    const closeBtn = instance.findByProps({ accessibilityLabel: 'Close legal reader' });
    ReactTestRenderer.act(() => {
      closeBtn.props.onPress();
    });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(defaultProps.onViewCompleted).not.toHaveBeenCalled();
  });

  it('enables the Done button and triggers onViewCompleted when initially viewed', () => {
    const props = { ...defaultProps, initialViewed: true };
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(LegalReaderModal, props));
    });

    const instance = root!.root;
    const doneButton = instance.findByProps({ accessibilityLabel: 'Done reading document' });
    expect(doneButton.props.disabled).toBe(false);

    ReactTestRenderer.act(() => {
      doneButton.props.onPress();
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('scroll event reaching bottom triggers onViewCompleted and enables Done button', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(LegalReaderModal, defaultProps));
    });

    const instance = root!.root;
    const scrollView = instance.findByType('ScrollView' as any);

    // Simulate scrolling to bottom
    await ReactTestRenderer.act(async () => {
      scrollView.props.onScroll({
        nativeEvent: {
          layoutMeasurement: { height: 600 },
          contentOffset: { y: 450 },
          contentSize: { height: 1000 },
        },
      });
    });

    expect(defaultProps.onViewCompleted).toHaveBeenCalledTimes(1);

    const doneButton = instance.findByProps({ accessibilityLabel: 'Done reading document' });
    expect(doneButton.props.disabled).toBe(false);

    ReactTestRenderer.act(() => {
      doneButton.props.onPress();
    });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('handles server RPC errors gracefully for unauthenticated users without breaking onViewCompleted', async () => {
    (legalService.recordLegalDocumentView as jest.Mock).mockRejectedValueOnce(
      new Error('Permission denied for function record_legal_document_view')
    );

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(LegalReaderModal, defaultProps));
    });

    const instance = root!.root;
    const scrollView = instance.findByType('ScrollView' as any);

    await ReactTestRenderer.act(async () => {
      scrollView.props.onScroll({
        nativeEvent: {
          layoutMeasurement: { height: 600 },
          contentOffset: { y: 450 },
          contentSize: { height: 1000 },
        },
      });
    });

    expect(defaultProps.onViewCompleted).toHaveBeenCalledTimes(1);
  });
});
