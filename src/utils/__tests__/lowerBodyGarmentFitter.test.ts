import { calculateGarmentFit } from '../garmentFitter';
import { SceneViewProjection, computeSceneViewAnchoredPosition } from '../sceneViewMath';
import { SceneViewSkeletalRetargeter } from '../sceneViewRetargeter';
import { validateGarmentRig } from '../sceneViewRigValidator';
import type { Landmark } from '../poseDetector';
import type { BodyPose } from '../../types/pose';
import type { GarmentMetadata } from '../../types/garment';

function makeLandmark(x: number, y: number, z = 0, visibility = 1): Landmark {
  return { x, y, z, visibility };
}

interface TestBodyPose extends BodyPose {
  landmarks: Landmark[];
}

function createMockPose(overrides?: Partial<TestBodyPose>): TestBodyPose {
  const landmarks: Landmark[] = Array(33).fill(null).map(() => makeLandmark(0, 0, 0, 1));

  // Shoulders (11 = left, 12 = right)
  landmarks[11] = makeLandmark(240, 150, 0, 1);
  landmarks[12] = makeLandmark(160, 150, 0, 1);

  // Hips (23 = left, 24 = right) - default joint separation: 40px (~19cm anatomical)
  landmarks[23] = makeLandmark(220, 300, 0, 1);
  landmarks[24] = makeLandmark(180, 300, 0, 1);

  // Knees (25 = left, 26 = right)
  landmarks[25] = makeLandmark(220, 450, 0, 1);
  landmarks[26] = makeLandmark(180, 450, 0, 1);

  // Ankles (27 = left, 28 = right)
  landmarks[27] = makeLandmark(220, 600, 0, 1);
  landmarks[28] = makeLandmark(180, 600, 0, 1);

  const worldLandmarks = Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  worldLandmarks[11] = { x: 0.2, y: -0.4, z: 0, visibility: 1 };
  worldLandmarks[12] = { x: -0.2, y: -0.4, z: 0, visibility: 1 };
  worldLandmarks[23] = { x: 0.095, y: 0.0, z: 0, visibility: 1 };
  worldLandmarks[24] = { x: -0.095, y: 0.0, z: 0, visibility: 1 };
  worldLandmarks[25] = { x: 0.095, y: 0.45, z: 0, visibility: 1 };
  worldLandmarks[26] = { x: -0.095, y: 0.45, z: 0, visibility: 1 };
  worldLandmarks[27] = { x: 0.095, y: 0.9, z: 0, visibility: 1 };
  worldLandmarks[28] = { x: -0.095, y: 0.9, z: 0, visibility: 1 };

  return {
    landmarks,
    stageLandmarks: landmarks as any,
    normalizedLandmarks: landmarks,
    worldLandmarks,
    confidence: 0.95,
    coordinateFrame: {
      origin: { x: 0, y: 0, z: 0 },
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
    },
    orientation: {
      rollRad: 0,
      pitchRad: 0,
      yawRad: 0,
      isFacingForward: true,
      isBackFacing: false,
    },
    trackingState: 'GOOD_FIT',
    ...overrides,
  };
}

const mockPantsMetadata: GarmentMetadata = {
  id: 'garment_pants_01',
  category: 'pants',
  calibrationVersion: '1.0.0',
  ingestionStatus: 'AR_READY',
  anatomicalAnchorOffset: { x: 0, y: 0.95, z: 0 },
  anchorConfidence: 'merchant_confirmed',
  anchorType: 'WAIST',
  restPoseMetricWidth: 0.34,
  boneMap: {
    LeftUpLeg: 'mixamorigLeftUpLeg',
    RightUpLeg: 'mixamorigRightUpLeg',
    LeftLeg: 'mixamorigLeftLeg',
    RightLeg: 'mixamorigRightLeg',
    Hips: 'mixamorigHips',
  },
  restPose: 'T_POSE',
};

const mockShirtMetadata: GarmentMetadata = {
  id: 'garment_shirt_01',
  category: 'shirt',
  calibrationVersion: '1.0.0',
  ingestionStatus: 'AR_READY',
  anatomicalAnchorOffset: { x: 0, y: 1.35, z: 0 },
  anchorConfidence: 'merchant_confirmed',
  anchorType: 'SHOULDER_CENTER',
  restPoseMetricWidth: 0.4,
  boneMap: {
    LeftArm: 'mixamorigLeftArm',
    RightArm: 'mixamorigRightArm',
    LeftForeArm: 'mixamorigLeftForeArm',
    RightForeArm: 'mixamorigRightForeArm',
    Spine: 'mixamorigSpine',
  },
  restPose: 'T_POSE',
};

describe('TASK: LOWER-BODY GARMENT FIT — PRECISE SILHOUETTE-AWARE PANTS FITTING', () => {
  // Case 1: Neutral front-facing body
  it('Case 1: neutral front-facing body produces correct silhouette-expanded pants width and pelvis anchor', () => {
    const pose = createMockPose();
    const fit = calculateGarmentFit(pose, mockPantsMetadata, 400, 600);

    expect(fit.confidence).toBeGreaterThan(0);
    // Pelvis anchor centered at midpoint of hips: (220 + 180)/2 - 400/2 = 0
    expect(fit.anchor.x).toBeCloseTo(0, 1);

    // Silhouette expansion: joint separation is 40px. With 1.78 silhouette ratio and 1.08 ease:
    // targetWidthPx = 40 * 1.78 * 1.08 = 76.896px.
    // Scale = (76.896 / 100) / 0.34 ≈ 2.26
    expect(fit.scale.x).toBeGreaterThan(1.8);
    expect(fit.scale.x).toBeLessThan(2.5);
    expect(Number.isFinite(fit.scale.x)).toBe(true);
    expect(Number.isFinite(fit.scale.y)).toBe(true);
  });

  // Case 2: Narrow hips
  it('Case 2: narrow hips results in proportionally narrower pants scale', () => {
    const neutralPose = createMockPose();
    const narrowPose = createMockPose();
    narrowPose.landmarks[23] = makeLandmark(210, 300); // 20px hip width
    narrowPose.landmarks[24] = makeLandmark(190, 300);

    const neutralFit = calculateGarmentFit(neutralPose, mockPantsMetadata, 400, 600);
    const narrowFit = calculateGarmentFit(narrowPose, mockPantsMetadata, 400, 600);

    expect(narrowFit.scale.x).toBeLessThan(neutralFit.scale.x);
    expect(narrowFit.scale.x).toBeCloseTo(neutralFit.scale.x * 0.5, 1);
  });

  // Case 3: Wider hips
  it('Case 3: wider hips grows pants width proportionally', () => {
    const neutralPose = createMockPose();
    const widePose = createMockPose();
    widePose.landmarks[23] = makeLandmark(230, 300); // 60px hip width
    widePose.landmarks[24] = makeLandmark(170, 300);

    const neutralFit = calculateGarmentFit(neutralPose, mockPantsMetadata, 400, 600);
    const wideFit = calculateGarmentFit(widePose, mockPantsMetadata, 400, 600);

    expect(wideFit.scale.x).toBeGreaterThan(neutralFit.scale.x);
    expect(wideFit.scale.x).toBeCloseTo(neutralFit.scale.x * 1.5, 1);
  });

  // Case 4: Move closer to camera
  it('Case 4: moving closer to camera scales up pants proportionally', () => {
    const normalPose = createMockPose();
    const closePose = createMockPose();
    // 2x pixel size when closer
    closePose.landmarks[23] = makeLandmark(240, 300);
    closePose.landmarks[24] = makeLandmark(160, 300);

    const normalFit = calculateGarmentFit(normalPose, mockPantsMetadata, 400, 600);
    const closeFit = calculateGarmentFit(closePose, mockPantsMetadata, 400, 600);

    expect(closeFit.scale.x).toBeGreaterThan(normalFit.scale.x);
    expect(closeFit.scale.x).toBeCloseTo(normalFit.scale.x * 2, 1);
  });

  // Case 5: Move farther from camera
  it('Case 5: moving farther from camera scales down pants proportionally', () => {
    const normalPose = createMockPose();
    const farPose = createMockPose();
    farPose.landmarks[23] = makeLandmark(210, 300);
    farPose.landmarks[24] = makeLandmark(190, 300);

    const normalFit = calculateGarmentFit(normalPose, mockPantsMetadata, 400, 600);
    const farFit = calculateGarmentFit(farPose, mockPantsMetadata, 400, 600);

    expect(farFit.scale.x).toBeLessThan(normalFit.scale.x);
  });

  // Case 6: Body yaw 15°
  it('Case 6: body yaw 15° does not collapse pants width', () => {
    const neutralPose = createMockPose();
    const yaw15Pose = createMockPose({
      orientation: {
        rollRad: 0,
        pitchRad: 0,
        yawRad: (15 * Math.PI) / 180,
        isFacingForward: true,
        isBackFacing: false,
      },
    });
    // Apparent 2D hip width foreshortened by cos(15°)
    yaw15Pose.landmarks[23] = makeLandmark(200 + 20 * Math.cos((15 * Math.PI) / 180), 300);
    yaw15Pose.landmarks[24] = makeLandmark(200 - 20 * Math.cos((15 * Math.PI) / 180), 300);

    const neutralFit = calculateGarmentFit(neutralPose, mockPantsMetadata, 400, 600);
    const yawFit = calculateGarmentFit(yaw15Pose, mockPantsMetadata, 400, 600);

    // Yaw compensation should recover true width within 1%
    expect(yawFit.scale.x).toBeCloseTo(neutralFit.scale.x, 1);
  });

  // Case 7: Body yaw 30°
  it('Case 7: body yaw 30° preserves true silhouette width', () => {
    const neutralPose = createMockPose();
    const yaw30Pose = createMockPose({
      orientation: {
        rollRad: 0,
        pitchRad: 0,
        yawRad: (30 * Math.PI) / 180,
        isFacingForward: true,
        isBackFacing: false,
      },
    });
    yaw30Pose.landmarks[23] = makeLandmark(200 + 20 * Math.cos((30 * Math.PI) / 180), 300);
    yaw30Pose.landmarks[24] = makeLandmark(200 - 20 * Math.cos((30 * Math.PI) / 180), 300);

    const neutralFit = calculateGarmentFit(neutralPose, mockPantsMetadata, 400, 600);
    const yawFit = calculateGarmentFit(yaw30Pose, mockPantsMetadata, 400, 600);

    expect(yawFit.scale.x).toBeCloseTo(neutralFit.scale.x, 1);
  });

  // Case 8: Body yaw 45°
  it('Case 8: body yaw 45° maintains safe floor without collapsing to zero', () => {
    const neutralPose = createMockPose();
    const yaw45Pose = createMockPose({
      orientation: {
        rollRad: 0,
        pitchRad: 0,
        yawRad: (45 * Math.PI) / 180,
        isFacingForward: true,
        isBackFacing: false,
      },
    });
    yaw45Pose.landmarks[23] = makeLandmark(200 + 20 * Math.cos((45 * Math.PI) / 180), 300);
    yaw45Pose.landmarks[24] = makeLandmark(200 - 20 * Math.cos((45 * Math.PI) / 180), 300);

    const neutralFit = calculateGarmentFit(neutralPose, mockPantsMetadata, 400, 600);
    const yawFit = calculateGarmentFit(yaw45Pose, mockPantsMetadata, 400, 600);

    expect(yawFit.scale.x).toBeGreaterThan(neutralFit.scale.x * 0.9);
    expect(Number.isFinite(yawFit.scale.x)).toBe(true);
  });

  // Case 9: Left leg forward
  it('Case 9: left leg forward maintains valid leg length scaling without NaN', () => {
    const pose = createMockPose();
    pose.landmarks[25] = makeLandmark(220, 440, -0.2); // knee forward
    pose.landmarks[27] = makeLandmark(220, 580, -0.3); // ankle forward

    const fit = calculateGarmentFit(pose, mockPantsMetadata, 400, 600);
    expect(fit.confidence).toBeGreaterThan(0);
    expect(Number.isFinite(fit.scale.y)).toBe(true);
    expect(fit.scale.y).toBeGreaterThan(fit.scale.x * 0.85);
    expect(fit.scale.y).toBeLessThanOrEqual(fit.scale.x * 1.25);
  });

  // Case 10: Right leg forward
  it('Case 10: right leg forward preserves bounded Y-scaling', () => {
    const pose = createMockPose();
    pose.landmarks[26] = makeLandmark(180, 440, -0.2);
    pose.landmarks[28] = makeLandmark(180, 580, -0.3);

    const fit = calculateGarmentFit(pose, mockPantsMetadata, 400, 600);
    expect(fit.confidence).toBeGreaterThan(0);
    expect(Number.isFinite(fit.scale.y)).toBe(true);
    expect(fit.scale.y).toBeGreaterThan(fit.scale.x * 0.85);
    expect(fit.scale.y).toBeLessThanOrEqual(fit.scale.x * 1.25);
  });

  // Case 11: Legs apart
  it('Case 11: legs apart keeps pelvis waistband anchored at hip center', () => {
    const pose = createMockPose();
    pose.landmarks[25] = makeLandmark(260, 450); // left knee wider
    pose.landmarks[26] = makeLandmark(140, 450); // right knee wider
    pose.landmarks[27] = makeLandmark(280, 600); // left ankle wider
    pose.landmarks[28] = makeLandmark(120, 600); // right ankle wider

    const fit = calculateGarmentFit(pose, mockPantsMetadata, 400, 600);
    expect(fit.anchor.x).toBeCloseTo(0, 1);
  });

  // Case 12: Return to neutral
  it('Case 12: return to neutral stabilizes identical values', () => {
    const neutral1 = createMockPose();
    const neutral2 = createMockPose();

    const fit1 = calculateGarmentFit(neutral1, mockPantsMetadata, 400, 600);
    const fit2 = calculateGarmentFit(neutral2, mockPantsMetadata, 400, 600);

    expect(fit1.scale.x).toBeCloseTo(fit2.scale.x, 4);
    expect(fit1.anchor.x).toBeCloseTo(fit2.anchor.x, 4);
    expect(fit1.anchor.y).toBeCloseTo(fit2.anchor.y, 4);
  });

  // Case 13: Temporary loss of left hip
  it('Case 13: low visibility of left hip does not produce NaN or inverted scale', () => {
    const pose = createMockPose();
    pose.landmarks[23].visibility = 0.1;

    const fit = calculateGarmentFit(pose, mockPantsMetadata, 400, 600);
    expect(Number.isFinite(fit.scale.x)).toBe(true);
    expect(fit.scale.x).toBeGreaterThan(0);
  });

  // Case 14: Temporary loss of right hip
  it('Case 14: low visibility of right hip does not produce NaN', () => {
    const pose = createMockPose();
    pose.landmarks[24].visibility = 0.1;

    const fit = calculateGarmentFit(pose, mockPantsMetadata, 400, 600);
    expect(Number.isFinite(fit.scale.x)).toBe(true);
    expect(fit.scale.x).toBeGreaterThan(0);
  });

  // Case 15: Selected size S vs L
  it('Case 15: selected size S vs L remains visually distinct and effective', () => {
    const pose = createMockPose();

    // Size S: smaller garment hips (e.g. 90cm)
    const fitSizeS = calculateGarmentFit(
      pose,
      mockPantsMetadata,
      400,
      600,
      undefined,
      undefined,
      { hips: 98 }, // wearer hips 98cm
      { hips: 90 }  // garment hips 90cm
    );

    // Size L: larger garment hips (e.g. 106cm)
    const fitSizeL = calculateGarmentFit(
      pose,
      mockPantsMetadata,
      400,
      600,
      undefined,
      undefined,
      { hips: 98 }, // wearer hips 98cm
      { hips: 106 } // garment hips 106cm
    );

    expect(fitSizeL.scale.x).toBeGreaterThan(fitSizeS.scale.x);
    expect(fitSizeL.scale.x / fitSizeS.scale.x).toBeCloseTo(106 / 90, 1);
  });

  // Case 16: Legacy pants metadata
  it('Case 16: legacy pants metadata without explicit new fields falls back gracefully', () => {
    const legacyMetadata: GarmentMetadata = {
      id: 'legacy_pants',
      category: 'pants',
      calibrationVersion: '1.0.0',
      ingestionStatus: 'AR_READY',
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
      anchorConfidence: 'merchant_confirmed',
      anchorType: 'WAIST',
      restPoseMetricWidth: 0.34,
      boneMap: {},
      restPose: 'T_POSE',
    };

    const pose = createMockPose();
    const fit = calculateGarmentFit(pose, legacyMetadata, 400, 600);

    expect(fit.confidence).toBeGreaterThan(0);
    expect(fit.scale.x).toBeGreaterThan(1.5);
    expect(Number.isFinite(fit.scale.x)).toBe(true);
  });

  // Case 17: Upper-body garment unchanged
  it('Case 17: upper-body garment behavior is 100% unchanged (regression-free)', () => {
    const pose = createMockPose();
    const fitShirt = calculateGarmentFit(pose, mockShirtMetadata, 400, 600);

    // Should anchor at shoulders: (240 + 160) / 2 - 400/2 = 0
    expect(fitShirt.anchor.x).toBeCloseTo(0, 1);

    // Shirt width is based on shoulders (80px), NO lower-body 1.78 ratio or pants ease
    // targetWidthPx = 80px. Scale = (80 / 100) / 0.4 = 2.0
    expect(fitShirt.scale.x).toBeCloseTo(2.0, 1);
    expect(fitShirt.scale.y).toBeCloseTo(2.0, 1);
    expect(fitShirt.scale.z).toBeCloseTo(2.0, 1);
  });

  // Parity: SceneView Projection validation for pants
  it('SceneViewProjection computes silhouette-expanded scale and per-axis values for pants', () => {
    const projection = new SceneViewProjection();
    const result = projection.update(
      { x: 0.55, y: 0.5 }, // left hip
      { x: 0.45, y: 0.5 }, // right hip
      { x: 0, y: 0, z: 0, w: 1 },
      400,
      800,
      0.34,
      1.0,
      { isBottomGarment: true }
    );

    expect(result).not.toBeNull();
    if (result) {
      expect(result.scaleX).toBeGreaterThan(0);
      expect(result.scaleY).toBeGreaterThan(0);
      expect(result.scaleZ).toBeGreaterThan(0);
      expect(result.scaleX).toBeCloseTo(result.scaleZ, 4);

      // Anchored position should apply scaleX/scaleY
      const pos = computeSceneViewAnchoredPosition(result, { x: 0, y: 0.95, z: 0 });
      expect(Number.isFinite(pos[0])).toBe(true);
      expect(Number.isFinite(pos[1])).toBe(true);
      expect(Number.isFinite(pos[2])).toBe(true);
    }
  });

  // Rig Validator & Retargeter validation for pants
  it('SceneViewSkeletalRetargeter and RigValidator correctly handle lower-body leg bones', () => {
    const validation = validateGarmentRig(mockPantsMetadata);
    expect(validation.isLoaded).toBe(true);

    const retargeter = new SceneViewSkeletalRetargeter(mockPantsMetadata);
    const boneTransforms = retargeter.computePerFrameBoneTransforms({
      LeftUpLeg: { x: 0, y: 0, z: 0.1, w: 0.995 },
      RightUpLeg: { x: 0, y: 0, z: -0.1, w: 0.995 },
    });

    expect(boneTransforms.length).toBeGreaterThan(0);
    const upLeg = boneTransforms.find((b) => b.boneName.includes('LeftUpLeg'));
    expect(upLeg).toBeDefined();
  });
});
