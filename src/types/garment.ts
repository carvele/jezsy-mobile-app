import type { Vec3 } from './pose';

export type GarmentCategory = 'shirt' | 'dress' | 'jacket' | 'pants' | 'skirt';

export interface GarmentFitProfile {
  category: GarmentCategory;

  anchors: {
    neck?: Vec3;
    leftShoulder?: Vec3;
    rightShoulder?: Vec3;
    leftHip?: Vec3;
    rightHip?: Vec3;
    waist?: Vec3;
  };

  dimensions: {
    shoulderWidth: number;
    chestWidth: number;
    waistWidth?: number;
    length: number;
    sleeveLength?: number;
  };

  rig?: {
    skeletonUrl: string;
    meshUrl: string;
  };
}
