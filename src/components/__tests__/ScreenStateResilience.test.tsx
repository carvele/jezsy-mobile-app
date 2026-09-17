import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { View, Text } from 'react-native';
import { BrandEmptyState } from '../BrandEmptyState';
import { ErrorRetryState } from '../ErrorRetryState';
import { ProductCardSkeleton, SkeletonList } from '../Skeleton';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

jest.mock('react-native-svg', () => {
  const MockSvg = (props: any) => React.createElement('Svg', props, props.children);
  return {
    __esModule: true,
    default: MockSvg,
    Path: (props: any) => React.createElement('Path', props),
    Ellipse: (props: any) => React.createElement('Ellipse', props),
    G: (props: any) => React.createElement('G', props, props.children),
    Defs: (props: any) => React.createElement('Defs', props, props.children),
    LinearGradient: (props: any) => React.createElement('LinearGradient', props, props.children),
    Stop: (props: any) => React.createElement('Stop', props),
  };
});

jest.mock('react-native-reanimated', () => {
  return {
    __esModule: true,
    default: {
      View: (props: any) => React.createElement('View', props),
    },
    useSharedValue: (init: any) => ({ value: init }),
    useAnimatedStyle: () => ({}),
    withRepeat: (anim: any) => anim,
    withTiming: (toVal: any) => toVal,
    Easing: {
      inOut: () => ({}),
      ease: {},
    },
  };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Harness component implementing the canonical 4-state screen resilience contract:
 * - loading + no data -> SkeletonList
 * - failure + no data -> ErrorRetryState
 * - success + zero data -> BrandEmptyState
 * - failure + existing data -> keep existing content + non-blocking banner/toast
 */
function TestResilientScreen({
  loading,
  refreshing,
  error,
  data,
  onRetry,
}: {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  data: string[];
  onRetry: () => void;
}) {
  if (loading && !refreshing && data.length === 0) {
    return (
      <View testID="state-loading-skeleton">
        <SkeletonList count={2}>
          <ProductCardSkeleton width={160} />
        </SkeletonList>
      </View>
    );
  }

  if (error && data.length === 0) {
    return (
      <View testID="state-error-retry">
        <ErrorRetryState
          title="Unable to load content"
          message={error}
          onRetry={onRetry}
        />
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View testID="state-genuine-empty">
        <BrandEmptyState
          icon="bag.fill"
          title="Nothing here yet"
          message="New pieces are on their way."
        />
      </View>
    );
  }

  return (
    <View testID="state-content">
      {error && <Text testID="non-blocking-error">{error}</Text>}
      {data.map((item, idx) => (
        <Text key={idx} testID={`item-${idx}`}>
          {item}
        </Text>
      ))}
    </View>
  );
}

describe('Screen State Resilience 4-State Contract (UX-FOUND-002, UX-FOUND-006)', () => {
  it('renders skeleton placeholders on initial load with no data', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(TestResilientScreen, {
          loading: true,
          refreshing: false,
          error: null,
          data: [],
          onRetry: jest.fn(),
        })
      );
    });

    const instance = root!.root;
    expect(instance.findByProps({ testID: 'state-loading-skeleton' })).toBeDefined();
  });

  it('renders ErrorRetryState when initial load fails with zero data', () => {
    const onRetry = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(TestResilientScreen, {
          loading: false,
          refreshing: false,
          error: 'Network connection lost',
          data: [],
          onRetry,
        })
      );
    });

    const instance = root!.root;
    expect(instance.findByProps({ testID: 'state-error-retry' })).toBeDefined();

    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Unable to load content');
    expect(texts).toContain('Network connection lost');

    const retryBtn = instance.findByType('TouchableOpacity' as any);
    ReactTestRenderer.act(() => {
      retryBtn.props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders genuine BrandEmptyState on success with zero data (never masquerades error)', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(TestResilientScreen, {
          loading: false,
          refreshing: false,
          error: null,
          data: [],
          onRetry: jest.fn(),
        })
      );
    });

    const instance = root!.root;
    expect(instance.findByProps({ testID: 'state-genuine-empty' })).toBeDefined();
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Nothing here yet');
  });

  it('preserves usable stale data when refresh fails (does not replace with full-screen error)', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(TestResilientScreen, {
          loading: false,
          refreshing: false,
          error: 'Refresh failed, could not reach server',
          data: ['Product 1', 'Product 2'],
          onRetry: jest.fn(),
        })
      );
    });

    const instance = root!.root;
    // Must NOT show full-screen error
    expect(instance.findAllByProps({ testID: 'state-error-retry' }).length).toBe(0);
    // Must preserve content container
    expect(instance.findByProps({ testID: 'state-content' })).toBeDefined();
    // Must preserve data items
    expect(instance.findByProps({ testID: 'item-0' }).props.children).toBe('Product 1');
    expect(instance.findByProps({ testID: 'item-1' }).props.children).toBe('Product 2');
    // Non-blocking error notification is rendered
    expect(instance.findByProps({ testID: 'non-blocking-error' }).props.children).toBe(
      'Refresh failed, could not reach server'
    );
  });
});
