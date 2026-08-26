import { extractBodyCoordinateFrame, type Landmark, type WorldLandmark } from '../poseDetector';
import { constructBodyPose } from '../poseConstructor';

// A mock transformation context
const transformCtx = {
  videoWidth: 1080,
  videoHeight: 1920,
  stageWidth: 390,
  stageHeight: 844,
  isMirrored: true,
  objectFit: 'cover' as const,
};

// Generate 33 empty landmarks
function makeLandmarks(): Landmark[] {
  return Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
}

function makeWorldLandmarks(): WorldLandmark[] {
  return Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
}

describe('AR Tracking Pipeline - Phase 1 Coordinate Separation', () => {

  describe('extractBodyCoordinateFrame', () => {
    
    it('should correctly calculate midpoints without operator precedence bugs', () => {
      const worldLandmarks = makeWorldLandmarks();
      // Setup known shoulders
      worldLandmarks[11] = { x: -0.2, y: -0.5, z: 0.4, visibility: 1 }; // Left Shoulder
      worldLandmarks[12] = { x: 0.2, y: -0.5, z: 0.2, visibility: 1 };  // Right Shoulder
      worldLandmarks[23] = { x: -0.1, y: 0.1, z: 0.0, visibility: 1 };  // Left Hip
      worldLandmarks[24] = { x: 0.1, y: 0.1, z: 0.0, visibility: 1 };   // Right Hip

      const frame = extractBodyCoordinateFrame(worldLandmarks);
      
      // Expected midShoulder = (-0.2 + 0.2)/2, (-0.5 + -0.5)/2, (0.4 + 0.2)/2
      // z should be 0.3!
      expect(frame.origin.x).toBeCloseTo(0);
      expect(frame.origin.y).toBeCloseTo(-0.5);
      expect(frame.origin.z).toBeCloseTo(0.3); // If bug existed, z would be 0.1
    });

    it('should produce a perfectly orthonormal 3D basis', () => {
      const worldLandmarks = makeWorldLandmarks();
      // Standard T-Pose (MediaPipe: X is right on image so left side of person is -X? Actually subject left shoulder is +X on screen if facing, wait, let's just make an arbitrary skew pose)
      worldLandmarks[11] = { x: -0.3, y: -0.5, z: 0.1, visibility: 1 };
      worldLandmarks[12] = { x: 0.3, y: -0.4, z: -0.1, visibility: 1 };
      worldLandmarks[23] = { x: -0.2, y: 0.4, z: 0.2, visibility: 1 };
      worldLandmarks[24] = { x: 0.1, y: 0.3, z: 0.0, visibility: 1 };

      const frame = extractBodyCoordinateFrame(worldLandmarks);
      
      // Dot products must be 0
      const dotRU = frame.right.x * frame.up.x + frame.right.y * frame.up.y + frame.right.z * frame.up.z;
      const dotRF = frame.right.x * frame.forward.x + frame.right.y * frame.forward.y + frame.right.z * frame.forward.z;
      const dotUF = frame.up.x * frame.forward.x + frame.up.y * frame.forward.y + frame.up.z * frame.forward.z;
      
      expect(dotRU).toBeCloseTo(0);
      expect(dotRF).toBeCloseTo(0);
      expect(dotUF).toBeCloseTo(0);

      // Magnitudes must be 1
      const magR = Math.sqrt(frame.right.x**2 + frame.right.y**2 + frame.right.z**2);
      const magU = Math.sqrt(frame.up.x**2 + frame.up.y**2 + frame.up.z**2);
      const magF = Math.sqrt(frame.forward.x**2 + frame.forward.y**2 + frame.forward.z**2);

      expect(magR).toBeCloseTo(1);
      expect(magU).toBeCloseTo(1);
      expect(magF).toBeCloseTo(1);
    });
  });

  describe('constructBodyPose Orientation Derivation', () => {
    it('should derive yaw correctly from the world orthonormal frame without heuristics', () => {
      const norm = makeLandmarks();
      const world = makeWorldLandmarks();
      
      // Front facing: shoulders have same Z. 
      // In camera view, person's left shoulder is on the right side of the image (+X),
      // and right shoulder is on the left side of the image (-X).
      world[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 }; // Left Shoulder
      world[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 }; // Right Shoulder
      world[23] = { x: 0.1, y: 0.2, z: 0, visibility: 1 }; // Left Hip
      world[24] = { x: -0.1, y: 0.2, z: 0, visibility: 1 }; // Right Hip

      let pose = constructBodyPose(norm, norm, world, transformCtx);
      expect(pose.orientation.yawRad).toBeCloseTo(0);
      expect(pose.orientation.isFacingForward).toBe(true);
      expect(pose.orientation.isBackFacing).toBe(false);

      // Turned right (Person turns right: left shoulder comes closer to camera, meaning -Z in MediaPipe)
      world[11] = { x: 0.1, y: -0.4, z: -0.2, visibility: 1 };
      world[12] = { x: -0.1, y: -0.4, z: 0.2, visibility: 1 };
      
      pose = constructBodyPose(norm, norm, world, transformCtx);
      expect(pose.orientation.yawRad).not.toBeCloseTo(0);
      expect(pose.orientation.isFacingForward).toBe(false);
    });
  });

});
