import type { Landmark } from '@/src/utils/poseDetector';
import type { TrackingState } from '@/src/utils/trackingState';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BodyCoordinateFrame {
  origin: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export interface BodyOrientation {
  yawRad: number;
  pitchRad: number;
  rollRad: number;
  isFacingForward: boolean;
  isBackFacing: boolean;
}

export interface BodyPose {
  /** The local orthonormal basis vectors representing the torso's orientation in 3D space */
  coordinateFrame: BodyCoordinateFrame;
  /** Raw landmarks directly from the pose detector (e.g. MediaPipe) */
  landmarks: Landmark[];
  /** Temporally smoothed landmarks (e.g. via One Euro filter) */
  filteredLandmarks: Landmark[];
  /** Euler angles and boolean flags representing the overall body orientation */
  orientation: BodyOrientation;
  /** The current confidence state of the tracking (e.g., GOOD_FIT, TURN_TOO_FAR) */
  trackingState: TrackingState;
  /** Overall confidence score of the pose [0, 1] */
  confidence: number;
}

export interface GarmentDimensions {
  shoulderWidthPx: number;
  chestWidthPx: number;
  lengthPx: number;
}

export interface GarmentFitState {
  /** The 2D/3D focal point where the garment is attached to the body */
  anchor: Vec3;
  /** Scale factors to apply to the garment mesh or image */
  scale: Vec3;
  /** Rotation to apply to the garment */
  rotation: Quaternion;
  /** Physical or pixel dimensions of the scaled garment */
  dimensions: GarmentDimensions;
  /** Fit confidence score [0, 1] */
  confidence: number;
}
