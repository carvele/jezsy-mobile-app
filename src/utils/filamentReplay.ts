import type { PoseFrame } from '../types/pose';

export const FILAMENT_REPLAY_FRAMES = 120;
export const FILAMENT_REPLAY_INTERVAL_MS = 50;

// Synthetic detector-space poses avoid recording or persisting anyone's biometric data.
export function filamentReplayFrame(index: number): PoseFrame {
  const phase = (index % FILAMENT_REPLAY_FRAMES) / FILAMENT_REPLAY_FRAMES * Math.PI * 2;
  const worldLandmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const arm = 0.15 * Math.sin(phase);
  const coords: Record<number, [number, number, number]> = {
    11: [0.2, -0.45, 0], 12: [-0.2, -0.45, 0], 23: [0.15, 0, 0], 24: [-0.15, 0, 0],
    13: [0.35, -0.2 - arm, 0], 14: [-0.35, -0.2 + arm, 0],
    15: [0.4, 0.05 - arm * 2, -0.05], 16: [-0.4, 0.05 + arm * 2, -0.05],
  };
  for (const [key, [x, y, z]] of Object.entries(coords)) worldLandmarks[Number(key)] = { x, y, z, visibility: 1 };
  const normalizedLandmarks = worldLandmarks.map((p) => ({ ...p, x: 0.5 + p.x * 0.5 + Math.sin(phase) * 0.05, y: 0.6 + p.y * 0.5 }));
  return { worldLandmarks, normalizedLandmarks, timestamp: index * FILAMENT_REPLAY_INTERVAL_MS };
}
