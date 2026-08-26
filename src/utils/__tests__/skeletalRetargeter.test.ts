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
