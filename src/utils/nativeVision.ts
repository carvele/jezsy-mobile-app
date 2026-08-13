import { useCallback, useMemo } from "react";
import type { ComponentType } from "react";
import type {
  CameraDevice,
  CameraPosition,
  DeviceFilter,
} from "react-native-vision-camera";
import type {
  DetectionCallbacks,
  MediaPipeSolution,
  PoseDetectionOptions,
  PoseDetectionResultBundle,
  RunningMode as RunningModeType,
} from "react-native-mediapipe-posedetection";

// react-native-vision-camera and react-native-mediapipe-posedetection are
// load-bearing native modules (see CLAUDE.md). A version-skewed JS bundle
// (e.g. delivered via expo-updates ahead of a matching native rebuild) can
// have this require() throw, which would otherwise crash the whole app at
// import time since ar-tryon/[id].tsx and body-scan.tsx import them
// statically. require (not import) lets the failure be caught here once,
// with every consumer degrading through the existing "no device" UI instead.
let VisionCamera: typeof import("react-native-vision-camera") | null = null;
let PoseDetection: typeof import("react-native-mediapipe-posedetection") | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be synchronous so the try/catch can guard the hooks below
  VisionCamera = require("react-native-vision-camera");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PoseDetection = require("react-native-mediapipe-posedetection");
} catch (e) {
  console.error("Native camera/pose-detection modules failed to load:", e);
}

export const NATIVE_VISION_AVAILABLE = VisionCamera != null && PoseDetection != null;

export const Camera: ComponentType<any> = NATIVE_VISION_AVAILABLE
  ? (VisionCamera as any).Camera
  : () => null;

export const RunningMode = NATIVE_VISION_AVAILABLE
  ? (PoseDetection as any).RunningMode
  : ({ LIVE_STREAM: "LIVE_STREAM" } as any);

export const Delegate = NATIVE_VISION_AVAILABLE
  ? (PoseDetection as any).Delegate
  : ({ CPU: "CPU", GPU: "GPU" } as any);

// Each pair below is one real implementation (delegates to the native hook)
// and one stub (calls no native code, just returns an inert value). Which
// one gets exported is decided once at module load from NATIVE_VISION_AVAILABLE,
// not branched on per-render -- so every exported hook unconditionally calls
// the same fixed hook chain on every render, satisfying rules-of-hooks, while
// a missing native module still can't crash the call site.

function useCameraDeviceReal(position: CameraPosition, filter?: DeviceFilter): CameraDevice | undefined {
  return (VisionCamera as any).useCameraDevice(position, filter);
}
function useCameraDeviceStub(): CameraDevice | undefined {
  return undefined;
}
export const useCameraDevice = NATIVE_VISION_AVAILABLE ? useCameraDeviceReal : useCameraDeviceStub;

function useCameraPermissionReal(): { hasPermission: boolean; requestPermission: () => Promise<boolean> } {
  return (VisionCamera as any).useCameraPermission();
}
function useCameraPermissionStub(): { hasPermission: boolean; requestPermission: () => Promise<boolean> } {
  return useMemo(() => ({ hasPermission: false, requestPermission: async () => false }), []);
}
export const useCameraPermission = NATIVE_VISION_AVAILABLE ? useCameraPermissionReal : useCameraPermissionStub;

function usePoseDetectionReal(
  callbacks: DetectionCallbacks<PoseDetectionResultBundle>,
  runningMode: RunningModeType,
  model: string,
  options?: Partial<PoseDetectionOptions>,
): MediaPipeSolution {
  return (PoseDetection as any).usePoseDetection(callbacks, runningMode, model, options);
}
function usePoseDetectionStub(): MediaPipeSolution {
  const cameraViewLayoutChangeHandler = useCallback(() => {}, []);
  return useMemo(
    () =>
      ({
        cameraViewLayoutChangeHandler,
        cameraDeviceChangeHandler: () => {},
        cameraOrientationChangedHandler: () => {},
        resizeModeChangeHandler: () => {},
        cameraViewDimensions: { width: 1, height: 1 },
        frameProcessor: undefined,
      }) as unknown as MediaPipeSolution,
    [cameraViewLayoutChangeHandler],
  );
}
export const usePoseDetection = NATIVE_VISION_AVAILABLE ? usePoseDetectionReal : usePoseDetectionStub;

export type { PoseDetectionResultBundle } from "react-native-mediapipe-posedetection";
