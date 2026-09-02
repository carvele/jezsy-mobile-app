import { calculateBoneRotations, calculateBoneRotationsFromCanonical } from '../skeletalRetargeter';
import { normalizePose } from '../poseNormalizer';
import type { WorldLandmark } from '../poseDetector';

function makeWorldLandmarks(): WorldLandmark[] {
  return Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
}

describe('Phase 4A: Skeletal Retargeting Math', () => {

  it('calculates correct bone rotations for Pose A: Arms Down', () => {
    const world = makeWorldLandmarks();
    
    // MediaPipe Hands down (Y is positive going down)
    // Left shoulder (viewer's right)
    world[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };
    // Left elbow directly below shoulder (+Y)
    world[13] = { x: 0.2, y: 0.0, z: 0, visibility: 1 };
    
    // Right shoulder (viewer's left)
    world[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };
    // Right elbow directly below shoulder (+Y)
    world[14] = { x: -0.2, y: 0.0, z: 0, visibility: 1 };

    const rotations = calculateBoneRotations(world);
    
    expect(rotations['LeftArm']).toBeDefined();
    expect(rotations['RightArm']).toBeDefined();
    
    // We expect the LeftArm (T-Pose +X rest) to rotate to point -Y (down in Three.js space)
    // A rotation from (1,0,0) to (0,-1,0) is a 90 degree rotation around -Z axis
    // Quaternion for -90 around Z is (0, 0, -sin(45), cos(45)) -> (0, 0, -0.707, 0.707)
    expect(rotations['LeftArm'].z).toBeCloseTo(-0.707, 2);
    expect(rotations['LeftArm'].w).toBeCloseTo(0.707, 2);

    // We expect the RightArm (T-Pose -X rest) to rotate to point -Y (down in Three.js space)
    // A rotation from (-1,0,0) to (0,-1,0) is a 90 degree rotation around +Z axis
    // Quaternion for +90 around Z is (0, 0, sin(45), cos(45)) -> (0, 0, 0.707, 0.707)
    expect(rotations['RightArm'].z).toBeCloseTo(0.707, 2);
    expect(rotations['RightArm'].w).toBeCloseTo(0.707, 2);
  });

  it('calculates correct bone rotations for Pose B: Left arm raised 45 degrees up and forward', () => {
    const world = makeWorldLandmarks();
    
    // Left shoulder
    world[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };
    // Left elbow: +X (right), -Y (up in MediaPipe), -Z (closer to camera in MediaPipe)
    world[13] = { x: 0.6, y: -0.8, z: -0.4, visibility: 1 };

    const rotations = calculateBoneRotations(world);
    expect(rotations['LeftArm']).toBeDefined();
    
    // Target Dir in Three.js = normalize({ x: 0.4, y: 0.4, z: 0.4 }) = (0.577, 0.577, 0.577)
    // Rotation from (1,0,0) to (0.577, 0.577, 0.577)
    // Just ensure it generates a valid normalized quaternion
    const q = rotations['LeftArm'];
    const mag = Math.sqrt(q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w);
    expect(mag).toBeCloseTo(1.0);
    
    // It should have some rotation (not w=1)
    expect(q.w).toBeLessThan(1.0);
  });

});

describe('Torso-local retargeting (P0-D torso-bend fix)', () => {

  /**
   * Rotates a point about the X axis in MEDIAPIPE space (Y down, Z away) -- which is
   * exactly what bending forward at the hips does to everything above the hips.
   */
  function bendForward(p: WorldLandmark, deg: number): WorldLandmark {
    const a = deg * Math.PI / 180;
    return {
      x: p.x,
      y: p.y * Math.cos(a) - p.z * Math.sin(a),
      z: p.y * Math.sin(a) + p.z * Math.cos(a),
      visibility: p.visibility,
    };
  }

  function uprightWithArmOut(): WorldLandmark[] {
    const w = makeWorldLandmarks();
    w[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };   // left shoulder
    w[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };  // right shoulder
    w[23] = { x: 0.1, y: 0.4, z: 0, visibility: 1 };    // left hip
    w[24] = { x: -0.1, y: 0.4, z: 0, visibility: 1 };   // right hip
    // Left elbow raised 45 deg above the shoulder line, in the body own frontal plane.
    w[13] = { x: 0.2 + 0.21, y: -0.4 - 0.21, z: 0, visibility: 1 };
    return w;
  }

  it('gives the SAME arm delta for the same body-relative arm angle, upright or bent forward', () => {
    const upright = uprightWithArmOut();

    // Bend the whole upper body forward about the hips: shoulders and elbow rotate
    // together, so the arm has not moved RELATIVE TO THE BODY at all. Before this fix
    // the arm delta was computed in world space, so it changed anyway.
    const hipY = 0.4;
    const bent = upright.map((p, i) => {
      if (i !== 11 && i !== 12 && i !== 13) return p;
      const rotated = bendForward({ ...p, y: p.y - hipY }, 40);
      return { ...rotated, y: rotated.y + hipY };
    }) as WorldLandmark[];

    const a = calculateBoneRotations(upright)['LeftArm'];
    const b = calculateBoneRotations(bent)['LeftArm'];

    // Quaternion double cover: q and -q are the same rotation, so compare |dot|.
    const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    expect(dot).toBeCloseTo(1, 3);
  });

  it('no longer emits a Spine rotation -- the torso orientation now lives on the garment group', () => {
    const rotations = calculateBoneRotations(uprightWithArmOut());
    expect(rotations['Spine']).toBeUndefined();
    expect(rotations['LeftArm']).toBeDefined();
  });

  it('returns an identity delta (leave the bone at its bind pose) when a joint is not visible', () => {
    const w = uprightWithArmOut();
    w[14] = { x: 0, y: 0, z: 0, visibility: 0.0 }; // right elbow not visible
    const rotations = calculateBoneRotations(w);

    expect(rotations['RightArm']).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

});

describe('Invalid-torso fallback roll cancellation (#6)', () => {

  // Hips deliberately omitted/invisible below MIN_JOINT_VISIBILITY (0.3) so
  // normalizePose returns torso.valid = false -- the common try-on-framing case
  // this fallback exists for (hips out of frame at typical distance).
  function armsAtRestNoHips(): WorldLandmark[] {
    const w = makeWorldLandmarks();
    w[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };   // left shoulder
    w[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };  // right shoulder
    w[13] = { x: 0.4, y: -0.4, z: 0, visibility: 1 };   // left elbow, along the T-pose rest direction
    w[14] = { x: -0.4, y: -0.4, z: 0, visibility: 1 };  // right elbow, along the T-pose rest direction
    w[23] = { x: 0.1, y: 0.4, z: 0, visibility: 0.0 };  // left hip, invisible
    w[24] = { x: -0.1, y: 0.4, z: 0, visibility: 0.0 }; // right hip, invisible
    return w;
  }

  it('confirms the test fixture actually produces an invalid torso', () => {
    const pose = normalizePose(armsAtRestNoHips());
    expect(pose.torso.valid).toBe(false);
  });

  it('without fallbackRollRad, arm bones stay at their prior (double-counting) behavior: identity for an at-rest arm', () => {
    const pose = normalizePose(armsAtRestNoHips());
    const rotations = calculateBoneRotationsFromCanonical(pose, 'T_POSE');

    // Arms are exactly along the T-pose rest direction and the invalid torso's
    // untouched quaternion is identity, so with no fallback the delta is identity --
    // this is the pre-fix behavior the omit-the-parameter case preserves on purpose.
    expect(rotations['LeftArm']).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(rotations['RightArm']).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('with fallbackRollRad, arm bones cancel the same roll the garment group applies, instead of leaving it double-counted', () => {
    const pose = normalizePose(armsAtRestNoHips());
    const fallbackRollRad = 30 * Math.PI / 180; // poseConstructor's Y-down convention

    const rotations = calculateBoneRotationsFromCanonical(pose, 'T_POSE', fallbackRollRad);

    // garmentFitter's fallback group rotation uses the same CANONICAL_Y_UP_ROLL_SIGN
    // (-1) flip on fallbackRollRad -- this function must build the IDENTICAL
    // roll-only quaternion internally and remove it from arm directions, so the
    // bone delta here should be the INVERSE of that group rotation: r = -1 * -rollRad
    // = +rollRad half-angle, i.e. sin(+rollRad/2)/cos(+rollRad/2) on Z.
    const expectedZ = Math.sin(fallbackRollRad / 2);
    const expectedW = Math.cos(fallbackRollRad / 2);

    expect(rotations['LeftArm'].z).toBeCloseTo(expectedZ, 5);
    expect(rotations['LeftArm'].w).toBeCloseTo(expectedW, 5);
    expect(rotations['RightArm'].z).toBeCloseTo(expectedZ, 5);
    expect(rotations['RightArm'].w).toBeCloseTo(expectedW, 5);

    // Not identity -- confirms the fallback actually changed the bone delta rather
    // than silently no-op'ing (which would leave #6's double-roll bug in place).
    expect(rotations['LeftArm']).not.toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('a VALID torso ignores fallbackRollRad entirely -- the parameter only matters when the real torso basis failed', () => {
    const w = armsAtRestNoHips();
    w[23] = { x: 0.1, y: 0.4, z: 0, visibility: 1 }; // hips visible now -> valid torso
    w[24] = { x: -0.1, y: 0.4, z: 0, visibility: 1 };
    const pose = normalizePose(w);
    expect(pose.torso.valid).toBe(true);

    const withoutFallback = calculateBoneRotationsFromCanonical(pose, 'T_POSE');
    const withFallback = calculateBoneRotationsFromCanonical(pose, 'T_POSE', 30 * Math.PI / 180);

    expect(withFallback['LeftArm']).toEqual(withoutFallback['LeftArm']);
    expect(withFallback['RightArm']).toEqual(withoutFallback['RightArm']);
  });

});
