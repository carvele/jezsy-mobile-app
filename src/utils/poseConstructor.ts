import type { Landmark } from './poseDetector';
import { extractBodyCoordinateFrame } from './poseDetector';
import type { BodyPose, BodyOrientation } from '../types/pose';
import type { TrackingState } from './trackingState';
import { transformLandmarksToStage, type TransformContext } from './coordinateTransform';

const L = { nose: 0, leftShoulder: 11, rightShoulder: 12 };

export function constructBodyPose(
  rawLandmarks: Landmark[],
  filteredLandmarks: Landmark[],
  transformCtx: TransformContext
): BodyPose {
  
  // Transform to canonical screen coordinates
  const stageLandmarks = transformLandmarksToStage(filteredLandmarks, transformCtx);
  
  // Extract rigid torso orientation using the stage-mapped (or normalized) landmarks
  // BodyCoordinateFrame should be built on canonical stage coordinates so the Z-roll matches the screen.
  const coordinateFrame = extractBodyCoordinateFrame(stageLandmarks);
  
  // Calculate Orientation (yaw, pitch, roll)
  const leftShoulder = stageLandmarks[L.leftShoulder];
  const rightShoulder = stageLandmarks[L.rightShoulder];
  
  let yawRad = 0;
  if (leftShoulder && rightShoulder) {
    const deltaZ = (rightShoulder.z ?? 0) - (leftShoulder.z ?? 0);
    // x is canonical now (pixels). But z is still uncalibrated relative.
    const deltaX = Math.abs(leftShoulder.x - rightShoulder.x) || 1;
    // Note: Z needs a scaling factor because X is now in 100s of pixels but Z is small.
    // For now, we fallback to normalized deltaX for yaw to keep it stable.
    const normDeltaX = Math.abs(filteredLandmarks[L.leftShoulder].x - filteredLandmarks[L.rightShoulder].x);
    yawRad = Math.atan2(deltaZ, normDeltaX || 0.01);
  }

  // Derive tracking state based on visibility and orientation
  let trackingState: TrackingState = 'GOOD_FIT';
  if (!leftShoulder || !rightShoulder || leftShoulder.visibility < 0.35 || rightShoulder.visibility < 0.35) {
    trackingState = 'TRACKING_LOST';
  } else if (Math.abs(yawRad) > 25 * (Math.PI / 180)) {
    trackingState = 'TURN_TOO_FAR';
  }

  // A basic confidence metric: average visibility of the shoulders
  const confidence = ((leftShoulder?.visibility ?? 0) + (rightShoulder?.visibility ?? 0)) / 2;

  const orientation: BodyOrientation = {
    yawRad,
    pitchRad: 0, // Phase 1 skips complex pitch
    rollRad: Math.atan2(coordinateFrame.right.y, coordinateFrame.right.x),
    isFacingForward: Math.abs(yawRad) < 25 * (Math.PI / 180),
    isBackFacing: false // Phase 1 skips complex back-facing detection
  };

  return {
    coordinateFrame,
    landmarks: rawLandmarks,
    filteredLandmarks: stageLandmarks,
    orientation,
    trackingState,
    confidence
  };
}
