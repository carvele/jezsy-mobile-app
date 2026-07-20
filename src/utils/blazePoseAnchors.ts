/**
 * BlazePose short-range detector: SSD anchor generation and output decode.
 *
 * All parameters below are transcribed verbatim from Google's authoritative
 * MediaPipe graph configs (not reconstructed from memory, which is easy to
 * get subtly wrong for this kind of numeric config):
 *   - Anchor generation: mediapipe/modules/pose_detection/pose_detection_cpu.pbtxt
 *     (SsdAnchorsCalculatorOptions)
 *   - Output decode: same file (TensorsToDetectionsCalculatorOptions)
 *   - Detection -> ROI: mediapipe/modules/pose_detection/pose_detection_to_roi.pbtxt
 *     (AlignmentPointsRectsCalculator + RectTransformationCalculator)
 *
 * The detector's model input is a 224x224 center-square crop of the camera
 * frame (see buildSquareCrop in poseDetector.ts). All coordinates produced
 * here are normalized [0,1] within that square crop.
 *
 * Deviation from the reference pipeline: MediaPipe rotates the ROI so the
 * body is upright using the two alignment keypoints' angle. This app only
 * supports axis-aligned crops (vision-camera-resize-plugin's rotation option
 * is limited to 0/90/180/270deg, and the app's own capture UX already keeps
 * users upright and centered via TiltGuide + voice guidance), so only the
 * keypoints' *center* and *scale* are used, not their angle.
 */

const INPUT_SIZE = 224;
const NUM_LAYERS = 5;
const STRIDES = [8, 16, 32, 32, 32];
const ANCHOR_OFFSET = 0.5;
// aspect_ratios: [1.0] (1 entry) plus the default interpolated_scale_aspect_ratio
// of 1.0 which adds one extra anchor -> 2 anchors per layer, per grid cell.
// NOTE: min_scale/max_scale from the config only affect anchor *sizes*, which
// are unused here because fixed_anchor_size: true. Only anchor centers matter
// for decoding, and centers depend solely on the stride grid.
const ANCHORS_PER_LAYER = 2;

const NUM_BOXES = 2254;
const NUM_COORDS = 12;
const BOX_COORD_OFFSET = 0;
const KEYPOINT_COORD_OFFSET = 4;
const SCORE_CLIPPING_THRESH = 100.0;
const MIN_SCORE_THRESH = 0.5;
const XY_SCALE = 224.0;
const WH_SCALE = 224.0;

export interface Anchor {
  x: number;
  y: number;
}

/**
 * Generates the 2254 SSD anchor centers for the pose detector, in the same
 * order the model's flat output array uses.
 */
export function generateBlazePoseAnchors(): Anchor[] {
  'worklet';
  const anchors: Anchor[] = [];
  let layerId = 0;
  while (layerId < NUM_LAYERS) {
    // MediaPipe's SsdAnchorsCalculator accumulates anchors across all
    // consecutive layers that share the same stride, so each grid cell in a
    // same-stride group emits (layers-in-group * ANCHORS_PER_LAYER) anchors.
    // For pose_detection: strides [8,16,32,32,32] -> the three stride-32
    // layers form one group of 6 anchors/cell. This is what makes the counts
    // sum to the model's 2254 boxes (28*28*2 + 14*14*2 + 7*7*6 = 2254);
    // emitting only 2/cell for the grouped layers would desync every anchor
    // index from the model output.
    let lastSameStrideLayer = layerId;
    while (
      lastSameStrideLayer < NUM_LAYERS &&
      STRIDES[lastSameStrideLayer] === STRIDES[layerId]
    ) {
      lastSameStrideLayer++;
    }
    const layersInGroup = lastSameStrideLayer - layerId;
    const anchorsPerCell = ANCHORS_PER_LAYER * layersInGroup;
    const stride = STRIDES[layerId];
    const featureMapSize = Math.ceil(INPUT_SIZE / stride);

    for (let y = 0; y < featureMapSize; y++) {
      for (let x = 0; x < featureMapSize; x++) {
        for (let a = 0; a < anchorsPerCell; a++) {
          anchors.push({
            x: (x + ANCHOR_OFFSET) / featureMapSize,
            y: (y + ANCHOR_OFFSET) / featureMapSize,
          });
        }
      }
    }
    layerId = lastSameStrideLayer;
  }
  return anchors;
}

function sigmoid(x: number): number {
  'worklet';
  return 1 / (1 + Math.exp(-x));
}

export interface DetectionRoi {
  centerX: number; // normalized [0,1] within the square crop fed to the detector
  centerY: number;
  size: number; // normalized [0,1], square side length
  score: number;
}

/**
 * Decodes the detector's raw output (boxes: [1,2254,12], scores: [1,2254,1])
 * into the single highest-confidence detection's ROI (center + size, with
 * the 1.25x training margin already applied), or null if nothing scored
 * above the MediaPipe-specified threshold.
 *
 * Multi-person NMS is intentionally omitted: this app captures one person
 * in a controlled, guided frame, so picking the single best-scoring anchor
 * is sufficient and avoids implementing full NMS.
 */
export function decodeBestDetection(
  rawBoxes: Float32Array,
  rawScores: Float32Array,
  anchors: Anchor[]
): DetectionRoi | null {
  'worklet';
  let bestIndex = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < NUM_BOXES; i++) {
    let rawScore = rawScores[i];
    if (rawScore < -SCORE_CLIPPING_THRESH) rawScore = -SCORE_CLIPPING_THRESH;
    if (rawScore > SCORE_CLIPPING_THRESH) rawScore = SCORE_CLIPPING_THRESH;
    const score = sigmoid(rawScore);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < MIN_SCORE_THRESH) return null;

  const anchor = anchors[bestIndex];
  const base = bestIndex * NUM_COORDS;

  // reverse_output_order: true -> raw layout is [y, x, h, w, ...keypoints as (y, x) pairs]
  const rawY = rawBoxes[base + BOX_COORD_OFFSET + 0];
  const rawX = rawBoxes[base + BOX_COORD_OFFSET + 1];

  const kp0Y = rawBoxes[base + KEYPOINT_COORD_OFFSET + 0];
  const kp0X = rawBoxes[base + KEYPOINT_COORD_OFFSET + 1];
  const kp1Y = rawBoxes[base + KEYPOINT_COORD_OFFSET + 2];
  const kp1X = rawBoxes[base + KEYPOINT_COORD_OFFSET + 3];

  // AlignmentPointsRectsCalculator: center = keypoint 0, size = 2 * dist(kp0, kp1)
  const kp0XNorm = anchor.x + kp0X / XY_SCALE;
  const kp0YNorm = anchor.y + kp0Y / XY_SCALE;
  const kp1XNorm = anchor.x + kp1X / XY_SCALE;
  const kp1YNorm = anchor.y + kp1Y / XY_SCALE;

  const dx = kp1XNorm - kp0XNorm;
  const dy = kp1YNorm - kp0YNorm;
  const rawSize = 2 * Math.sqrt(dx * dx + dy * dy);

  // RectTransformationCalculator: scale_x/scale_y: 1.25 (training margin)
  const size = rawSize * 1.25;

  // rawX/rawY here decode the SSD box center, kept only as a fallback
  // reference point in case keypoints are degenerate (rawSize ~ 0).
  const boxCenterX = anchor.x + rawX / XY_SCALE;
  const boxCenterY = anchor.y + rawY / XY_SCALE;

  const useKeypointCenter = rawSize > 1e-4;

  return {
    centerX: useKeypointCenter ? kp0XNorm : boxCenterX,
    centerY: useKeypointCenter ? kp0YNorm : boxCenterY,
    size: useKeypointCenter ? size : Math.abs(rawBoxes[base + 3]) / WH_SCALE * 1.25,
    score: bestScore,
  };
}
