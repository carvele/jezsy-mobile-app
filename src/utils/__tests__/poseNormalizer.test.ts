import {
  normalizePose,
  torsoEulerDegrees,
  toTorsoLocal,
  applyQuatToVec,
  quaternionFromBasis,
  LM,
} from '../poseNormalizer';
import type { WorldLandmark } from '../poseDetector';

/**
 * All inputs here are RAW MEDIAPIPE world landmarks: X right, Y DOWN, Z away from
 * camera. The normalizer is what flips them into canonical (Y up, Z toward viewer).
 * Getting that flip wrong is exactly the class of bug these tests exist to catch.
 */
function makeWorld(): WorldLandmark[] {
  return Array(33)
    .fill(null)
    .map(() => ({ x: 0, y: 0, z: 0, visibility: 1 })) as WorldLandmark[];
}

/**
 * Upright subject squarely facing the camera. MediaPipe puts the subject own LEFT
 * shoulder (11) at the larger x in the raw unmirrored frame, and Y grows downward,
 * so the shoulders carry the more negative y.
 */
function uprightPose(): WorldLandmark[] {
  const w = makeWorld();
  w[LM.leftShoulder] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };
  w[LM.rightShoulder] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };
  w[LM.leftHip] = { x: 0.1, y: 0.4, z: 0, visibility: 1 };
  w[LM.rightHip] = { x: -0.1, y: 0.4, z: 0, visibility: 1 };
  return w;
}

describe('poseNormalizer: canonical space conversion', () => {
  it('flips MediaPipe Y-down / Z-away into canonical Y-up / Z-toward-viewer', () => {
    const w = makeWorld();
    w[LM.leftShoulder] = { x: 0.2, y: -0.4, z: -0.3, visibility: 1 };
    const j = normalizePose(w).joints[LM.leftShoulder]!;

    expect(j.x).toBeCloseTo(0.2);
    expect(j.y).toBeCloseTo(0.4); // was -0.4 (down) -> +0.4 (up)
    expect(j.z).toBeCloseTo(0.3); // was -0.3 (toward camera) -> +0.3 (toward viewer)
  });

  it('drops landmarks below the visibility floor rather than trusting them', () => {
    const w = uprightPose();
    w[LM.leftElbow] = { x: 0.4, y: 0, z: 0, visibility: 0.1 };
    expect(normalizePose(w).joints[LM.leftElbow]).toBeNull();
  });

  it('drops non-finite landmarks', () => {
    const w = uprightPose();
    w[LM.leftElbow] = { x: NaN, y: 0, z: 0, visibility: 1 };
    expect(normalizePose(w).joints[LM.leftElbow]).toBeNull();
  });
});

describe('poseNormalizer: torso basis', () => {
  it('is the identity rotation for an upright subject facing the camera', () => {
    const { torso } = normalizePose(uprightPose());

    expect(torso.valid).toBe(true);
    expect(torso.xAxis).toMatchObject({ x: 1, y: 0, z: 0 });
    expect(torso.yAxis.y).toBeCloseTo(1);
    expect(torso.zAxis.z).toBeCloseTo(1);

    // Identity quaternion -- this is the property that guarantees the new full-3DOF
    // group rotation is a no-op at rest, i.e. no regression versus the old roll-only path.
    expect(torso.quaternion.w).toBeCloseTo(1);
    expect(torso.quaternion.x).toBeCloseTo(0);
    expect(torso.quaternion.y).toBeCloseTo(0);
    expect(torso.quaternion.z).toBeCloseTo(0);

    const e = torsoEulerDegrees(torso);
    expect(e.pitch).toBeCloseTo(0);
    expect(e.yaw).toBeCloseTo(0);
    expect(e.roll).toBeCloseTo(0);
  });

  it('produces an orthonormal right-handed basis', () => {
    const w = uprightPose();
    // Deliberately skew: shoulder line not perpendicular to the torso line.
    w[LM.leftShoulder] = { x: 0.2, y: -0.5, z: -0.1, visibility: 1 };
    w[LM.rightShoulder] = { x: -0.2, y: -0.3, z: 0.05, visibility: 1 };
    const { torso } = normalizePose(w);

    const dot = (a: any, b: any) => a.x * b.x + a.y * b.y + a.z * b.z;
    const len = (a: any) => Math.sqrt(dot(a, a));

    expect(len(torso.xAxis)).toBeCloseTo(1);
    expect(len(torso.yAxis)).toBeCloseTo(1);
    expect(len(torso.zAxis)).toBeCloseTo(1);
    expect(dot(torso.xAxis, torso.yAxis)).toBeCloseTo(0);
    expect(dot(torso.yAxis, torso.zAxis)).toBeCloseTo(0);
    expect(dot(torso.zAxis, torso.xAxis)).toBeCloseTo(0);

    // Right-handed: x cross y == z
    const cx = torso.xAxis.y * torso.yAxis.z - torso.xAxis.z * torso.yAxis.y;
    const cy = torso.xAxis.z * torso.yAxis.x - torso.xAxis.x * torso.yAxis.z;
    const cz = torso.xAxis.x * torso.yAxis.y - torso.xAxis.y * torso.yAxis.x;
    expect(cx).toBeCloseTo(torso.zAxis.x);
    expect(cy).toBeCloseTo(torso.zAxis.y);
    expect(cz).toBeCloseTo(torso.zAxis.z);
  });

  it('reads a forward hip-bend as pitch, not as roll or yaw', () => {
    const w = uprightPose();
    // Bending forward at the hips: shoulders swing toward the camera (MediaPipe -Z)
    // and drop closer to hip height. Hips stay put.
    w[LM.leftShoulder] = { x: 0.2, y: -0.15, z: -0.35, visibility: 1 };
    w[LM.rightShoulder] = { x: -0.2, y: -0.15, z: -0.35, visibility: 1 };

    const { torso } = normalizePose(w);
    const e = torsoEulerDegrees(torso);

    expect(torso.valid).toBe(true);
    expect(e.pitch).toBeLessThan(-20); // chest normal tipped downward
    expect(Math.abs(e.roll)).toBeLessThan(1);
    expect(Math.abs(e.yaw)).toBeLessThan(1);
  });

  it('reads a sideways lean as roll, not as pitch or yaw', () => {
    const w = uprightPose();
    // Leaning so the shoulder line tilts in the image plane; the torso line tilts with it.
    w[LM.leftShoulder] = { x: 0.25, y: -0.3, z: 0, visibility: 1 };
    w[LM.rightShoulder] = { x: -0.15, y: -0.5, z: 0, visibility: 1 };
    w[LM.leftHip] = { x: 0.2, y: 0.4, z: 0, visibility: 1 };
    w[LM.rightHip] = { x: 0.0, y: 0.35, z: 0, visibility: 1 };

    const { torso } = normalizePose(w);
    const e = torsoEulerDegrees(torso);

    expect(Math.abs(e.roll)).toBeGreaterThan(15);
    expect(Math.abs(e.pitch)).toBeLessThan(1);
    expect(Math.abs(e.yaw)).toBeLessThan(1);
  });

  it('reads a twist as yaw, not as pitch or roll', () => {
    const w = uprightPose();
    // Rotating about the vertical: one shoulder moves toward the camera, the other away.
    w[LM.leftShoulder] = { x: 0.17, y: -0.4, z: -0.1, visibility: 1 };
    w[LM.rightShoulder] = { x: -0.17, y: -0.4, z: 0.1, visibility: 1 };

    const { torso } = normalizePose(w);
    const e = torsoEulerDegrees(torso);

    expect(Math.abs(e.yaw)).toBeGreaterThan(15);
    expect(Math.abs(e.pitch)).toBeLessThan(1);
    expect(Math.abs(e.roll)).toBeLessThan(1);
  });

  it('reports an invalid identity torso when landmarks are missing or untrusted', () => {
    expect(normalizePose(null).torso.valid).toBe(false);
    expect(normalizePose(undefined).torso.quaternion.w).toBe(1);

    const w = uprightPose();
    w[LM.leftHip] = { x: 0.1, y: 0.4, z: 0, visibility: 0.05 };
    const { torso } = normalizePose(w);
    expect(torso.valid).toBe(false);
    expect(torso.quaternion.w).toBe(1);
  });

  it('reports an invalid torso when the 3D shoulder distance is physically implausible', () => {
    // Simulates the deep-profile-turn failure mode (Phase 1 report finding #1):
    // MediaPipe's depth estimate for the far shoulder collapses near profile view,
    // producing a 3D shoulder-to-shoulder distance far outside any real human's.
    const wTooNarrow = uprightPose();
    wTooNarrow[LM.leftShoulder] = { x: 0.02, y: -0.4, z: 0, visibility: 1 };
    wTooNarrow[LM.rightShoulder] = { x: -0.02, y: -0.4, z: 0, visibility: 1 };
    expect(normalizePose(wTooNarrow).torso.valid).toBe(false);

    const wTooWide = uprightPose();
    wTooWide[LM.leftShoulder] = { x: 1.5, y: -0.4, z: 0, visibility: 1 };
    wTooWide[LM.rightShoulder] = { x: -1.5, y: -0.4, z: 0, visibility: 1 };
    expect(normalizePose(wTooWide).torso.valid).toBe(false);
  });

  it('reports an invalid torso rather than NaN when the basis is degenerate', () => {
    const w = makeWorld(); // every landmark collapsed onto the origin
    const { torso } = normalizePose(w);

    expect(torso.valid).toBe(false);
    expect(Number.isNaN(torso.quaternion.x)).toBe(false);
    expect(torso.quaternion.w).toBe(1);
  });
});

describe('poseNormalizer: quaternion helpers', () => {
  it('quaternionFromBasis maps canonical axes onto the basis axes', () => {
    const w = uprightPose();
    // Arbitrary non-trivial pose: leaning forward and twisted.
    w[LM.leftShoulder] = { x: 0.18, y: -0.25, z: -0.22, visibility: 1 };
    w[LM.rightShoulder] = { x: -0.2, y: -0.32, z: 0.05, visibility: 1 };
    const { torso } = normalizePose(w);

    const q = quaternionFromBasis(torso.xAxis, torso.yAxis, torso.zAxis);
    const mappedX = applyQuatToVec(q, { x: 1, y: 0, z: 0 });
    const mappedY = applyQuatToVec(q, { x: 0, y: 1, z: 0 });

    expect(mappedX.x).toBeCloseTo(torso.xAxis.x);
    expect(mappedX.y).toBeCloseTo(torso.xAxis.y);
    expect(mappedX.z).toBeCloseTo(torso.xAxis.z);
    expect(mappedY.y).toBeCloseTo(torso.yAxis.y);
  });

  it('toTorsoLocal takes the torso own axes back to the canonical axes', () => {
    const w = uprightPose();
    w[LM.leftShoulder] = { x: 0.18, y: -0.2, z: -0.3, visibility: 1 };
    w[LM.rightShoulder] = { x: -0.2, y: -0.28, z: 0.02, visibility: 1 };
    const { torso } = normalizePose(w);

    const localX = toTorsoLocal(torso, torso.xAxis);
    const localY = toTorsoLocal(torso, torso.yAxis);

    expect(localX.x).toBeCloseTo(1);
    expect(localX.y).toBeCloseTo(0);
    expect(localX.z).toBeCloseTo(0);
    expect(localY.y).toBeCloseTo(1);
  });

  it('toTorsoLocal is a pass-through when the torso is invalid, so callers degrade to canonical space', () => {
    const { torso } = normalizePose(null);
    const v = { x: 0.3, y: -0.7, z: 0.1 };
    expect(toTorsoLocal(torso, v)).toEqual(v);
  });
});
