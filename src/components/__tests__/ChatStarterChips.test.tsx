import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { TouchableOpacity, Text } from 'react-native';
import { ChatStarterChips, STARTER_MESSAGES } from '../ChatStarterChips';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatStarterChips (CHAT-001)', () => {
  test('renders a chip for every starter message, with its label', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<ChatStarterChips onSelect={() => {}} />);
    });

    const texts = root!.root.findAllByType(Text as any).map((t) => t.props.children);
    for (const starter of STARTER_MESSAGES) {
      expect(texts).toContain(starter.label);
    }

    const chips = root!.root.findAllByType(TouchableOpacity as any);
    expect(chips).toHaveLength(STARTER_MESSAGES.length);
  });

  test('tapping a chip invokes onSelect with that starter\'s exact text, not its label', () => {
    const onSelect = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<ChatStarterChips onSelect={onSelect} />);
    });

    const chips = root!.root.findAllByType(TouchableOpacity as any);
    const trackMyOrderIndex = STARTER_MESSAGES.findIndex((s) => s.label === 'Track My Order');

    ReactTestRenderer.act(() => {
      chips[trackMyOrderIndex].props.onPress();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(STARTER_MESSAGES[trackMyOrderIndex].text);
  });

  test('each chip has an accessible label naming the starter', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(<ChatStarterChips onSelect={() => {}} />);
    });

    const chips = root!.root.findAllByType(TouchableOpacity as any);
    const labels = chips.map((c) => c.props.accessibilityLabel);
    expect(labels).toContain('Send starter message: Store Pickup');
  });
});
