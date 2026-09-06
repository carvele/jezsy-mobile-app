import { anchoredPosition, axisAngle, correctBindRotation, FilamentProjection, rotationFromMatrix } from '../filamentExperimentMath';
import { filamentReplayFrame, FILAMENT_REPLAY_FRAMES } from '../filamentReplay';
import { IDENTITY_QUAT, multiplyQuat, normalizePose } from '../poseNormalizer';
import { calculateBoneRotationsFromCanonical } from '../skeletalRetargeter';

describe('Filament experimental projection', () => {
  const left = { x: 0.6, y: 0.35 }, right = { x: 0.4, y: 0.35 };
  it('preserves the uncalibrated 45 degree camera and shoulder-width scale', () => {
    const result = new FilamentProjection().update(left, right, IDENTITY_QUAT, 400, 800, 0.4)!;
    const halfHeight = 5 * Math.tan(Math.PI / 8);
    expect(result.distance).toBe(5);
    expect(result.fov).toBe(45);
    expect(result.position.x).toBeCloseTo(0);
    expect(result.position.y).toBeCloseTo(0.3 * halfHeight);
    expect(result.scale).toBeCloseTo(halfHeight * 0.5);
  });

  it('applies the selected size modifier exactly once', () => {
    const a = new FilamentProjection().update(left, right, IDENTITY_QUAT, 400, 800, 0.4, 1)!;
    const b = new FilamentProjection().update(left, right, IDENTITY_QUAT, 400, 800, 0.4, 1.2)!;
    expect(b.scale / a.scale).toBeCloseTo(1.2);
    expect(b.position).toEqual(a.position);
  });

  it('uses the existing calibrated bootstrap, aspect ratio, and bounded distance smoothing', () => {
    const calibration = { focalLengthPx: 1000, verticalFovDeg: 60, videoWidthPx: 720, videoHeightPx: 1280, wearerShoulderWidthM: 0.4 };
    const result = new FilamentProjection(calibration).update({ x: 0.75, y: 0.35 }, { x: 0.25, y: 0.35 }, IDENTITY_QUAT, 400, 800, 0.4)!;
    expect(result.distance).toBeCloseTo(0.636);
    expect(result.aspect).toBe(720 / 1280);
    expect(result.fov).toBe(60);
  });

  it('rejects malformed poses and degenerate shoulder widths', () => {
    expect(new FilamentProjection().update(left, left, IDENTITY_QUAT, 400, 800, 0.4)).toBeNull();
    expect(new FilamentProjection().update(left, right, { ...IDENTITY_QUAT, w: NaN }, 400, 800, 0.4)).toBeNull();
    expect(new FilamentProjection().update(left, right, IDENTITY_QUAT, 0, 800, 0.4)).toBeNull();
  });

  it('keeps translation unmirrored; the host mirrors the complete view once', () => {
    const result = new FilamentProjection().update({ x: 0.8, y: 0.35 }, { x: 0.6, y: 0.35 }, IDENTITY_QUAT, 400, 800, 0.4)!;
    expect(result.position.x).toBeGreaterThan(0);
  });

  it('moves the anatomical anchor to the shoulder without changing its rotation owner', () => {
    const result = new FilamentProjection().update(left, right, IDENTITY_QUAT, 400, 800, 0.4)!;
    const anchored = anchoredPosition(result, { x: 0, y: 0.5, z: 0 });
    expect(anchored[1] + 0.5 * result.scale).toBeCloseTo(result.position.y);
  });
});

describe('Filament arm bind correction', () => {
  it('identity delta restores the local bind rotation even with a rotated ancestor', () => {
    const local = { x: Math.sin(0.2), y: 0, z: 0, w: Math.cos(0.2) };
    const parent = { x: 0, y: Math.sin(0.3), z: 0, w: Math.cos(0.3) };
    const corrected = correctBindRotation(local, multiplyQuat(parent, local), IDENTITY_QUAT);
    expect(corrected.x).toBeCloseTo(local.x);
    expect(corrected.y).toBeCloseTo(local.y);
    expect(corrected.z).toBeCloseTo(local.z);
    expect(corrected.w).toBeCloseTo(local.w);
  });

  it('reads rotation independently of a positive bind scale', () => {
    const q = rotationFromMatrix([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]);
    expect(q).toEqual(IDENTITY_QUAT);
    expect(axisAngle(q)).toEqual({ angle: 0, axis: [1, 0, 0] });
  });

  it('rejects invalid native transform data', () => {
    expect(() => rotationFromMatrix([])).toThrow();
    expect(() => axisAngle({ x: 0, y: 0, z: 0, w: 0 })).toThrow();
  });
});

describe('synthetic comparison fixture', () => {
  it('is repeatable and produces valid existing canonical poses and four arm deltas', () => {
    for (let index = 0; index < FILAMENT_REPLAY_FRAMES; index++) {
      const frame = filamentReplayFrame(index);
      expect(frame.worldLandmarks).toEqual(filamentReplayFrame(index + FILAMENT_REPLAY_FRAMES).worldLandmarks);
      const pose = normalizePose(frame.worldLandmarks);
      expect(pose.torso.valid).toBe(true);
      const bones = calculateBoneRotationsFromCanonical(pose, 'A_POSE', 0);
      expect(Object.keys(bones).sort()).toEqual(['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm']);
      expect(Object.values(bones).flatMap(Object.values).every(Number.isFinite)).toBe(true);
    }
  });
});
