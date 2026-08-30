import { calculateBoneRotations } from '../skeletalRetargeter';
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
