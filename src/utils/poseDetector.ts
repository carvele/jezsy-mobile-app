/**
 * BlazePose Lite TFLite pose detector wrapper.
 *
 * Wraps react-native-fast-tflite for on-device inference of the
 * BlazePose Lite model. The model's raw output is [1, 195] = 39 landmarks
 * x 5 values (x, y, z, visibility, presence) -- verified directly against
 * the downloaded assets/models/blazepose_lite.tflite via its FlatBuffer
 * tensor metadata, not assumed. Landmarks 0-32 are the public pose
 * landmarks; 33-34 are auxiliary "alignment points" (center + scale/
 * rotation reference) used only to compute the next frame's tracking ROI
 * -- see computeRoiFromAlignmentPoints below. Landmarks 35-38 are unused.
 *
 * All x/y/z here are in ROI-local normalized [0,1] space, i.e. relative to
 * whichever square crop was fed into the model that frame -- NOT relative
 * to the full camera frame. Ratio-based math (extractBodyRatios) is valid
 * in this space since every landmark in a given inference call shares the
 * same reference frame. Mapping to full-camera-frame coordinates (needed
 * only for the debug overlay and for locating the next crop) is handled
 * by the caller, which knows the ROI's placement in the frame.
 *
 * NOTE: Requires a development build — not available in Expo Go.
 * Place the model file at: assets/models/blazepose_lite.tflite
 *
 * BlazePose landmark indices (0-32):
 *   0  = nose          11 = left_shoulder   12 = right_shoulder
 *   13 = left_elbow    14 = right_elbow     15 = left_wrist
 *   16 = right_wrist   23 = left_hip        24 = right_hip
 *   25 = left_knee     26 = right_knee      27 = left_ankle
 *   28 = right_ankle
 */

export interface Landmark {
  x: number;      // normalized [0, 1] horizontal position, ROI-local
  y: number;      // normalized [0, 1] vertical position, ROI-local
  z: number;      // depth (relative, less reliable from single camera)
  visibility: number; // confidence [0, 1]
}

// Indices of the two auxiliary alignment landmarks within the 39-landmark
// raw output (verified against mediapipe/modules/pose_landmark's
// tensors_to_pose_landmarks_and_segmentation.pbtxt SplitNormalizedLandmarkListCalculator
// config: ranges [0,33) = public landmarks, [33,35) = auxiliary landmarks).
const AUXILIARY_CENTER_INDEX = 33;
const AUXILIARY_SCALE_INDEX = 34;
const TOTAL_RAW_LANDMARKS = 39;
// RectTransformationCalculator's scale_x/scale_y training margin (same
// value used by the detector stage in blazePoseAnchors.ts).
const ROI_MARGIN_SCALE = 1.25;

export interface PoseResult {
  landmarks: Landmark[];   // 33 landmarks
  confidence: number;      // overall pose confidence (mean visibility of key joints)
  isFullBody: boolean;     // all limb endpoints visible
}

export interface BodyRatios {
  // All values in normalized pixel space (relative to frame height)
  shoulderWidthRatio: number;      // shoulder-to-shoulder span / frame height
  hipWidthRatio: number;           // hip-to-hip span / frame height
  torsoLengthRatio: number;        // mid-shoulder to mid-hip / frame height
  armLengthRatio: number;          // shoulder to wrist (left avg'd with right) / frame height
  legLengthRatio: number;          // hip to ankle (left avg'd with right) / frame height
  inseamRatio: number;             // mid-hip to ankle / frame height
  headToAnkleRatio: number;        // total body span for height calibration
  bustWidthRatio: number;          // axillary shoulder width proxy / frame height
}

// Key landmark indices used for measurement extraction
const L = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13,    rightElbow: 14,
  leftWrist: 15,    rightWrist: 16,
  leftHip: 23,      rightHip: 24,
  leftKnee: 25,     rightKnee: 26,
  leftAnkle: 27,    rightAnkle: 28,
} as const;

// Key joints that must be visible for a "full body" pose
const REQUIRED_JOINTS = [
  L.nose, L.leftShoulder, L.rightShoulder,
  L.leftHip, L.rightHip, L.leftKnee, L.rightKnee,
  L.leftAnkle, L.rightAnkle,
];

function sigmoid(x: number): number {
  'worklet';
  return 1 / (1 + Math.exp(-x));
}

/**
 * Parses raw TFLite output tensor into structured landmarks.
 * BlazePose Lite output: flat float32 array of shape [1, 39, 5]
 * Each landmark: [x, y, z, visibility, presence] where x/y are in
 * 256px ROI-pixel space and visibility/presence are raw logits
 * (visibility_activation/presence_activation: SIGMOID per the reference
 * graph -- NOT already-normalized probabilities).
 *
 * Returns all 39 raw landmarks (33 public + 6 raw slots, of which only
 * 33-34 are meaningful auxiliary points); callers needing just the public
 * pose should slice landmarks.slice(0, 33).
 */
export function parseLandmarks(outputData: Float32Array): Landmark[] {
  'worklet';
  const landmarks: Landmark[] = [];
  for (let i = 0; i < TOTAL_RAW_LANDMARKS; i++) {
    const base = i * 5;
    landmarks.push({
      x: outputData[base] / 256,
      y: outputData[base + 1] / 256,
      z: outputData[base + 2] / 256,
      visibility: sigmoid(outputData[base + 3]),
    });
  }
  return landmarks;
}

export interface RoiCircle {
  centerX: number;
  centerY: number;
  size: number; // square side length, same units as the input coordinates
}

/**
 * Derives the ROI to use for the *next* frame directly from this frame's
 * auxiliary alignment landmarks (indices 33/34), avoiding a re-run of the
 * detector model on every frame -- matching the reference pipeline's
 * PoseLandmarksToRoi graph (AlignmentPointsRectsCalculator): center = the
 * first alignment point, size = 2x the distance between the two alignment
 * points, expanded by the same 1.25x training margin as the detector
 * stage. Rotation is intentionally not computed (see file header).
 *
 * Input landmarks must be in the same coordinate space the caller wants
 * the returned ROI expressed in. Callers should pass frame-PIXEL-space
 * landmarks (see frameCropping.roiLocalLandmarksToFramePixels), not
 * ROI-local or per-axis-normalized coordinates -- mixing x/y deltas from
 * values normalized independently by frameWidth/frameHeight would distort
 * this distance calculation whenever the frame isn't square.
 */
export function computeRoiFromAlignmentPoints(landmarks: Landmark[]): RoiCircle | null {
  'worklet';
  if (landmarks.length <= AUXILIARY_SCALE_INDEX) return null;

  const center = landmarks[AUXILIARY_CENTER_INDEX];
  const scale = landmarks[AUXILIARY_SCALE_INDEX];

  const dx = scale.x - center.x;
  const dy = scale.y - center.y;
  const rawSize = 2 * Math.sqrt(dx * dx + dy * dy);
  if (rawSize <= 1e-4) return null;

  return {
    centerX: center.x,
    centerY: center.y,
    size: rawSize * ROI_MARGIN_SCALE,
  };
}

/**
 * Returns true when detected pose meets capture quality requirements:
 * - All required joints visible with confidence >85%
 * - Overall mean confidence >85%
 * - Person occupies at least 50% of frame height
 */
export function isPoseValid(landmarks: Landmark[]): boolean {
  'worklet';
  if (landmarks.length < 33) return false;

  const allKeyJointsVisible = REQUIRED_JOINTS.every(
    (idx: number) => landmarks[idx].visibility >= 0.85
  );
  if (!allKeyJointsVisible) return false;

  const meanConfidence =
    REQUIRED_JOINTS.reduce((sum: number, idx: number) => sum + landmarks[idx].visibility, 0) /
    REQUIRED_JOINTS.length;
  if (meanConfidence < 0.85) return false;

  // Check body height spans at least 50% of the normalized frame
  const nose = landmarks[L.nose];
  const ankleY = (landmarks[L.leftAnkle].y + landmarks[L.rightAnkle].y) / 2;
  const bodySpan = Math.abs(ankleY - nose.y);
  if (bodySpan < 0.5) return false;

  return true;
}

/**
 * Computes the overall pose confidence score (0–1).
 */
export function getPoseConfidence(landmarks: Landmark[]): number {
  'worklet';
  if (landmarks.length < 33) return 0;
  return (
    REQUIRED_JOINTS.reduce((sum: number, idx: number) => sum + landmarks[idx].visibility, 0) /
    REQUIRED_JOINTS.length
  );
}

/**
 * Extracts normalized body proportion ratios from landmarks.
 * All ratios are relative to the total head-to-ankle pixel height,
 * making them resolution-independent.
 */
export function extractBodyRatios(landmarks: Landmark[]): BodyRatios {
  'worklet';
  const lm = landmarks;

  // Reference span: nose to avg ankle (in normalized coords)
  const noseY = lm[L.nose].y;
  const ankleY = (lm[L.leftAnkle].y + lm[L.rightAnkle].y) / 2;
  const totalHeight = Math.abs(ankleY - noseY) || 1; // avoid divide-by-zero

  const dist = (a: Landmark, b: Landmark) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  // Shoulder width (left to right shoulder)
  const shoulderWidth = dist(lm[L.leftShoulder], lm[L.rightShoulder]);

  // Hip width
  const hipWidth = dist(lm[L.leftHip], lm[L.rightHip]);

  // Mid-shoulder → mid-hip (torso)
  const midShoulderX = (lm[L.leftShoulder].x + lm[L.rightShoulder].x) / 2;
  const midShoulderY = (lm[L.leftShoulder].y + lm[L.rightShoulder].y) / 2;
  const midHipX = (lm[L.leftHip].x + lm[L.rightHip].x) / 2;
  const midHipY = (lm[L.leftHip].y + lm[L.rightHip].y) / 2;
  const torsoLength = Math.sqrt(
    (midHipX - midShoulderX) ** 2 + (midHipY - midShoulderY) ** 2
  );

  // Arm length: shoulder → elbow → wrist (each side, then averaged)
  const leftArm =
    dist(lm[L.leftShoulder], lm[L.leftElbow]) +
    dist(lm[L.leftElbow], lm[L.leftWrist]);
  const rightArm =
    dist(lm[L.rightShoulder], lm[L.rightElbow]) +
    dist(lm[L.rightElbow], lm[L.rightWrist]);
  const armLength = (leftArm + rightArm) / 2;

  // Leg length: hip → knee → ankle (each side, then averaged)
  const leftLeg =
    dist(lm[L.leftHip], lm[L.leftKnee]) +
    dist(lm[L.leftKnee], lm[L.leftAnkle]);
  const rightLeg =
    dist(lm[L.rightHip], lm[L.rightKnee]) +
    dist(lm[L.rightKnee], lm[L.rightAnkle]);
  const legLength = (leftLeg + rightLeg) / 2;

  // Inseam: mid-hip to avg ankle
  const inseam = Math.sqrt(
    (midHipX - (lm[L.leftAnkle].x + lm[L.rightAnkle].x) / 2) ** 2 +
    (midHipY - ankleY) ** 2
  );

  // Bust width proxy: outer shoulder width (1.05× shoulder span is a typical axillary approximation)
  const bustWidth = shoulderWidth * 1.05;

  return {
    shoulderWidthRatio:  shoulderWidth / totalHeight,
    hipWidthRatio:       hipWidth / totalHeight,
    torsoLengthRatio:    torsoLength / totalHeight,
    armLengthRatio:      armLength / totalHeight,
    legLengthRatio:      legLength / totalHeight,
    inseamRatio:         inseam / totalHeight,
    headToAnkleRatio:    1.0, // by definition (normalized to self)
    bustWidthRatio:      bustWidth / totalHeight,
  };
}
