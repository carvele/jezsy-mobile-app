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
 * Calculates continuous real-time auto-sizing, auto-tracking (X, Y), and auto-fitting (scale, rotation)
 * of garments from live camera landmarks.
 *
 * Robust in both selfie (bust-shot) and full-body modes by anchoring to the collarbone/shoulders
 * and extrapolating torso height if hips are out of frame.
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

  // Base upper-body tracking requires only shoulders to be detected
  // No hip or face requirement, making it work seamlessly on close-up selfie shots
  if (!leftShoulder || !rightShoulder || leftShoulder.visibility < 0.30 || rightShoulder.visibility < 0.30) {
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

  const isMirrored = options?.isMirrored ?? true;
  const widthFactor = options?.screenWidth ?? 300;
  const heightFactor = options?.screenHeight ?? 340;
  const fitEase = options?.fitEase ?? 1.0;

  // 1. Apparent 2D shoulder span
  const apparentWidth = dist(leftShoulder, rightShoulder);

  // 2. Yaw (body turn) calculation & foreshortening correction using 3D depth (z)
  const deltaZ = (rightShoulder.z ?? 0) - (leftShoulder.z ?? 0);
  const deltaX = Math.abs(rightShoulder.x - leftShoulder.x);
  const yawRad = Math.atan2(deltaZ, Math.max(0.01, deltaX));
  const yawDeg = yawRad * (180 / Math.PI);
  const cosYaw = Math.max(0.55, Math.abs(Math.cos(yawRad)));

  // Corrected true shoulder width (prevents garment from falsely shrinking when user turns sideways)
  const correctedShoulderWidth = apparentWidth / cosYaw;

  // 3. Proportional Auto-Sizing Scale
  // Standard adult shoulder span takes ~36% of camera frame at typical 1.2m selfie distance
  const BASELINE_SHOULDER_SPAN = 0.36;
  const rawScale = (correctedShoulderWidth / BASELINE_SHOULDER_SPAN) * fitEase;
  const targetScale = Math.max(0.55, Math.min(2.4, rawScale));

  // 4. Auto-Fitting Roll / Tilt Angle (Shoulder Slope)
  // When user tilts shoulders, garment tilts in unison
  let rollRad: number;
  if (isMirrored) {
    // In mirrored front camera, horizontal coordinates are visually flipped
    rollRad = Math.atan2(leftShoulder.y - rightShoulder.y, rightShoulder.x - leftShoulder.x);
  } else {
    rollRad = Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x);
  }
  // Clamp roll to +/- 45 degrees to avoid extreme flips
  const targetRotation = Math.max(-45, Math.min(45, rollRad * (180 / Math.PI)));

  // 5. Collarline & Torso Anchor Point
  const midShoulder = midPoint(leftShoulder, rightShoulder);
  const leftHip = landmarks[L.leftHip];
  const rightHip = landmarks[L.rightHip];

  let torsoLength: number;
  if (leftHip && rightHip && leftHip.visibility >= 0.35 && rightHip.visibility >= 0.35) {
    // Real hip detected
    const midHipY = (leftHip.y + rightHip.y) / 2;
    torsoLength = Math.max(0.2, midHipY - midShoulder.y);
  } else {
    // Fallback: Extrapolate torso height using standard anatomical proportion (Torso ≈ 1.25 × ShoulderWidth)
    torsoLength = correctedShoulderWidth * 1.25;
  }

  // Anchor to upper chest (collarline + 22% of torso length down)
  const chestAnchorY = midShoulder.y + torsoLength * 0.22;
  const chestAnchorX = midShoulder.x;

  // Horizontal translation with mirror inversion
  const rawXOffset = isMirrored ? (0.5 - chestAnchorX) : (chestAnchorX - 0.5);
  const targetX = rawXOffset * widthFactor;

  // Vertical translation (0.40 is neutral center chest in frame)
  const targetY = (chestAnchorY - 0.40) * heightFactor;

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
