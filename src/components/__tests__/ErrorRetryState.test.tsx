import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { ErrorRetryState } from '../ErrorRetryState';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ErrorRetryState Component (UX-FOUND-002)', () => {
  it('renders default error title and message', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(ErrorRetryState));
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Something went wrong');
    expect(texts).toContain("We couldn't load this information. Please check your connection and try again.");
  });

  it('renders custom title and message when provided', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(ErrorRetryState, {
          title: 'Failed to Load Cart',
          message: 'Network timeout while fetching your bag.',
        })
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Failed to Load Cart');
    expect(texts).toContain('Network timeout while fetching your bag.');
  });

  it('renders retry button and triggers callback on press', () => {
    const onRetry = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(ErrorRetryState, { onRetry, retryLabel: 'Reload Items' })
      );
    });

    const instance = root!.root;
    const retryBtn = instance.findByType('TouchableOpacity' as any);
    expect(retryBtn).toBeDefined();

    ReactTestRenderer.act(() => {
      retryBtn.props.onPress();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables retry button and shows ActivityIndicator when isRetrying is true', () => {
    const onRetry = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(ErrorRetryState, { onRetry, isRetrying: true })
      );
    });

    const instance = root!.root;
    const retryBtn = instance.findByType('TouchableOpacity' as any);
    expect(retryBtn.props.disabled).toBe(true);

    const spinner = instance.findByType('ActivityIndicator' as any);
    expect(spinner).toBeDefined();

    ReactTestRenderer.act(() => {
      retryBtn.props.onPress();
    });
    expect(onRetry).not.toHaveBeenCalled();
  });
});
