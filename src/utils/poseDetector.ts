/**
 * Pose-quality checks and body-ratio extraction for the body-scan flow.
 *
 * Landmark detection itself is handled by react-native-mediapipe-posedetection
 * (usePoseDetection), which produces the standard MediaPipe BlazePose 33-point
 * landmark layout. This file only contains the measurement logic that operates
 * on that layout -- it is detector-agnostic as long as the input follows the
 * same indices.
 *
 * BlazePose landmark indices (0-32):
 *   0  = nose          11 = left_shoulder   12 = right_shoulder
 *   13 = left_elbow    14 = right_elbow     15 = left_wrist
 *   16 = right_wrist   23 = left_hip        24 = right_hip
 *   25 = left_knee     26 = right_knee      27 = left_ankle
 *   28 = right_ankle
 */

export interface Landmark {
  x: number;      // normalized [0, 1] horizontal position
  y: number;      // normalized [0, 1] vertical position
  z: number;      // depth (relative, less reliable from single camera)
  visibility: number; // confidence [0, 1]
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
  rawWaistWidthRatio?: number;     // 3D anatomical waistline width / frame height
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

/**
 * Returns true when detected pose meets capture quality requirements:
 * - All required joints visible with confidence >85%
 * - Overall mean confidence >85%
 * - Person occupies at least 50% of frame height
 */
export function isPoseValid(landmarks: Landmark[]): boolean {
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

export type PoseOrientation = 'front' | 'side' | 'unknown';

/**
 * Whether the person is facing the camera or standing in profile.
 *
 * Uses shoulder separation relative to torso length rather than raw pixels,
 * so it holds at any distance. Facing forward the shoulders are far apart
 * horizontally; in profile one shoulder occludes the other and they collapse
 * towards the same x. The band between the two thresholds is deliberately
 * left 'unknown' -- a half-turn measures neither width nor depth honestly,
 * and accepting it would quietly corrupt the result.
 */
export function getPoseOrientation(landmarks: Landmark[]): PoseOrientation {
  if (landmarks.length < 33) return 'unknown';

  const shoulderSpan = Math.abs(
    landmarks[L.leftShoulder].x - landmarks[L.rightShoulder].x,
  );
  const midShoulderY = (landmarks[L.leftShoulder].y + landmarks[L.rightShoulder].y) / 2;
  const midHipY = (landmarks[L.leftHip].y + landmarks[L.rightHip].y) / 2;
  const torso = Math.abs(midHipY - midShoulderY);
  if (torso < 0.05) return 'unknown';

  const ratio = shoulderSpan / torso;
  if (ratio > 0.55) return 'front';
  if (ratio < 0.28) return 'side';
  return 'unknown';
}

/**
 * A profile pose hides the far half of the body, so the front check's
 * demand that every joint be clearly visible can never be met. This asks
 * only for the near-side chain plus a full head-to-ankle span.
 */
export function isSidePoseValid(landmarks: Landmark[]): boolean {
  if (landmarks.length < 33) return false;
  if (getPoseOrientation(landmarks) !== 'side') return false;

  // Best-visible of each pair: whichever side is facing the camera.
  const bestOf = (a: number, b: number) =>
    Math.max(landmarks[a].visibility, landmarks[b].visibility);

  const nearSideVisible =
    bestOf(L.leftShoulder, L.rightShoulder) >= 0.8 &&
    bestOf(L.leftHip, L.rightHip) >= 0.8 &&
    bestOf(L.leftKnee, L.rightKnee) >= 0.7 &&
    bestOf(L.leftAnkle, L.rightAnkle) >= 0.7;
  if (!nearSideVisible) return false;

  const ankleY = (landmarks[L.leftAnkle].y + landmarks[L.rightAnkle].y) / 2;
  return Math.abs(ankleY - landmarks[L.nose].y) >= 0.5;
}

/**
 * Computes the overall pose confidence score (0-1).
 */
export function getPoseConfidence(landmarks: Landmark[]): number {
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
  const lm = landmarks;

  // 1. 3D Euclidean Distance calculation (invariant to camera tilt and pitch)
  const dist3D = (
    a: Landmark | { x: number; y: number; z: number },
    b: Landmark | { x: number; y: number; z: number }
  ) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z ?? 0) - (b.z ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  const getMidpoint = (a: Landmark, b: Landmark) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  });

  const midShoulder = getMidpoint(lm[L.leftShoulder], lm[L.rightShoulder]);
  const midHip = getMidpoint(lm[L.leftHip], lm[L.rightHip]);
  const midAnkle = getMidpoint(lm[L.leftAnkle], lm[L.rightAnkle]);

  // 2. Segmented 3D Height Chain (unrolled anatomical segments)
  const headToShoulder = dist3D(lm[L.nose], midShoulder);
  const torsoLength = dist3D(midShoulder, midHip);
  const legLengthBase = dist3D(midHip, midAnkle);

  // Nose-to-ankle chain represents ~83% of total standing stature
  const unrolledNoseToAnkle = headToShoulder + torsoLength + legLengthBase;
  const estimatedFullStatureSpan = Math.max(0.01, unrolledNoseToAnkle / 0.83);

  // 3. True 3D Widths and Appendages
  const shoulderWidth = dist3D(lm[L.leftShoulder], lm[L.rightShoulder]);
  const hipWidth = dist3D(lm[L.leftHip], lm[L.rightHip]);

  const leftArm =
    dist3D(lm[L.leftShoulder], lm[L.leftElbow]) +
    dist3D(lm[L.leftElbow], lm[L.leftWrist]);
  const rightArm =
    dist3D(lm[L.rightShoulder], lm[L.rightElbow]) +
    dist3D(lm[L.rightElbow], lm[L.rightWrist]);
  const armLength = (leftArm + rightArm) / 2;

  const leftLeg =
    dist3D(lm[L.leftHip], lm[L.leftKnee]) +
    dist3D(lm[L.leftKnee], lm[L.leftAnkle]);
  const rightLeg =
    dist3D(lm[L.rightHip], lm[L.rightKnee]) +
    dist3D(lm[L.rightKnee], lm[L.rightAnkle]);
  const legLength = (leftLeg + rightLeg) / 2;

  const inseam = legLengthBase * 0.92;
  const bustWidth = shoulderWidth * 1.05;

  // 4. Dynamic Waist Derivation (Using 3D interpolation along shoulder-to-hip line)
  const WAIST_DROP_RATIO = 0.42;
  const leftWaist = {
    x: lm[L.leftShoulder].x + (lm[L.leftHip].x - lm[L.leftShoulder].x) * WAIST_DROP_RATIO,
    y: lm[L.leftShoulder].y + (lm[L.leftHip].y - lm[L.leftShoulder].y) * WAIST_DROP_RATIO,
    z: (lm[L.leftShoulder].z ?? 0) + ((lm[L.leftHip].z ?? 0) - (lm[L.leftShoulder].z ?? 0)) * WAIST_DROP_RATIO,
  };
  const rightWaist = {
    x: lm[L.rightShoulder].x + (lm[L.rightHip].x - lm[L.rightShoulder].x) * WAIST_DROP_RATIO,
    y: lm[L.rightShoulder].y + (lm[L.rightHip].y - lm[L.rightShoulder].y) * WAIST_DROP_RATIO,
    z: (lm[L.rightShoulder].z ?? 0) + ((lm[L.rightHip].z ?? 0) - (lm[L.rightShoulder].z ?? 0)) * WAIST_DROP_RATIO,
  };
  const rawWaistWidth = dist3D(leftWaist, rightWaist);

  return {
    shoulderWidthRatio:  shoulderWidth / estimatedFullStatureSpan,
    hipWidthRatio:       hipWidth / estimatedFullStatureSpan,
    torsoLengthRatio:    torsoLength / estimatedFullStatureSpan,
    armLengthRatio:      armLength / estimatedFullStatureSpan,
    legLengthRatio:      legLength / estimatedFullStatureSpan,
    inseamRatio:         inseam / estimatedFullStatureSpan,
    headToAnkleRatio:    unrolledNoseToAnkle / estimatedFullStatureSpan,
    bustWidthRatio:      bustWidth / estimatedFullStatureSpan,
    rawWaistWidthRatio:  rawWaistWidth / estimatedFullStatureSpan,
  };
}
