import {
  quaternionToSceneViewEulerDeg,
  slerpQuaternion,
  SceneViewProjection,
  computeSceneViewAnchoredPosition,
} from '../sceneViewMath';
import { validateGarmentRig, parseGlbHeader } from '../sceneViewRigValidator';
import { SceneViewSkeletalRetargeter, type BoneLocalTransform } from '../sceneViewRetargeter';
import type { GarmentMetadata } from '../../types/garment';
import type { CameraCalibration } from '../../types/arRenderState';

describe('SceneView AR Renderer Integration', () => {
  describe('1. Rig & Asset Validation (Phase 5)', () => {
    const mockMetadata: GarmentMetadata = {
      id: 'prod_tee',
      category: 'shirt',
      calibrationVersion: '1.0',
      ingestionStatus: 'AR_READY',
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
      anchorConfidence: 'merchant_confirmed',
      anchorType: 'NECK',
      restPoseMetricWidth: 0.42,
      boneMap: {
        LeftArm: 'mixamorigLeftArm',
        RightArm: 'mixamorigRightArm',
        LeftForeArm: 'mixamorigLeftForeArm',
        RightForeArm: 'mixamorigRightForeArm',
      },
      restPose: 'A_POSE',
    };

    it('validates a complete Mixamo-rigged garment asset', () => {
      const mockHeader = {
        meshes: [{ name: 'GarmentMesh' }],
        skins: [{ joints: [0, 1, 2, 3] }],
        nodes: [
          { name: 'mixamorigLeftArm' },
          { name: 'mixamorigRightArm' },
          { name: 'mixamorigLeftForeArm' },
          { name: 'mixamorigRightForeArm' },
        ],
        materials: [{ name: 'CottonFabric', pbrMetallicRoughness: {} }],
      };

      const result = validateGarmentRig(mockMetadata, mockHeader);
      expect(result.isLoaded).toBe(true);
      expect(result.hasMesh).toBe(true);
      expect(result.hasSkin).toBe(true);
      expect(result.boneCount).toBe(4);
      expect(result.missingBones).toHaveLength(0);
      expect(result.isSkinnedGarment).toBe(true);
      expect(result.diagnostics).toContain('[AR-SCENEVIEW-ASSET]');
      expect(result.diagnostics).toContain('mixamorigLeftArm: OK');
    });

    it('gracefully reports missing bones without crashing', () => {
      const incompleteHeader = {
        meshes: [{ name: 'GarmentMesh' }],
        skins: [{ joints: [0, 1] }],
        nodes: [
          { name: 'mixamorigLeftArm' },
          { name: 'mixamorigRightArm' },
          // Missing forearms
        ],
      };

      const result = validateGarmentRig(mockMetadata, incompleteHeader);
      expect(result.missingBones).toContain('mixamorigLeftForeArm');
      expect(result.missingBones).toContain('mixamorigRightForeArm');
      expect(result.isSkinnedGarment).toBe(false);
      expect(result.diagnostics.some((d) => d.includes('Missing required bone'))).toBe(true);
    });

    it('parses valid binary GLB header JSON chunk', () => {
      // Construct a synthetic 32-byte GLB header
      const jsonString = JSON.stringify({ meshes: [{ name: 'test' }] });
      const jsonBytes = new TextEncoder().encode(jsonString);
      const totalLen = 20 + jsonBytes.length;
      const buffer = new ArrayBuffer(totalLen);
      const view = new DataView(buffer);

      view.setUint32(0, 0x46546c67, true); // "glTF"
      view.setUint32(4, 2, true); // version 2
      view.setUint32(8, totalLen, true);
      view.setUint32(12, jsonBytes.length, true);
      view.setUint32(16, 0x4e4f534a, true); // "JSON"

      new Uint8Array(buffer, 20).set(jsonBytes);

      const parsed = parseGlbHeader(buffer);
      expect(parsed).not.toBeNull();
      expect(parsed?.meshes?.[0].name).toBe('test');
    });

    it('returns null safely on truncated or invalid GLB buffer', () => {
      const invalidBuffer = new ArrayBuffer(10);
      expect(parseGlbHeader(invalidBuffer)).toBeNull();
    });
  });

  describe('2. Quaternion & Euler Angle Conversions (Phase 6)', () => {
    it('converts identity quaternion to zero degrees Euler', () => {
      const euler = quaternionToSceneViewEulerDeg({ x: 0, y: 0, z: 0, w: 1 });
      expect(euler).toEqual([0, 0, 0]);
    });

    it('converts a pure 90-degree yaw rotation accurately', () => {
      // 90 deg about Y axis: w = cos(45) = 0.7071, y = sin(45) = 0.7071
      const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
      const [pitch, yaw, roll] = quaternionToSceneViewEulerDeg(q);
      expect(pitch).toBeCloseTo(0, 1);
      expect(yaw).toBeCloseTo(90, 1);
      expect(roll).toBeCloseTo(0, 1);
    });

    it('converts a pure 45-degree pitch rotation (X-axis) accurately', () => {
      // 45 deg about X axis: w = cos(22.5), x = sin(22.5)
      const rad = (45 * Math.PI) / 180 / 2;
      const q = { x: Math.sin(rad), y: 0, z: 0, w: Math.cos(rad) };
      const [pitch, yaw, roll] = quaternionToSceneViewEulerDeg(q);
      expect(pitch).toBeCloseTo(45, 1);
      expect(yaw).toBeCloseTo(0, 1);
      expect(roll).toBeCloseTo(0, 1);
    });

    it('converts a pure 45-degree roll rotation (Z-axis) accurately', () => {
      // 45 deg about Z axis: w = cos(22.5), z = sin(22.5)
      const rad = (45 * Math.PI) / 180 / 2;
      const q = { x: 0, y: 0, z: Math.sin(rad), w: Math.cos(rad) };
      const [pitch, yaw, roll] = quaternionToSceneViewEulerDeg(q);
      expect(pitch).toBeCloseTo(0, 1);
      expect(yaw).toBeCloseTo(0, 1);
      expect(roll).toBeCloseTo(45, 1);
    });

    it('handles degenerate or zero quaternion safely without NaN', () => {
      const euler = quaternionToSceneViewEulerDeg({ x: 0, y: 0, z: 0, w: 0 });
      expect(euler).toEqual([0, 0, 0]);
      expect(euler.every(Number.isFinite)).toBe(true);
    });

    it('interpolates quaternions smoothly with SLERP', () => {
      const q1 = { x: 0, y: 0, z: 0, w: 1 };
      const q2 = { x: 0, y: 1, z: 0, w: 0 }; // 180 deg yaw
      const mid = slerpQuaternion(q1, q2, 0.5);
      expect(mid.y).toBeCloseTo(Math.SQRT1_2, 3);
      expect(mid.w).toBeCloseTo(Math.SQRT1_2, 3);
    });
  });

  describe('3. Camera Calibration & Sizing Projection (Phases 8 & 9)', () => {
    const mockCalibration: CameraCalibration = {
      focalLengthPx: 1100,
      verticalFovDeg: 55,
      videoWidthPx: 1280,
      videoHeightPx: 720,
      wearerShoulderWidthM: 0.44,
    };

    it('projects shoulder landmarks with real camera calibration', () => {
      const projection = new SceneViewProjection(mockCalibration);
      const leftShoulder = { x: 0.35, y: 0.4 };
      const rightShoulder = { x: 0.65, y: 0.4 };
      const rotation = { x: 0, y: 0, z: 0, w: 1 };

      const result = projection.update(
        leftShoulder,
        rightShoulder,
        rotation,
        390,
        600,
        0.42, // metric width
        1.0 // fit modifier
      );

      expect(result).not.toBeNull();
      expect(result!.distance).toBeGreaterThan(0.5);
      expect(result!.scale).toBeGreaterThan(0);
      expect(result!.rotationEulerDeg).toBeDefined();
      expect(result!.fov).toBe(55);
    });

    it('visibly changes garment scale between Size S and Size L using fitModifier', () => {
      const projSmall = new SceneViewProjection(mockCalibration);
      const projLarge = new SceneViewProjection(mockCalibration);

      const left = { x: 0.4, y: 0.4 };
      const right = { x: 0.6, y: 0.4 };
      const rot = { x: 0, y: 0, z: 0, w: 1 };

      const resSmall = projSmall.update(left, right, rot, 390, 600, 0.42, 0.95);
      const resLarge = projLarge.update(left, right, rot, 390, 600, 0.42, 1.15);

      expect(resSmall).not.toBeNull();
      expect(resLarge).not.toBeNull();
      // Size L scale must be noticeably larger than Size S
      expect(resLarge!.scale).toBeGreaterThan(resSmall!.scale * 1.15);
    });

    it('computes anatomical anchor offset translation relative to rotation and scale', () => {
      const projection = new SceneViewProjection(mockCalibration);
      const res = projection.update(
        { x: 0.4, y: 0.4 },
        { x: 0.6, y: 0.4 },
        { x: 0, y: 0, z: 0, w: 1 },
        390,
        600,
        0.42,
        1.0
      );
      expect(res).not.toBeNull();

      const anchorOffset = { x: 0, y: 0.12, z: 0.05 };
      const pos = computeSceneViewAnchoredPosition(res!, anchorOffset);

      expect(pos).toHaveLength(3);
      expect(pos[0]).toBeCloseTo(res!.position.x, 3);
      // Y offset applied negatively relative to scale
      expect(pos[1]).toBeLessThan(res!.position.y);
    });

    it('returns null and does not crash when landmarks contain NaN or zero dimensions', () => {
      const projection = new SceneViewProjection(mockCalibration);
      const invalid = projection.update(
        { x: NaN, y: 0.4 },
        { x: 0.6, y: 0.4 },
        { x: 0, y: 0, z: 0, w: 1 },
        390,
        600,
        0.42,
        1.0
      );
      expect(invalid).toBeNull();
    });
  });

  describe('4. Skeletal Retargeting & Per-Joint Deformation (Phase 2)', () => {
    const mockMetadata: GarmentMetadata = {
      id: 'prod_jacket',
      category: 'jacket',
      calibrationVersion: '1.0',
      ingestionStatus: 'AR_READY',
      anatomicalAnchorOffset: { x: 0, y: 0.15, z: 0 },
      anchorConfidence: 'merchant_confirmed',
      anchorType: 'NECK',
      restPoseMetricWidth: 0.46,
      boneMap: {
        LeftArm: 'mixamorigLeftArm',
        RightArm: 'mixamorigRightArm',
        LeftForeArm: 'mixamorigLeftForeArm',
        RightForeArm: 'mixamorigRightForeArm',
        Spine: 'mixamorigSpine',
      },
      restPose: 'A_POSE',
    };

    it('resolves bone names once and caches mapping without re-searching', () => {
      const retargeter = new SceneViewSkeletalRetargeter(mockMetadata);
      expect(retargeter.getResolvedBoneName('LeftArm')).toBe('mixamorigLeftArm');
      expect(retargeter.getResolvedBoneName('RightForeArm')).toBe('mixamorigRightForeArm');
      expect(retargeter.getResolvedBoneName('Spine')).toBe('mixamorigSpine');
    });

    it('returns exact rest pose with zero drift on neutral pose (identity deltas)', () => {
      const retargeter = new SceneViewSkeletalRetargeter(mockMetadata);
      const w = Math.sqrt(1 - 0.1 * 0.1 - 0.2 * 0.2 - 0.3 * 0.3);
      retargeter.registerBindTransform({
        boneName: 'mixamorigLeftArm',
        mappedEntityName: 'mixamorigLeftArm',
        localRotation: { x: 0.1, y: 0.2, z: 0.3, w },
        worldRotation: { x: 0.1, y: 0.2, z: 0.3, w },
        position: [0.2, 1.4, 0],
        scale: [1, 1, 1],
      });

      // Pass neutral pose (identity)
      const transforms = retargeter.computePerFrameBoneTransforms({});
      const leftArm = transforms.find((t: BoneLocalTransform) => t.boneName === 'mixamorigLeftArm');

      expect(leftArm).toBeDefined();
      expect(leftArm!.rotation.x).toBeCloseTo(0.1, 4);
      expect(leftArm!.rotation.y).toBeCloseTo(0.2, 4);
      expect(leftArm!.rotation.z).toBeCloseTo(0.3, 4);
      expect(leftArm!.rotation.w).toBeCloseTo(w, 4);
    });

    it('deforms only the left sleeve when raising the left arm while right sleeve stays rest pose', () => {
      const retargeter = new SceneViewSkeletalRetargeter(mockMetadata);
      retargeter.registerBindTransform({
        boneName: 'mixamorigLeftArm',
        mappedEntityName: 'mixamorigLeftArm',
        localRotation: { x: 0, y: 0, z: 0, w: 1 },
        worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        position: [0.2, 1.4, 0],
        scale: [1, 1, 1],
      });
      retargeter.registerBindTransform({
        boneName: 'mixamorigRightArm',
        mappedEntityName: 'mixamorigRightArm',
        localRotation: { x: 0, y: 0, z: 0, w: 1 },
        worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        position: [-0.2, 1.4, 0],
        scale: [1, 1, 1],
      });

      // 45 degree delta only on LeftArm
      const rad = (45 * Math.PI) / 180 / 2;
      const leftDelta = { x: Math.sin(rad), y: 0, z: 0, w: Math.cos(rad) };

      const transforms = retargeter.computePerFrameBoneTransforms({
        mixamorigLeftArm: leftDelta,
      });

      const left = transforms.find((t: BoneLocalTransform) => t.boneName === 'mixamorigLeftArm');
      const right = transforms.find((t: BoneLocalTransform) => t.boneName === 'mixamorigRightArm');

      // Left arm has delta applied
      expect(left!.rotation.x).toBeCloseTo(Math.sin(rad), 4);
      // Right arm remains in undisturbed bind pose
      expect(right!.rotation.x).toBeCloseTo(0, 4);
      expect(right!.rotation.w).toBeCloseTo(1, 4);
    });

    it('composes valid 16-element column-major 4x4 matrix', () => {
      const retargeter = new SceneViewSkeletalRetargeter(mockMetadata);
      const transforms = retargeter.computePerFrameBoneTransforms({});
      expect(transforms[0].matrix16).toHaveLength(16);
      expect(transforms[0].matrix16.every(Number.isFinite)).toBe(true);
      // Diagonal scale components non-zero
      expect(transforms[0].matrix16[0]).not.toBe(0);
      expect(transforms[0].matrix16[5]).not.toBe(0);
      expect(transforms[0].matrix16[10]).not.toBe(0);
      expect(transforms[0].matrix16[15]).toBe(1); // homogeneous coordinate
    });
  });

  describe('5. True Material Variant Recoloring (Phase 2)', () => {
    it('parses valid #RRGGBB hex color into normalized RGBA floats', () => {
      const { hexToNormalizedRgba } = require('../sceneViewMaterialRecolorer');
      const rgba = hexToNormalizedRgba('#FF0000');
      expect(rgba).toEqual([1.0, 0, 0, 1.0]);

      const black = hexToNormalizedRgba('#000000');
      expect(black).toEqual([0, 0, 0, 1.0]);

      const invalid = hexToNormalizedRgba('invalid');
      expect(invalid).toBeNull();
    });

    it('identifies garment fabric material and excludes buttons, zippers, and logos', () => {
      const { isFabricMaterialName } = require('../sceneViewMaterialRecolorer');
      expect(isFabricMaterialName('Fabric_Cotton_Body')).toBe(true);
      expect(isFabricMaterialName('Shirt_Main_Mat')).toBe(true);
      expect(isFabricMaterialName('metal_zipper_pull')).toBe(false);
      expect(isFabricMaterialName('plastic_button_01')).toBe(false);
      expect(isFabricMaterialName('brand_logo_patch')).toBe(false);
    });

    it('recolors only fabric material in multi-material GLBs preserving metallic & roughness', () => {
      const { resolveFabricMaterialRecoloring } = require('../sceneViewMaterialRecolorer');
      const materials = [
        { name: 'Metal_Zipper', index: 0 },
        { name: 'Cotton_Fabric_Body', index: 1 },
        { name: 'Plastic_Buttons', index: 2 },
      ];

      const override = resolveFabricMaterialRecoloring('#1A3B8B', undefined, materials);
      expect(override).not.toBeNull();
      expect(override!.materialName).toBe('Cotton_Fabric_Body');
      expect(override!.materialIndex).toBe(1);
      expect(override!.baseColorFactor[0]).toBeCloseTo(0x1a / 255, 3);
      expect(override!.baseColorFactor[1]).toBeCloseTo(0x3b / 255, 3);
      expect(override!.baseColorFactor[2]).toBeCloseTo(0x8b / 255, 3);
      expect(override!.preservedAttributes).toContain('roughnessFactor');
      expect(override!.preservedAttributes).toContain('metallicFactor');
      expect(override!.preservedAttributes).toContain('normalTexture');
    });

    it('preserves authored GLB colors and warns when multiple materials have no identifiable fabric', () => {
      const { resolveFabricMaterialRecoloring } = require('../sceneViewMaterialRecolorer');
      const ambiguousMaterials = [
        { name: 'Zipper_Hardware', index: 0 },
        { name: 'Button_Trim', index: 1 },
      ];

      const override = resolveFabricMaterialRecoloring('#FFCC00', undefined, ambiguousMaterials);
      expect(override).toBeNull();
    });
  });
});

