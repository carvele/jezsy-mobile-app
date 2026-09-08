declare module 'react-native-filament' {
  import type React from 'react';
  import type { ViewStyle } from 'react-native';

  export type Float3 = [number, number, number];
  export type Entity = number;
  export type RenderCallback = () => void;

  export interface TransformData {
    data: number[];
    scale: Float3;
    translation: Float3;
  }

  export interface MatrixHelper {
    scaling(s: Float3): MatrixHelper;
    rotate(angle: number, axis: Float3): MatrixHelper;
    translate(pos: Float3): MatrixHelper;
  }

  export interface TransformManager {
    getTransform(entity: Entity): TransformData;
    getWorldTransform(entity: Entity): TransformData;
    openLocalTransformTransaction(): void;
    commitLocalTransformTransaction(): void;
    createIdentityMatrix(): MatrixHelper;
    setTransform(entity: Entity, matrix: MatrixHelper): void;
  }

  export interface FilamentCamera {
    setProjection(fov: number, aspect: number, near: number, far: number, direction?: string): void;
    lookAt(eye: Float3, target: Float3, up: Float3): void;
  }

  export interface FilamentAsset {
    getFirstEntityByName(name: string): Entity | undefined;
  }

  export interface FilamentModel {
    state: 'loading' | 'loaded' | 'error';
    asset?: FilamentAsset;
    rootEntity?: Entity;
  }

  export interface FilamentAnimator {
    updateBoneMatrices(): void;
  }

  export interface FilamentContext {
    transformManager: TransformManager;
    camera: FilamentCamera;
  }

  export function useModel(source: { uri: string }, options?: { shouldReleaseSourceData?: boolean }): FilamentModel;
  export function useFilamentContext(): FilamentContext;
  export function useAnimator(asset?: FilamentAsset): FilamentAnimator | undefined;

  export interface FilamentViewProps {
    style?: ViewStyle;
    enableTransparentRendering?: boolean;
    renderCallback?: RenderCallback;
    children?: React.ReactNode;
  }

  export const FilamentScene: React.FC<{ children?: React.ReactNode }>;
  export const FilamentView: React.FC<FilamentViewProps>;
  export const Light: React.FC<{
    type?: string;
    intensity?: number;
    direction?: Float3;
    color?: string | number;
  }>;
}
