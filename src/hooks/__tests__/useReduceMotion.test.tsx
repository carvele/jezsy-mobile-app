import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { Text, AccessibilityInfo } from 'react-native';
import { useReduceMotion } from '../useReduceMotion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function TestMotionConsumer() {
  const reduceMotion = useReduceMotion();
  return React.createElement(Text, { testID: 'motion-status' }, reduceMotion ? 'reduced' : 'normal');
}

describe('useReduceMotion (HCI-004)', () => {
  let listeners: ((enabled: boolean) => void)[] = [];

  beforeEach(() => {
    listeners = [];
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event: string, handler: any) => {
      if (event === 'reduceMotionChanged') {
        listeners.push(handler);
      }
      return {
        remove: () => {
          listeners = listeners.filter((l) => l !== handler);
        },
      } as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to false and updates when AccessibilityInfo resolves', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(TestMotionConsumer));
    });

    const instance = root!.root;
    const textNode = instance.findByProps({ testID: 'motion-status' });
    expect(textNode.props.children).toBe('reduced');
  });

  it('updates state when reduceMotionChanged event fires', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(TestMotionConsumer));
    });

    const instance = root!.root;
    const textNode = instance.findByProps({ testID: 'motion-status' });
    expect(textNode.props.children).toBe('normal');

    await ReactTestRenderer.act(async () => {
      listeners.forEach((l) => l(true));
    });

    expect(textNode.props.children).toBe('reduced');
  });
});
