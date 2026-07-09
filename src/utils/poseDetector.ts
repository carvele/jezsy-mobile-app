/**
 * BlazePose Lite TFLite pose detector wrapper.
 *
 * Wraps react-native-fast-tflite for on-device inference of the
 * BlazePose Lite model. Returns 33 landmarks per frame with confidence.
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
  x: number;      // normalized [0, 1] horizontal position
  y: number;      // normalized [0, 1] vertical position
  z: number;      // depth (relative, less reliable from single camera)
  visibility: number; // confidence [0, 1]
}

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

/**
 * Parses raw TFLite output tensor into structured landmarks.
 * BlazePose Lite output: flat float32 array of shape [1, 33, 5]
 * Each landmark: [x, y, z, visibility, presence]
 */
export function parseLandmarks(outputData: Float32Array): Landmark[] {
  const landmarks: Landmark[] = [];
  for (let i = 0; i < 33; i++) {
    const base = i * 5;
    landmarks.push({
      x: outputData[base],
      y: outputData[base + 1],
      z: outputData[base + 2],
      visibility: Math.min(1, Math.max(0, outputData[base + 3])),
    });
  }
  return landmarks;
}

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

/**
 * Computes the overall pose confidence score (0–1).
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
