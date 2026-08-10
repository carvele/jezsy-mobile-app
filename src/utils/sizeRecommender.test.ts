import { recommendSize, analyzeFit } from './sizeRecommender';

describe('Size Recommender & Fit Analysis', () => {
  const sampleChart = {
    S: { bust: 88, waist: 70, hips: 94 },
    M: { bust: 94, waist: 76, hips: 100 },
    L: { bust: 100, waist: 82, hips: 106 },
  };

  test('returns null when product measurements or user metrics are missing', () => {
    expect(recommendSize({ bust: null }, sampleChart)).toBeNull();
    expect(recommendSize({ bust: 90 }, null)).toBeNull();
  });

  test('recommends best fitting size based on user measurements', () => {
    const user = { bust: 90, waist: 72, hips: 96 };
    expect(recommendSize(user, sampleChart, 'regular')).toBe('M');
  });

  test('analyzes fit zones correctly', () => {
    const user = { bust: 90, waist: 72, hips: 96 };
    const garment = { bust: 94, waist: 76, hips: 100 };

    const zones = analyzeFit(user, garment);
    expect(zones.length).toBe(3);
    expect(zones.find((z) => z.zone === 'Bust')?.verdict).toBe('fitted');
  });
});
