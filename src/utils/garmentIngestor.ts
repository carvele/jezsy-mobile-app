import type { GarmentMetadata, IngestionStatus, GarmentCategory } from '../types/garment';

const STANDARD_BONES = [
  'Spine',
  'Spine1',
  'Spine2',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
];

export class GarmentIngestor {
  /**
   * Analyzes an uploaded GLTF scene and generates a canonical GarmentMetadata contract.
   */
  public static analyzeGLB(
    id: string,
    category: GarmentCategory,
    scene: any // THREE.Object3D
  ): GarmentMetadata {
    let hasSkinnedMesh = false;
    const bones: Record<string, any> = {};
    const boneMap: Record<string, string> = {};

    // 1. Traverse and Validate Skeleton
    scene.traverse((child: any) => {
      if (child.isSkinnedMesh) {
        hasSkinnedMesh = true;
      }
      if (child.isBone) {
        bones[child.name] = child;
      }
    });

    if (!hasSkinnedMesh || Object.keys(bones).length === 0) {
      return this.createFailureResult(id, category, 'NOT_AR_COMPATIBLE');
    }

    // 2. Auto-map bones (heuristic matching)
    let mappedCount = 0;
    for (const stdBone of STANDARD_BONES) {
      // Look for exact match, or Mixamo prefix
      if (bones[stdBone]) {
        boneMap[stdBone] = stdBone;
        mappedCount++;
      } else if (bones['mixamorig' + stdBone]) {
        boneMap[stdBone] = 'mixamorig' + stdBone;
        mappedCount++;
      }
    }

    const ingestionStatus: IngestionStatus =
      mappedCount >= 3 ? 'AR_READY' : 'NEEDS_MERCHANT_MAPPING';

    // 3. Metric Scale Calibration
    // In a real Node environment we'd use 'three' package to measure the bounding box.
    // Here we stub it out because 'three' is loaded via CDN in the frontend WebView.
    const restPoseMetricWidth = 0.5;

    // 4. Anatomical Anchoring
    // Instead of Box3 center, we find a specific anchor.
    // For shirts/dresses, the anchor is the neck/spine top.
    const anchorOffset = { x: 0, y: 0.5, z: 0 };
    if (boneMap['Spine2']) {
      const spine2 = bones[boneMap['Spine2']];
      // spine2.getWorldPosition(new THREE.Vector3())
      // We stub this for the typechecker.
    }

    return {
      id,
      category,
      calibrationVersion: '1.0.0',
      ingestionStatus,
      anatomicalAnchorOffset: { x: anchorOffset.x, y: anchorOffset.y, z: anchorOffset.z },
      restPoseMetricWidth,
      boneMap,
      restPose: 'T_POSE' // Can be heuristically detected by arm angles
    };
  }

  private static createFailureResult(
    id: string,
    category: GarmentCategory,
    status: IngestionStatus
  ): GarmentMetadata {
    return {
      id,
      category,
      calibrationVersion: '1.0.0',
      ingestionStatus: status,
      anatomicalAnchorOffset: { x: 0, y: 0, z: 0 },
      restPoseMetricWidth: 0.5,
      boneMap: {},
      restPose: 'CUSTOM'
    };
  }
}
