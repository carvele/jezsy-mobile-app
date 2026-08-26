/**
 * oneEuroFilter.ts
 *
 * Adaptive first-order low-pass filter for real-time biomechanical landmark
 * stabilization in AR and computer vision applications.
 *
 * Reference: Casiez, G., Roussel, N. and Vogel, D. (2012).
 * 1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems.
 * CHI '12: Proceedings of the SIGCHI Conference on Human Factors in Computing Systems.
 */

import type { Landmark } from './poseDetector';

class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.y === null) {
      this.s = value;
      this.y = value;
      return value;
    }
    this.y = alpha * value + (1.0 - alpha) * this.s!;
    this.s = this.y;
    return this.y;
  }

  hasLast(): boolean {
    return this.y !== null;
  }

  last(): number {
    return this.y ?? 0;
  }

  reset(): void {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xFilter: LowPassFilter;
  private dxFilter: LowPassFilter;
  private lastTime: number | null = null;

  /**
   * @param minCutoff Minimum cutoff frequency (Hz). Lower values = more jitter reduction when stationary.
   * @param beta Speed coefficient. Higher values = faster response/less lag during quick motion.
   * @param dCutoff Cutoff frequency for velocity derivation (Hz).
   */
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
  }

  private alpha(rate: number, cutoff: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  filter(value: number, timestampMs: number): number {
    if (this.lastTime === null) {
      this.lastTime = timestampMs;
      return this.xFilter.filter(value, 1.0);
    }

    const dt = Math.max((timestampMs - this.lastTime) / 1000.0, 1e-4);
    this.lastTime = timestampMs;
    const rate = 1.0 / dt;

    // Estimate instantaneous velocity derivative
    const dx = this.xFilter.hasLast() ? (value - this.xFilter.last()) * rate : 0;
    const edx = this.dxFilter.filter(dx, this.alpha(rate, this.dCutoff));

    // Adaptive cutoff frequency: f_c = f_min + beta * |v|
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(value, this.alpha(rate, cutoff));
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/**
 * Multi-channel filter manager for all 33 BlazePose landmarks (X, Y, Z).
 */
export class PoseLandmarkFilter {
  private xFilters: OneEuroFilter[] = [];
  private yFilters: OneEuroFilter[] = [];
  private zFilters: OneEuroFilter[] = [];

  // Independent filter state for world (metric) coordinates to avoid cross-contamination
  private worldXFilters: OneEuroFilter[] = [];
  private worldYFilters: OneEuroFilter[] = [];
  private worldZFilters: OneEuroFilter[] = [];

  constructor(defaultMinCutoff = 1.2, defaultBeta = 0.015, dCutoff = 1.0) {
    for (let i = 0; i < 33; i++) {
      let minCutoff = defaultMinCutoff;
      let beta = defaultBeta;

      // Joint-specific configuration for AR stability vs responsiveness
      if ([11, 12, 23, 24].includes(i)) {
        // Torso polygon (shoulders, hips): Needs extremely stable, heavy filtering to prevent garment jitter
        minCutoff = 0.5;
        beta = 0.005;
      } else if ([15, 16, 17, 18, 19, 20, 21, 22].includes(i)) {
        // Hands and wrists: Need highly responsive, lighter filtering for occlusion and gestural tracking
        minCutoff = 3.0;
        beta = 0.05;
      } else if ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(i)) {
        // Head/Face: Moderate filtering
        minCutoff = 1.0;
        beta = 0.01;
      }

      this.xFilters.push(new OneEuroFilter(minCutoff, beta, dCutoff));
      this.yFilters.push(new OneEuroFilter(minCutoff, beta, dCutoff));
      this.zFilters.push(new OneEuroFilter(minCutoff * 0.8, beta * 0.5, dCutoff));

      // For world landmarks (meters), we use slightly more aggressive filtering
      // because meter scale noise has high impact on 3D retargeting and bone rotations
      this.worldXFilters.push(new OneEuroFilter(minCutoff * 0.8, beta * 0.8, dCutoff));
      this.worldYFilters.push(new OneEuroFilter(minCutoff * 0.8, beta * 0.8, dCutoff));
      this.worldZFilters.push(new OneEuroFilter(minCutoff * 0.5, beta * 0.5, dCutoff));
    }
  }

  /**
   * Filters an array of 33 normalized landmarks, returning a new smoothed landmark array.
   */
  filterLandmarks(landmarks: Landmark[], timestampMs?: number): Landmark[] {
    if (!landmarks || landmarks.length === 0) return landmarks;
    const now = timestampMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());

    return landmarks.map((lm, idx) => {
      if (idx >= 33) return lm;

      const filteredX = this.xFilters[idx].filter(lm.x, now);
      const filteredY = this.yFilters[idx].filter(lm.y, now);
      const filteredZ = lm.z !== undefined ? this.zFilters[idx].filter(lm.z, now) : 0;

      return {
        ...lm,
        x: filteredX,
        y: filteredY,
        z: filteredZ,
      };
    });
  }

  /**
   * Filters an array of 33 metric world landmarks.
   * This operates on a completely independent filter state to avoid contaminating the normalized filter.
   */
  filterWorldLandmarks<T extends Landmark>(landmarks: T[], timestampMs?: number): T[] {
    if (!landmarks || landmarks.length === 0) return landmarks;
    const now = timestampMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());

    return landmarks.map((lm, idx) => {
      if (idx >= 33) return lm;

      const filteredX = this.worldXFilters[idx].filter(lm.x, now);
      const filteredY = this.worldYFilters[idx].filter(lm.y, now);
      const filteredZ = lm.z !== undefined ? this.worldZFilters[idx].filter(lm.z, now) : 0;

      return {
        ...lm,
        x: filteredX,
        y: filteredY,
        z: filteredZ,
      };
    });
  }

  reset(): void {
    this.xFilters.forEach(f => f.reset());
    this.yFilters.forEach(f => f.reset());
    this.zFilters.forEach(f => f.reset());
    this.worldXFilters.forEach(f => f.reset());
    this.worldYFilters.forEach(f => f.reset());
    this.worldZFilters.forEach(f => f.reset());
  }
}
