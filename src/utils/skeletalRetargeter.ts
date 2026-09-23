import type { WorldLandmark } from './poseDetector';
import type { Quaternion, Vec3 } from '../types/pose';
import {
  normalizePose,
  toTorsoLocal,
  normalizeVec,
  subVec,
  invertQuat,
  multiplyQuat,
  crossVec,
  quaternionFromBasis,
  IDENTITY_QUAT,
  LM,
  type CanonicalPose,
  type CanonicalJoint,
} from './poseNormalizer';

/**
 * Computes a quaternion representing a rotation from vector A to vector B.
 * Equivalent to THREE.Quaternion().setFromUnitVectors(vFrom, vTo).
 */
export function setFromUnitVectors(vFrom: Vec3, vTo: Vec3): Quaternion {
  let r = vFrom.x * vTo.x + vFrom.y * vTo.y + vFrom.z * vTo.z + 1;
  let q = { x: 0, y: 0, z: 0, w: 0 };

  if (r < 1e-6) {
    r = 0;
    if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
      q = { x: -vFrom.y, y: vFrom.x, z: 0, w: r };
    } else {
      q = { x: 0, y: -vFrom.z, z: vFrom.y, w: r };
    }
  } else {
    q = {
      x: vFrom.y * vTo.z - vFrom.z * vTo.y,
      y: vFrom.z * vTo.x - vFrom.x * vTo.z,
      z: vFrom.x * vTo.y - vFrom.y * vTo.x,
      w: r
    };
  }

  // Normalize the quaternion
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) return { x: 0, y: 0, z: 0, w: 1 };

  return {
    x: q.x / len,
    y: q.y / len,
    z: q.z / len,
    w: q.w / len
  };
}

/**
 * Caps a rotation delta's angle at maxAngleRad, preserving its axis. For the leg
 * deltas below: hip/knee landmarks proved to be far noisier in practice than the
 * shoulder/elbow pair this same math already handles well for arms -- confirmed
 * live, a wearer standing still produced a computed LeftUpLeg delta of ~137deg
 * (anatomically that's a deep crouch, not standing), visibly mangling the mesh
 * into an unrecognizable twisted shape. Real hip/knee flexion during a normal
 * standing/shifting try-on session doesn't approach that range, so a delta this
 * large is far more likely sensor noise (baggy clothing, self-occlusion, camera
 * distance) than a real pose. Clamping the MAGNITUDE rather than discarding the
 * delta outright keeps the leg visibly responsive to real (smaller) movement
 * instead of snapping between "full bend" and "no bend" as noise crosses a
 * threshold.
 */
function clampQuatAngle(q: Quaternion, maxAngleRad: number): Quaternion {
  const w = Math.min(1, Math.max(-1, Math.abs(q.w)));
  const angle = 2 * Math.acos(w);
  if (angle <= maxAngleRad) return q;
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  if (sinHalf < 1e-9) return q; // angle ~0 or ~2*PI: no well-defined axis to preserve
  const newHalf = maxAngleRad / 2;
  const scale = Math.sin(newHalf) / sinHalf;
  return {
    x: q.x * scale,
    y: q.y * scale,
    z: q.z * scale,
    w: Math.cos(newHalf) * (q.w < 0 ? -1 : 1),
  };
}

/**
 * Calculates per-bone rotation DELTAS (relative to each bone rest/bind orientation)
 * from a CanonicalPose, for GarmentRenderer to apply to the garment skeleton.
 *
 * WHAT CHANGED AND WHY (P0-D, torso-bend fix)
 * -------------------------------------------
 * This used to work in raw world space and drive the Spine bone directly from the
 * hip->shoulder direction. Two problems, both visible as "bending at the hips sends
 * the garment the wrong way":
 *
 *  1. DOUBLE-COUNTED ROTATION. The whole garment group is also rotated by the body
 *     orientation (garmentFitter). The hip->shoulder direction contains that same
 *     roll/pitch, so a lean was applied twice, through two different code paths that
 *     knew nothing about each other.
 *
 *  2. WRONG PIVOT. The Spine bone sits at the base of the chain, so rotating it swings
 *     the torso about the HIP -- while the garment group anchors the SHOULDER centre.
 *     A bend therefore rotated about one point and translated about another.
 *
 * The garment covers hips->shoulders and is anchored at the shoulder centre, which is
 * tracked live. Rotating the whole group by the torso orientation about that anchor puts
 * the hem exactly where the real hips are, so the torso orientation belongs entirely to
 * the group (see poseNormalizer.CanonicalTorso.quaternion) and the Spine bone goes back
 * to its bind pose. Arm deltas are therefore computed in TORSO-LOCAL space: an arm held
 * at the same angle relative to the body produces the same delta whether the body is
 * upright or bent.
 *
 * Also note the old code wrote a near-identity quaternion straight into the Spine bone
 * local rotation at rest, silently discarding whatever bind rotation the GLB actually had
 * -- the same "overwrote a real bind rotation" defect already fixed for the shoulders.
 * Omitting Spine from the output leaves it at its bind pose, which is what we want.
 */
export function calculateBoneRotationsFromCanonical(
  pose: CanonicalPose,
  restPose: 'T_POSE' | 'A_POSE' | 'CUSTOM' = 'T_POSE',
  fallbackRollRad?: number,
  category?: import('../types/garment').GarmentCategory
): Record<string, Quaternion> {
  const boneRotations: Record<string, Quaternion> = {};
  const j = pose.joints;
  const shouldComputeArms = category !== 'pants' && category !== 'skirt';
  const shouldComputeLegs = category !== 'shirt' && category !== 'jacket';

  const CANONICAL_Y_UP_ROLL_SIGN = -1;
  const torsoForRetarget: CanonicalPose['torso'] =
    !pose.torso.valid && fallbackRollRad !== undefined
      ? {
          ...pose.torso,
          valid: true,
          quaternion: (() => {
            const r = CANONICAL_Y_UP_ROLL_SIGN * fallbackRollRad;
            return { x: 0, y: 0, z: Math.sin(r / 2), w: Math.cos(r / 2) };
          })(),
        }
      : pose.torso;

  const lS = j[LM.leftShoulder];
  const lE = j[LM.leftElbow];
  const lW = j[LM.leftWrist];
  const rS = j[LM.rightShoulder];
  const rE = j[LM.rightElbow];
  const rW = j[LM.rightWrist];

  // Legs (pants/skirt garments only consume these -- see GarmentRenderer.tsx's
  // registerCorrection list; a garment with no LeftUpLeg/RightUpLeg bones simply
  // never reads these keys, so computing them unconditionally is harmless for
  // every existing shoulder-anchored garment).
  const lH = j[LM.leftHip];
  const lK = j[LM.leftKnee];
  const lA = j[LM.leftAnkle];
  const rH = j[LM.rightHip];
  const rK = j[LM.rightKnee];
  const rA = j[LM.rightAnkle];

  // Rest directions, in torso-local space. T-pose arms lie along the shoulder line,
  // which IS the torso local X axis by construction (see poseNormalizer).
  let lArmRest: Vec3 = { x: 1, y: 0, z: 0 };
  let rArmRest: Vec3 = { x: -1, y: 0, z: 0 };
  if (restPose === 'A_POSE') {
    const angle = (35 * Math.PI) / 180;
    lArmRest = { x: Math.cos(angle), y: -Math.sin(angle), z: 0 };
    rArmRest = { x: -Math.cos(angle), y: -Math.sin(angle), z: 0 };
  }

  // Neutral human resting pose deadzone:
  // In natural standing posture, arms hang down along the torso (~ -Y).
  // Live monocular MediaPipe tracking introduces landmark noise and natural anatomical
  // abduction (~8-12 deg). Within the neutral deadzone (<= 15 deg from vertical -Y),
  // the arm direction is resolved to relaxed vertical hang (0, -1, 0), ensuring the
  // garment sleeves hang relaxed, symmetric, and upright without jitter or A-pose stub
  // deformation. Outside the transition zone (>= 28 deg), live tracking engages smoothly.
  const NEUTRAL_ARM_DEADZONE_RAD = (15.0 * Math.PI) / 180;
  const FULL_ARM_ENGAGE_RAD = (28.0 * Math.PI) / 180;

  function resolveArmDirection(rawDir: Vec3 | null): Vec3 | null {
    if (!rawDir) return null;
    const cosAngle = Math.max(-1, Math.min(1, -rawDir.y));
    const angleRad = Math.acos(cosAngle);

    if (angleRad <= NEUTRAL_ARM_DEADZONE_RAD) {
      return { x: 0, y: -1, z: 0 };
    }
    if (angleRad >= FULL_ARM_ENGAGE_RAD) {
      return rawDir;
    }
    const t = (angleRad - NEUTRAL_ARM_DEADZONE_RAD) / (FULL_ARM_ENGAGE_RAD - NEUTRAL_ARM_DEADZONE_RAD);
    const s = t * t * (3 - 2 * t);
    return normalizeVec({
      x: rawDir.x * s,
      y: -1 * (1 - s) + rawDir.y * s,
      z: rawDir.z * s,
    });
  }

  const FOREARM_DEADZONE_RAD = (12.0 * Math.PI) / 180;
  const MAX_ARM_BEND_RAD = (145.0 * Math.PI) / 180;

  /** Direction from joint a to joint b, rotated out of canonical space into the torso frame. */
  const localDir = (a: CanonicalJoint | null, b: CanonicalJoint | null): Vec3 | null => {
    if (!a || !b) return null;
    const d = normalizeVec(subVec(b, a));
    if (d.x === 0 && d.y === 0 && d.z === 0) return null;
    return normalizeVec(toTorsoLocal(torsoForRetarget, d));
  };

  if (shouldComputeArms) {
    // Upper arms: shoulder -> elbow. Neutral arms down produce relaxed, symmetric hang.
    const rawLArmDir = localDir(lS, lE);
    const rawRArmDir = localDir(rS, rE);
    const lArmDir = resolveArmDirection(rawLArmDir);
    const rArmDir = resolveArmDirection(rawRArmDir);

    /**
     * Constructs an orthonormal 3D frame for upper arms to constrain both pointing
     * direction and axial sleeve twist.
     */
    function constructArmFrameDelta(
      armDir: Vec3 | null,
      restDir: Vec3,
      side: 'left' | 'right'
    ): Quaternion {
      if (!armDir) return IDENTITY_QUAT;

      const isLeft = side === 'left';
      const refForward: Vec3 = isLeft ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 };

      const xLive = normalizeVec(armDir);
      const dotForward = xLive.x * refForward.x + xLive.y * refForward.y + xLive.z * refForward.z;

      let yLive: Vec3;
      let zLive: Vec3;

      if (Math.abs(dotForward) > 0.96) {
        const refUp: Vec3 = { x: 0, y: 1, z: 0 };
        const dotUp = xLive.x * refUp.x + xLive.y * refUp.y + xLive.z * refUp.z;
        yLive = normalizeVec({
          x: refUp.x - xLive.x * dotUp,
          y: refUp.y - xLive.y * dotUp,
          z: refUp.z - xLive.z * dotUp,
        });
        zLive = normalizeVec(crossVec(xLive, yLive));
      } else {
        zLive = normalizeVec({
          x: refForward.x - xLive.x * dotForward,
          y: refForward.y - xLive.y * dotForward,
          z: refForward.z - xLive.z * dotForward,
        });
        yLive = normalizeVec(crossVec(zLive, xLive));
      }

      const qLive = quaternionFromBasis(xLive, yLive, zLive);

      const xRest = normalizeVec(restDir);
      const dotRest = xRest.x * refForward.x + xRest.y * refForward.y + xRest.z * refForward.z;
      const zRest = normalizeVec({
        x: refForward.x - xRest.x * dotRest,
        y: refForward.y - xRest.y * dotRest,
        z: refForward.z - xRest.z * dotRest,
      });
      const yRest = normalizeVec(crossVec(zRest, xRest));
      const qRest = quaternionFromBasis(xRest, yRest, zRest);

      return multiplyQuat(qLive, invertQuat(qRest));
    }

    const lArm = lArmDir ? constructArmFrameDelta(lArmDir, lArmRest, 'left') : IDENTITY_QUAT;
    const rArm = rArmDir ? constructArmFrameDelta(rArmDir, rArmRest, 'right') : IDENTITY_QUAT;
    boneRotations['LeftArm'] = lArm;
    boneRotations['RightArm'] = rArm;

    // Phase 11 & 12: Clavicles (LeftShoulder / RightShoulder) in Mixamo rigs sit near
    // the spine centerline and are not driven by uncalibrated arm elevation deltas.
    // Omit from boneRotations so they remain at their authored bind pose, preventing
    // sleeve root pinching around the neck and collar collapse.

    // Forearms: elbow -> wrist, expressed relative to the upper arm (the parent in the chain).
    const lForeDir = localDir(lE, lW);
    const rForeDir = localDir(rE, rW);

    function computeForearm(armDelta: Quaternion, armRest: Vec3, armDir: Vec3 | null, foreDir: Vec3 | null): Quaternion {
      if (!armDir || !foreDir) return IDENTITY_QUAT;
      const d = Math.max(-1, Math.min(1, armDir.x * foreDir.x + armDir.y * foreDir.y + armDir.z * foreDir.z));
      const angle = Math.acos(d);
      if (angle <= FOREARM_DEADZONE_RAD) {
        return IDENTITY_QUAT;
      }
      const rawForeDelta = multiplyQuat(invertQuat(armDelta), setFromUnitVectors(armRest, foreDir));
      return clampQuatAngle(rawForeDelta, MAX_ARM_BEND_RAD);
    }

    boneRotations['LeftForeArm'] = computeForearm(lArm, lArmRest, lArmDir, lForeDir);
    boneRotations['RightForeArm'] = computeForearm(rArm, rArmRest, rArmDir, rForeDir);
  }

  if (shouldComputeLegs) {
    // Upper legs: hip -> knee. Rest direction is straight down the torso-local
    // -Y axis regardless of restPose -- unlike arms, T-pose and A-pose don't
    // differ in leg stance, both are a neutral standing pose.
    const legRest: Vec3 = { x: 0, y: -1, z: 0 };
    const MAX_LEG_BEND_RAD = (100 * Math.PI) / 180;
    const KNEE_DEADZONE_RAD = (8.0 * Math.PI) / 180;
    const MAX_KNEE_BEND_RAD = (130 * Math.PI) / 180;

    const lLegDir = localDir(lH, lK);
    const rLegDir = localDir(rH, rK);
    const lUpLeg = lLegDir ? clampQuatAngle(setFromUnitVectors(legRest, lLegDir), MAX_LEG_BEND_RAD) : IDENTITY_QUAT;
    const rUpLeg = rLegDir ? clampQuatAngle(setFromUnitVectors(legRest, rLegDir), MAX_LEG_BEND_RAD) : IDENTITY_QUAT;
    boneRotations['LeftUpLeg'] = lUpLeg;
    boneRotations['RightUpLeg'] = rUpLeg;

    // Lower legs: knee -> ankle, expressed relative to the upper leg (the parent in the chain).
    // When the knee is extended (standing or straight leg raise), thigh and calf directions are
    // parallel -> returns IDENTITY_QUAT so the lower leg cleanly follows the upper leg without
    // bending backward or forming horizontal distortion segments.
    const lCalfDir = localDir(lK, lA);
    const rCalfDir = localDir(rK, rA);

    function computeKnee(upLegDelta: Quaternion, thighDir: Vec3 | null, calfDir: Vec3 | null): Quaternion {
      if (!thighDir || !calfDir) return IDENTITY_QUAT;
      const dot = Math.max(-1, Math.min(1, thighDir.x * calfDir.x + thighDir.y * calfDir.y + thighDir.z * calfDir.z));
      const angle = Math.acos(dot);
      if (angle <= KNEE_DEADZONE_RAD) {
        return IDENTITY_QUAT;
      }
      const rawKneeDelta = multiplyQuat(invertQuat(upLegDelta), setFromUnitVectors(legRest, calfDir));
      return clampQuatAngle(rawKneeDelta, MAX_KNEE_BEND_RAD);
    }

    boneRotations['LeftLeg'] = computeKnee(lUpLeg, lLegDir, lCalfDir);
    boneRotations['RightLeg'] = computeKnee(rUpLeg, rLegDir, rCalfDir);
  }

  return boneRotations;
}

/**
 * Adapter for callers that still hold raw MediaPipe world landmarks.
 * Prefer calculateBoneRotationsFromCanonical: the AR screen already builds the
 * CanonicalPose once per frame for the garment transform, and passing it straight
 * through avoids normalizing the same frame twice.
 */
export function calculateBoneRotations(
  worldLandmarks: WorldLandmark[],
  restPose: 'T_POSE' | 'A_POSE' | 'CUSTOM' = 'T_POSE',
  fallbackRollRad?: number,
  category?: import('../types/garment').GarmentCategory
): Record<string, Quaternion> {
  if (!worldLandmarks || worldLandmarks.length < 33) return {};
  return calculateBoneRotationsFromCanonical(normalizePose(worldLandmarks), restPose, fallbackRollRad, category);
}
