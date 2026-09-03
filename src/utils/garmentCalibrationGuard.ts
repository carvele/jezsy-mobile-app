import type { GarmentMetadata } from '../types/garment';

/**
 * Phase 1 instrumentation (ar-tryon-implementation-roadmap.md): a client-side sanity
 * check on garment calibration data, independent of the DB's own ingestion_status.
 *
 * Why this exists: ingestion_status === 'AR_READY' is not proof of calibration (see
 * ar-system-contract.md section 9) -- the Tailored Blazer sat AR_READY with
 * anatomicalAnchorOffset.y = 1.304 (should be ~0.1) and rendered visibly broken live
 * before anyone caught it. This is defense in depth: even if a future ingestion or a
 * manual DB edit stamps AR_READY on bad data again, an obviously-wrong value should not
 * reach the renderer silently.
 *
 * What this deliberately does NOT catch: subtly wrong values within a plausible range.
 * The original Cotton T-Shirt bug (restPoseMetricWidth = 0.22 for a GLB that measures
 * ~0.59, and whose sibling product using the identical file uses 0.4) was only caught by
 * comparing against a sibling product sharing the same GLB -- 0.22m is a plausible
 * garment width in isolation. Bounds checking is a coarse net for grossly wrong values,
 * not a replacement for that kind of cross-reference.
 */

const MIN_METRIC_WIDTH_M = 0.1;
const MAX_METRIC_WIDTH_M = 1.0;

// The anchor offset is meant to be a pure Y-offset from the garment's origin to its
// anatomical anchor (see anatomicalAnchorOffset's own doc comment in types/garment.ts).
// Confirmed across every live-calibrated product to date (Black tee, Cotton T-Shirt):
// x and z sit at ~1e-9, i.e. floating-point noise around zero. MAX_ANCHOR_LATERAL_M is
// deliberately generous relative to that noise floor.
const MAX_ANCHOR_LATERAL_M = 0.05;
// The demo-rig fallback itself uses y: 0.5 (see buildFallbackMetadata in
// app/ar-tryon/[id].tsx) -- the real ceiling must sit above that with headroom, while
// still rejecting the Blazer's 1.304 by a wide margin.
const MAX_ANCHOR_Y_M = 0.6;

export interface CalibrationPlausibilityResult {
  plausible: boolean;
  /** Empty when plausible. Each entry is a human-readable reason, safe to log as-is. */
  reasons: string[];
}

/**
 * Checks only the two fields with a confirmed live failure mode (#25's anchor offset,
 * #26's metric width). Does not check boneMap, restPose, or category -- those have no
 * confirmed bad-data history and a plausible numeric range isn't a meaningful concept
 * for them.
 */
export function checkCalibrationPlausibility(
  metadata: Pick<GarmentMetadata, 'restPoseMetricWidth' | 'anatomicalAnchorOffset'>
): CalibrationPlausibilityResult {
  const reasons: string[] = [];

  const width = metadata.restPoseMetricWidth;
  if (!Number.isFinite(width) || width < MIN_METRIC_WIDTH_M || width > MAX_METRIC_WIDTH_M) {
    reasons.push(
      `restPoseMetricWidth ${width} is outside the plausible [${MIN_METRIC_WIDTH_M}, ${MAX_METRIC_WIDTH_M}]m range`
    );
  }

  const offset = metadata.anatomicalAnchorOffset;
  if (
    !offset ||
    !Number.isFinite(offset.x) ||
    !Number.isFinite(offset.y) ||
    !Number.isFinite(offset.z)
  ) {
    reasons.push('anatomicalAnchorOffset is missing or has a non-finite component');
  } else {
    if (offset.y < 0 || offset.y > MAX_ANCHOR_Y_M) {
      reasons.push(
        `anatomicalAnchorOffset.y ${offset.y} is outside the plausible [0, ${MAX_ANCHOR_Y_M}]m range`
      );
    }
    if (Math.abs(offset.x) > MAX_ANCHOR_LATERAL_M) {
      reasons.push(
        `anatomicalAnchorOffset.x ${offset.x} exceeds ${MAX_ANCHOR_LATERAL_M}m -- expected near-zero (pure Y-offset by design)`
      );
    }
    if (Math.abs(offset.z) > MAX_ANCHOR_LATERAL_M) {
      reasons.push(
        `anatomicalAnchorOffset.z ${offset.z} exceeds ${MAX_ANCHOR_LATERAL_M}m -- expected near-zero (pure Y-offset by design)`
      );
    }
  }

  return { plausible: reasons.length === 0, reasons };
}
