import type { BodyPose, GarmentFitState } from '../types/pose';
import type { GarmentFitProfile } from '../types/garment';
import { normalizePose, IDENTITY_QUAT, type CanonicalPose } from './poseNormalizer';
import type { UserMeasurements } from './sizeRecommender';

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
  metadata?: import('../types/garment').GarmentMetadata,
  /**
   * Canonical pose for this same frame. Pass the one the caller already built rather
   * than normalizing the same landmarks twice; derived here only as a convenience.
   */
  canonical?: CanonicalPose,
  /**
   * Phase B2: the wearer's saved body measurements and the selected/recommended
   * size's real chart entry, both optional. When both are present their shoulder-
   * width ratio multiplies the live silhouette-matched scale below (kept this path
   * consistent with GarmentRenderer.tsx's own fitModifier for the 3D overlay).
   * Missing either one degrades to today's pure silhouette-match behavior.
   */
  userMeasurements?: UserMeasurements,
  garmentSizeMeasurements?: { shoulderWidth?: number }
): GarmentFitState {

  if (pose.confidence < 0.3 || pose.trackingState === 'TRACKING_LOST' || pose.trackingState === 'FULL_BODY_REQUIRED') {
    return {
      anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 }, // Neutral quaternion
      orientation3D: IDENTITY_QUAT,
      dimensions: { shoulderWidthPx: 0, chestWidthPx: 0, lengthPx: 0 },
      confidence: 0
    };
  }

  const canonicalPose = canonical ?? normalizePose(pose.worldLandmarks);

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
  

  // 2. Metric Anthropometric Scaling (Phase 3 -> Phase 6 3D)
  const wl = pose.worldLandmarks;
  let userShoulderWidthMeters = 0.4; // fallback for average human
  if (wl && wl[11] && wl[12]) {
    const dx = wl[12].x - wl[11].x;
    const dy = wl[12].y - wl[11].y;
    const dz = wl[12].z - wl[11].z;
    userShoulderWidthMeters = Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  const garmentShoulderWidthMeters = metadata?.restPoseMetricWidth || profile.dimensions.shoulderWidth || 0.4;
  
  // Phase 6 True 3D Scale:
  // The Three.js renderer uses `pos.x / 100` to map pixels to 3D units.
  // Therefore, the target 3D width of the garment must be `correctedShoulderWidthPx / 100` units.
  // Since the base 3D width is `garmentShoulderWidthMeters`, the required scale is:
  const targetScale3D = (correctedShoulderWidthPx / 100) / garmentShoulderWidthMeters;

  // Phase B2: real-measurement fit modifier, same formula as GarmentRenderer.tsx's
  // own fitModifier so the legacy 2D overlay and the 3D WebGL overlay never disagree.
  const wearerWidthCm = userMeasurements?.shoulderWidth ?? (userShoulderWidthMeters > 0 ? userShoulderWidthMeters * 100 : null);
  const garmentWidthCm = garmentSizeMeasurements?.shoulderWidth ?? null;
  const fitModifier = wearerWidthCm && garmentWidthCm && wearerWidthCm > 0
    ? Math.min(1.4, Math.max(0.7, garmentWidthCm / wearerWidthCm))
    : 1;

  const targetScale = targetScale3D * fitModifier;


  // 3. Rotation.
  // `rotation` stays roll-only: it drives the legacy 2D image overlay, which can only
  // spin about the screen normal. The 3D renderer instead consumes `orientation3D`,
  // the full torso orientation from poseNormalizer -- previously the 3D path was fed
  // this same roll-only value while the Spine bone separately applied the pitch, about
  // a different pivot, which is what sent the garment sideways during a hip bend.
  const rollRad = pose.orientation.rollRad;
  
  // 4. Translate the anchor pixel coordinates so the UI knows where to position the DOM element.
  // In the current UI, translate is applied from center of screen.
  const targetX = anchorX - (screenWidth / 2);
  const targetY = anchorY - (screenHeight / 2) + (screenHeight * 0.15); // Adjust for the old topOffset

  // Roll-only quaternion for the legacy 2D image overlay (screen-space rotation).
  const rollQuat = { x: 0, y: 0, z: Math.sin(rollRad / 2), w: Math.cos(rollRad / 2) };

  // Fix for open item #3 in the AR audit plan: rollRad is derived in poseConstructor
  // from the raw MediaPipe frame (Y-down image coordinates), but the 3D path consumes
  // orientation3D as a rotation about canonical +Z in Y-up space -- the two conventions
  // differ by an exact sign flip. Feeding rollQuat (built from the Y-down rollRad)
  // straight into orientation3D rolled the garment the wrong direction specifically
  // whenever the torso basis is invalid and this fallback path is exercised. Negate at
  // this Y-down -> Y-up handoff, not at rollRad's own declaration, so the 2D overlay
  // above (which wants the Y-down convention) is unaffected.
  // NOT verified on a physical device -- see docs/ar-tryon-audit-implementation-plan.md.
  const CANONICAL_Y_UP_ROLL_SIGN = -1;
  const rollRad3D = CANONICAL_Y_UP_ROLL_SIGN * rollRad;
  const rollQuat3D = { x: 0, y: 0, z: Math.sin(rollRad3D / 2), w: Math.cos(rollRad3D / 2) };

  // If the torso could not be resolved -- most often because the hips are out of frame
  // or low-visibility, which is common at try-on framing distance -- degrade to the
  // roll-only orientation the 3D path used before rather than to identity. Never worse
  // than the previous behaviour, just no pitch/yaw until the hips come back.
  const orientation3D = canonicalPose.torso.valid ? canonicalPose.torso.quaternion : rollQuat3D;

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
    rotation: rollQuat,
    orientation3D,
    dimensions: {
      shoulderWidthPx: correctedShoulderWidthPx,
      chestWidthPx: correctedShoulderWidthPx * 1.05,
      lengthPx: correctedShoulderWidthPx * 2.5 
    },
    confidence: pose.confidence
  };
}
