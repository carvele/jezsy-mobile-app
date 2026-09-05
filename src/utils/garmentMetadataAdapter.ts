import type { GarmentMetadata } from '../types/garment';
import { checkCalibrationPlausibility } from './garmentCalibrationGuard';

/**
 * garmentMetadataAdapter -- the single seam between `products.garment_metadata` as
 * the database stores it and the `GarmentMetadata` shape every AR module consumes.
 *
 * WHY THIS EXISTS (roadmap Phase 3)
 * ---------------------------------
 * This adaptation lived inline in app/ar-tryon/[id].tsx and has produced three
 * separate live bugs, each silent:
 *
 *  1. The DB stores snake_case (`bone_map`, `rest_pose_metric_width`, ...) while
 *     everything downstream reads camelCase. A straight type-cast satisfied the
 *     compiler without converting the runtime object, so every calibrated field
 *     read as `undefined` -- confirmed live: `restPose` logged undefined and the
 *     metric width silently fell back to a hardcoded 0.4 for a product that had a
 *     real value of 0.22 in the database.
 *  2. `bone_map` is stored keyed by the GLB's own bone name with the canonical name
 *     as the value (`"_left_arm": "LeftArm"`), but the runtime looks it up the
 *     other way round (`boneMap[canonical] -> glbBoneName`), so every lookup failed
 *     even after the casing was fixed. It has to be inverted exactly once.
 *  3. `ingestion_status === 'AR_READY'` is not by itself proof that the numbers are
 *     sane -- the Tailored Blazer sat AR_READY with a broken anchor and rendered
 *     visibly wrong before anyone caught it by hand.
 *
 * Keeping all three in one tested place is the point: the screen becomes
 * orchestration, and these behaviours get pinned by unit tests instead of being
 * re-derived from a live camera each time someone touches the file.
 */

/** What the adapter decided, and why -- so the caller can log it rather than guess. */
export type MetadataSource =
  | 'calibrated'
  | 'no-metadata'
  | 'not-ar-ready'
  | 'failed-plausibility';

export interface AdaptedGarmentMetadata {
  metadata: GarmentMetadata;
  /** True when `metadata` is invented defaults rather than real calibration. */
  isDemoRig: boolean;
  source: MetadataSource;
  /** Populated only for 'failed-plausibility'; the guard's own reasons. */
  reasons?: string[];
  /** The raw DB status, for logging. Undefined when there was no metadata at all. */
  rawStatus?: string;
}

/**
 * Inverts the stored bone map into the direction the runtime actually queries:
 * `boneMap[canonicalName] -> glbBoneName`.
 */
export function invertBoneMap(rawBoneMap: unknown): Record<string, string> {
  const inverted: Record<string, string> = {};
  if (rawBoneMap && typeof rawBoneMap === 'object') {
    for (const [glbBoneName, canonicalName] of Object.entries(rawBoneMap as Record<string, unknown>)) {
      if (typeof canonicalName === 'string') inverted[canonicalName] = glbBoneName;
    }
  }
  return inverted;
}

/**
 * snake_case DB row -> camelCase `GarmentMetadata`. Pure shape conversion; it does
 * not judge whether the values are sane (see `adaptGarmentMetadata`).
 */
export function mapRawGarmentMetadata(raw: any): GarmentMetadata {
  return {
    id: raw.id,
    category: raw.category,
    calibrationVersion: raw.calibration_version,
    ingestionStatus: raw.ingestion_status,
    anatomicalAnchorOffset: raw.anatomical_anchor_offset,
    anchorConfidence: raw.anchor_confidence,
    anchorType: raw.anchor_type,
    restPoseMetricWidth: raw.rest_pose_metric_width,
    boneMap: invertBoneMap(raw.bone_map),
    restPose: raw.rest_pose,
  };
}

/**
 * Decides what metadata the AR screen should actually render with.
 *
 * Only `AR_READY` takes the real path, and even then the values must pass the
 * calibration sanity guard -- a coarse last-line check for grossly implausible
 * numbers, not a substitute for real ingestion validation. Anything else falls back
 * to the caller's demo rig, which marks itself `DEMO_RIG` so that `AR_READY` can be
 * trusted to mean calibrated everywhere downstream.
 */
export function adaptGarmentMetadata(
  rawMetadata: unknown,
  buildFallback: () => GarmentMetadata
): AdaptedGarmentMetadata {
  const raw = rawMetadata as any;
  const rawStatus: string | undefined = raw?.ingestion_status;

  if (!raw) {
    return { metadata: buildFallback(), isDemoRig: true, source: 'no-metadata' };
  }

  if (rawStatus !== 'AR_READY') {
    return { metadata: buildFallback(), isDemoRig: true, source: 'not-ar-ready', rawStatus };
  }

  const mapped = mapRawGarmentMetadata(raw);
  const plausibility = checkCalibrationPlausibility(mapped);
  if (!plausibility.plausible) {
    return {
      metadata: buildFallback(),
      isDemoRig: true,
      source: 'failed-plausibility',
      reasons: plausibility.reasons,
      rawStatus,
    };
  }

  return { metadata: mapped, isDemoRig: false, source: 'calibrated', rawStatus };
}
