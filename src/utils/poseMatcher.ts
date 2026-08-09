/**
 * poseMatcher.ts
 *
 * Evaluates MediaPipe BlazePose landmarks against target poses for the AR Try-On guide.
 */

import type { Landmark } from './poseDetector';

// Indices match those in poseDetector.ts
const L = {
  nose: 0,
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
}

export interface PoseMatchResult {
  score: number;       // 0-100
  isMatched: boolean;  // >= 80
  feedback: string;
  transform: PoseTransform | null;
}

// Simple vector math
const dist = (p1: Landmark, p2: Landmark) =>
  Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

const midPoint = (p1: Landmark, p2: Landmark): Landmark => ({
  x: (p1.x + p2.x) / 2,
  y: (p1.y + p2.y) / 2,
  z: 0,
  visibility: (p1.visibility + p2.visibility) / 2,
});

/**
 * Evaluates live landmarks against a target pose name.
 */
export function evaluatePoseMatch(
  landmarks: Landmark[],
  targetPoseName: string
): PoseMatchResult {
  if (!landmarks || landmarks.length < 33) {
    return { score: 0, isMatched: false, feedback: 'No pose detected', transform: null };
  }

  const leftShoulder = landmarks[L.leftShoulder];
  const rightShoulder = landmarks[L.rightShoulder];
  const leftHip = landmarks[L.leftHip];
  const rightHip = landmarks[L.rightHip];
  const leftWrist = landmarks[L.leftWrist];
  const rightWrist = landmarks[L.rightWrist];

  // Base confidence check
  const coreJoints = [leftShoulder, rightShoulder, leftHip, rightHip];
  if (coreJoints.some(j => j.visibility < 0.6)) {
    return { score: 0, isMatched: false, feedback: 'Position yourself in frame', transform: null };
  }

  // Calculate garment transform
  // Scale based on shoulder width relative to standard frame (e.g., assuming base image shoulder width is ~40% of frame)
  const shoulderWidth = dist(leftShoulder, rightShoulder);
  const scale = Math.max(0.5, Math.min(2.5, shoulderWidth / 0.4));
  
  const midShoulder = midPoint(leftShoulder, rightShoulder);
  const midHip = midPoint(leftHip, rightHip);
  
  // Position garment between shoulders and hips
  const torsoCenter = midPoint(midShoulder, midHip);
  
  const transform: PoseTransform = {
    scale,
    translateX: (torsoCenter.x - 0.5) * 100, // % offset from center
    translateY: (torsoCenter.y - 0.5) * 100, // % offset from center
  };

  let score = 0;
  let feedback = 'Align with outline';

  // Evaluate specific poses
  if (targetPoseName === 'Front T-Pose') {
    // Check if arms are extended horizontally
    const leftArmHorizontal = Math.abs(leftWrist.y - leftShoulder.y) < 0.15;
    const rightArmHorizontal = Math.abs(rightWrist.y - rightShoulder.y) < 0.15;
    const armsExtended = dist(leftWrist, rightWrist) > shoulderWidth * 2;

    if (leftArmHorizontal && rightArmHorizontal && armsExtended) {
      score = 90;
      feedback = 'Hold still...';
    } else {
      score = 40;
      feedback = 'Extend arms straight out';
    }
  } else if (targetPoseName === 'Side Profile') {
    // Shoulders should be close together horizontally
    if (shoulderWidth < 0.15) {
      score = 85;
      feedback = 'Hold still...';
    } else {
      score = 30;
      feedback = 'Turn to the side';
    }
  } else if (targetPoseName === 'Walking Stride') {
    // Legs split
    const leftAnkle = landmarks[L.leftAnkle];
    const rightAnkle = landmarks[L.rightAnkle];
    
    if (leftAnkle.visibility > 0.6 && rightAnkle.visibility > 0.6) {
      const ankleDistX = Math.abs(leftAnkle.x - rightAnkle.x);
      if (ankleDistX > 0.15) {
         score = 85;
         feedback = 'Hold still...';
      } else {
         score = 40;
         feedback = 'Step one foot forward';
      }
    } else {
      score = 20;
      feedback = 'Step back to show legs';
    }
  } else {
    // Default fallback - just need to be visible
    score = 80;
    feedback = 'Hold still...';
  }

  const isMatched = score >= 80;

  return {
    score,
    isMatched,
    feedback,
    transform,
  };
}
