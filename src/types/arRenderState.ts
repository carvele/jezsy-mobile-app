import type { Vec3, Quaternion, SegmentationFrame } from './pose';
import type { GarmentMetadata } from './garment';
import type { BodyFitState } from '../utils/bodyFitEstimator';

export type { BodyFitState };

export interface CameraCalibration {
  focalLengthPx: number;
  verticalFovDeg: number;
  videoWidthPx: number;
  videoHeightPx: number;
  wearerShoulderWidthM: number;
  wearerHipWidthM?: number;
  wearerSkeletalShoulderSpanM?: number;
  wearerSkeletalHipSpanM?: number;
}

export interface ResolvedScaleXYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * Renderer-neutral garment render state passed down from pose/fit/retargeting.
 */
export interface GarmentRenderState {
  position: Vec3;
  orientationQuaternion: Quaternion;
  scale: number;
  boneRotations?: Record<string, Quaternion>;
  visible: boolean;
  color?: string | null;
  opacity?: number;
  fitModifier?: number;
  cameraCalibration?: CameraCalibration;
  cameraDimensions?: { width: number; height: number };
  bodyFitState?: BodyFitState;
}

/**
 * Standard imperative ref interface implemented by ALL garment renderers:
 * - GarmentRenderer (Three.js / WebView)
 * - FilamentExperimentRenderer (Native Filament)
 * - SceneViewExperimentRenderer (Native SceneView)
 */
export interface GarmentRendererRef {
  updateTransform: (
    position: Vec3,
    rotation: Quaternion,
    scale: number,
    boneRotations?: Record<string, Quaternion>,
    segmentation?: SegmentationFrame,
    normalizedLandmarks?: any[],
    worldLandmarks?: any[],
    bodyFitState?: BodyFitState
  ) => void;
}

/**
 * Standard base props accepted by all 3D garment renderers.
 */
export interface BaseGarmentRendererProps {
  modelUrl: string;
  visible?: boolean;
  metadata?: GarmentMetadata;
  fitModifier?: number;
  cameraCalibration?: CameraCalibration;
  cameraDimensions?: {
    width: number;
    height: number;
  };
  stageWidth?: number;
  stageHeight?: number;
  hexColor?: string | null;
  onLoadError?: (error: string | { type: string; message: string }) => void;
  onLoaded?: () => void;
  /** Called once when the renderer has confirmed its first real rendered frame.
   *  For SceneViewScene this fires inside updateTransform after hasTransform becomes true,
   *  meaning the native GLSurfaceView is confirmed active and rendering the garment.
   *  This is the authoritative ground-truth signal — not a JS state label. */
  onRendererConfirmed?: (rendererName: string) => void;
}

export type GarmentRendererProps = BaseGarmentRendererProps;
