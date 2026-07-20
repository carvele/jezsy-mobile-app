/**
 * Worklet-side two-stage BlazePose inference, wrapping react-native-fast-tflite's
 * runSync for use inside a vision-camera frame processor.
 *
 * Stage 1 (detector): pose_detection.tflite, 224x224 RGB float32 input,
 *   outputs boxes [1,2254,12] + scores [1,2254,1]. Run only when we don't
 *   already have a tracking ROI (first frame / after track loss).
 * Stage 2 (landmark): pose_landmark_lite.tflite, 256x256 RGB float32 input,
 *   outputs landmarks [1,195] + pose-presence flag [1,1] (+ unused seg /
 *   heatmap / world tensors). Run every frame on the current ROI.
 *
 * Output tensor ordering is resolved defensively by byte length rather than
 * assumed index, since a model re-export could reorder outputs.
 *
 * All model I/O uses ArrayBuffer[] (fast-tflite's runSync contract). The
 * resize plugin hands us a Float32Array whose .buffer we pass straight in.
 */

import type { TensorflowModel } from 'react-native-fast-tflite';
import { decodeBestDetection, generateBlazePoseAnchors, type Anchor, type DetectionRoi } from './blazePoseAnchors';
import { parseLandmarks, type Landmark } from './poseDetector';

const DETECTOR_BOX_FLOATS = 2254 * 12;
const DETECTOR_SCORE_FLOATS = 2254 * 1;
const LANDMARK_FLOATS = 195;
const POSE_FLAG_FLOATS = 1;

export interface LandmarkResult {
  landmarks: Landmark[]; // 39 raw landmarks, ROI-local normalized [0,1]
  posePresent: boolean;
}

/**
 * Picks the output ArrayBuffer whose float count matches `expectedFloats`.
 * Guards against output-order assumptions.
 */
function pickOutputByFloatCount(outputs: ArrayBuffer[], expectedFloats: number): ArrayBuffer | null {
  'worklet';
  const expectedBytes = expectedFloats * 4;
  for (let i = 0; i < outputs.length; i++) {
    if (outputs[i].byteLength === expectedBytes) return outputs[i];
  }
  return null;
}

/**
 * Runs the detector stage on an already-resized 224x224x3 float32 RGB buffer.
 * Returns the best detection's ROI (detector-square-crop-local normalized),
 * or null if nothing scored above threshold.
 */
export function runDetector(
  model: TensorflowModel,
  input: Float32Array,
  anchors: Anchor[]
): DetectionRoi | null {
  'worklet';
  const outputs = model.runSync([input.buffer as ArrayBuffer]);

  const boxesBuffer = pickOutputByFloatCount(outputs, DETECTOR_BOX_FLOATS);
  const scoresBuffer = pickOutputByFloatCount(outputs, DETECTOR_SCORE_FLOATS);
  if (boxesBuffer == null || scoresBuffer == null) return null;

  const boxes = new Float32Array(boxesBuffer);
  const scores = new Float32Array(scoresBuffer);
  return decodeBestDetection(boxes, scores, anchors);
}

/**
 * Runs the landmark stage on an already-resized 256x256x3 float32 RGB buffer.
 * Returns the 39 raw landmarks (ROI-local) and whether a pose is present.
 */
export function runLandmarks(model: TensorflowModel, input: Float32Array): LandmarkResult | null {
  'worklet';
  const outputs = model.runSync([input.buffer as ArrayBuffer]);

  const landmarkBuffer = pickOutputByFloatCount(outputs, LANDMARK_FLOATS);
  const poseFlagBuffer = pickOutputByFloatCount(outputs, POSE_FLAG_FLOATS);
  if (landmarkBuffer == null) return null;

  const landmarks = parseLandmarks(new Float32Array(landmarkBuffer));

  // Pose-presence flag is a raw logit; threshold at 0 (sigmoid(0)=0.5, matching
  // the reference ThresholdingCalculator threshold of 0.5). If the flag output
  // couldn't be located, fall back to treating the pose as present and rely on
  // isPoseValid's landmark-visibility gate downstream.
  let posePresent = true;
  if (poseFlagBuffer != null) {
    const flagLogit = new Float32Array(poseFlagBuffer)[0];
    posePresent = flagLogit > 0;
  }

  return { landmarks, posePresent };
}

/**
 * Convenience re-export so the frame processor can build the anchor set once
 * (it's ~2254 entries; generate on the JS thread and share into the worklet).
 */
export { generateBlazePoseAnchors };
