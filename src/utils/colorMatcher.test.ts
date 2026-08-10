import { evaluateColors } from './colorMatcher';

describe('Color Matcher & Harmony Evaluator', () => {
  test('returns default guidance when no colors are provided', () => {
    const res = evaluateColors([]);
    expect(res.score).toBe(75);
    expect(res.label).toBe('Neutral / Balanced');
  });

  test('evaluates monochrome all-neutral palette as Perfect Harmony', () => {
    const res = evaluateColors(['black', 'white', 'grey']);
    expect(res.score).toBe(95);
    expect(res.label).toBe('Perfect Harmony');
  });

  test('detects metallic clash when multiple metals are combined', () => {
    const res = evaluateColors(['gold', 'silver']);
    expect(res.score).toBe(45);
    expect(res.label).toBe('Clashing Colors');
    expect(res.feedback).toContain('gold and silver');
  });

  test('scores single chromatic color against neutrals as high harmony', () => {
    const res = evaluateColors(['red', 'black', 'white']);
    expect(res.score).toBeGreaterThanOrEqual(90);
    expect(res.label).toBe('Perfect Harmony');
  });
});
