import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { ConfirmModal } from '../ConfirmModal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ConfirmModal Component (UX-FOUND-003)', () => {
  const defaultProps = {
    visible: true,
    title: 'Delete Item',
    message: 'Are you sure you want to delete this item?',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal content with title and message when visible', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(ConfirmModal, defaultProps));
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Delete Item');
    expect(texts).toContain('Are you sure you want to delete this item?');
  });

  it('triggers onConfirm and onCancel callbacks', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(React.createElement(ConfirmModal, defaultProps));
    });

    const instance = root!.root;
    const buttons = instance.findAllByType('TouchableOpacity' as any);
    expect(buttons.length).toBe(2);

    // Cancel button
    ReactTestRenderer.act(() => {
      buttons[0].props.onPress();
    });
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);

    // Confirm button
    ReactTestRenderer.act(() => {
      buttons[1].props.onPress();
    });
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders consequences list when provided', () => {
    const consequences = ['Stock will be released', 'Active cart items removed'];
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(ConfirmModal, { ...defaultProps, consequences })
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Impact Summary:');
    expect(texts).toContain('Stock will be released');
    expect(texts).toContain('Active cart items removed');
  });

  it('enforces typed keyword confirmation when confirmKeyword is specified', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(ConfirmModal, {
          ...defaultProps,
          severity: 'HIGH',
          confirmKeyword: 'DELETE',
        })
      );
    });

    const instance = root!.root;
    const confirmBtn = instance.findAllByType('TouchableOpacity' as any)[1];
    expect(confirmBtn.props.disabled).toBe(true);

    const input = instance.findByType('TextInput' as any);
    expect(input).toBeDefined();

    // Type matching keyword
    ReactTestRenderer.act(() => {
      input.props.onChangeText('DELETE');
    });

    const updatedConfirmBtn = instance.findAllByType('TouchableOpacity' as any)[1];
    expect(updatedConfirmBtn.props.disabled).toBe(false);
  });

  it('locks action buttons and displays ActivityIndicator when isLoading is true', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(ConfirmModal, { ...defaultProps, isLoading: true })
      );
    });

    const instance = root!.root;
    const buttons = instance.findAllByType('TouchableOpacity' as any);
    expect(buttons[0].props.disabled).toBe(true);
    expect(buttons[1].props.disabled).toBe(true);

    const spinner = instance.findByType('ActivityIndicator' as any);
    expect(spinner).toBeDefined();
  });
});
