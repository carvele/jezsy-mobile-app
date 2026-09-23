import {
  deriveBodyOuterHipWidth,
  deriveBodyOuterShoulderWidth,
  estimateBodyFitState,
  calculateSkeletalHipSpan,
  calculateSkeletalShoulderSpan,
  ELLIPSE_CIRCUMFERENCE_FACTOR,
} from '../bodyFitEstimator';
import { calculateBoneRotationsFromCanonical } from '../skeletalRetargeter';
import { normalizePose } from '../poseNormalizer';
import type { WorldLandmark } from '../poseDetector';

function makeWorldLandmarks(): WorldLandmark[] {
  return Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
}

describe('BodyFitState and Semantics Suite', () => {
  describe('Problem 1: Distinct Body-Size Semantics (Joint Distance vs Outer Silhouette)', () => {
    test('Priority A: User Sizing circumference converts via anatomical ellipse model', () => {
      // 94cm hips should yield outer hip width ~ 34.4cm (0.344m)
      const outerHipM = deriveBodyOuterHipWidth(94);
      expect(outerHipM).toBeCloseTo(0.3437, 3);

      // Verify Priority A returns source 'USER_SIZING'
      const state = estimateBodyFitState({
        userMeasurements: { hips: 94, waist: 76, shoulderWidth: 42 },
        skeletalLandmarks: [],
        torsoYawRad: 0,
        trackingConfidence: 0.9,
      });
      expect(state.source).toBe('USER_SIZING');
      expect(state.bodyOuterHipWidthM).toBeCloseTo(0.3437, 3);
      expect(state.isLocked).toBe(true);
    });

    test('Priority D: Skeletal Landmark Fallback adds anatomical soft-tissue margin', () => {
      const mockLandmarks = makeWorldLandmarks();
      // Femoral head joint centers at 18.2cm distance
      mockLandmarks[23] = { x: -0.091, y: 0, z: 0, visibility: 1 };
      mockLandmarks[24] = { x: 0.091, y: 0, z: 0, visibility: 1 };

      const span = calculateSkeletalHipSpan(mockLandmarks);
      expect(span).toBeCloseTo(0.182, 3);

      const state = estimateBodyFitState({
        userMeasurements: undefined,
        skeletalLandmarks: mockLandmarks,
        torsoYawRad: 0,
        trackingConfidence: 0.8,
      });
      expect(state.source).toBe('SKELETAL_INFERRED');
      expect(state.bodyOuterHipWidthM).toBeCloseTo(0.182 + 0.15, 3);
    });

    test('Eliminates 0.502 pants scale distortion', () => {
      // Authored Pants metric width from Admin: 0.363m
      const garmentMetricWidth = 0.363;

      // Old flawed way: MediaPipe landmarks joint distance (0.182m) / garmentMetricWidth (0.363m)
      const oldFlawedScale = 0.182 / garmentMetricWidth;
      expect(oldFlawedScale).toBeCloseTo(0.501, 2); // Exactly reproduces the 0.502 bug!

      // New way: Body outer hip width (0.344m) / garmentMetricWidth (0.363m)
      const outerHipWidth = deriveBodyOuterHipWidth(94);
      const newScale = outerHipWidth / garmentMetricWidth;
      expect(newScale).toBeCloseTo(0.947, 2); // Natural 95% fit!
      expect(newScale).toBeGreaterThanOrEqual(0.65);
      expect(newScale).toBeLessThanOrEqual(1.45);
    });
  });

  describe('Problem 1.5: Stable Fit State & Yaw Locking', () => {
    test('Locks physical dimensions in frontal view and holds constant across turning', () => {
      const initialFrontal = estimateBodyFitState({
        userMeasurements: { hips: 94, waist: 76 },
        skeletalLandmarks: [],
        torsoYawRad: 0.05, // ~3 degrees frontal
        trackingConfidence: 0.95,
      });

      expect(initialFrontal.isLocked).toBe(true);
      const lockedWidth = initialFrontal.bodyOuterHipWidthM;

      // Simulate turn to 30 deg (0.52 rad)
      const state30 = estimateBodyFitState({
        userMeasurements: { hips: 94, waist: 76 },
        skeletalLandmarks: [],
        torsoYawRad: 0.52,
        trackingConfidence: 0.9,
        priorState: initialFrontal,
      });
      expect(state30.bodyOuterHipWidthM).toBe(lockedWidth);

      // Simulate turn to 91.5 deg (1.60 rad) where 2D projected distance collapses
      const state91 = estimateBodyFitState({
        userMeasurements: { hips: 94, waist: 76 },
        skeletalLandmarks: [],
        torsoYawRad: 1.60,
        trackingConfidence: 0.6,
        priorState: state30,
      });
      expect(state91.bodyOuterHipWidthM).toBe(lockedWidth);
      expect(state91.isLocked).toBe(true);

      // Return to frontal view
      const stateReturn = estimateBodyFitState({
        userMeasurements: { hips: 94, waist: 76 },
        skeletalLandmarks: [],
        torsoYawRad: 0.02,
        trackingConfidence: 0.95,
        priorState: state91,
      });
      expect(stateReturn.bodyOuterHipWidthM).toBe(lockedWidth);
    });
  });

  describe('Problem 2: Lower-body Retargeting / Knee Articulation Chain', () => {
    test('Straight leg (neutral standing) produces identity quaternion for child knee', () => {
      const world = makeWorldLandmarks();
      // Shoulders
      world[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };
      world[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };
      // Hips
      world[23] = { x: 0.1, y: 0.2, z: 0, visibility: 1 };
      world[24] = { x: -0.1, y: 0.2, z: 0, visibility: 1 };
      // Knees straight down (+Y in MediaPipe)
      world[25] = { x: 0.1, y: 0.6, z: 0, visibility: 1 };
      world[26] = { x: -0.1, y: 0.6, z: 0, visibility: 1 };
      // Ankles straight down (+Y in MediaPipe)
      world[27] = { x: 0.1, y: 1.0, z: 0, visibility: 1 };
      world[28] = { x: -0.1, y: 1.0, z: 0, visibility: 1 };

      const canonical = normalizePose(world);
      const bones = calculateBoneRotationsFromCanonical(canonical, 'A_POSE', 0, 'pants');

      // LeftLeg should be identity (within knee deadzone of 8 degrees)
      expect(bones.LeftLeg).toBeDefined();
      expect(bones.LeftLeg.x).toBeCloseTo(0, 2);
      expect(bones.LeftLeg.y).toBeCloseTo(0, 2);
      expect(bones.LeftLeg.z).toBeCloseTo(0, 2);
      expect(bones.LeftLeg.w).toBeCloseTo(1, 2);
    });

    test('Leg raise (hip flexion forward) keeps knee in identity when leg is unbent', () => {
      const world = makeWorldLandmarks();
      world[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };
      world[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };
      world[23] = { x: 0.1, y: 0.2, z: 0, visibility: 1 };
      world[24] = { x: -0.1, y: 0.2, z: 0, visibility: 1 };

      // Left leg lifted 45 deg forward (-Z in MediaPipe coordinate system)
      // Thigh forward and up:
      world[25] = { x: 0.1, y: 0.45, z: -0.3, visibility: 1 };
      // Calf collinear with thigh (straight leg raise):
      world[27] = { x: 0.1, y: 0.70, z: -0.6, visibility: 1 };

      // Right leg straight down
      world[26] = { x: -0.1, y: 0.6, z: 0, visibility: 1 };
      world[28] = { x: -0.1, y: 1.0, z: 0, visibility: 1 };

      const canonical = normalizePose(world);
      const bones = calculateBoneRotationsFromCanonical(canonical, 'A_POSE', 0, 'pants');

      // LeftUpLeg moves (non-identity):
      expect(bones.LeftUpLeg).toBeDefined();
      expect(Math.abs(bones.LeftUpLeg.x) + Math.abs(bones.LeftUpLeg.y) + Math.abs(bones.LeftUpLeg.z)).toBeGreaterThan(0.1);

      // LeftLeg remains at identity because it is collinear with thigh!
      expect(bones.LeftLeg).toBeDefined();
      expect(bones.LeftLeg.x).toBeCloseTo(0, 2);
      expect(bones.LeftLeg.y).toBeCloseTo(0, 2);
      expect(bones.LeftLeg.z).toBeCloseTo(0, 2);
      expect(bones.LeftLeg.w).toBeCloseTo(1, 2);
    });

    test('Knee flexion bends relative to thigh without horizontal distortion', () => {
      const world = makeWorldLandmarks();
      world[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };
      world[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };
      world[23] = { x: 0.1, y: 0.2, z: 0, visibility: 1 };
      world[24] = { x: -0.1, y: 0.2, z: 0, visibility: 1 };

      // Thigh straight down:
      world[25] = { x: 0.1, y: 0.6, z: 0, visibility: 1 };
      // Knee flexed backward (+Z in MediaPipe is away from camera / behind body):
      world[27] = { x: 0.1, y: 0.6, z: 0.35, visibility: 1 };

      // Right leg straight
      world[26] = { x: -0.1, y: 0.6, z: 0, visibility: 1 };
      world[28] = { x: -0.1, y: 1.0, z: 0, visibility: 1 };

      const canonical = normalizePose(world);
      const bones = calculateBoneRotationsFromCanonical(canonical, 'A_POSE', 0, 'pants');

      // LeftLeg should reflect flexion around hinge axis without unnatural roll
      expect(bones.LeftLeg).toBeDefined();
      expect(Math.abs(bones.LeftLeg.x)).toBeGreaterThan(0.2); // hinge flexion
    });
  });
});
