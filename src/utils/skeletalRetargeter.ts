import type { WorldLandmark } from './poseDetector';
import type { Quaternion } from '../types/pose';

// TEMP DEBUG: see the throttled log call inside calculateBoneRotations below.
let debugVisCounter = 0;

/**
 * Normalizes a 3D vector.
 */
function normalize(v: { x: number; y: number; z: number }) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Computes a quaternion representing a rotation from vector A to vector B.
 * Equivalent to THREE.Quaternion().setFromUnitVectors(vFrom, vTo).
 */
export function setFromUnitVectors(vFrom: { x: number; y: number; z: number }, vTo: { x: number; y: number; z: number }): Quaternion {
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
 * Calculates local bone quaternions from MediaPipe world landmarks to feed into Three.js.
 * 
 * MediaPipe World Coordinate Handedness:
 * X right (subject's left is +X if facing camera)
 * Y down
 * Z forward (negative Z is closer to camera)
 * 
 * Three.js World Coordinate Handedness:
 * X right
 * Y up
 * Z towards viewer (+Z is out of screen).
 */

/**
 * Inverts a quaternion.
 */
function invertQuat(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/**
 * Multiplies two quaternions (q1 * q2).
 */
function multiplyQuat(q1: Quaternion, q2: Quaternion): Quaternion {
  return {
    x: q1.x * q2.w + q1.w * q2.x + q1.y * q2.z - q1.z * q2.y,
    y: q1.y * q2.w + q1.w * q2.y + q1.z * q2.x - q1.x * q2.z,
    z: q1.z * q2.w + q1.w * q2.z + q1.x * q2.y - q1.y * q2.x,
    w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
  };
}

export function calculateBoneRotations(
worldLandmarks: WorldLandmark[], restPose: 'T_POSE' | 'A_POSE' | 'CUSTOM' = 'T_POSE'): Record<string, Quaternion> {
  const boneRotations: Record<string, Quaternion> = {};
  
  if (!worldLandmarks || worldLandmarks.length < 33) return boneRotations;

  // MediaPipe Landmark Indices
  const LEFT_SHOULDER = 11;
  const RIGHT_SHOULDER = 12;
  const LEFT_ELBOW = 13;
  const RIGHT_ELBOW = 14;
  const LEFT_WRIST = 15;
  const RIGHT_WRIST = 16;
  const LEFT_HIP = 23;
  const RIGHT_HIP = 24;
  
  const lS = worldLandmarks[LEFT_SHOULDER];
  const lE = worldLandmarks[LEFT_ELBOW];
  const lW = worldLandmarks[LEFT_WRIST];
  const rS = worldLandmarks[RIGHT_SHOULDER];
  const rE = worldLandmarks[RIGHT_ELBOW];
  const rW = worldLandmarks[RIGHT_WRIST];
  const lH = worldLandmarks[LEFT_HIP];
  const rH = worldLandmarks[RIGHT_HIP];


  const hasVis = (p: WorldLandmark) => p && p.visibility > 0.3;

  // TEMP DEBUG: throttled visibility dump -- remove once wrong-arm-response /
  // "only appears when both arms move" is root-caused. Tests whether hasVis()
  // is intermittently failing (causing arms to fall back to Spine's rotation
  // instead of their own) rather than the retargeting math itself being wrong.
  debugVisCounter++;
  if (debugVisCounter % 20 === 0) {
    console.log('[AR-DEBUG-VIS] lS=' + lS?.visibility?.toFixed(2) + ' lE=' + lE?.visibility?.toFixed(2)
      + ' lW=' + lW?.visibility?.toFixed(2) + ' rS=' + rS?.visibility?.toFixed(2)
      + ' rE=' + rE?.visibility?.toFixed(2) + ' rW=' + rW?.visibility?.toFixed(2)
      + ' | leftArmVisible=' + (hasVis(lS) && hasVis(lE)) + ' rightArmVisible=' + (hasVis(rS) && hasVis(rE)));
  }

  // We will compute WORLD quaternions first, then convert to LOCAL.
  const worldRotations: Record<string, Quaternion> = {};
  const identityQuat = { x: 0, y: 0, z: 0, w: 1 };

  // 1. SPINE (MidHip to MidShoulder)
  if (hasVis(lS) && hasVis(rS) && hasVis(lH) && hasVis(rH)) {
    const midHip = { x: (lH.x + rH.x) / 2, y: (lH.y + rH.y) / 2, z: (lH.z + rH.z) / 2 };
    const midShoulder = { x: (lS.x + rS.x) / 2, y: (lS.y + rS.y) / 2, z: (lS.z + rS.z) / 2 };
    const targetDir = normalize({ x: midShoulder.x - midHip.x, y: -(midShoulder.y - midHip.y), z: -(midShoulder.z - midHip.z) });
    worldRotations['Spine'] = setFromUnitVectors({ x: 0, y: 1, z: 0 }, targetDir);
  } else {
    worldRotations['Spine'] = identityQuat;
  }

  // Helper for Rest Directions
  let lArmRest = { x: 1, y: 0, z: 0 };
  let rArmRest = { x: -1, y: 0, z: 0 };
  if (restPose === 'A_POSE') {
    const angle = 35 * Math.PI / 180;
    lArmRest = { x: Math.cos(angle), y: -Math.sin(angle), z: 0 };
    rArmRest = { x: -Math.cos(angle), y: -Math.sin(angle), z: 0 };
  }

  // 2. LEFT UPPER ARM
  if (hasVis(lS) && hasVis(lE)) {
    const targetDir = normalize({ x: lE.x - lS.x, y: -(lE.y - lS.y), z: -(lE.z - lS.z) });
    worldRotations['LeftArm'] = setFromUnitVectors(lArmRest, targetDir);
  } else {
    worldRotations['LeftArm'] = worldRotations['Spine']; // fallback to spine's rotation if missing
  }

  // 3. LEFT FOREARM
  if (hasVis(lE) && hasVis(lW)) {
    const targetDir = normalize({ x: lW.x - lE.x, y: -(lW.y - lE.y), z: -(lW.z - lE.z) });
    worldRotations['LeftForeArm'] = setFromUnitVectors(lArmRest, targetDir);
  } else {
    worldRotations['LeftForeArm'] = worldRotations['LeftArm'];
  }

  // 4. RIGHT UPPER ARM
  if (hasVis(rS) && hasVis(rE)) {
    const targetDir = normalize({ x: rE.x - rS.x, y: -(rE.y - rS.y), z: -(rE.z - rS.z) });
    worldRotations['RightArm'] = setFromUnitVectors(rArmRest, targetDir);
  } else {
    worldRotations['RightArm'] = worldRotations['Spine'];
  }

  // 5. RIGHT FOREARM
  if (hasVis(rE) && hasVis(rW)) {
    const targetDir = normalize({ x: rW.x - rE.x, y: -(rW.y - rE.y), z: -(rW.z - rE.z) });
    worldRotations['RightForeArm'] = setFromUnitVectors(rArmRest, targetDir);
  } else {
    worldRotations['RightForeArm'] = worldRotations['RightArm'];
  }

  // Convert World Rotations to Local Rotations
  // Hierarchy: Spine -> Spine1 -> Spine2 -> Shoulder -> Arm -> ForeArm
  // Spine1/Spine2/Shoulder are intentionally left OUT of boneRotations rather than forced
  // to identity: their bind-pose local rotation is not identity in general (measured on a
  // real Mixamo-rigged GLB: Spine1/Spine2 ~0deg off identity, but LeftShoulder/RightShoulder
  // ~130deg off identity). Forcing them to identity overwrites that real bind rotation and
  // snaps the shoulder joint to a completely different orientation than the mesh was skinned
  // for, independent of any pose input -- confirmed as the cause of severe mesh distortion at
  // the shoulder/sleeve attachment. GarmentRenderer only writes bones present in this map, so
  // omitting a bone here leaves it at whatever quaternion the GLTFLoader set from the file.
  boneRotations['Spine'] = worldRotations['Spine'];

  const invSpine = invertQuat(worldRotations['Spine']);
  boneRotations['LeftArm'] = multiplyQuat(invSpine, worldRotations['LeftArm']);
  boneRotations['RightArm'] = multiplyQuat(invSpine, worldRotations['RightArm']);

  const invLeftArm = invertQuat(worldRotations['LeftArm']);
  boneRotations['LeftForeArm'] = multiplyQuat(invLeftArm, worldRotations['LeftForeArm']);

  const invRightArm = invertQuat(worldRotations['RightArm']);
  boneRotations['RightForeArm'] = multiplyQuat(invRightArm, worldRotations['RightForeArm']);

  return boneRotations;
}

