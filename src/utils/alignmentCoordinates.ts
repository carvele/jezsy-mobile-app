import type { Landmark } from './poseDetector';

export interface AlignmentCoordinateContext {
  isMirrored: boolean;
  sensorRotation: 0 | 90 | 180 | 270;
}

/**
 * Normalizes raw camera-sensor landmarks into a canonical user-facing coordinate space.
 * X is [0.0, 1.0] from user's visual left to right.
 * Y is [0.0, 1.0] from top to bottom.
 */
export function normalizeAlignmentLandmarks(
  landmarks: Landmark[],
  context: AlignmentCoordinateContext
): Landmark[] {
  return landmarks.map(lm => {
    let { x, y } = lm;

    // First apply the sensor rotation to bring the frame upright.
    // If sensorRotation is 90, the raw image is rotated 90deg clockwise relative to upright.
    // So we rotate the coordinates 90deg counter-clockwise to compensate.
    // (Depending on the exact sensor mapping, this might need adjusting, but this provides 4-rotation coverage).
    if (context.sensorRotation === 90) {
      const nx = y;
      const ny = 1 - x;
      x = nx;
      y = ny;
    } else if (context.sensorRotation === 180) {
      const nx = 1 - x;
      const ny = 1 - y;
      x = nx;
      y = ny;
    } else if (context.sensorRotation === 270) {
      const nx = 1 - y;
      const ny = x;
      x = nx;
      y = ny;
    }

    // Mirroring: if it's a front camera, X needs to be flipped so it acts as a mirror 
    // (user's visual left is on the left side of the screen).
    if (context.isMirrored) {
      x = 1 - x;
    }

    return {
      ...lm,
      x,
      y
    };
  });
}
