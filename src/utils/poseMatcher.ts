/**
 * poseMatcher.ts
 *
 * Evaluates MediaPipe BlazePose landmarks for real-time garment auto-sizing,
 * auto-tracking, and auto-fitting on live camera feed, plus target pose recreation scoring.
 */

import type { Landmark } from './poseDetector';

// Indices match those in BlazePose / MediaPipe Pose 33-landmark schema
const L = {
  nose: 0,
  leftEye: 2,       rightEye: 5,
  leftEar: 7,       rightEar: 8,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13,    rightElbow: 14,
  leftWrist: 15,    rightWrist: 16,
  leftHip: 23,      rightHip: 24,
  leftKnee: 25,     rightKnee: 26,
  leftAnkle: 27,    rightAnkle: 28,
} as const;

export interface PoseTransform {
  scale: number;
  translateX: number;
  translateY: number;
  rotateDeg?: number;
}

export interface GarmentAutoFitResult {
  isTracking: boolean;
  targetX: number;
  targetY: number;
  targetScale: number;
  targetRotation: number; // In degrees
  targetOpacity: number;
  yawDeg: number;
  shoulderWidth: number;
  feedback: string;
}

export interface PoseMatchResult {
  score: number;       // 0-100
  isMatched: boolean;  // >= 80
  feedback: string;
  transform: PoseTransform | null;
  autoFit?: GarmentAutoFitResult;
}

// Vector helper functions
const dist = (p1: Landmark, p2: Landmark) =>
  Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

const midPoint = (p1: Landmark, p2: Landmark): Landmark => ({
  x: (p1.x + p2.x) / 2,
  y: (p1.y + p2.y) / 2,
  z: ((p1.z ?? 0) + (p2.z ?? 0)) / 2,
  visibility: (p1.visibility + p2.visibility) / 2,
});

/**
 * Helper to detect if a landmark is clipped by the camera boundary or unreliable
 */
function isClipped(pt?: Landmark | null): boolean {
  if (!pt) return true;
  if (pt.visibility !== undefined && pt.visibility < 0.35) return true;
  // Boundary buffer: points within 4% of frame edges are vulnerable to model hallucination
  if (pt.x <= 0.04 || pt.x >= 0.96) return true;
  if (pt.y <= 0.02 || pt.y >= 0.98) return true;
  return false;
}

/**
 * Calculates continuous real-time auto-sizing, auto-tracking (X, Y), and auto-fitting (scale, rotation)
 * of garments from live camera landmarks.
 *
 * Robust against edge-of-frame clipping, model hallucination, and bust-shot framing.
 */
export function calculateGarmentAutoFit(
  landmarks: Landmark[],
  options?: {
    isMirrored?: boolean;
    screenWidth?: number;
    screenHeight?: number;
    fitEase?: number;
  }
): GarmentAutoFitResult {
  if (!landmarks || landmarks.length < 33) {
    return {
      isTracking: false,
      targetX: 0,
      targetY: 0,
      targetScale: 1,
      targetRotation: 0,
      targetOpacity: 0,
      yawDeg: 0,
      shoulderWidth: 0,
      feedback: 'Position yourself in frame',
    };
  }

  const leftShoulder = landmarks[L.leftShoulder];
  const rightShoulder = landmarks[L.rightShoulder];
  const nose = landmarks[L.nose];
  const leftEye = landmarks[L.leftEye];
  const rightEye = landmarks[L.rightEye];

  const leftValid = !isClipped(leftShoulder);
  const rightValid = !isClipped(rightShoulder);

  const isMirrored = options?.isMirrored ?? true;
  // Use actual device viewport bounds (standard mobile default fallback: 390x844)
  const screenW = options?.screenWidth ?? 390;
  const screenH = options?.screenHeight ?? 844;
  const fitEase = options?.fitEase ?? 1.0;

  // 1. Determine Head Center for horizontal stabilization
  let headCenterX = 0.5;
  if (!isClipped(nose)) {
    headCenterX = nose.x;
  } else if (!isClipped(leftEye) && !isClipped(rightEye)) {
    headCenterX = (leftEye.x + rightEye.x) / 2;
  }

  let chestAnchorX = 0.5;
  let chestAnchorY = 0.38;
  let targetRotation = 0;
  let correctedShoulderWidth = 0.36;
  let yawDeg = 0;

  if (leftValid && rightValid) {
    // Both shoulders visible
    const apparentWidth = Math.sqrt(
      Math.pow((leftShoulder.x - rightShoulder.x) * screenW, 2) +
      Math.pow((leftShoulder.y - rightShoulder.y) * screenH, 2)
    ) / screenW;

    // Yaw / Depth Foreshortening Correction
    const deltaZ = (rightShoulder.z ?? 0) - (leftShoulder.z ?? 0);
    const yawRad = Math.atan2(deltaZ, Math.abs(leftShoulder.x - rightShoulder.x) || 0.01);
    yawDeg = yawRad * (180 / Math.PI);
    const cosYaw = Math.max(0.70, Math.abs(Math.cos(yawRad)));
    correctedShoulderWidth = apparentWidth / cosYaw;

    // 2. Aspect-Ratio Corrected Roll / Tilt (Calculated in real screen pixels)
    // On screen: Screen Left -> Screen Right vector
    let deltaPixelX: number;
    let deltaPixelY: number;

    if (isMirrored) {
      // Mirrored: left shoulder is on screen right, right shoulder is on screen left
      deltaPixelX = (leftShoulder.x - rightShoulder.x) * screenW;
      deltaPixelY = (rightShoulder.y - leftShoulder.y) * screenH;
    } else {
      deltaPixelX = (leftShoulder.x - rightShoulder.x) * screenW;
      deltaPixelY = (leftShoulder.y - rightShoulder.y) * screenH;
    }

    const rollRad = Math.atan2(deltaPixelY, Math.abs(deltaPixelX));
    const rawDeg = rollRad * (180 / Math.PI);

    // Clamp roll strictly to natural anatomical range (+/- 16 degrees)
    targetRotation = Math.max(-16, Math.min(16, rawDeg));

    // Anchor: Collar notch (midpoint between shoulders)
    chestAnchorX = (leftShoulder.x + rightShoulder.x) / 2;
    chestAnchorY = (leftShoulder.y + rightShoulder.y) / 2;
  } else if (leftValid && !rightValid) {
    // Single-shoulder fallback (right shoulder clipped)
    const halfSpan = Math.max(0.14, Math.abs(leftShoulder.x - headCenterX));
    correctedShoulderWidth = halfSpan * 2;
    targetRotation = 0;
    chestAnchorX = headCenterX;
    chestAnchorY = leftShoulder.y;
  } else if (!leftValid && rightValid) {
    // Single-shoulder fallback (left shoulder clipped)
    const halfSpan = Math.max(0.14, Math.abs(rightShoulder.x - headCenterX));
    correctedShoulderWidth = halfSpan * 2;
    targetRotation = 0;
    chestAnchorX = headCenterX;
    chestAnchorY = rightShoulder.y;
  } else {
    return {
      isTracking: false,
      targetX: 0,
      targetY: 0,
      targetScale: 1,
      targetRotation: 0,
      targetOpacity: 0,
      yawDeg: 0,
      shoulderWidth: 0,
      feedback: 'Position yourself in frame',
    };
  }

  // 3. Proportional Auto-Sizing Scale
  const BASELINE_SHOULDER_SPAN = 0.35;
  const rawScale = (correctedShoulderWidth / BASELINE_SHOULDER_SPAN) * fitEase;
  const targetScale = Math.max(0.70, Math.min(2.4, rawScale));

  // 4. Centered Pixel Translations
  const visualChestX = isMirrored ? (1 - chestAnchorX) : chestAnchorX;
  const targetX = (visualChestX - 0.50) * screenW;

  // 0.35 is neutral collar level on screen. Garment translates dynamically across full screen height
  const targetY = (chestAnchorY - 0.35) * screenH;

  return {
    isTracking: true,
    targetX,
    targetY,
    targetScale,
    targetRotation,
    targetOpacity: 1,
    yawDeg,
    shoulderWidth: correctedShoulderWidth,
    feedback: 'Auto-Fit Active',
  };
}

/**
 * Evaluates live landmarks against a target pose name.
 */
export function evaluatePoseMatch(
  landmarks: Landmark[],
  targetPoseName: string,
  options?: { isMirrored?: boolean; screenWidth?: number; screenHeight?: number }
): PoseMatchResult {
  const autoFit = calculateGarmentAutoFit(landmarks, options);

  if (!autoFit.isTracking || !landmarks || landmarks.length < 33) {
    return {
      score: 0,
      isMatched: false,
      feedback: autoFit.feedback,
      transform: null,
      autoFit,
    };
  }

  const transform: PoseTransform = {
    scale: autoFit.targetScale,
    translateX: autoFit.targetX,
    translateY: autoFit.targetY,
    rotateDeg: autoFit.targetRotation,
  };

  const leftShoulder = landmarks[L.leftShoulder];
  const rightShoulder = landmarks[L.rightShoulder];
  const leftWrist = landmarks[L.leftWrist];
  const rightWrist = landmarks[L.rightWrist];

  let score = 0;
  let feedback = 'Align with outline';

  const poseKey = (targetPoseName || '').toLowerCase();
  const shoulderWidth = dist(leftShoulder, rightShoulder);

  // Evaluate specific poses or base pose types
  if (poseKey === 'front t-pose') {
    // Check if arms are extended horizontally
    const leftArmHorizontal = Math.abs(leftWrist.y - leftShoulder.y) < 0.18;
    const rightArmHorizontal = Math.abs(rightWrist.y - rightShoulder.y) < 0.18;
    const armsExtended = dist(leftWrist, rightWrist) > shoulderWidth * 1.8;

    if (leftArmHorizontal && rightArmHorizontal && armsExtended) {
      score = 92;
      feedback = 'Pose Matched!';
    } else {
      score = 45;
      feedback = 'Extend arms horizontally';
    }
  } else if (poseKey === 'side profile' || poseKey.includes('side')) {
    // Shoulders should be close together horizontally or high yaw
    if (shoulderWidth < 0.20 || Math.abs(autoFit.yawDeg) > 35) {
      score = 88;
      feedback = 'Pose Matched!';
    } else {
      score = 35;
      feedback = 'Turn to the side';
    }
  } else if (poseKey === 'walking stride' || poseKey.includes('walking') || poseKey.includes('stride')) {
    const leftAnkle = landmarks[L.leftAnkle];
    const rightAnkle = landmarks[L.rightAnkle];

    if (leftAnkle && rightAnkle && leftAnkle.visibility > 0.4 && rightAnkle.visibility > 0.4) {
      const ankleDistX = Math.abs(leftAnkle.x - rightAnkle.x);
      if (ankleDistX > 0.10) {
        score = 88;
        feedback = 'Pose Matched!';
      } else {
        score = 45;
        feedback = 'Step one foot forward';
      }
    } else {
      score = 40;
      feedback = 'Step back to show legs';
    }
  } else if (poseKey.includes('front') || poseKey.includes('standing') || poseKey.includes('gala')) {
    // Generic front standing pose
    const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y);
    if (shoulderTilt < 0.14) {
      score = 88;
      feedback = 'Pose Matched!';
    } else {
      score = 50;
      feedback = 'Stand up straight';
    }
  } else {
    // Default fallback: Upper body tracked successfully
    score = 85;
    feedback = 'Auto-Fit Active';
  }

  const isMatched = score >= 80;

  return {
    score,
    isMatched,
    feedback: isMatched ? 'Pose Matched!' : feedback,
    transform,
    autoFit,
  };
}
