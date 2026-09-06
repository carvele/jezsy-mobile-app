import type { PoseFrame } from '../types/pose';
import { computeLengthFitSignal, type LengthFitSignal } from './sizeRecommender';

const TORSO_JOINTS = [11, 12, 23, 24];

export function computeLiveLengthFit(
  frame: PoseFrame,
  chartLengthCm: number | null | undefined,
  category: string | null | undefined,
): LengthFitSignal | null {
  // The existing hip-drop baseline is for tops, not dresses or lower-body garments.
  if (!['shirt', 'jacket'].includes(category?.toLowerCase() ?? '')) return null;
  if (!frame.worldLandmarks || frame.worldLandmarks.length < 33) return null;
  if (!TORSO_JOINTS.every((index) => {
    const image = frame.normalizedLandmarks[index];
    const world = frame.worldLandmarks[index];
    return image && world && Number.isFinite(image.visibility) && image.visibility >= 0.65
      && Number.isFinite(image.x) && image.x >= 0 && image.x <= 1
      && Number.isFinite(image.y) && image.y >= 0 && image.y <= 1
      && Number.isFinite(world.x) && Number.isFinite(world.y) && Number.isFinite(world.z);
  })) return null;
  return computeLengthFitSignal(frame.worldLandmarks, chartLengthCm);
}
