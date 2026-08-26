import type { BodyPose, GarmentFitState, Vec3 } from '../types/pose';
import type { GarmentFitProfile } from '../types/garment';

/**
 * Calculates the garment's target transformation and scale state (GarmentFitState) 
 * given a strictly defined BodyPose and GarmentFitProfile.
 * 
 * This effectively replaces the heuristic "calculateGarmentAutoFit" and explicitly
 * decouples tracking heuristics from garment geometry scaling.
 */
export function calculateGarmentFit(
  pose: BodyPose,
  profile: GarmentFitProfile,
  screenWidth: number,
  screenHeight: number
): GarmentFitState {
  
  if (pose.confidence < 0.3 || pose.trackingState === 'TRACKING_LOST' || pose.trackingState === 'FULL_BODY_REQUIRED') {
    return {
      anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, // Neutral quaternion
      dimensions: { shoulderWidthPx: 0, chestWidthPx: 0, lengthPx: 0 },
      confidence: 0
    };
  }

  // Use the canonical stage-mapped landmarks
  const L = pose.filteredLandmarks;
  const leftShoulder = L[11];
  const rightShoulder = L[12];
  
  // Calculate apparent 2D pixel width of the shoulders
  const apparentShoulderWidthPx = Math.abs(leftShoulder.x - rightShoulder.x);

  // Foreshortening correction using orientation
  // Orientation was established robustly in BodyCoordinateFrame
  const cosYaw = Math.max(0.65, Math.abs(Math.cos(pose.orientation.yawRad)));
  const correctedShoulderWidthPx = apparentShoulderWidthPx / cosYaw;

  // 1. Anchoring Logic driven by GarmentFitProfile
  let anchorX = pose.coordinateFrame.origin.x;
  let anchorY = pose.coordinateFrame.origin.y;

  // By default, the BodyCoordinateFrame origin is the mid-shoulder point (collar notch)
  // If the garment has specific anchor preferences, apply them here (in the future).
  if (profile.anchors.neck) {
     // example override if rig provides specific attachment offsets
  }
  
  // 2. Scaling Logic
  // Assuming the 2D overlays were scaled assuming a baseline width. 
  // We'll map the garment's profile shoulderWidth to the detected shoulder width.
  // (In V1, 0.35 * screenW was the hardcoded baseline).
  const BASELINE_WIDTH_PX = screenWidth * 0.35;
  const rawScale = correctedShoulderWidthPx / BASELINE_WIDTH_PX;
  const targetScale = Math.max(0.6, Math.min(2.5, rawScale));

  // 3. Rotation (Roll only for 2D overlay compatibility right now)
  // Convert body coordinate frame 'right' vector to a Z-axis roll
  // Right axis points from left shoulder to right shoulder
  const rightVec = pose.coordinateFrame.right;
  let rollRad = Math.atan2(rightVec.y, rightVec.x);
  
  // If the vector points generally right-to-left in pixel coordinates, it might need to be flipped depending on mirroring. 
  // We assume rightVec is canonical stage coordinates (x grows right).
  // Clamp roll to natural anatomical limits
  const rollDeg = Math.max(-18, Math.min(18, rollRad * (180 / Math.PI)));
  
  // 4. Translate the anchor pixel coordinates so the UI knows where to position the DOM element.
  // In the current UI, translate is applied from center of screen.
  const targetX = anchorX - (screenWidth / 2);
  const targetY = anchorY - (screenHeight / 2) + (screenHeight * 0.15); // Adjust for the old topOffset (chestAnchorY - 0.35)

  return {
    anchor: {
      x: targetX,
      y: targetY,
      z: 0 // Z-translation for true 3D will be implemented in Phase 4
    },
    scale: {
      x: targetScale,
      y: targetScale,
      z: targetScale
    },
    rotation: {
      x: 0,
      y: 0,
      z: Math.sin(rollRad / 2),
      w: Math.cos(rollRad / 2)
    },
    dimensions: {
      shoulderWidthPx: correctedShoulderWidthPx,
      chestWidthPx: correctedShoulderWidthPx * 1.05,
      lengthPx: correctedShoulderWidthPx * 2.5 
    },
    confidence: pose.confidence
  };
}
