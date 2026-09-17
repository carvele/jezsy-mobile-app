import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { HardwarePermissionState } from '../HardwarePermissionState';
import { Linking } from 'react-native';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('HardwarePermissionState Component (UX-FOUND-005)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when status is granted', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(HardwarePermissionState, { status: 'granted' })
      );
    });

    expect(root!.toJSON()).toBeNull();
  });

  it('renders missing hardware message when status is hardware_unavailable', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(HardwarePermissionState, {
          status: 'hardware_unavailable',
          featureName: 'AR try-on',
        })
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Camera Unavailable');
  });

  it('renders runtime error message with retry button when status is runtime_error', () => {
    const onRetry = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(HardwarePermissionState, {
          status: 'runtime_error',
          errorMessage: 'Failed to access camera driver.',
          onRetry,
        })
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Camera Initialization Error');
    expect(texts).toContain('Failed to access camera driver.');

    const retryBtn = instance.findByType('TouchableOpacity' as any);
    ReactTestRenderer.act(() => {
      retryBtn.props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders settings link when status is permanently_denied', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(HardwarePermissionState, { status: 'permanently_denied' })
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Camera Access Blocked');

    const settingsBtn = instance.findByType('TouchableOpacity' as any);
    ReactTestRenderer.act(() => {
      settingsBtn.props.onPress();
    });
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('renders grant permission button when status is not_determined', () => {
    const onRequestPermission = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        React.createElement(HardwarePermissionState, {
          status: 'not_determined',
          onRequestPermission,
        })
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Camera Access Required');

    const grantBtn = instance.findByType('TouchableOpacity' as any);
    ReactTestRenderer.act(() => {
      grantBtn.props.onPress();
    });
    expect(onRequestPermission).toHaveBeenCalledTimes(1);
  });
});
