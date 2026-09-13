import { normalizeAlignmentLandmarks, AlignmentCoordinateContext } from '../alignmentCoordinates';
import type { Landmark } from '../poseDetector';

describe('alignmentCoordinates', () => {
  const createMockLandmark = (x: number, y: number): Landmark => ({
    x,
    y,
    z: 0,
    visibility: 1
  });

  it('normalizes 0 degree rotation without mirror', () => {
    const lm = [createMockLandmark(0.2, 0.4)];
    const ctx: AlignmentCoordinateContext = { isMirrored: false, sensorRotation: 0 };
    const res = normalizeAlignmentLandmarks(lm, ctx);
    expect(res[0].x).toBeCloseTo(0.2);
    expect(res[0].y).toBeCloseTo(0.4);
  });

  it('normalizes 90 degree rotation without mirror', () => {
    const lm = [createMockLandmark(0.2, 0.4)];
    const ctx: AlignmentCoordinateContext = { isMirrored: false, sensorRotation: 90 };
    const res = normalizeAlignmentLandmarks(lm, ctx);
    // (x=0.2, y=0.4) -> nx = y = 0.4, ny = 1 - x = 0.8
    expect(res[0].x).toBeCloseTo(0.4);
    expect(res[0].y).toBeCloseTo(0.8);
  });

  it('normalizes 180 degree rotation without mirror', () => {
    const lm = [createMockLandmark(0.2, 0.4)];
    const ctx: AlignmentCoordinateContext = { isMirrored: false, sensorRotation: 180 };
    const res = normalizeAlignmentLandmarks(lm, ctx);
    // 1 - 0.2 = 0.8, 1 - 0.4 = 0.6
    expect(res[0].x).toBeCloseTo(0.8);
    expect(res[0].y).toBeCloseTo(0.6);
  });

  it('normalizes 270 degree rotation without mirror', () => {
    const lm = [createMockLandmark(0.2, 0.4)];
    const ctx: AlignmentCoordinateContext = { isMirrored: false, sensorRotation: 270 };
    const res = normalizeAlignmentLandmarks(lm, ctx);
    // nx = 1 - 0.4 = 0.6, ny = 0.2
    expect(res[0].x).toBeCloseTo(0.6);
    expect(res[0].y).toBeCloseTo(0.2);
  });

  it('applies mirror correctly across rotations', () => {
    const lm = [createMockLandmark(0.2, 0.4)];
    
    // 0 deg, mirrored -> x = 1 - 0.2 = 0.8
    let res = normalizeAlignmentLandmarks(lm, { isMirrored: true, sensorRotation: 0 });
    expect(res[0].x).toBeCloseTo(0.8);
    expect(res[0].y).toBeCloseTo(0.4);

    // 90 deg, mirrored -> nx=0.4, ny=0.8 -> mirrored x=1-0.4=0.6
    res = normalizeAlignmentLandmarks(lm, { isMirrored: true, sensorRotation: 90 });
    expect(res[0].x).toBeCloseTo(0.6);
    expect(res[0].y).toBeCloseTo(0.8);
  });
});
