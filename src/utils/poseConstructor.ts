import type { Landmark, StageLandmark, WorldLandmark } from './poseDetector';
import { extractBodyCoordinateFrame } from './poseDetector';
import type { BodyPose, BodyOrientation } from '../types/pose';
import type { TrackingState } from './trackingState';
import { transformLandmarksToStage, type TransformContext } from './coordinateTransform';

const L = { nose: 0, leftShoulder: 11, rightShoulder: 12 };

export function constructBodyPose(
  rawNormalizedLandmarks: Landmark[],
  filteredNormalizedLandmarks: Landmark[],
  worldLandmarks: WorldLandmark[],
  transformCtx: TransformContext
): BodyPose {
  
  // Transform to canonical stage pixel coordinates
  const stageLandmarks = transformLandmarksToStage(filteredNormalizedLandmarks, transformCtx) as StageLandmark[];
  
  // Ensure we have a valid 3D metric world landmark array to extract physical orientation
  const useWorldLandmarks = worldLandmarks && worldLandmarks.length >= 33;
  const metricLandmarks = useWorldLandmarks ? worldLandmarks : filteredNormalizedLandmarks;
  
  // Extract robust rigid torso orientation using the metric 3D world landmarks
  const coordinateFrame = extractBodyCoordinateFrame(metricLandmarks);
  
  // Calculate Orientation (yaw, pitch, roll) strictly from the orthonormal 3D basis vectors.
  // In our orthonormal system:
  // - coordinateFrame.forward points into the scene (+Z)
  // - coordinateFrame.right points to the subject's right (+X)
  // - coordinateFrame.up points towards the head (-Y in MediaPipe, or whatever Gram-Schmidt determined)
  
  // Yaw is rotation around the Y (up) axis. Looking down from above:
  const yawRad = Math.atan2(coordinateFrame.forward.x, coordinateFrame.forward.z);
  
  // Pitch is rotation around the X (right) axis.
  const pitchRad = Math.atan2(-coordinateFrame.forward.y, Math.sqrt(coordinateFrame.forward.x ** 2 + coordinateFrame.forward.z ** 2));
  
  // Roll is rotation around the Z (forward) axis.
  // MediaPipe's raw (unmirrored) world landmarks put the subject's own right shoulder
  // (landmark 12) at a SMALLER x than the left shoulder (landmark 11) when facing the
  // camera upright -- so coordinateFrame.right.x is negative at true zero roll, which
  // made atan2(right.y, right.x) read ~180 deg for a person standing normally (confirmed:
  // rollDeg consistently ~+-180 while yawDeg correctly stayed ~0). Negating both
  // components shifts the baseline to 0 without touching right/up/forward themselves,
  // so yaw/pitch (which were already correct) are unaffected.
  const rollRad = Math.atan2(-coordinateFrame.right.y, -coordinateFrame.right.x);

  const isFacingForward = Math.abs(yawRad) < 25 * (Math.PI / 180) && coordinateFrame.forward.z > 0;
  const isBackFacing = Math.abs(yawRad) > 110 * (Math.PI / 180) || coordinateFrame.forward.z < 0;

  // Derive tracking state based on stage visibility and yaw threshold
  const leftShoulder = stageLandmarks[L.leftShoulder];
  const rightShoulder = stageLandmarks[L.rightShoulder];

  let trackingState: TrackingState = 'GOOD_FIT';
  if (!leftShoulder || !rightShoulder || leftShoulder.visibility < 0.35 || rightShoulder.visibility < 0.35) {
    trackingState = 'TRACKING_LOST';
  } else if (!isFacingForward) {
    trackingState = 'TURN_TOO_FAR';
  }

  // Basic confidence metric: average visibility of the shoulders
  const confidence = ((leftShoulder?.visibility ?? 0) + (rightShoulder?.visibility ?? 0)) / 2;

  const orientation: BodyOrientation = {
    yawRad,
    pitchRad,
    rollRad,
    isFacingForward,
    isBackFacing
  };

  return {
    coordinateFrame,
    normalizedLandmarks: filteredNormalizedLandmarks,
    stageLandmarks,
    worldLandmarks: useWorldLandmarks ? worldLandmarks : (filteredNormalizedLandmarks as any),
    orientation,
    trackingState,
    confidence
  };
}
