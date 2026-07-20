/**
 * Pixel-space crop-rect helpers bridging normalized ROI math (poseDetector.ts,
 * blazePoseAnchors.ts) to vision-camera-resize-plugin's pixel-space `crop`
 * option. Kept separate from poseDetector.ts so that file can stay purely
 * about landmark math, independent of frame dimensions.
 *
 * Coordinate convention: cross-crop math (converting a landmark from one
 * square sub-crop into the reference frame, or computing a distance between
 * two such landmarks) is always done in plain camera-frame PIXEL space, not
 * [0,1]-normalized-per-axis. This matters because normalizing x by
 * frameWidth and y by frameHeight independently is NOT a uniform scale
 * whenever the frame isn't square (true for virtually every phone camera) --
 * it would silently distort any distance/size calculation that mixes x and
 * y deltas (exactly what computeRoiFromAlignmentPoints does). Since every
 * sub-crop used in this pipeline (the detector's center-square crop, and
 * each landmark-model ROI crop) is square by construction, mapping
 * ROI-local [0,1] -> frame-pixel via that crop's own (equal) width/height
 * is a uniform scale and safe to use in distance math.
 *
 * [0,1]-per-axis normalization is only used for the debug overlay, which
 * renders each point independently (no cross-axis distance math) against a
 * view that itself matches the frame's aspect ratio.
 */

import type { Landmark } from './poseDetector';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * The largest centered square within the frame, in pixel space. Used to
 * build the detector stage's 224x224 input without distorting aspect ratio.
 */
export function computeCenterSquareCrop(frameWidth: number, frameHeight: number): CropRect {
  'worklet';
  const size = Math.min(frameWidth, frameHeight);
  return {
    x: Math.round((frameWidth - size) / 2),
    y: Math.round((frameHeight - size) / 2),
    width: size,
    height: size,
  };
}

/**
 * Maps a normalized [0,1] point relative to a square sub-crop into plain
 * camera-frame pixel coordinates. Safe to use in distance calculations
 * because sourceCrop.width === sourceCrop.height (every crop in this
 * pipeline is square).
 */
export function roiLocalToFramePixels(point: { x: number; y: number }, sourceCrop: CropRect): PixelPoint {
  'worklet';
  return {
    x: sourceCrop.x + point.x * sourceCrop.width,
    y: sourceCrop.y + point.y * sourceCrop.height,
  };
}

export function roiLocalLandmarksToFramePixels(
  landmarks: Landmark[],
  sourceCrop: CropRect
): (PixelPoint & { z: number; visibility: number })[] {
  'worklet';
  const out: (PixelPoint & { z: number; visibility: number })[] = [];
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const mapped = roiLocalToFramePixels(lm, sourceCrop);
    out.push({ x: mapped.x, y: mapped.y, z: lm.z, visibility: lm.visibility });
  }
  return out;
}

export interface PixelRoi {
  centerX: number;
  centerY: number;
  size: number; // square side length, in frame pixels
}

/**
 * Converts a pixel-space ROI (center + square size) into a CropRect,
 * clamped so it stays within the frame bounds. Clamping shifts the crop
 * rather than shrinking it, so the output is always exactly the requested
 * size (falling back to the nearest in-bounds position) -- required
 * because the resize plugin's crop must fit entirely within the source
 * frame.
 */
export function pixelRoiToClampedCropRect(
  roi: PixelRoi,
  frameWidth: number,
  frameHeight: number
): CropRect {
  'worklet';
  const clampedSize = Math.max(1, Math.min(Math.round(roi.size), frameWidth, frameHeight));

  let x = Math.round(roi.centerX - clampedSize / 2);
  let y = Math.round(roi.centerY - clampedSize / 2);

  x = Math.max(0, Math.min(x, frameWidth - clampedSize));
  y = Math.max(0, Math.min(y, frameHeight - clampedSize));

  return { x, y, width: clampedSize, height: clampedSize };
}
