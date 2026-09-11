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

describe('AR Garment Recoloring (Phase 1)', () => {
  it('never bakes hexColor into the injected document -- switching color must not reload the GLB', () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const consoleError = jest.spyOn(console, 'error').mockImplementation((message) => {
      if (!String(message).includes('react-test-renderer is deprecated')) throw new Error(String(message));
    });
    let renderer: any;
    const element = (hexColor: string | null) => React.createElement(GarmentRenderer, {
      modelUrl: 'https://example.com/shirt.glb', hexColor,
    });
    try {
      act(() => { renderer = create(element('#112233')); });
      const document = () => renderer.root.findByType('iframe').props.srcDoc;
      const initialDocument = document();
      // If hexColor were interpolated into the HTML string (like modelUrl is),
      // this would differ per color and force a full WebView/iframe reload --
      // losing tracking/smoothing state on every switch. It must be delivered
      // by postMessage instead, exactly like fitModifier/cameraCalibration.
      act(() => renderer.update(element('#ffcc00')));
      expect(document()).toBe(initialDocument);
      act(() => renderer.update(element(null)));
      expect(document()).toBe(initialDocument);
    } finally {
      if (renderer) act(() => renderer.unmount());
      consoleError.mockRestore();
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it('only targets explicitly-named Recolor_ materials, never a recolor-everything fallback', () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const consoleError = jest.spyOn(console, 'error').mockImplementation((message) => {
      if (!String(message).includes('react-test-renderer is deprecated')) throw new Error(String(message));
    });
    let renderer: any;
    try {
      act(() => {
        renderer = create(React.createElement(GarmentRenderer, { modelUrl: 'https://example.com/shirt.glb' }));
      });
      const document = renderer.root.findByType('iframe').props.srcDoc as string;
      expect(document).toContain("RECOLOR_MATERIAL_PREFIX = 'Recolor_'");
      // Multi-material meshes: both the array and non-array cases must clone.
      expect(document).toContain('child.material.map((m) => m.clone())');
      expect(document).toContain('child.material.clone()');
      // No blanket recolor of every material when none match the prefix.
      expect(document).not.toMatch(/recolorableMaterials\s*=\s*\[\s*\.\.\.\s*allMaterials/);
    } finally {
      if (renderer) act(() => renderer.unmount());
      consoleError.mockRestore();
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});

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
