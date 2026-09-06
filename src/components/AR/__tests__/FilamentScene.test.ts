import React from 'react';
import { FilamentExperimentScene } from '../FilamentScene.native';
import type { GarmentRendererRef } from '../GarmentRenderer';
import type { GarmentMetadata } from '../../../types/garment';

const { act, create } = jest.requireActual('react-test-renderer');
const mockSetProjection = jest.fn();
const mockUpdateBones = jest.fn();
const mockSetTransform = jest.fn();
const mockCommit = jest.fn();
const mockMatrix = () => ({ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  scale: [1, 1, 1], translation: [0, 0, 0], scaling: () => mockMatrix(), rotate: () => mockMatrix(), translate: () => mockMatrix() });
const mockAsset = { getFirstEntityByName: (name: string) => ({ id: ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm'].indexOf(name) + 1 }) };
const mockModel = { state: 'loaded', asset: mockAsset, rootEntity: { id: 0 } };
const mockContext = {
  transformManager: { getTransform: mockMatrix, getWorldTransform: mockMatrix, createIdentityMatrix: mockMatrix,
    setTransform: mockSetTransform, openLocalTransformTransaction: jest.fn(), commitLocalTransformTransaction: mockCommit },
  camera: { setProjection: mockSetProjection, lookAt: jest.fn() },
};
const mockAnimator = { updateBoneMatrices: mockUpdateBones };

jest.mock('react-native', () => ({ View: 'View', Text: 'Text', StyleSheet: { absoluteFill: {} } }));
jest.mock('react-native-filament', () => ({
  FilamentScene: ({ children }: React.PropsWithChildren) => children,
  FilamentView: 'FilamentView', Light: 'Light',
  useModel: () => mockModel, useAnimator: () => mockAnimator, useFilamentContext: () => mockContext,
}));
jest.mock('react-native-worklets-core', () => ({
  useSharedValue: (value: unknown) => jest.requireActual('react').useMemo(() => ({ value }), []),
}));

it('consumes the existing transform contract once per packet and updates skinning after the transaction', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const silence = jest.spyOn(console, 'error').mockImplementation((message) => {
    if (!String(message).includes('react-test-renderer is deprecated')) throw new Error(String(message));
  });
  const ref = React.createRef<GarmentRendererRef>();
  const metadata: GarmentMetadata = { id: 'fixture', category: 'shirt', calibrationVersion: 'test', ingestionStatus: 'DEMO_RIG',
    anatomicalAnchorOffset: { x: 0, y: 0.5, z: 0 }, anchorConfidence: 'inferred', anchorType: 'SHOULDER_CENTER',
    restPoseMetricWidth: 0.4, restPose: 'A_POSE', boneMap: {} };
  let renderer: any;
  try {
    act(() => { renderer = create(React.createElement(FilamentExperimentScene, {
      ref, modelUrl: 'https://example.com/fixture.glb', metadata, stageWidth: 400, stageHeight: 800, visible: true,
    })); });
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.35 }));
    landmarks[11].x = 0.6;
    landmarks[12].x = 0.4;
    act(() => ref.current!.updateTransform({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 1, {}, undefined, landmarks));
    const callback = renderer.root.findByType('FilamentView').props.renderCallback;
    act(() => callback());
    expect(mockSetProjection).toHaveBeenCalledWith(45, 0.5, 0.1, 1000, 'vertical');
    expect(mockSetTransform).toHaveBeenCalledTimes(5);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockUpdateBones).toHaveBeenCalledTimes(1);
    expect(mockCommit.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateBones.mock.invocationCallOrder[0]);
    act(() => callback());
    expect(mockUpdateBones).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) act(() => renderer.unmount());
    silence.mockRestore();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
