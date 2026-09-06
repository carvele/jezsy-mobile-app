import type { Quaternion, Vec3 } from '../types/pose';
import type { GarmentRendererProps } from '../components/AR/GarmentRenderer';
import { applyQuatToVec, invertQuat, multiplyQuat, quaternionFromBasis } from './poseNormalizer';

export type Calibration = NonNullable<GarmentRendererProps['cameraCalibration']>;
export type Joint = { x: number; y: number };
export type Projection = { position: Vec3; rotation: Quaternion; scale: number; distance: number; fov: number; aspect: number };

export function axisAngle(q: Quaternion): { angle: number; axis: [number, number, number] } {
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(norm) || norm < 1e-9) throw new Error('Invalid rotation');
  const w = Math.max(-1, Math.min(1, q.w / norm));
  const sin = Math.sqrt(1 - w * w);
  return sin < 1e-8 ? { angle: 0, axis: [1, 0, 0] }
    : { angle: 2 * Math.acos(w), axis: [q.x / norm / sin, q.y / norm / sin, q.z / norm / sin] };
}

export function rotationFromMatrix(m: readonly number[]): Quaternion {
  const x = Math.hypot(m[0], m[1], m[2]);
  const y = Math.hypot(m[4], m[5], m[6]);
  const z = Math.hypot(m[8], m[9], m[10]);
  if (m.length !== 16 || !m.every(Number.isFinite) || Math.min(x, y, z) < 1e-8) throw new Error('Invalid bind transform');
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (determinant <= 0 || Math.abs((m[0] * m[4] + m[1] * m[5] + m[2] * m[6]) / x / y) > 0.001
    || Math.abs((m[0] * m[8] + m[1] * m[9] + m[2] * m[10]) / x / z) > 0.001
    || Math.abs((m[4] * m[8] + m[5] * m[9] + m[6] * m[10]) / y / z) > 0.001) throw new Error('Reflected or sheared bind transforms are unsupported in this experiment');
  return quaternionFromBasis({ x: m[0] / x, y: m[1] / x, z: m[2] / x },
    { x: m[4] / y, y: m[5] / y, z: m[6] / y }, { x: m[8] / z, y: m[9] / z, z: m[10] / z });
}

export function correctBindRotation(local: Quaternion, world: Quaternion, delta: Quaternion): Quaternion {
  const parent = multiplyQuat(world, invertQuat(local));
  return multiplyQuat(multiplyQuat(invertQuat(parent), delta), world);
}

function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (dot < 0) { b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; dot = -dot; }
  const theta = Math.acos(Math.min(1, dot));
  const sin = Math.sin(theta);
  const u = sin < 1e-6 ? 1 - t : Math.sin((1 - t) * theta) / sin;
  const v = sin < 1e-6 ? t : Math.sin(t * theta) / sin;
  const q = { x: a.x * u + b.x * v, y: a.y * u + b.y * v, z: a.z * u + b.z * v, w: a.w * u + b.w * v };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

// Experimental port of the existing renderer's projection; the Three.js implementation remains the reference.
export class FilamentProjection {
  private cosYaw: number | null = null;
  private reliableCos = 0.65;
  private previous: Projection | null = null;
  private distance: number;

  constructor(private calibration?: Calibration) {
    if (calibration && (!Object.values(calibration).every((value) => Number.isFinite(value) && value > 0)
      || calibration.verticalFovDeg >= 180)) this.calibration = undefined;
    this.distance = this.calibration ? 0.6 : 5;
  }

  update(left: Joint, right: Joint, rotation: Quaternion, width: number, height: number, metricWidth: number, fit = 1): Projection | null {
    if (![left.x, left.y, right.x, right.y, rotation.x, rotation.y, rotation.z, rotation.w, width, height, metricWidth, fit]
      .every(Number.isFinite) || Math.min(width, height, metricWidth, fit) <= 0) return null;
    const { x, y, z, w } = rotation;
    if (Math.hypot(x, y, z, w) < 1e-8) return null;
    const yaw = Math.abs(2 * (y * z - x * w)) < 0.9999999
      ? Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y))
      : Math.atan2(-2 * (x * z - y * w), 1 - 2 * (y * y + z * z));
    const rawCos = Math.abs(Math.cos(yaw));
    this.cosYaw = this.cosYaw === null ? rawCos : this.cosYaw + (rawCos - this.cosYaw) * 0.25;
    if (this.cosYaw >= 0.65) this.reliableCos = this.cosYaw;
    const c = this.calibration;
    if (c) {
      const dx = (right.x - left.x) * c.videoWidthPx;
      const dy = (right.y - left.y) * c.videoHeightPx;
      const pixels = Math.hypot(dx, dy);
      const raw = c.wearerShoulderWidthM * c.focalLengthPx / pixels * this.reliableCos;
      if (pixels > 1 && Math.abs(dx) > Math.abs(dy) && raw > 0.2 && raw < 2.5) {
        this.distance += (Math.max(this.distance * 0.6, Math.min(this.distance * 1.4, raw)) - this.distance) * 0.15;
      }
    }
    const aspect = c ? c.videoWidthPx / c.videoHeightPx : width / height;
    const fov = c?.verticalFovDeg ?? 45;
    const halfHeight = this.distance * Math.tan(fov * Math.PI / 360);
    const unproject = (point: Joint): Vec3 => {
      const visW = c ? Math.min(1, width / height / aspect) : 1;
      const visH = c ? Math.min(1, aspect / (width / height)) : 1;
      const nx = (Math.max(0, Math.min(1, point.x)) - (1 - visW) / 2) / visW;
      const ny = (Math.max(0, Math.min(1, point.y)) - (1 - visH) / 2) / visH;
      return { x: (2 * nx - 1) * halfHeight * aspect, y: (1 - 2 * ny) * halfHeight, z: 0 };
    };
    const position = unproject({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
    const l = unproject(left), r = unproject(right);
    const scale = Math.hypot(l.x - r.x, l.y - r.y) / this.reliableCos / metricWidth * fit;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const p = this.previous;
    const next: Projection = { position: p ? { x: p.position.x + (position.x - p.position.x) * 0.25,
      y: p.position.y + (position.y - p.position.y) * 0.25, z: 0 } : position,
      scale: p ? p.scale + (scale - p.scale) * 0.25 : scale, rotation: p ? slerp(p.rotation, rotation, 0.25) : rotation,
      distance: this.distance, aspect, fov };
    this.previous = next;
    return next;
  }
}

export function anchoredPosition(projection: Projection, anchor: Vec3): [number, number, number] {
  const offset = applyQuatToVec(projection.rotation, anchor);
  return [projection.position.x - offset.x * projection.scale, projection.position.y - offset.y * projection.scale,
    projection.position.z - offset.z * projection.scale];
}
