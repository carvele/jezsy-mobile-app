import type { WorldLandmark } from './poseDetector';
import type { Quaternion, Vec3 } from '../types/pose';
import {
  normalizePose,
  toTorsoLocal,
  normalizeVec,
  subVec,
  invertQuat,
  multiplyQuat,
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
  // Fix for open item #6 in the AR audit plan. When pose.torso is invalid (hips out
  // of frame / low visibility, common at try-on framing distance), garmentFitter
  // rotates the whole garment group by a roll-only fallback quaternion (see its
  // CANONICAL_Y_UP_ROLL_SIGN * rollRad), but toTorsoLocal used to pass arm-direction
  // vectors through UNCHANGED for an invalid torso -- so that same roll ended up
  // baked into both the parent group and these child bone deltas, compounding rather
  // than just duplicating. Passing the caller's rollRad (Y-down, poseConstructor's
  // convention -- same value garmentFitter negates into its fallback) lets this
  // function build the identical fallback quaternion and remove it from arm
  // directions the same way a valid torso basis already does, so the two owners
  // (group, bones) agree on who applies roll instead of each assuming the other
  // isn't. Omit to preserve the exact prior (double-counting) behavior.
  // NOT verified on a physical device -- see docs/ar-tryon-audit-implementation-plan.md.
  fallbackRollRad?: number
): Record<string, Quaternion> {
  const boneRotations: Record<string, Quaternion> = {};
  const j = pose.joints;

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
    const angle = 35 * Math.PI / 180;
    lArmRest = { x: Math.cos(angle), y: -Math.sin(angle), z: 0 };
    rArmRest = { x: -Math.cos(angle), y: -Math.sin(angle), z: 0 };
  }

  /** Direction from joint a to joint b, rotated out of canonical space into the torso frame. */
  const localDir = (a: CanonicalJoint | null, b: CanonicalJoint | null): Vec3 | null => {
    if (!a || !b) return null;
    const d = normalizeVec(subVec(b, a));
    if (d.x === 0 && d.y === 0 && d.z === 0) return null;
    return normalizeVec(toTorsoLocal(torsoForRetarget, d));
  };

  // Upper arms: shoulder -> elbow. Missing joint means "no delta", i.e. leave the bone at
  // its bind pose, rather than inheriting some other bone rotation.
  const lArmDir = localDir(lS, lE);
  const rArmDir = localDir(rS, rE);
  const lArm = lArmDir ? setFromUnitVectors(lArmRest, lArmDir) : IDENTITY_QUAT;
  const rArm = rArmDir ? setFromUnitVectors(rArmRest, rArmDir) : IDENTITY_QUAT;
  boneRotations['LeftArm'] = lArm;
  boneRotations['RightArm'] = rArm;

  // Forearms: elbow -> wrist, expressed relative to the upper arm (the parent in the chain).
  const lForeDir = localDir(lE, lW);
  const rForeDir = localDir(rE, rW);
  boneRotations['LeftForeArm'] = lForeDir
    ? multiplyQuat(invertQuat(lArm), setFromUnitVectors(lArmRest, lForeDir))
    : IDENTITY_QUAT;
  boneRotations['RightForeArm'] = rForeDir
    ? multiplyQuat(invertQuat(rArm), setFromUnitVectors(rArmRest, rForeDir))
    : IDENTITY_QUAT;

  // Upper legs: hip -> knee. Rest direction is straight down the torso-local
  // -Y axis regardless of restPose -- unlike arms, T-pose and A-pose don't
  // differ in leg stance, both are a neutral standing pose.
  const legRest: Vec3 = { x: 0, y: -1, z: 0 };
  // See clampQuatAngle's own comment: hip/knee landmark noise, not real
  // anatomy, is what actually produces a delta anywhere near this bound.
  const MAX_LEG_BEND_RAD = (100 * Math.PI) / 180;
  const lLegDir = localDir(lH, lK);
  const rLegDir = localDir(rH, rK);
  const lUpLeg = lLegDir ? clampQuatAngle(setFromUnitVectors(legRest, lLegDir), MAX_LEG_BEND_RAD) : IDENTITY_QUAT;
  const rUpLeg = rLegDir ? clampQuatAngle(setFromUnitVectors(legRest, rLegDir), MAX_LEG_BEND_RAD) : IDENTITY_QUAT;
  boneRotations['LeftUpLeg'] = lUpLeg;
  boneRotations['RightUpLeg'] = rUpLeg;

  // Lower legs: knee -> ankle, expressed relative to the upper leg (the parent in the chain).
  const lCalfDir = localDir(lK, lA);
  const rCalfDir = localDir(rK, rA);
  boneRotations['LeftLeg'] = lCalfDir
    ? clampQuatAngle(multiplyQuat(invertQuat(lUpLeg), setFromUnitVectors(legRest, lCalfDir)), MAX_LEG_BEND_RAD)
    : IDENTITY_QUAT;
  boneRotations['RightLeg'] = rCalfDir
    ? clampQuatAngle(multiplyQuat(invertQuat(rUpLeg), setFromUnitVectors(legRest, rCalfDir)), MAX_LEG_BEND_RAD)
    : IDENTITY_QUAT;

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
  restPose: 'T_POSE' | 'A_POSE' | 'CUSTOM' = 'T_POSE'
): Record<string, Quaternion> {
  if (!worldLandmarks || worldLandmarks.length < 33) return {};
  return calculateBoneRotationsFromCanonical(normalizePose(worldLandmarks), restPose);
}
