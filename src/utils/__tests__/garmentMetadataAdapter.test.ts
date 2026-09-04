import {
  invertBoneMap,
  mapRawGarmentMetadata,
  adaptGarmentMetadata,
} from '../garmentMetadataAdapter';
import type { GarmentMetadata } from '../../types/garment';

/**
 * Each block here pins a bug this adaptation has actually shipped, live, silently.
 * See garmentMetadataAdapter.ts's own header for the history.
 */

/** A DB row as `products.garment_metadata` actually stores it: snake_case. */
function rawRow(overrides: Record<string, any> = {}) {
  return {
    id: 'p-1',
    category: 'shirt',
    calibration_version: '1.0.0',
    ingestion_status: 'AR_READY',
    anatomical_anchor_offset: { x: 0, y: 0.105, z: 0 },
    anchor_confidence: 'detected',
    anchor_type: 'SHOULDER_CENTER',
    rest_pose_metric_width: 0.4,
    // Stored keyed by the GLB's own bone name, canonical name as the value.
    bone_map: { mixamorigLeftArm: 'LeftArm', mixamorigRightArm: 'RightArm' },
    rest_pose: 'T_POSE',
    ...overrides,
  };
}

const FALLBACK: GarmentMetadata = {
  id: 'mock',
  category: 'shirt',
  calibrationVersion: '1.0.0',
  ingestionStatus: 'DEMO_RIG',
  anatomicalAnchorOffset: { x: 0, y: 0.5, z: 0 },
  anchorConfidence: 'inferred',
  anchorType: 'SHOULDER_CENTER',
  restPoseMetricWidth: 0.35,
  boneMap: {},
  restPose: 'A_POSE',
};
const buildFallback = () => ({ ...FALLBACK });

describe('garmentMetadataAdapter: snake_case -> camelCase', () => {
  it('converts every calibrated field, not just satisfying the type', () => {
    // The original bug: a straight cast compiled fine but converted nothing at
    // runtime, so each of these silently read as undefined.
    const m = mapRawGarmentMetadata(rawRow());
    expect(m.calibrationVersion).toBe('1.0.0');
    expect(m.ingestionStatus).toBe('AR_READY');
    expect(m.anatomicalAnchorOffset).toEqual({ x: 0, y: 0.105, z: 0 });
    expect(m.anchorConfidence).toBe('detected');
    expect(m.anchorType).toBe('SHOULDER_CENTER');
    expect(m.restPoseMetricWidth).toBe(0.4);
    expect(m.restPose).toBe('T_POSE');
  });

  it('does not leave restPoseMetricWidth undefined for a row that has one', () => {
    // The exact live symptom: a real 0.22 in the DB fell back to a hardcoded 0.4.
    const m = mapRawGarmentMetadata(rawRow({ rest_pose_metric_width: 0.22 }));
    expect(m.restPoseMetricWidth).toBe(0.22);
  });
});

describe('garmentMetadataAdapter: bone map inversion', () => {
  it('inverts to boneMap[canonical] -> glbBoneName, the direction lookups use', () => {
    const inverted = invertBoneMap({ mixamorigLeftArm: 'LeftArm', _right_arm: 'RightArm' });
    expect(inverted.LeftArm).toBe('mixamorigLeftArm');
    expect(inverted.RightArm).toBe('_right_arm');
  });

  it('is not the identity -- querying by the stored key must miss', () => {
    // Guards against someone "simplifying" the inversion away again.
    const inverted = invertBoneMap({ mixamorigLeftArm: 'LeftArm' });
    expect(inverted.mixamorigLeftArm).toBeUndefined();
  });

  it('skips non-string values instead of producing junk keys', () => {
    const inverted = invertBoneMap({ good: 'LeftArm', bad: 42, alsoBad: null });
    expect(inverted).toEqual({ LeftArm: 'good' });
  });

  it('tolerates a missing or malformed bone_map', () => {
    expect(invertBoneMap(undefined)).toEqual({});
    expect(invertBoneMap(null)).toEqual({});
    expect(invertBoneMap('nonsense')).toEqual({});
  });
});

describe('garmentMetadataAdapter: which metadata actually gets used', () => {
  it('uses real calibration for an AR_READY row with sane values', () => {
    const res = adaptGarmentMetadata(rawRow(), buildFallback);
    expect(res.isDemoRig).toBe(false);
    expect(res.source).toBe('calibrated');
    expect(res.metadata.restPoseMetricWidth).toBe(0.4);
    expect(res.metadata.boneMap.LeftArm).toBe('mixamorigLeftArm');
  });

  it('falls back when there is no metadata at all', () => {
    const res = adaptGarmentMetadata(null, buildFallback);
    expect(res.isDemoRig).toBe(true);
    expect(res.source).toBe('no-metadata');
    expect(res.metadata.ingestionStatus).toBe('DEMO_RIG');
  });

  it.each(['NEEDS_CALIBRATION', 'NEEDS_MERCHANT_MAPPING', 'NOT_AR_COMPATIBLE'])(
    'falls back for %s rather than rendering incomplete ingestion',
    (status) => {
      const res = adaptGarmentMetadata(rawRow({ ingestion_status: status }), buildFallback);
      expect(res.isDemoRig).toBe(true);
      expect(res.source).toBe('not-ar-ready');
      expect(res.rawStatus).toBe(status);
    }
  );

  it('falls back when AR_READY data fails the plausibility guard', () => {
    // The Tailored Blazer class of bug: stamped AR_READY, values grossly wrong.
    const res = adaptGarmentMetadata(
      rawRow({ rest_pose_metric_width: 99 }),
      buildFallback
    );
    expect(res.isDemoRig).toBe(true);
    expect(res.source).toBe('failed-plausibility');
    expect(res.reasons?.length).toBeGreaterThan(0);
  });

  it('never reports isDemoRig=false alongside DEMO_RIG metadata', () => {
    // The invariant the whole DEMO_RIG change exists to guarantee: the flag and
    // the metadata can never disagree about whether calibration is real.
    for (const raw of [null, rawRow(), rawRow({ ingestion_status: 'NEEDS_CALIBRATION' }), rawRow({ rest_pose_metric_width: 99 })]) {
      const res = adaptGarmentMetadata(raw, buildFallback);
      expect(res.isDemoRig).toBe(res.metadata.ingestionStatus === 'DEMO_RIG');
    }
  });
});
