import type { WorldLandmark } from './poseDetector';
import type { Quaternion, Vec3 } from '../types/pose';

/**
 * poseNormalizer -- the single seam between raw pose-detector output and every
 * downstream AR module (garmentFitter, skeletalRetargeter, GarmentRenderer).
 *
 * WHY THIS EXISTS (P0-D):
 * Before this file, each consumer did its own ad-hoc conversion out of MediaPipe
 * space, and the torso orientation had no single owner: garmentFitter produced a
 * roll-only quaternion for the whole garment, while skeletalRetargeter independently
 * drove the Spine bone from the full 3D hip->shoulder direction. Those two pivot about
 * DIFFERENT points (the shoulder anchor vs. the hip) and both contain the roll
 * component, so bending at the hips sent the garment somewhere neither of them meant.
 *
 * THE CONTRACT
 * ------------
 * Canonical space is Three.js space: X right, Y up, Z toward the viewer, right-handed,
 * metres. MediaPipe world space is X right, Y DOWN, Z away-from-camera, metres, with
 * the origin between the hips. The conversion is therefore (x, -y, -z) -- the same
 * negation that used to be open-coded at every call site in skeletalRetargeter.
 *
 * Canonical space is the RAW, UNMIRRORED camera frame. The preview mirrors the video
 * and the garment layer together with a single CSS scaleX(-1) after rendering, so no
 * mirroring belongs anywhere in here.
 */

export const CANONICAL_SPACE_VERSION = 'canonical-v1';

/** Landmark indices this module depends on. */
export const LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

/** Below this visibility a landmark is treated as absent rather than trusted. */
export const MIN_JOINT_VISIBILITY = 0.3;

/**
 * Shoulder axis and torso axis this close to parallel means the basis is degenerate
 * (subject folded flat, or landmarks collapsed onto each other) and its cross product
 * is numerically meaningless. sin(angle) below this -> report the torso as invalid.
 */
const MIN_BASIS_SEPARATION = 0.05;

export interface CanonicalJoint extends Vec3 {
  confidence: number;
}

export interface CanonicalTorso {
  /** Shoulder midpoint, canonical metres. The garment anchor point. */
  origin: Vec3;
  /** Unit basis vectors. xAxis ~ (1,0,0), yAxis ~ (0,1,0), zAxis ~ (0,0,1) when upright and facing the camera. */
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
  /**
   * Rotation taking canonical rest orientation to the live torso orientation.
   * Identity for an upright subject squarely facing the camera. This is the ONE
   * value that owns the garment global rotation -- nothing downstream may add
   * its own roll/pitch/yaw on top of it.
   */
  quaternion: Quaternion;
  /** False when the landmarks were missing, low-confidence, or geometrically degenerate. */
  valid: boolean;
}

export interface CanonicalPose {
  space: typeof CANONICAL_SPACE_VERSION;
  /** MediaPipe-indexed joints converted to canonical space; null where not trusted. */
  joints: (CanonicalJoint | null)[];
  torso: CanonicalTorso;
  /** Mean shoulder visibility [0,1]. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Vector / quaternion helpers. Exported so downstream modules share ONE
// implementation instead of each carrying a private copy.
// ---------------------------------------------------------------------------

export const IDENTITY_QUAT: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

export function normalizeVec(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthVec(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function invertQuat(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function multiplyQuat(q1: Quaternion, q2: Quaternion): Quaternion {
  return {
    x: q1.x * q2.w + q1.w * q2.x + q1.y * q2.z - q1.z * q2.y,
    y: q1.y * q2.w + q1.w * q2.y + q1.z * q2.x - q1.x * q2.z,
    z: q1.z * q2.w + q1.w * q2.z + q1.x * q2.y - q1.y * q2.x,
    w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
  };
}

/** Rotates a vector by a quaternion. */
export function applyQuatToVec(q: Quaternion, v: Vec3): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/**
 * Builds a quaternion from an orthonormal basis whose vectors are the COLUMNS of the
 * rotation matrix (i.e. the images of local +X/+Y/+Z). Same algorithm as
 * THREE.Quaternion.setFromRotationMatrix, inlined so this module stays dependency-free
 * and unit-testable outside a WebGL context.
 */
export function quaternionFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quaternion {
  const m11 = xAxis.x, m12 = yAxis.x, m13 = zAxis.x;
  const m21 = xAxis.y, m22 = yAxis.y, m23 = zAxis.y;
  const m31 = xAxis.z, m32 = yAxis.z, m33 = zAxis.z;
  const trace = m11 + m22 + m33;

  // Each branch's sqrt argument is algebraically >= 0 for a perfectly orthonormal basis,
  // but xAxis/yAxis/zAxis are Gram-Schmidt'd from noisy landmark cross products (see
  // normalizePose) -- never bit-exact orthonormal. At a large rotation angle (a torso
  // bend), floating-point error can push an argument fractionally negative right at a
  // branch boundary, producing NaN. A NaN quaternion silently poisons GarmentRenderer's
  // slerp-based smoothing PERMANENTLY (confirmed live: garment vanishes on a bend and
  // never recovers without a reload, because slerp always mixes in its own current
  // value -- there is no self-healing on the next good frame). Clamp with a small
  // epsilon rather than 0 so `s` is never exactly zero either (that would produce
  // Infinity instead of NaN from the divisions below -- equally fatal).
  const EPS = 1e-12;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(Math.max(EPS, trace + 1.0));
    return { w: 0.25 / s, x: (m32 - m23) * s, y: (m13 - m31) * s, z: (m21 - m12) * s };
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(Math.max(EPS, 1.0 + m11 - m22 - m33));
    return { w: (m32 - m23) / s, x: 0.25 * s, y: (m12 + m21) / s, z: (m13 + m31) / s };
  }
  if (m22 > m33) {
    const s = 2.0 * Math.sqrt(Math.max(EPS, 1.0 + m22 - m11 - m33));
    return { w: (m13 - m31) / s, x: (m12 + m21) / s, y: 0.25 * s, z: (m23 + m32) / s };
  }
  const s = 2.0 * Math.sqrt(Math.max(EPS, 1.0 + m33 - m11 - m22));
  return { w: (m21 - m12) / s, x: (m13 + m31) / s, y: (m23 + m32) / s, z: 0.25 * s };
}

/** Euler readout in DEGREES, for diagnostics only -- never for math. */
export function torsoEulerDegrees(t: CanonicalTorso): { pitch: number; yaw: number; roll: number } {
  const toDeg = 180 / Math.PI;
  return {
    // Tilt of the chest normal above horizontal: bending forward drops it, so a
    // forward bend reads as NEGATIVE pitch.
    pitch: Math.atan2(t.zAxis.y, Math.sqrt(t.zAxis.x * t.zAxis.x + t.zAxis.z * t.zAxis.z)) * toDeg,
    // Turning left/right about the vertical.
    yaw: Math.atan2(t.zAxis.x, t.zAxis.z) * toDeg,
    // Shoulder-line tilt in the image plane.
    roll: Math.atan2(t.xAxis.y, t.xAxis.x) * toDeg,
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** MediaPipe world point -> canonical point. The ONLY place this negation lives. */
function toCanonical(p: WorldLandmark): CanonicalJoint {
  return { x: p.x, y: -p.y, z: -(p.z ?? 0), confidence: p.visibility ?? 0 };
}

const INVALID_TORSO: CanonicalTorso = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
  quaternion: IDENTITY_QUAT,
  valid: false,
};

/**
 * Converts raw MediaPipe world landmarks into the canonical pose every downstream
 * AR module consumes.
 *
 * The torso basis is built from the shoulder line and the hip->shoulder line, then
 * Gram-Schmidt orthonormalized so the shoulder line (the axis the garment fit is
 * calibrated against) is preserved exactly and any non-perpendicularity is absorbed
 * by the up axis.
 */
export function normalizePose(
  worldLandmarks: WorldLandmark[] | null | undefined,
  minVisibility: number = MIN_JOINT_VISIBILITY
): CanonicalPose {
  const joints: (CanonicalJoint | null)[] = new Array(33).fill(null);

  if (!worldLandmarks || worldLandmarks.length < 33) {
    return { space: CANONICAL_SPACE_VERSION, joints, torso: INVALID_TORSO, confidence: 0 };
  }

  for (let i = 0; i < 33; i++) {
    const p = worldLandmarks[i];
    if (!p) continue;
    const vis = p.visibility ?? (p as any).presence ?? 0;
    if (vis < minVisibility) continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z ?? 0)) continue;
    joints[i] = toCanonical(p);
  }

  const lS = joints[LM.leftShoulder];
  const rS = joints[LM.rightShoulder];
  const lH = joints[LM.leftHip];
  const rH = joints[LM.rightHip];

  const confidence = ((lS?.confidence ?? 0) + (rS?.confidence ?? 0)) / 2;

  if (!lS || !rS || !lH || !rH) {
    return { space: CANONICAL_SPACE_VERSION, joints, torso: INVALID_TORSO, confidence };
  }

  const midShoulder: Vec3 = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2, z: (lS.z + rS.z) / 2 };
  const midHip: Vec3 = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2, z: (lH.z + rH.z) / 2 };

  // +X: left shoulder minus right shoulder. MediaPipe raw unmirrored frame puts the
  // subject own LEFT shoulder (11) at the LARGER x, so this points along canonical +X
  // for an upright subject -- which is also the direction skeletalRetargeter T-pose
  // left-arm rest vector (1,0,0) points, keeping arm rest directions and torso basis
  // on one convention.
  const xRaw = subVec(lS, rS);
  const upRaw = subVec(midShoulder, midHip);
  if (lengthVec(xRaw) < 1e-6 || lengthVec(upRaw) < 1e-6) {
    return {
      space: CANONICAL_SPACE_VERSION,
      joints,
      torso: { ...INVALID_TORSO, origin: midShoulder },
      confidence,
    };
  }

  const xAxis = normalizeVec(xRaw);
  const upHint = normalizeVec(upRaw);

  // zAxis (out of the chest, toward the viewer at rest) = xAxis X upHint.
  // Its length is sin(angle between them): near zero means the two source lines are
  // parallel and the basis carries no real orientation.
  const zRaw = crossVec(xAxis, upHint);
  if (lengthVec(zRaw) < MIN_BASIS_SEPARATION) {
    return {
      space: CANONICAL_SPACE_VERSION,
      joints,
      torso: { ...INVALID_TORSO, origin: midShoulder },
      confidence,
    };
  }
  const zAxis = normalizeVec(zRaw);
  const yAxis = normalizeVec(crossVec(zAxis, xAxis));

  return {
    space: CANONICAL_SPACE_VERSION,
    joints,
    torso: {
      origin: midShoulder,
      xAxis,
      yAxis,
      zAxis,
      quaternion: quaternionFromBasis(xAxis, yAxis, zAxis),
      valid: true,
    },
    confidence,
  };
}

/** Rotates a canonical-space vector into the torso own frame. */
export function toTorsoLocal(torso: CanonicalTorso, v: Vec3): Vec3 {
  if (!torso.valid) return v;
  return applyQuatToVec(invertQuat(torso.quaternion), v);
}
