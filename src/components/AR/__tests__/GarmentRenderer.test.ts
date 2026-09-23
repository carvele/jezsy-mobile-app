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

describe('GarmentRenderer generated document syntax', () => {
  it('does not redeclare anchorOffset or produce duplicate lexical declarations', () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: any;
    try {
      act(() => {
        renderer = create(React.createElement(GarmentRenderer, {
          modelUrl: 'https://example.com/pants.glb',
          metadata: {
            id: 'pants-1',
            category: 'pants',
            calibrationVersion: '2.0',
            anchorConfidence: 'merchant_confirmed',
            anchorType: 'HIP',
            restPoseMetricWidth: 0.35,
            boneMap: {},
            restPose: 'A_POSE',
            ingestionStatus: 'AR_READY',
            anatomicalAnchorOffset: { x: 0, y: 0.95, z: 0 },
            garmentFitProfileVersion: 2,
            fitProfileV2: {
              version: 2,
              category: 'pants',
              universalSkeleton: {},
              fitBands: [],
              rootAnchor: {
                bone: 'Hips',
                confidence: 'high',
                offset: { x: 0, y: 0.95, z: 0 },
              },
            } as any,
          },
        }));
      });
      const document = renderer.root.findByType('iframe').props.srcDoc as string;
      const scriptMatches = Array.from(document.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi));
      expect(scriptMatches.length).toBeGreaterThan(0);
      const scriptCode = scriptMatches[0][1];

      // Extract all top-level / function-level `let anchorOffset` or `const anchorOffset` declarations
      const anchorDeclarations = scriptCode.match(/\b(let|const|var)\s+anchorOffset\b/g) || [];
      expect(anchorDeclarations.length).toBe(1);

      // Verify the script can be parsed without SyntaxError by the JavaScript engine
      expect(() => new Function(scriptCode)).not.toThrow();

      // Verify safeRestPoseMetricWidth and REST_POSE_METRIC_WIDTH are declared
      expect(scriptCode).toContain('const REST_POSE_METRIC_WIDTH = 0.35;');
      expect(scriptCode).toContain('const safeRestPoseMetricWidth = REST_POSE_METRIC_WIDTH;');
      expect(scriptCode).not.toContain('targetWorldWidth');
    } finally {
      if (renderer) act(() => renderer.unmount());
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it('safely handles V1 top garment metadata without ReferenceError', () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: any;
    try {
      act(() => {
        renderer = create(React.createElement(GarmentRenderer, {
          modelUrl: 'https://example.com/shirt.glb',
          metadata: {
            id: 'shirt-1',
            category: 'shirt',
            calibrationVersion: '1.0',
            anchorConfidence: 'merchant_confirmed',
            anchorType: 'SHOULDER_CENTER',
            restPoseMetricWidth: 0.45,
            boneMap: {},
            restPose: 'T_POSE',
            ingestionStatus: 'AR_READY',
            anatomicalAnchorOffset: { x: 0, y: 1.35, z: 0 },
          },
        }));
      });
      const document = renderer.root.findByType('iframe').props.srcDoc as string;
      const scriptMatches = Array.from(document.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi));
      expect(scriptMatches.length).toBeGreaterThan(0);
      const scriptCode = scriptMatches[0][1];

      expect(scriptCode).toContain('const REST_POSE_METRIC_WIDTH = 0.45;');
      expect(scriptCode).toContain('const safeRestPoseMetricWidth = REST_POSE_METRIC_WIDTH;');
      expect(() => new Function(scriptCode)).not.toThrow();
    } finally {
      if (renderer) act(() => renderer.unmount());
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it('safely handles missing or invalid restPoseMetricWidth with null fallback', () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: any;
    try {
      act(() => {
        renderer = create(React.createElement(GarmentRenderer, {
          modelUrl: 'https://example.com/uncalibrated.glb',
          metadata: {
            id: 'uncalibrated-1',
            category: 'jacket',
            calibrationVersion: '1.0',
            restPoseMetricWidth: NaN,
            boneMap: {},
            restPose: 'T_POSE',
            ingestionStatus: 'PENDING',
          } as any,
        }));
      });
      const document = renderer.root.findByType('iframe').props.srcDoc as string;
      const scriptMatches = Array.from(document.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi));
      expect(scriptMatches.length).toBeGreaterThan(0);
      const scriptCode = scriptMatches[0][1];

      expect(scriptCode).toContain('const REST_POSE_METRIC_WIDTH = null;');
      expect(scriptCode).toContain('const safeRestPoseMetricWidth = REST_POSE_METRIC_WIDTH;');
      expect(() => new Function(scriptCode)).not.toThrow();
    } finally {
      if (renderer) act(() => renderer.unmount());
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it('contains Phase 27 upper-body retargeting invariants and parent-aware hierarchy traversal', () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: any;
    try {
      act(() => {
        renderer = create(React.createElement(GarmentRenderer, {
          modelUrl: 'https://example.com/1788455887355_Long-sleeve1.glb',
          metadata: {
            id: 'long-sleeve-1',
            category: 'jacket',
            calibrationVersion: '1.0',
            anchorConfidence: 'merchant_confirmed',
            anchorType: 'SHOULDER_CENTER',
            restPoseMetricWidth: 0.44,
            boneMap: {},
            restPose: 'T_POSE',
            ingestionStatus: 'AR_READY',
            anatomicalAnchorOffset: { x: 0, y: 1.34, z: 0 },
          },
        }));
      });
      const document = renderer.root.findByType('iframe').props.srcDoc as string;
      const scriptMatches = Array.from(document.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi));
      expect(scriptMatches.length).toBeGreaterThan(0);
      const scriptCode = scriptMatches[0][1];

      // Verifies isolation mode configuration is available
      expect(scriptCode).toContain("const BONE_ISOLATION_MODE = 'ALL';");

      // Verifies clavicle preservation (Mixamo clavicle bones LeftShoulder/RightShoulder kept at authored bind pose)
      expect(scriptCode).toContain("if (boneName === 'LeftShoulder' || boneName === 'RightShoulder')");

      // Verifies live parent hierarchy traversal and inverse multiplication
      expect(scriptCode).toContain("const liveParentInGroup = getQuatInGroup(bone.parent);");
      expect(scriptCode).toContain("const corrected = liveParentInGroup.clone().invert().multiply(targetInGroup);");
      expect(scriptCode).toContain("bone.quaternion.copy(corrected);");

      // Verifies damped camera distance triangulation for root stability
      expect(scriptCode).toContain("const maxDelta = 0.05;");
      expect(scriptCode).toContain("camera.position.z = smoothedCameraDistance;");

      // JavaScript engine parses without syntax error
      expect(() => new Function(scriptCode)).not.toThrow();
    } finally {
      if (renderer) act(() => renderer.unmount());
      delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    }
  });
});

