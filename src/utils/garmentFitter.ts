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
  screenHeight: number,
  metadata?: import('../types/garment').GarmentMetadata
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

  // Use the canonical stage-mapped landmarks for 2D UI positioning only
  const L = pose.stageLandmarks;
  const leftShoulder = L[11];
  const rightShoulder = L[12];
  
  // Calculate apparent 2D pixel width of the shoulders
  const apparentShoulderWidthPx = Math.abs(leftShoulder.x - rightShoulder.x);

  // Foreshortening correction using orientation
  // Orientation was established robustly in BodyCoordinateFrame
  const cosYaw = Math.max(0.65, Math.abs(Math.cos(pose.orientation.yawRad)));
  const correctedShoulderWidthPx = apparentShoulderWidthPx / cosYaw;

  // 1. Anchoring Logic driven by GarmentFitProfile (2D pixel coordinates for HUD)
  let anchorX = (leftShoulder.x + rightShoulder.x) / 2;
  let anchorY = (leftShoulder.y + rightShoulder.y) / 2;

  if (profile.anchors.neck) {
     // example override if rig provides specific attachment offsets
  }
  
  // 2. Metric Anthropometric Scaling (Phase 3)
  // Derive the user's true physical shoulder width from worldLandmarks
  const wl = pose.worldLandmarks;
  let userShoulderWidthMeters = 0.4; // fallback for average human
  if (wl && wl[11] && wl[12]) {
    const dx = wl[12].x - wl[11].x;
    const dy = wl[12].y - wl[11].y;
    const dz = wl[12].z - wl[11].z;
    userShoulderWidthMeters = Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  // Calculate scaling mapping physical -> screen.
  // We know the apparent 2D shoulder width in pixels and the true physical shoulder width in meters.
  const pixelsPerMeter = correctedShoulderWidthPx / userShoulderWidthMeters;

  // The garment's designed physical shoulder width (e.g. 0.4 meters)
  const garmentShoulderWidthMeters = metadata?.restPoseMetricWidth || profile.dimensions.shoulderWidth || 0.4;
  
  // The scale factor required to fit the garment to this specific user's body in true metric space
  const physicalScale = userShoulderWidthMeters / garmentShoulderWidthMeters;
  
  // The target screen width for the garment in pixels
  const targetGarmentWidthPx = garmentShoulderWidthMeters * physicalScale * pixelsPerMeter;
  
  // Because the 2D overlay relies on a fixed internal reference (e.g., assuming 0.35 * screen width was "scale 1"),
  // we map the calculated pixel width back into the legacy scale multiplier so the React Native UI doesn't break
  const legacyBaseGarmentWidthPx = screenWidth * 0.35;
  const rawScale = targetGarmentWidthPx / legacyBaseGarmentWidthPx;
  const targetScale = Math.max(0.5, Math.min(3.0, rawScale));

  // 3. Rotation (Roll only for 2D overlay compatibility right now)
  const rollRad = pose.orientation.rollRad;
  
  // 4. Translate the anchor pixel coordinates so the UI knows where to position the DOM element.
  // In the current UI, translate is applied from center of screen.
  const targetX = anchorX - (screenWidth / 2);
  const targetY = anchorY - (screenHeight / 2) + (screenHeight * 0.15); // Adjust for the old topOffset

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
