import type { Quaternion, Vec3 } from '../types/pose';
import type { GarmentMetadata } from '../types/garment';
import {
  multiplyQuat,
  invertQuat,
  applyQuatToVec,
  IDENTITY_QUAT,
} from './poseNormalizer';

export interface BindTransform {
  boneName: string;
  mappedEntityName: string;
  localRotation: Quaternion;
  worldRotation: Quaternion;
  position: [number, number, number];
  scale: [number, number, number];
}

export interface BoneLocalTransform {
  boneName: string;
  mappedEntityName: string;
  rotation: Quaternion;
  eulerDeg: [number, number, number];
  position: [number, number, number];
  scale: [number, number, number];
  matrix16: number[];
}

export interface RetargetingSessionState {
  resolvedBones: Map<string, string>; // Canonical -> Mapped GLB Bone Name
  bindTransforms: Map<string, BindTransform>; // Mapped Bone Name -> Initial Bind Transform
  isInitialized: boolean;
  activeBonesCount: number;
}

/**
 * Standard Mixamo canonical arm and spine bones required for garment deformation.
 */
export const REQUIRED_GARMENT_BONES = [
  'mixamorigLeftArm',
  'mixamorigRightArm',
  'mixamorigLeftForeArm',
  'mixamorigRightForeArm',
  'mixamorigSpine',
] as const;

/**
 * Resolves canonical bone names to authored GLB bone names using garment_metadata.boneMap.
 * Cached once on model load to avoid per-frame string lookups.
 */
export function resolveBoneMapIndicesOnce(
  metadata?: GarmentMetadata
): Map<string, string> {
  const map = new Map<string, string>();
  const boneMap = metadata?.boneMap || {};

  // Standard mappings
  const canonicalAliases: Record<string, string> = {
    LeftArm: 'mixamorigLeftArm',
    RightArm: 'mixamorigRightArm',
    LeftForeArm: 'mixamorigLeftForeArm',
    RightForeArm: 'mixamorigRightForeArm',
    Spine: 'mixamorigSpine',
  };

  for (const [canonicalKey, defaultName] of Object.entries(canonicalAliases)) {
    const mapped = boneMap[canonicalKey] || defaultName;
    map.set(canonicalKey, mapped);
    map.set(defaultName, mapped);
  }

  return map;
}

/**
 * Corrects rest-pose relative rotation deltas against bind pose.
 * Invert parent frame so delta applies purely in the bone's local joint space:
 * Local' = invert(Parent) * Delta * World
 * When Delta is identity (neutral pose): Local' returns precisely to bind.local.
 */
export function computeLocalBindRelativeRotation(
  bindLocal: Quaternion,
  bindWorld: Quaternion,
  deltaRotation: Quaternion
): Quaternion {
  // Normalize delta quaternion to prevent drift
  const norm = Math.hypot(deltaRotation.x, deltaRotation.y, deltaRotation.z, deltaRotation.w);
  const safeDelta =
    norm > 1e-6
      ? {
          x: deltaRotation.x / norm,
          y: deltaRotation.y / norm,
          z: deltaRotation.z / norm,
          w: deltaRotation.w / norm,
        }
      : IDENTITY_QUAT;

  // Parent rotation = World * Invert(Local)
  const parentRotation = multiplyQuat(bindWorld, invertQuat(bindLocal));
  const corrected = multiplyQuat(
    multiplyQuat(invertQuat(parentRotation), safeDelta),
    bindWorld
  );

  const cNorm = Math.hypot(corrected.x, corrected.y, corrected.z, corrected.w);
  return cNorm > 1e-6
    ? {
        x: corrected.x / cNorm,
        y: corrected.y / cNorm,
        z: corrected.z / cNorm,
        w: corrected.w / cNorm,
      }
    : bindLocal;
}

/**
 * Builds a column-major 4x4 matrix from scale, rotation quaternion, and translation.
 * Matches Filament and glTF column-major matrix conventions.
 */
export function composeMatrix4x4(
  scale: [number, number, number],
  rotation: Quaternion,
  translation: [number, number, number]
): number[] {
  const [sx, sy, sz] = scale;
  const { x, y, z, w } = rotation;
  const [tx, ty, tz] = translation;

  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,

    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,

    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,

    tx,
    ty,
    tz,
    1,
  ];
}

/**
 * Retargeting engine for per-frame skeletal bone updates.
 */
export class SceneViewSkeletalRetargeter {
  private resolvedBoneMap: Map<string, string>;
  private bindTransforms = new Map<string, BindTransform>();
  private isInitialized = false;

  constructor(private metadata?: GarmentMetadata) {
    this.resolvedBoneMap = resolveBoneMapIndicesOnce(metadata);
  }

  /**
   * Registers initial bind transforms captured from the loaded GLB mesh.
   */
  public registerBindTransform(bind: BindTransform): void {
    this.bindTransforms.set(bind.mappedEntityName, bind);
    this.bindTransforms.set(bind.boneName, bind);
    this.isInitialized = true;
  }

  /**
   * Evaluates per-frame bone updates from skeletal retargeter quaternions.
   */
  public computePerFrameBoneTransforms(
    boneRotations: Record<string, Quaternion>
  ): BoneLocalTransform[] {
    const transforms: BoneLocalTransform[] = [];

    for (const canonicalName of REQUIRED_GARMENT_BONES) {
      const mappedName = this.resolvedBoneMap.get(canonicalName) || canonicalName;
      const bind = this.bindTransforms.get(mappedName);

      // Default to bind pose if bone has no delta or bind transform not yet registered
      const delta = boneRotations[canonicalName] || boneRotations[mappedName] || IDENTITY_QUAT;

      const bindLocal = bind ? bind.localRotation : IDENTITY_QUAT;
      const bindWorld = bind ? bind.worldRotation : IDENTITY_QUAT;
      const pos: [number, number, number] = bind ? bind.position : [0, 0, 0];
      const scale: [number, number, number] = bind ? bind.scale : [1, 1, 1];

      // Compute relative rotation
      const newLocalRot = bind
        ? computeLocalBindRelativeRotation(bindLocal, bindWorld, delta)
        : delta;

      // Convert to Euler for SceneView
      const euler = quaternionToEuler(newLocalRot);
      const matrix = composeMatrix4x4(scale, newLocalRot, pos);

      transforms.push({
        boneName: canonicalName,
        mappedEntityName: mappedName,
        rotation: newLocalRot,
        eulerDeg: euler,
        position: pos,
        scale: scale,
        matrix16: matrix,
      });
    }

    return transforms;
  }

  public getResolvedBoneName(canonical: string): string {
    return this.resolvedBoneMap.get(canonical) || canonical;
  }

  public getActiveBoneCount(): number {
    return this.bindTransforms.size;
  }

  public isReady(): boolean {
    return this.isInitialized;
  }
}

function quaternionToEuler(q: Quaternion): [number, number, number] {
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (norm < 1e-8) return [0, 0, 0];
  const x = q.x / norm;
  const y = q.y / norm;
  const z = q.z / norm;
  const w = q.w / norm;
  const toDeg = 180 / Math.PI;

  const sinX = 2 * (w * x - y * z);
  const rotX = Math.abs(sinX) >= 1 ? Math.sign(sinX) * 90 : Math.asin(sinX) * toDeg;
  const rotY = Math.atan2(2 * (w * y + z * x), 1 - 2 * (x * x + y * y)) * toDeg;
  const rotZ = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z)) * toDeg;

  return [rotX, rotY, rotZ];
}
