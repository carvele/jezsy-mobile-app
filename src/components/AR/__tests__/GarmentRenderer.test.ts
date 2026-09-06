import React from 'react';
import { Platform } from 'react-native';
import { GarmentRenderer } from '../GarmentRenderer';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  View: 'View',
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles },
}));
jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));

const { act, create } = jest.requireActual('react-test-renderer');

describe.each(['web', 'android'] as const)('garment visibility on %s', (platform) => {
  it('hides the whole overlay without replacing the renderer document', () => {
    Platform.OS = platform;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const consoleError = jest.spyOn(console, 'error').mockImplementation((message) => {
      if (!String(message).includes('react-test-renderer is deprecated')) throw new Error(String(message));
    });
    let renderer: any;
    const element = (visible: boolean) => React.createElement(GarmentRenderer, {
      modelUrl: 'https://example.com/shirt.glb', visible,
    });
    try {
      act(() => { renderer = create(element(false)); });
      const document = () => platform === 'web' ? renderer.root.findByType('iframe').props.srcDoc
        : renderer.root.findByType('WebView').props.source.html;
      const opacity = () => renderer.root.findByType('View').props.style[1].opacity;
      const initialDocument = document();
      expect(opacity()).toBe(0);
      act(() => renderer.update(element(true)));
      expect(opacity()).toBe(1);
      expect(document()).toBe(initialDocument);
      act(() => renderer.update(element(false)));
      expect(opacity()).toBe(0);
      expect(document()).toBe(initialDocument);
    } finally {
      if (renderer) act(() => renderer.unmount());
      consoleError.mockRestore();
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
      Platform.OS = 'web';
    }
  });
});
