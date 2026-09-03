import { checkCalibrationPlausibility } from '../garmentCalibrationGuard';

describe('checkCalibrationPlausibility', () => {

  // Real values confirmed live via direct DB query this session (see
  // ar-tryon-audit-implementation-plan.md #25/#26). These are the ground truth the
  // bounds were chosen against, not synthetic examples.

  it('accepts Black tee (the one product confirmed sane by live A/B test)', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.4,
      anatomicalAnchorOffset: { x: 6.456865264681255e-9, y: 0.10529425740242004, z: -6.502623772774996e-9 },
    });
    expect(result.plausible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('accepts Cotton T-Shirt post-fix (copied from Black tee, same GLB)', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.4,
      anatomicalAnchorOffset: { x: 6.456865264681255e-9, y: 0.10529425740242004, z: -6.502623772774996e-9 },
    });
    expect(result.plausible).toBe(true);
  });

  it('rejects Tailored Blazer pre-fix (anchor_offset.y = 1.304, the actual live-broken value)', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.35715197350238126,
      anatomicalAnchorOffset: { x: -0.000005645752991085802, y: 1.3043573201828005, z: 0.001261271625627093 },
    });
    expect(result.plausible).toBe(false);
    expect(result.reasons.length).toBe(1);
    expect(result.reasons[0]).toContain('anatomicalAnchorOffset.y');
  });

  it('rejects Cotton T-Shirt pre-fix on width alone if the width were grossly wrong (regression guard for the bounds themselves)', () => {
    // 0.22 (the ACTUAL original bad value) is deliberately NOT flagged here -- it's a
    // plausible width in isolation, and this test documents that limitation rather than
    // asserting a false capability. A width this grossly wrong (half the real GLB
    // measurement of ~0.59, well outside the ingested value's neighborhood) IS caught.
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.02,
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
    });
    expect(result.plausible).toBe(false);
    expect(result.reasons[0]).toContain('restPoseMetricWidth');
  });

  it('does NOT catch the original Cotton T-Shirt bug (0.22m) -- documents the guard\'s real limit, not a passing assertion to celebrate', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.22,
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
    });
    expect(result.plausible).toBe(true);
  });

  it('accepts the demo-rig fallback\'s own values (buildFallbackMetadata in [id].tsx) -- the guard must never flag its own fallback', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.35, // shirt fallback
      anatomicalAnchorOffset: { x: 0, y: 0.5, z: 0 },
    });
    expect(result.plausible).toBe(true);
  });

  it('rejects a missing anatomicalAnchorOffset', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.4,
      anatomicalAnchorOffset: undefined as any,
    });
    expect(result.plausible).toBe(false);
    expect(result.reasons[0]).toContain('missing or has a non-finite component');
  });

  it('rejects a non-finite width (NaN/undefined from a malformed DB record)', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: NaN,
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
    });
    expect(result.plausible).toBe(false);
    expect(result.reasons[0]).toContain('restPoseMetricWidth');
  });

  it('rejects a negative anchor y (behind the shoulder, geometrically implausible for a shoulder-anchored garment)', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.4,
      anatomicalAnchorOffset: { x: 0, y: -0.1, z: 0 },
    });
    expect(result.plausible).toBe(false);
    expect(result.reasons[0]).toContain('anatomicalAnchorOffset.y');
  });

  it('rejects large lateral (x/z) noise even when width and y are fine', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 0.4,
      anatomicalAnchorOffset: { x: 0.3, y: 0.1, z: 0.3 },
    });
    expect(result.plausible).toBe(false);
    expect(result.reasons.length).toBe(2);
    expect(result.reasons.some(r => r.includes('anatomicalAnchorOffset.x'))).toBe(true);
    expect(result.reasons.some(r => r.includes('anatomicalAnchorOffset.z'))).toBe(true);
  });

  it('collects multiple simultaneous reasons rather than stopping at the first', () => {
    const result = checkCalibrationPlausibility({
      restPoseMetricWidth: 5, // too wide
      anatomicalAnchorOffset: { x: 0, y: 2, z: 0 }, // y too large
    });
    expect(result.plausible).toBe(false);
    expect(result.reasons.length).toBe(2);
  });

  it('accepts the exact lower and upper width bounds', () => {
    expect(checkCalibrationPlausibility({
      restPoseMetricWidth: 0.1,
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
    }).plausible).toBe(true);
    expect(checkCalibrationPlausibility({
      restPoseMetricWidth: 1.0,
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
    }).plausible).toBe(true);
  });

  it('rejects just past the width bounds', () => {
    expect(checkCalibrationPlausibility({
      restPoseMetricWidth: 0.099,
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
    }).plausible).toBe(false);
    expect(checkCalibrationPlausibility({
      restPoseMetricWidth: 1.001,
      anatomicalAnchorOffset: { x: 0, y: 0.1, z: 0 },
    }).plausible).toBe(false);
  });

});
