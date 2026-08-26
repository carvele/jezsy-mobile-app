import type { Landmark } from './poseDetector';

export interface TransformContext {
  videoWidth: number;
  videoHeight: number;
  stageWidth: number;
  stageHeight: number;
  isMirrored: boolean;
  objectFit: 'cover' | 'contain' | 'fill';
}

/**
 * Transforms a normalized MediaPipe landmark (0 to 1) from the source video's coordinate space
 * into the physical pixel coordinates of the rendering stage, accounting for CSS object-fit rules,
 * aspect ratio cropping, and mirroring.
 */
export function videoNormalizedToStage(
  landmark: Landmark,
  ctx: TransformContext
): Landmark {
  const { videoWidth, videoHeight, stageWidth, stageHeight, isMirrored, objectFit } = ctx;
  
  if (videoWidth === 0 || videoHeight === 0 || stageWidth === 0 || stageHeight === 0) {
    return { ...landmark };
  }

  const videoAspect = videoWidth / videoHeight;
  const stageAspect = stageWidth / stageHeight;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (objectFit === 'cover') {
    if (videoAspect > stageAspect) {
      // Video is wider than stage; scaled by height and cropped horizontally
      scale = stageHeight / videoHeight;
      const scaledVideoWidth = videoWidth * scale;
      offsetX = (stageWidth - scaledVideoWidth) / 2;
    } else {
      // Video is taller than stage; scaled by width and cropped vertically
      scale = stageWidth / videoWidth;
      const scaledVideoHeight = videoHeight * scale;
      offsetY = (stageHeight - scaledVideoHeight) / 2;
    }
  } else if (objectFit === 'contain') {
    if (videoAspect > stageAspect) {
      // Video is wider; scaled by width and letterboxed vertically
      scale = stageWidth / videoWidth;
      const scaledVideoHeight = videoHeight * scale;
      offsetY = (stageHeight - scaledVideoHeight) / 2;
    } else {
      // Video is taller; scaled by height and pillarboxed horizontally
      scale = stageHeight / videoHeight;
      const scaledVideoWidth = videoWidth * scale;
      offsetX = (stageWidth - scaledVideoWidth) / 2;
    }
  } else {
    // 'fill' - stretch to fit completely
    return {
      x: isMirrored ? stageWidth - (landmark.x * stageWidth) : landmark.x * stageWidth,
      y: landmark.y * stageHeight,
      z: landmark.z,
      visibility: landmark.visibility
    };
  }

  // Calculate the raw pixel position in the un-cropped scaled video
  let pixelX = landmark.x * videoWidth * scale;
  let pixelY = landmark.y * videoHeight * scale;

  // Apply mirroring if necessary
  if (isMirrored) {
    pixelX = (videoWidth * scale) - pixelX;
  }

  // Apply crop/letterbox offset to get final stage coordinates
  return {
    x: pixelX + offsetX,
    y: pixelY + offsetY,
    z: landmark.z, // Depth is preserved as relative value
    visibility: landmark.visibility
  };
}

/**
 * Convenience function to map an array of landmarks using the same context.
 */
export function transformLandmarksToStage(
  landmarks: Landmark[],
  ctx: TransformContext
): Landmark[] {
  return landmarks.map(lm => videoNormalizedToStage(lm, ctx));
}
