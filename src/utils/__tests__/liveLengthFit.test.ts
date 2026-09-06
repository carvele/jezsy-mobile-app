import type { PoseFrame } from '../../types/pose';
import { computeLiveLengthFit } from '../liveLengthFit';

function frame(): PoseFrame {
  const normalizedLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const worldLandmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
  worldLandmarks[11].y = worldLandmarks[12].y = -0.45;
  return { normalizedLandmarks, worldLandmarks, timestamp: 100 };
}

describe('live length confidence boundary', () => {
  it.each(['shirt', 'jacket', 'Shirt'])('uses metric torso length for %s', (category) => {
    expect(computeLiveLengthFit(frame(), 65, category)).toEqual({
      verdict: 'appropriate', chartLengthCm: 65, deltaCm: 0, trackedTorsoLengthCm: 45,
    });
  });

  it.each(['dress', 'pants', 'skirt', 'crop-top', '', null, undefined])('does not apply the tops baseline to %s', (category) => {
    expect(computeLiveLengthFit(frame(), 65, category)).toBeNull();
  });

  it('never substitutes normalized landmarks when world data is missing or incomplete', () => {
    const pose = frame();
    pose.worldLandmarks = [];
    expect(computeLiveLengthFit(pose, 65, 'shirt')).toBeNull();
    pose.worldLandmarks = frame().worldLandmarks.slice(0, 25);
    expect(computeLiveLengthFit(pose, 65, 'shirt')).toBeNull();
  });

  it.each([11, 12, 23, 24])('requires confidence in joint %i', (index) => {
    const pose = frame();
    pose.normalizedLandmarks[index].visibility = 0.64;
    expect(computeLiveLengthFit(pose, 65, 'shirt')).toBeNull();
    pose.normalizedLandmarks[index].visibility = NaN;
    expect(computeLiveLengthFit(pose, 65, 'shirt')).toBeNull();
  });

  it.each(['x', 'y', 'z'] as const)('requires finite world %s values', (axis) => {
    const pose = frame();
    pose.worldLandmarks[11][axis] = Infinity;
    expect(computeLiveLengthFit(pose, 65, 'shirt')).toBeNull();
  });

  it('rejects missing metric depth instead of manufacturing it', () => {
    const pose = frame();
    delete (pose.worldLandmarks[11] as { z?: number }).z;
    expect(computeLiveLengthFit(pose, 65, 'shirt')).toBeNull();
  });

  it('requires the torso to remain in the camera image', () => {
    const pose = frame();
    pose.normalizedLandmarks[23].y = 1.1;
    expect(computeLiveLengthFit(pose, 65, 'shirt')).toBeNull();
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, 0, -1])('rejects invalid chart length %s', (length) => {
    expect(computeLiveLengthFit(frame(), length, 'shirt')).toBeNull();
  });
});
