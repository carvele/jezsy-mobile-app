import type { BodyPose, GarmentFitState } from '../types/pose';
import type { GarmentFitProfile } from '../types/garment';
import { normalizePose, IDENTITY_QUAT, type CanonicalPose } from './poseNormalizer';
import type { UserMeasurements } from './sizeRecommender';
import { deriveBodyOuterHipWidth, deriveBodyOuterShoulderWidth } from './bodyFitEstimator';

/**
 * Calculates the garment's target transformation and scale state (GarmentFitState) 
 * given a strictly defined BodyPose and GarmentFitProfile.
 * 
 * This effectively replaces the heuristic "calculateGarmentAutoFit" and explicitly
 * decouples tracking heuristics from garment geometry scaling.
 */
export function calculateGarmentFit(
  pose: BodyPose,
  profileOrMetadata?: GarmentFitProfile | import('../types/garment').GarmentMetadata,
  screenWidth: number = 390,
  screenHeight: number = 844,
  metadataArg?: import('../types/garment').GarmentMetadata,
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
  garmentSizeMeasurements?: { shoulderWidth?: number; hips?: number; length?: number }
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

  const isProfile = profileOrMetadata && 'anchors' in profileOrMetadata;
  const profile = isProfile ? (profileOrMetadata as GarmentFitProfile) : undefined;
  const metadata = metadataArg || (!isProfile ? (profileOrMetadata as import('../types/garment').GarmentMetadata) : undefined);

  const canonicalPose = canonical ?? normalizePose(pose.worldLandmarks);

  // Pants/skirt anchor at the hips (landmarks 23/24), not the shoulders --
  // everything else (jacket/shirt/dress, and any category-less caller) keeps
  // the exact prior shoulder-anchored behavior unchanged. Falls back to
  // shoulders if a hip landmark is unexpectedly missing, same fail-safe
  // posture as the rest of this function.
  const isBottomGarment = ['pants', 'skirt', 'bottoms', 'trousers', 'jeans', 'shorts'].includes(
    String(metadata?.category || '').toLowerCase()
  );

  // Use the canonical stage-mapped landmarks for 2D UI positioning only
  const L = pose.stageLandmarks || (pose as any).landmarks || pose.normalizedLandmarks;
  if (!L) {
    return {
      anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: IDENTITY_QUAT,
      orientation3D: IDENTITY_QUAT,
      dimensions: { shoulderWidthPx: 0, chestWidthPx: 0, lengthPx: 0 },
      confidence: 0
    };
  }
  const useHipAnchor = isBottomGarment && L[23] && L[24];
  const leftAnchorPoint = useHipAnchor ? L[23] : (L[11] || L[23]);
  const rightAnchorPoint = useHipAnchor ? L[24] : (L[12] || L[24]);

  // A bag hangs from one shoulder, not the shoulder midpoint -- but the
  // apparentShoulderWidthPx/scale math below still needs a real two-point
  // span (collapsing left/right to the same point would zero the scale out
  // to nothing), so only the position midpoint is overridden here, not
  // leftAnchorPoint/rightAnchorPoint themselves.
  const isBag = metadata?.category === 'bag';
  const bagAnchorPoint = isBag && L[12] ? L[12] : null;

  // Calculate apparent 2D pixel width of the anchor pair (shoulders, or hips for bottoms)
  const apparentAnchorWidthPx = Math.abs(leftAnchorPoint.x - rightAnchorPoint.x);

  // 2. Metric Anthropometric Scaling (Phase 3 -> Phase 6 3D -> V2 Fit Bands)
  const wl = pose.worldLandmarks;
  const [aIdx, bIdx] = useHipAnchor ? [23, 24] : [11, 12];
  let skeletalJointSpanM = 0.4;
  if (wl && wl[aIdx] && wl[bIdx]) {
    const dx = wl[bIdx].x - wl[aIdx].x;
    const dy = wl[bIdx].y - wl[aIdx].y;
    const dz = wl[bIdx].z - wl[aIdx].z;
    skeletalJointSpanM = Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  // Derive body outer physical width using strict typed semantics and source priority
  const bodyOuterHipWidthM = deriveBodyOuterHipWidth({
    userMeasurements,
    sizingMeasurements: userMeasurements ? { hips: userMeasurements.hips, waist: userMeasurements.waist, shoulderWidth: userMeasurements.shoulderWidth } : null,
    skeletalHipSpanM: isBottomGarment ? skeletalJointSpanM : null,
    skeletalShoulderSpanM: isBottomGarment ? null : skeletalJointSpanM,
    yawRad: pose.orientation.yawRad,
    confidence: pose.confidence
  });

  const bodyOuterShoulderWidthM = deriveBodyOuterShoulderWidth({
    userMeasurements,
    skeletalShoulderSpanM: isBottomGarment ? null : skeletalJointSpanM,
  });

  const bodyOuterWidthM = isBottomGarment ? bodyOuterHipWidthM : bodyOuterShoulderWidthM;

  // Foreshortening correction using orientation
  // During movement or turning, physical body outer width remains stable
  const cosYaw = Math.max(0.65, Math.abs(Math.cos(pose.orientation.yawRad)));
  const correctedShoulderWidthPx = (isBottomGarment ? apparentAnchorWidthPx * 1.78 : apparentAnchorWidthPx) / cosYaw;

  // 1. Anchoring Logic driven by GarmentFitProfile (2D pixel coordinates for HUD)
  let anchorX = bagAnchorPoint ? bagAnchorPoint.x : (leftAnchorPoint.x + rightAnchorPoint.x) / 2;
  let anchorY = bagAnchorPoint ? bagAnchorPoint.y : (leftAnchorPoint.y + rightAnchorPoint.y) / 2;

  if (profile?.anchors?.neck) {
     // example override if rig provides specific attachment offsets
  }

  // V2 Profile Awareness: Read authored fit bands and coverage profile
  const v2 = metadata?.fitProfileV2;
  const hipBand = v2?.fitBands?.find(b => b.name === 'HIP');
  const waistBand = v2?.fitBands?.find(b => b.name === 'WAIST');
  const shoulderBand = v2?.fitBands?.find(b => b.name === 'SHOULDER');

  let aggregatedBottomWidth = null;
  if (isBottomGarment) {
    if (hipBand && hipBand.authoredWidthMeters) {
      if (waistBand && waistBand.authoredWidthMeters) {
        aggregatedBottomWidth = (hipBand.authoredWidthMeters * 0.65) + (waistBand.authoredWidthMeters * 0.35);
      } else {
        aggregatedBottomWidth = hipBand.authoredWidthMeters;
      }
    } else if (waistBand && waistBand.authoredWidthMeters) {
      aggregatedBottomWidth = waistBand.authoredWidthMeters;
    }
  }

  const garmentMetricWidthMeters = isBottomGarment
    ? (aggregatedBottomWidth || hipBand?.authoredWidthMeters || waistBand?.authoredWidthMeters || metadata?.restPoseMetricWidth || 0.34)
    : (shoulderBand?.authoredWidthMeters || metadata?.restPoseMetricWidth || (profile?.dimensions?.shoulderWidth || 0.4));
  
  // Category-specific clothing ease (8% for bottoms so garment rests naturally over silhouette)
  const garmentEase = isBottomGarment ? 1.08 : 1.0;

  // Horizontal target 3D scale: Body Outer Width / Authored Garment Reference Width
  const targetScaleX = ((bodyOuterWidthM * garmentEase) / garmentMetricWidthMeters);

  // Multi-constraint Vertical Fit / Leg Length scaling for trousers/skirts
  let targetScaleY = isBottomGarment ? 1.0 : targetScaleX;
  if (isBottomGarment && L[23] && L[24]) {
    const kneeL = L[25];
    const ankleL = L[27];
    const kneeR = L[26];
    const ankleR = L[28];
    let legLenPx = 0;
    let legCount = 0;
    if (kneeL && ankleL) {
      legLenPx += Math.hypot(kneeL.x - L[23].x, kneeL.y - L[23].y) + Math.hypot(ankleL.x - kneeL.x, ankleL.y - kneeL.y);
      legCount++;
    }
    if (kneeR && ankleR) {
      legLenPx += Math.hypot(kneeR.x - L[24].x, kneeR.y - L[24].y) + Math.hypot(ankleR.x - kneeR.x, ankleR.y - kneeR.y);
      legCount++;
    }
    if (legCount > 0) {
      legLenPx /= legCount;
      const authoredLength = v2?.coverageProfile?.authoredLengthMeters || profile?.dimensions?.length || 1.0;
      const rawScaleY = (legLenPx / 100) / authoredLength;
      targetScaleY = Math.max(targetScaleX * 0.80, Math.min(targetScaleX * 1.25, rawScaleY));
    }
  }

  // Phase B2: real-measurement fit modifier, matching hips for bottoms
  const wearerWidthCm = isBottomGarment
    ? (userMeasurements?.hips ? (userMeasurements.hips / 2.735) : (bodyOuterHipWidthM * 100))
    : (userMeasurements?.shoulderWidth ?? (bodyOuterShoulderWidthM * 100));
  const garmentWidthCm = isBottomGarment
    ? (garmentSizeMeasurements?.hips ? (garmentSizeMeasurements.hips / 2.735) : (garmentSizeMeasurements?.shoulderWidth ?? null))
    : (garmentSizeMeasurements?.shoulderWidth ?? null);
  const fitModifier = wearerWidthCm && garmentWidthCm && wearerWidthCm > 0
    ? Math.min(1.4, Math.max(0.7, garmentWidthCm / wearerWidthCm))
    : 1;

  // Final safety clamp on target scale factors (prevent runaway scales on noisy frames)
  const targetScaleFinalX = Math.max(0.65, Math.min(1.45, targetScaleX * fitModifier));
  const targetScaleFinalY = Math.max(0.65, Math.min(1.45, targetScaleY * fitModifier));
  const targetScaleFinalZ = targetScaleFinalX;


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
  const fullTorsoOrientation = canonicalPose.torso.valid ? canonicalPose.torso.quaternion : rollQuat3D;

  // A hanging accessory (bag strap, necklace chain) isn't rigidly welded to the
  // torso the way clothing is -- gravity keeps it roughly vertical regardless of
  // how far the wearer leans forward or sideways. Applying the FULL torso
  // orientation (pitch+roll included, as clothing correctly does) made both
  // look like they were tipping/swinging unnaturally with every lean -- confirmed
  // live. Yaw only (turning left/right) still follows the body, since a
  // strap/chain anchored at the shoulder or neck genuinely does turn with you.
  // Reuses pose.orientation.yawRad -- already trusted for real (non-diagnostic)
  // math above at correctedShoulderWidthPx -- rather than decomposing
  // canonicalPose.torso's own basis, which poseNormalizer.ts's
  // torsoEulerDegrees explicitly documents as "for diagnostics only -- never
  // for math."
  // Sign NOT verified on a physical device: if the accessory turns opposite
  // to the wearer, flip this to -1, the same kind of live-tested correction
  // CANONICAL_Y_UP_ROLL_SIGN above needed for roll.
  const HANGING_ACCESSORY_YAW_SIGN = 1;
  const isHangingAccessory = metadata?.category === 'bag' || metadata?.category === 'necklace';
  const yawRad3D = HANGING_ACCESSORY_YAW_SIGN * pose.orientation.yawRad;
  const yawOnlyQuat = { x: 0, y: Math.sin(yawRad3D / 2), z: 0, w: Math.cos(yawRad3D / 2) };

  const orientation3D = isHangingAccessory ? yawOnlyQuat : fullTorsoOrientation;

  return {
    anchor: {
      x: targetX,
      y: targetY,
      z: 0 // Z-translation for true 3D will be implemented in Phase 4
    },
    scale: {
      x: targetScaleFinalX,
      y: targetScaleFinalY,
      z: targetScaleFinalZ
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
