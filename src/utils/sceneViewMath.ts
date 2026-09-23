import type { Quaternion, Vec3 } from '../types/pose';
import type { CameraCalibration } from '../types/arRenderState';
import { applyQuatToVec } from './poseNormalizer';

export type Joint = { x: number; y: number };

export interface SceneViewProjectionResult {
  position: Vec3;
  rotation: Quaternion;
  rotationEulerDeg: [number, number, number];
  scale: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  distance: number;
  fov: number;
  aspect: number;
}

/**
 * Converts a unit quaternion into Euler angles in degrees [pitch, yaw, roll]
 * suitable for SceneView rotation props.
 */
export function quaternionToSceneViewEulerDeg(q: Quaternion): [number, number, number] {
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(norm) || norm < 1e-8) {
    return [0, 0, 0];
  }
  const x = q.x / norm;
  const y = q.y / norm;
  const z = q.z / norm;
  const w = q.w / norm;

  const toDeg = 180 / Math.PI;

  // Rotation around X axis (pitch)
  const sinX = 2 * (w * x - y * z);
  let rotX = 0;
  if (Math.abs(sinX) >= 1) {
    rotX = Math.sign(sinX) * 90;
  } else {
    rotX = Math.asin(sinX) * toDeg;
  }

  // Rotation around Y axis (yaw)
  const sinY_cosX = 2 * (w * y + z * x);
  const cosY_cosX = 1 - 2 * (x * x + y * y);
  const rotY = Math.atan2(sinY_cosX, cosY_cosX) * toDeg;

  // Rotation around Z axis (roll)
  const sinZ_cosX = 2 * (w * z + x * y);
  const cosZ_cosX = 1 - 2 * (x * x + z * z);
  const rotZ = Math.atan2(sinZ_cosX, cosZ_cosX) * toDeg;

  return [
    Number.isFinite(rotX) ? rotX : 0,
    Number.isFinite(rotY) ? rotY : 0,
    Number.isFinite(rotZ) ? rotZ : 0,
  ];
}

/**
 * SLERP interpolation for smooth quaternion transitions between frames.
 */
export function slerpQuaternion(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (dot < 0) {
    b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    dot = -dot;
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  if (theta < 1e-6) return b;
  const sin = Math.sin(theta);
  const u = Math.sin((1 - t) * theta) / sin;
  const v = Math.sin(t * theta) / sin;
  const q = {
    x: a.x * u + b.x * v,
    y: a.y * u + b.y * v,
    z: a.z * u + b.z * v,
    w: a.w * u + b.w * v,
  };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return n > 0 ? { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n } : b;
}

/**
 * Projection class that maps physical camera calibration and MediaPipe shoulder landmarks
 * into 3D metric world space for SceneView.
 */
export class SceneViewProjection {
  private cosYaw: number | null = null;
  private reliableCos = 0.65;
  private previous: SceneViewProjectionResult | null = null;
  private distance: number;

  constructor(private calibration?: CameraCalibration) {
    if (
      calibration &&
      (!Object.values(calibration).every((v) => Number.isFinite(v) && v > 0) ||
        calibration.verticalFovDeg >= 180)
    ) {
      this.calibration = undefined;
    }
    this.distance = this.calibration ? 0.6 : 3.0;
  }

  update(
    left: Joint,
    right: Joint,
    rotation: Quaternion,
    width: number,
    height: number,
    metricWidth: number,
    fitModifier: number = 1,
    options?: {
      isBottomGarment?: boolean;
      shoulders?: { left: Joint; right: Joint };
      legLength?: { kneeL?: Joint; ankleL?: Joint; kneeR?: Joint; ankleR?: Joint; authoredLength?: number };
    }
  ): SceneViewProjectionResult | null {
    if (
      ![left.x, left.y, right.x, right.y, rotation.x, rotation.y, rotation.z, rotation.w, width, height, metricWidth, fitModifier]
        .every(Number.isFinite) ||
      Math.min(width, height, metricWidth, fitModifier) <= 0
    ) {
      return null;
    }

    const { x, y, z, w } = rotation;
    if (Math.hypot(x, y, z, w) < 1e-8) return null;

    // Yaw cosine floor for turning stability
    const yaw =
      Math.abs(2 * (y * z - x * w)) < 0.9999999
        ? Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y))
        : Math.atan2(-2 * (x * z - y * w), 1 - 2 * (y * y + z * z));
    const rawCos = Math.abs(Math.cos(yaw));
    this.cosYaw = this.cosYaw === null ? rawCos : this.cosYaw + (rawCos - this.cosYaw) * 0.25;
    if (this.cosYaw >= 0.65) this.reliableCos = this.cosYaw;

    const c = this.calibration;
    if (c) {
      const distJointL = options?.shoulders ? options.shoulders.left : left;
      const distJointR = options?.shoulders ? options.shoulders.right : right;
      const dx = (distJointR.x - distJointL.x) * c.videoWidthPx;
      const dy = (distJointR.y - distJointL.y) * c.videoHeightPx;
      const pixels = Math.hypot(dx, dy);
      const raw = ((c.wearerShoulderWidthM * c.focalLengthPx) / pixels) * this.reliableCos;
      if (pixels > 1 && Math.abs(dx) > Math.abs(dy) && raw > 0.2 && raw < 2.5) {
        this.distance += (Math.max(this.distance * 0.6, Math.min(this.distance * 1.4, raw)) - this.distance) * 0.15;
      }
    }

    const aspect = c ? c.videoWidthPx / c.videoHeightPx : width / height;
    const fov = c?.verticalFovDeg ?? 45;
    const halfHeight = this.distance * Math.tan((fov * Math.PI) / 360);

    const unproject = (point: Joint): Vec3 => {
      const visW = c ? Math.min(1, width / height / aspect) : 1;
      const visH = c ? Math.min(1, aspect / (width / height)) : 1;
      const nx = (Math.max(0, Math.min(1, point.x)) - (1 - visW) / 2) / visW;
      const ny = (Math.max(0, Math.min(1, point.y)) - (1 - visH) / 2) / visH;
      return {
        x: (2 * nx - 1) * halfHeight * aspect,
        y: (1 - 2 * ny) * halfHeight,
        z: 0,
      };
    };

    const position = unproject({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
    const l = unproject(left);
    const r = unproject(right);

    const isBottom = options?.isBottomGarment ?? false;
    const HIP_TO_SILHOUETTE_RATIO = isBottom ? 1.78 : 1.0;
    const GARMENT_EASE = isBottom ? 1.08 : 1.0;

    const baseWorldWidth = Math.hypot(l.x - r.x, l.y - r.y) * HIP_TO_SILHOUETTE_RATIO * GARMENT_EASE;
    const scaleX = (baseWorldWidth / this.reliableCos / metricWidth) * fitModifier;
    const scaleZ = scaleX;
    let scaleY = scaleX;

    if (isBottom && options?.legLength) {
      const { kneeL, ankleL, kneeR, ankleR, authoredLength } = options.legLength;
      let legLen = 0;
      let count = 0;
      if (kneeL && ankleL) {
        const uKneeL = unproject(kneeL);
        const uAnkleL = unproject(ankleL);
        legLen += Math.hypot(uKneeL.x - l.x, uKneeL.y - l.y) + Math.hypot(uAnkleL.x - uKneeL.x, uAnkleL.y - uKneeL.y);
        count++;
      }
      if (kneeR && ankleR) {
        const uKneeR = unproject(kneeR);
        const uAnkleR = unproject(ankleR);
        legLen += Math.hypot(uKneeR.x - r.x, uKneeR.y - r.y) + Math.hypot(uAnkleR.x - uKneeR.x, uAnkleR.y - uKneeR.y);
        count++;
      }
      if (count > 0 && authoredLength && authoredLength > 0) {
        legLen /= count;
        const rawScaleY = (legLen / authoredLength) * fitModifier;
        scaleY = Math.max(scaleX * 0.85, Math.min(scaleX * 1.25, rawScaleY));
      }
    }

    if (!Number.isFinite(scaleX) || scaleX <= 0) return null;

    const prev = this.previous;
    const smoothedPos: Vec3 = prev
      ? {
          x: prev.position.x + (position.x - prev.position.x) * 0.25,
          y: prev.position.y + (position.y - prev.position.y) * 0.25,
          z: 0,
        }
      : position;

    const smoothedScale = prev ? prev.scale + (scaleX - prev.scale) * 0.25 : scaleX;
    const smoothedScaleX = prev ? prev.scaleX + (scaleX - prev.scaleX) * 0.25 : scaleX;
    const smoothedScaleY = prev ? prev.scaleY + (scaleY - prev.scaleY) * 0.25 : scaleY;
    const smoothedScaleZ = prev ? prev.scaleZ + (scaleZ - prev.scaleZ) * 0.25 : scaleZ;
    const smoothedRot = prev ? slerpQuaternion(prev.rotation, rotation, 0.25) : rotation;
    const eulerDeg = quaternionToSceneViewEulerDeg(smoothedRot);

    const result: SceneViewProjectionResult = {
      position: smoothedPos,
      rotation: smoothedRot,
      rotationEulerDeg: eulerDeg,
      scale: smoothedScale,
      scaleX: smoothedScaleX,
      scaleY: smoothedScaleY,
      scaleZ: smoothedScaleZ,
      distance: this.distance,
      aspect,
      fov,
    };
    this.previous = result;
    return result;
  }
}

/**
 * Computes the anchored 3D position of the garment applying the calibrated anatomical anchor offset.
 */
export function computeSceneViewAnchoredPosition(
  projection: SceneViewProjectionResult,
  anchor: Vec3
): [number, number, number] {
  const offset = applyQuatToVec(projection.rotation, anchor);
  return [
    projection.position.x - offset.x * (projection.scaleX ?? projection.scale),
    projection.position.y - offset.y * (projection.scaleY ?? projection.scale),
    projection.position.z - offset.z * (projection.scaleZ ?? projection.scale),
  ];
}
