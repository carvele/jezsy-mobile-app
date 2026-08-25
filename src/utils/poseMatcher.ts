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
  pitchDeg: number;
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
      pitchDeg: 0,
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
      pitchDeg: 0,
      shoulderWidth: 0,
      feedback: 'Position yourself in frame',
    };
  }

  // 3. 2D Similarity Transform Scaling
  const BASELINE_SHOULDER_SPAN = 0.35;
  const rawScale = (correctedShoulderWidth / BASELINE_SHOULDER_SPAN) * fitEase;
  const targetScale = Math.max(0.70, Math.min(2.4, rawScale));

  // 4. Centered Stage Pixel Translations
  const visualChestX = isMirrored ? (1 - chestAnchorX) : chestAnchorX;
  const targetX = (visualChestX - 0.50) * screenW;
  const targetY = (chestAnchorY - 0.35) * screenH;

  // 5. Yaw Rejection & Opacity Attenuation (2D overlays cannot model extreme perspective)
  let targetOpacity = 1.0;
  let feedback = 'Auto-Fit Active';
  const absYaw = Math.abs(yawDeg);

  if (absYaw > 25) {
    // Gracefully attenuate opacity when user turns past 25 degrees
    targetOpacity = Math.max(0.15, 1.0 - (absYaw - 25) / 15);
    feedback = 'Face forward for 2D fitting';
  }

  // 6. 3D Pitch Calculation (Forward / Backward spine lean)
  const leftHip = landmarks[L.leftHip];
  const rightHip = landmarks[L.rightHip];
  let pitchDeg = 0;

  const midShoulderZ = ((leftShoulder?.z ?? 0) + (rightShoulder?.z ?? 0)) / 2;
  const midShoulderY = ((leftShoulder?.y ?? 0) + (rightShoulder?.y ?? 0)) / 2;

  if (leftHip && rightHip && (leftHip.visibility ?? 0) >= 0.4 && (rightHip.visibility ?? 0) >= 0.4) {
    const midHipZ = ((leftHip.z ?? 0) + (rightHip.z ?? 0)) / 2;
    const midHipY = ((leftHip.y ?? 0) + (rightHip.y ?? 0)) / 2;
    const deltaZ = midShoulderZ - midHipZ;
    const deltaY = Math.max(0.15, midHipY - midShoulderY);
    const pitchRad = Math.atan2(deltaZ, deltaY);
    pitchDeg = Math.max(-20, Math.min(20, pitchRad * (180 / Math.PI)));
  } else if (nose && (nose.visibility ?? 0) >= 0.4) {
    const deltaZ = (nose.z ?? 0) - midShoulderZ;
    const deltaY = Math.max(0.1, midShoulderY - (nose.y ?? 0));
    const pitchRad = Math.atan2(deltaZ, deltaY);
    pitchDeg = Math.max(-18, Math.min(18, -pitchRad * (180 / Math.PI) * 0.6));
  }

  return {
    isTracking: true,
    targetX,
    targetY,
    targetScale,
    targetRotation,
    targetOpacity,
    yawDeg,
    pitchDeg,
    shoulderWidth: correctedShoulderWidth,
    feedback,
  };
}

/**
 * Evaluates live landmarks against a target pose type or pose name.
 * Uses continuous posture angle calculations and avoids false-positive defaults.
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

  if (poseKey.includes('t-pose') || poseKey === 'front t-pose') {
    // Check if arms are extended horizontally
    const leftArmHorizontal = Math.abs(leftWrist.y - leftShoulder.y) < 0.15;
    const rightArmHorizontal = Math.abs(rightWrist.y - rightShoulder.y) < 0.15;
    const armsExtended = dist(leftWrist, rightWrist) > shoulderWidth * 1.7;

    if (leftArmHorizontal && rightArmHorizontal && armsExtended) {
      score = 92;
      feedback = 'Pose Matched!';
    } else {
      score = Math.min(65, Math.round((dist(leftWrist, rightWrist) / (shoulderWidth * 1.7)) * 70));
      feedback = 'Extend arms horizontally';
    }
  } else if (poseKey.includes('side') || poseKey.includes('profile')) {
    // Side pose requires significant yaw or narrow horizontal shoulder separation
    if (shoulderWidth < 0.22 || Math.abs(autoFit.yawDeg) > 30) {
      score = 88;
      feedback = 'Pose Matched!';
    } else {
      score = Math.min(60, Math.round((Math.abs(autoFit.yawDeg) / 30) * 60));
      feedback = 'Turn to the side';
    }
  } else if (poseKey.includes('walking') || poseKey.includes('stride')) {
    const leftAnkle = landmarks[L.leftAnkle];
    const rightAnkle = landmarks[L.rightAnkle];

    if (leftAnkle && rightAnkle && (leftAnkle.visibility ?? 0) > 0.4 && (rightAnkle.visibility ?? 0) > 0.4) {
      const ankleDistX = Math.abs(leftAnkle.x - rightAnkle.x);
      if (ankleDistX > 0.10) {
        score = 88;
        feedback = 'Pose Matched!';
      } else {
        score = 50;
        feedback = 'Step one foot forward';
      }
    } else {
      score = 30;
      feedback = 'Step back to show full body';
    }
  } else if (poseKey.includes('front') || poseKey.includes('standing') || poseKey.includes('gala') || poseKey === 'default') {
    // Front standing pose: upright posture, shoulders level, facing forward
    const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y);
    const isFacingForward = Math.abs(autoFit.yawDeg) <= 20;

    if (shoulderTilt < 0.10 && isFacingForward) {
      score = Math.round(85 + (1 - shoulderTilt / 0.10) * 12);
      feedback = 'Pose Matched!';
    } else if (!isFacingForward) {
      score = 45;
      feedback = 'Face forward';
    } else {
      score = 50;
      feedback = 'Stand up straight';
    }
  } else {
    // Unknown pose type: return unverified status (never false-positive match)
    score = 0;
    feedback = 'Align with silhouette';
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

export interface OcclusionSegment {
  name: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  radius: number;
  depthDelta: number;
}

/**
 * Extracts 3D depth-aware foreground occlusion capsules (forearms, hands, chin/neck)
 * that are positioned in front of the torso for Layer 3 sandwich rendering.
 */
export function getForegroundOcclusionSegments(landmarks: Landmark[]): OcclusionSegment[] {
  if (!landmarks || landmarks.length < 33) return [];

  const leftShoulder = landmarks[L.leftShoulder];
  const rightShoulder = landmarks[L.rightShoulder];
  if (!leftShoulder || !rightShoulder) return [];

  // Back-facing guard: If nose is obscured but shoulders are visible, user is facing backward
  const nose = landmarks[L.nose];
  const isBackFacing =
    (nose?.visibility ?? 0) < 0.25 &&
    (leftShoulder.visibility ?? 0) > 0.5 &&
    (rightShoulder.visibility ?? 0) > 0.5;
  if (isBackFacing) return [];

  const chestZ = ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2;
  const chestMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const chestMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderSpan = Math.sqrt(
    (rightShoulder.x - leftShoulder.x) ** 2 + (rightShoulder.y - leftShoulder.y) ** 2
  ) || 0.3;

  const occluders: OcclusionSegment[] = [];

  // Key foreground limb chains: [startJoint, endJoint, radiusRatio]
  const limbs = [
    // Left arm: elbow (13) -> wrist (15) -> index (19)
    { start: landmarks[13], end: landmarks[15], radius: shoulderSpan * 0.22, name: 'leftForearm' },
    { start: landmarks[15], end: landmarks[19], radius: shoulderSpan * 0.18, name: 'leftHand' },
    // Right arm: elbow (14) -> wrist (16) -> index (20)
    { start: landmarks[14], end: landmarks[16], radius: shoulderSpan * 0.22, name: 'rightForearm' },
    { start: landmarks[16], end: landmarks[20], radius: shoulderSpan * 0.18, name: 'rightHand' },
    // Chin / Neck: nose (0) -> upper chest notch
    { start: landmarks[0], end: { x: chestMidX, y: chestMidY - shoulderSpan * 0.15, z: chestZ - 0.05, visibility: 0.9 }, radius: shoulderSpan * 0.16, name: 'chinNeck' },
  ];

  // Oriented Bounding Box (OBB) alignment with torso roll angle
  const rollRad = Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x);
  const cosR = Math.cos(-rollRad);
  const sinR = Math.sin(-rollRad);

  const rotatePoint = (p: { x: number; y: number }) => {
    const dx = p.x - chestMidX;
    const dy = p.y - chestMidY;
    return {
      x: dx * cosR - dy * sinR,
      y: dx * sinR + dy * cosR,
    };
  };

  const halfWidth = shoulderSpan * 0.70;
  const topBound = -shoulderSpan * 0.35;
  const bottomBound = shoulderSpan * 1.50;

  for (const limb of limbs) {
    if (!limb.start || !limb.end) continue;
    if ((limb.start.visibility ?? 1) < 0.35 || (limb.end.visibility ?? 1) < 0.35) continue;

    // A limb is in front of the torso if its Z depth is forward of the chest plane (negative forward in BlazePose)
    const avgZ = ((limb.start.z ?? 0) + (limb.end.z ?? 0)) / 2;
    const isForward = avgZ < chestZ + 0.08;

    // Spatial overlap check using Torso-Aligned OBB
    const p1 = rotatePoint(limb.start);
    const p2 = rotatePoint(limb.end);
    const minX = Math.min(p1.x, p2.x) - limb.radius;
    const maxX = Math.max(p1.x, p2.x) + limb.radius;
    const minY = Math.min(p1.y, p2.y) - limb.radius;
    const maxY = Math.max(p1.y, p2.y) + limb.radius;

    const overlapsTorso = !(maxX < -halfWidth || minX > halfWidth || maxY < topBound || minY > bottomBound);

    if (isForward && overlapsTorso) {
      occluders.push({
        name: limb.name,
        start: { x: limb.start.x, y: limb.start.y },
        end: { x: limb.end.x, y: limb.end.y },
        radius: limb.radius,
        depthDelta: Math.round((avgZ - chestZ) * 100) / 100,
      });
    }
  }

  return occluders;
}
