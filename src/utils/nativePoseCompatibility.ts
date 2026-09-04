/**
 * nativePoseCompatibility -- the device-compatibility layer between the native
 * MediaPipe pose callback and everything downstream.
 *
 * WHY THIS EXISTS
 * ---------------
 * On the primary test device (Infinix X6880), raw landmarks arrive from the native
 * pose-detection callback already rotated ~90deg: the two shoulder landmarks show
 * near-zero separation on X and the full shoulder-width separation on Y. See
 * docs/ar-tryon-audit-implementation-plan.md findings #23/#24 for the full
 * investigation, including the proof that the rotation happens inside
 * MediaPipe/the native plugin, BEFORE any TypeScript in this repo runs.
 *
 * Applying a proper 90deg rotation -- derived algebraically from ~30 captured live
 * samples and verified against every one -- fixed three symptoms simultaneously:
 * torso roll dropped from a pinned ~-90deg to ~0-9deg, camera-distance
 * triangulation began varying with real distance instead of sitting at its 0.6m
 * bootstrap seed, and the garment rendered upright and centred on the wearer's
 * shoulders instead of edge-on or off-screen.
 *
 * THIS IS PERMANENT, NOT A WORKAROUND AWAITING REMOVAL.
 * `forceCameraOrientation` was tried as the "real" fix (2026-09-02): the library's
 * BaseViewCoordinator then logs sensorOrientation="landscape-right" correctly and
 * consistently, but the rotated landmarks still occur. It is correct to set and
 * insufficient on its own, so this compensation is the load-bearing fix.
 *
 * SCOPE: native only. The web path (WebCameraFeed -> handlePoseResults) never
 * passes through here and is unaffected.
 *
 * Extracted from app/ar-tryon/[id].tsx per roadmap Phase 3 -- it is the permanent
 * device-compat seam, and isolating it makes the guard directly testable against
 * synthetic landmark sets rather than only observable through a live camera.
 */

/** Minimal shape this layer needs; real landmarks carry visibility/presence too. */
export interface CompatLandmark {
  x: number;
  y: number;
  z?: number;
  [key: string]: any;
}

/** Shoulder landmark indices, the only pair the guard inspects. */
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

/**
 * Minimum vertical shoulder separation before the guard will fire at all. Below
 * this the frame is too small/noisy to distinguish a real rotation from jitter.
 */
export const MIN_VERTICAL_SEPARATION = 0.15;

/**
 * How much the vertical separation must dominate the horizontal before the frame
 * is treated as rotated. A genuine frontal shoulder line is wider than it is tall;
 * requiring dy to be meaningfully larger (not merely larger) avoids flipping a
 * frame from someone genuinely turned near-profile, where dx legitimately shrinks.
 */
export const VERTICAL_DOMINANCE_FACTOR = 2;

/**
 * True when this frame's landmarks show the rotated signature and should be
 * corrected. Deliberately conservative: a device WITHOUT the underlying bug
 * produces dx > dy for a frontal subject and is left untouched.
 *
 * Known limit: its behaviour on hardware other than the Infinix X6880 is
 * unverified (roadmap Step H, blocked on a second device). It is the only safety
 * net for a real native-library defect, so it must not fire on a legitimate pose.
 */
export function shouldCorrectNativeLandmarkRotation(landmarks: CompatLandmark[] | null | undefined): boolean {
  if (!landmarks) return false;
  const l11 = landmarks[LEFT_SHOULDER];
  const l12 = landmarks[RIGHT_SHOULDER];
  if (!l11 || !l12) return false;
  const dx = Math.abs(l12.x - l11.x);
  const dy = Math.abs(l12.y - l11.y);
  return dy > MIN_VERTICAL_SEPARATION && dy > dx * VERTICAL_DOMINANCE_FACTOR;
}

/**
 * 90deg rotation for METRIC world landmarks (origin at the hips, so it rotates
 * about the origin): (x, y) -> (y, -x). z is depth and is unaffected.
 */
export function correctWorldLandmarkRotation<T extends CompatLandmark>(p: T): T {
  return { ...p, x: p.y, y: -p.x };
}

/**
 * The same 90deg rotation for NORMALIZED [0,1] image-space landmarks, applied
 * about the image centre rather than the origin: (x, y) -> (y, 1 - x).
 */
export function correctNormalized2DLandmarkRotation<T extends CompatLandmark>(p: T): T {
  return { ...p, x: p.y, y: 1 - p.x };
}

/**
 * Applies the compensation to a whole frame when the guard fires, returning the
 * landmarks unchanged otherwise. Returns whether it fired so the caller can keep
 * the `[COMP-GUARD]` telemetry that proved this layer's reliability (39/39 frames
 * correct after a fresh app restart -- see audit finding #24).
 */
export function applyNativePoseCompatibility(
  normalizedLandmarks: CompatLandmark[] | null | undefined,
  worldLandmarks: CompatLandmark[] | null | undefined
): {
  normalizedLandmarks: CompatLandmark[] | null | undefined;
  worldLandmarks: CompatLandmark[] | null | undefined;
  triggered: boolean;
} {
  const triggered = !!(
    normalizedLandmarks &&
    normalizedLandmarks.length > 0 &&
    shouldCorrectNativeLandmarkRotation(normalizedLandmarks)
  );

  if (!triggered) {
    return { normalizedLandmarks, worldLandmarks, triggered: false };
  }

  return {
    normalizedLandmarks: normalizedLandmarks!.map(correctNormalized2DLandmarkRotation),
    worldLandmarks: worldLandmarks ? worldLandmarks.map(correctWorldLandmarkRotation) : worldLandmarks,
    triggered: true,
  };
}
