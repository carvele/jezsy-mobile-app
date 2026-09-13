import { LANDMARK_INDEX, type Landmark } from './poseDetector';

export type RequestedPose = 'front' | 'side';

export interface EllipseRegion {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export type AlignmentViolation =
  | 'NO_PERSON'
  | 'WRONG_ORIENTATION'
  | 'BODY_CLIPPED'
  | 'TOO_CLOSE'
  | 'TOO_FAR'
  | 'OFF_CENTER_LEFT'
  | 'OFF_CENTER_RIGHT'
  | 'DEVICE_TILT'
  | 'POSTURE'
  | 'FEET_PLACEMENT';

export interface PoseOrientationResult {
  label: 'front' | 'side' | 'ambiguous';
  confidence: number;
}

export interface AlignmentEvaluation {
  personDetected: boolean;
  confidence: number;
  violations: AlignmentViolation[];
  instruction: string | null;
  footStatus: { left: boolean; right: boolean };
  bounds: { topY: number; bottomY: number };
  stanceRatio: number;
  shoulderSlope: number;
}

export const ALIGNMENT_CONFIG = {
  minConfidence: 0.85,
  minHeight: 0.55,
  maxHeight: 0.85,
  maxCenterOffset: 0.1, // hips can be offset by 10% of screen from center (0.5)
  maxShoulderSlope: 0.12,
  targetMargin: 0.05,
  sideOrientationThreshold: 0.70,
  sideOrientationDwellMs: 400,
  sideProfileMaxShoulderRatio: 0.30,
  sideProfileMaxHipRatio: 0.35,
  deviceCalibrationHoldMs: 400,
  deviceCalibrationToleranceDeg: 8, // Tighter tolerance for initial setup
  liveTiltWarningToleranceDeg: 15, // Wider recovery tolerance during live scan before warning
  captureGuideFadeMs: 200,
};

export const FOOT_TARGETS = {
  left: { cx: 0.43, cy: 0.88, rx: 0.08, ry: 0.05 },
  right: { cx: 0.57, cy: 0.88, rx: 0.08, ry: 0.05 },
  side: { cx: 0.50, cy: 0.88, rx: 0.14, ry: 0.07 },
};

/**
 * Checks if a point is within an ellipse.
 */
function isPointInEllipse(x: number, y: number, ellipse: EllipseRegion): boolean {
  const dx = (x - ellipse.cx) / ellipse.rx;
  const dy = (y - ellipse.cy) / ellipse.ry;
  return dx * dx + dy * dy <= 1.0 + 1e-6;
}

/**
 * Evaluates whether the user is facing front, standing in side profile, or ambiguous.
 */
export function evaluatePoseOrientation(landmarks: Landmark[]): PoseOrientationResult {
  if (landmarks.length < 33) {
    return { label: 'ambiguous', confidence: 0 };
  }

  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  const leftHip = landmarks[LANDMARK_INDEX.leftHip];
  const rightHip = landmarks[LANDMARK_INDEX.rightHip];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return { label: 'ambiguous', confidence: 0 };
  }

  const shoulderSpan = Math.abs(leftShoulder.x - rightShoulder.x);
  const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const midHipY = (leftHip.y + rightHip.y) / 2;
  const torsoHeight = Math.abs(midHipY - midShoulderY);

  if (torsoHeight < 0.05) {
    return { label: 'ambiguous', confidence: 0 };
  }

  const shoulderRatio = shoulderSpan / torsoHeight;
  const hipSpan = Math.abs(leftHip.x - rightHip.x);
  const hipRatio = hipSpan / torsoHeight;

  // Front orientation: broad shoulder separation relative to torso
  if (shoulderRatio >= 0.48) {
    const confidence = Math.min(1.0, 0.65 + ((shoulderRatio - 0.48) / 0.35) * 0.35);
    return { label: 'front', confidence };
  }

  // Side orientation: collapsed shoulder and hip profile
  if (shoulderRatio <= ALIGNMENT_CONFIG.sideProfileMaxShoulderRatio && hipRatio <= ALIGNMENT_CONFIG.sideProfileMaxHipRatio) {
    const convergence = (ALIGNMENT_CONFIG.sideProfileMaxShoulderRatio - shoulderRatio) / ALIGNMENT_CONFIG.sideProfileMaxShoulderRatio;
    const confidence = Math.min(1.0, ALIGNMENT_CONFIG.sideOrientationThreshold + Math.max(0, convergence) * 0.30);
    return { label: 'side', confidence };
  }

  return { label: 'ambiguous', confidence: 0.5 };
}

function getPrimaryInstruction(violations: AlignmentViolation[], requestedPose: RequestedPose): string | null {
  if (violations.includes('NO_PERSON')) return 'Position yourself in front of the camera';
  if (violations.includes('WRONG_ORIENTATION')) {
    return requestedPose === 'front' ? 'Face the camera' : 'Turn sideways';
  }
  if (violations.includes('BODY_CLIPPED')) return 'Step back so your whole body is visible';
  if (violations.includes('TOO_CLOSE')) return 'Step back so your whole body is visible';
  if (violations.includes('TOO_FAR')) return 'Step closer';
  if (violations.includes('OFF_CENTER_LEFT')) return 'Move slightly right';
  if (violations.includes('OFF_CENTER_RIGHT')) return 'Move slightly left';
  if (violations.includes('DEVICE_TILT')) return 'Hold phone upright';
  if (violations.includes('POSTURE')) return 'Stand upright';
  if (violations.includes('FEET_PLACEMENT')) return 'Place feet in target zone';
  return null;
}

/**
 * Pure, deterministic geometry engine evaluating pose against requested framing rules.
 */
export function evaluateBodyAlignment(
  landmarks: Landmark[],
  isPhoneTiltValid: boolean,
  requestedPose: RequestedPose = 'front',
  footTargets: { left: EllipseRegion; right: EllipseRegion; side?: EllipseRegion } = FOOT_TARGETS
): AlignmentEvaluation {
  if (landmarks.length < 33) {
    return {
      personDetected: false,
      confidence: 0,
      violations: ['NO_PERSON'],
      instruction: 'Position yourself in front of the camera',
      footStatus: { left: false, right: false },
      bounds: { topY: 0, bottomY: 0 },
      stanceRatio: 0,
      shoulderSlope: 0
    };
  }

  // 1. Detection Hierarchy: Decouple presence from full-body framing
  const headVis = landmarks[LANDMARK_INDEX.nose]?.visibility ?? 0;
  const leftShoulderVis = landmarks[LANDMARK_INDEX.leftShoulder]?.visibility ?? 0;
  const rightShoulderVis = landmarks[LANDMARK_INDEX.rightShoulder]?.visibility ?? 0;

  const upperVisibles = [headVis, leftShoulderVis, rightShoulderVis].filter(v => v >= 0.45);
  const upperAvg = (headVis + leftShoulderVis + rightShoulderVis) / 3;
  // Person presence requires at least 2 upper-body keypoints with aggregate confidence
  const personDetected = upperVisibles.length >= 2 && upperAvg >= 0.45;

  const leftHipVis = landmarks[LANDMARK_INDEX.leftHip]?.visibility ?? 0;
  const rightHipVis = landmarks[LANDMARK_INDEX.rightHip]?.visibility ?? 0;
  const leftAnkleVis = landmarks[LANDMARK_INDEX.leftAnkle]?.visibility ?? 0;
  const rightAnkleVis = landmarks[LANDMARK_INDEX.rightAnkle]?.visibility ?? 0;

  const hipsVis = Math.max(leftHipVis, rightHipVis);
  const feetVis = Math.max(leftAnkleVis, rightAnkleVis);
  const lowerBodyDetected = hipsVis >= 0.35 && feetVis >= 0.35;

  const requiredJoints: number[] = [
    LANDMARK_INDEX.nose, LANDMARK_INDEX.leftShoulder, LANDMARK_INDEX.rightShoulder,
    LANDMARK_INDEX.leftHip, LANDMARK_INDEX.rightHip, LANDMARK_INDEX.leftKnee, LANDMARK_INDEX.rightKnee,
    LANDMARK_INDEX.leftAnkle, LANDMARK_INDEX.rightAnkle,
  ];
  const meanConfidence = requiredJoints.reduce((sum, idx) => sum + (landmarks[idx]?.visibility ?? 0), 0) / requiredJoints.length;

  const violations: AlignmentViolation[] = [];

  if (!personDetected) {
    violations.push('NO_PERSON');
    return {
      personDetected: false,
      confidence: meanConfidence,
      violations,
      instruction: getPrimaryInstruction(violations, requestedPose),
      footStatus: { left: false, right: false },
      bounds: { topY: 0, bottomY: 0 },
      stanceRatio: 0,
      shoulderSlope: 0
    };
  }

  // If upper body is detected but lower body is missing, user is too close / clipped
  if (!lowerBodyDetected) {
    violations.push('BODY_CLIPPED');
  }

  // Derive body bounds
  const topY = (landmarks[LANDMARK_INDEX.nose]?.y ?? 0.5) - 0.05;
  const leftAnkle = landmarks[LANDMARK_INDEX.leftAnkle];
  const rightAnkle = landmarks[LANDMARK_INDEX.rightAnkle];
  const leftHeel = landmarks[29];
  const rightHeel = landmarks[30];
  const leftFootIndex = landmarks[31];
  const rightFootIndex = landmarks[32];

  const bottomY = Math.max(
    leftAnkle?.y ?? 0, rightAnkle?.y ?? 0,
    leftHeel?.y ?? 0, rightHeel?.y ?? 0,
    leftFootIndex?.y ?? 0, rightFootIndex?.y ?? 0
  );

  const bounds = { topY, bottomY };
  const height = bottomY - topY;

  // Stance and foot centers
  const leftFootCenterX = ((leftAnkle?.x ?? 0.5) + (leftHeel?.x ?? leftAnkle?.x ?? 0.5) + (leftFootIndex?.x ?? leftAnkle?.x ?? 0.5)) / 3;
  const leftFootCenterY = ((leftAnkle?.y ?? 0.88) + (leftHeel?.y ?? leftAnkle?.y ?? 0.88) + (leftFootIndex?.y ?? leftAnkle?.y ?? 0.88)) / 3;
  const rightFootCenterX = ((rightAnkle?.x ?? 0.5) + (rightHeel?.x ?? rightAnkle?.x ?? 0.5) + (rightFootIndex?.x ?? rightAnkle?.x ?? 0.5)) / 3;
  const rightFootCenterY = ((rightAnkle?.y ?? 0.88) + (rightHeel?.y ?? rightAnkle?.y ?? 0.88) + (rightFootIndex?.y ?? rightAnkle?.y ?? 0.88)) / 3;

  // 2. Orientation check
  const orientation = evaluatePoseOrientation(landmarks);
  if (requestedPose === 'front') {
    if (orientation.label !== 'front') {
      violations.push('WRONG_ORIENTATION');
    }
  } else {
    if (orientation.label !== 'side') {
      violations.push('WRONG_ORIENTATION');
    }
  }

  // 3. Viewport and distance checks
  if (topY < 0.02 || bottomY > 0.98) {
    if (!violations.includes('BODY_CLIPPED')) violations.push('BODY_CLIPPED');
  }

  if (height > ALIGNMENT_CONFIG.maxHeight) {
    violations.push('TOO_CLOSE');
  } else if (height < ALIGNMENT_CONFIG.minHeight) {
    violations.push('TOO_FAR');
  }

  const midHipX = ((landmarks[LANDMARK_INDEX.leftHip]?.x ?? 0.5) + (landmarks[LANDMARK_INDEX.rightHip]?.x ?? 0.5)) / 2;
  if (midHipX < 0.5 - ALIGNMENT_CONFIG.maxCenterOffset) {
    violations.push('OFF_CENTER_LEFT');
  } else if (midHipX > 0.5 + ALIGNMENT_CONFIG.maxCenterOffset) {
    violations.push('OFF_CENTER_RIGHT');
  }

  if (!isPhoneTiltValid) {
    violations.push('DEVICE_TILT');
  }

  // 4. Posture check
  const shoulderDx = (landmarks[LANDMARK_INDEX.rightShoulder]?.x ?? 0.6) - (landmarks[LANDMARK_INDEX.leftShoulder]?.x ?? 0.4);
  const shoulderDy = (landmarks[LANDMARK_INDEX.rightShoulder]?.y ?? 0.3) - (landmarks[LANDMARK_INDEX.leftShoulder]?.y ?? 0.3);
  const shoulderSlope = Math.abs(shoulderDy / (shoulderDx || 1e-6));

  if (requestedPose === 'front' && shoulderSlope > ALIGNMENT_CONFIG.maxShoulderSlope) {
    violations.push('POSTURE');
  }

  // 5. Foot placement check
  let footStatus = { left: false, right: false };
  if (requestedPose === 'front') {
    const leftIn = isPointInEllipse(leftFootCenterX, leftFootCenterY, footTargets.left);
    const rightIn = isPointInEllipse(rightFootCenterX, rightFootCenterY, footTargets.right);
    footStatus = { left: leftIn, right: rightIn };
    if (!leftIn || !rightIn) {
      violations.push('FEET_PLACEMENT');
    }
  } else {
    // For side view, use the forgiving central ellipse
    const sideTarget = footTargets.side ?? FOOT_TARGETS.side;
    const midFootX = (leftFootCenterX + rightFootCenterX) / 2;
    const midFootY = (leftFootCenterY + rightFootCenterY) / 2;
    const sideIn = isPointInEllipse(midFootX, midFootY, sideTarget) ||
                   isPointInEllipse(leftFootCenterX, leftFootCenterY, sideTarget) ||
                   isPointInEllipse(rightFootCenterX, rightFootCenterY, sideTarget);
    footStatus = { left: sideIn, right: sideIn };
    if (!sideIn) {
      violations.push('FEET_PLACEMENT');
    }
  }

  const hipWidth = Math.sqrt(
    Math.pow((landmarks[LANDMARK_INDEX.rightHip]?.x ?? 0.55) - (landmarks[LANDMARK_INDEX.leftHip]?.x ?? 0.45), 2) +
    Math.pow((landmarks[LANDMARK_INDEX.rightHip]?.y ?? 0.55) - (landmarks[LANDMARK_INDEX.leftHip]?.y ?? 0.55), 2)
  );
  
  const stanceDistance = Math.sqrt(
    Math.pow(rightFootCenterX - leftFootCenterX, 2) +
    Math.pow(rightFootCenterY - leftFootCenterY, 2)
  );
  const stanceRatio = hipWidth > 0 ? stanceDistance / hipWidth : 0;

  return {
    personDetected,
    confidence: meanConfidence,
    violations,
    instruction: getPrimaryInstruction(violations, requestedPose),
    footStatus,
    bounds,
    stanceRatio,
    shoulderSlope: personDetected ? shoulderSlope : 0
  };
}
