import { normalizeSizes, validateSizingMode, compareSizes } from '../sizeOrder';

describe('Canonical Apparel Size Normalization & Ordering', () => {
  test('reorders scrambled standard sizes: S, M, L, XL, XS -> XS, S, M, L, XL', () => {
    expect(normalizeSizes(['S', 'M', 'L', 'XL', 'XS'])).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  test('reorders M, S, XS, L -> XS, S, M, L', () => {
    expect(normalizeSizes(['M', 'S', 'XS', 'L'])).toEqual(['XS', 'S', 'M', 'L']);
  });

  test('reorders S, XS -> XS, S', () => {
    expect(normalizeSizes(['S', 'XS'])).toEqual(['XS', 'S']);
  });

  test('normalizes aliases before deduplication: XXL, XL, 2XL, M -> M, XL, 2XL', () => {
    expect(normalizeSizes(['XXL', 'XL', '2XL', 'M'])).toEqual(['M', 'XL', '2XL']);
  });

  test('sorts numeric shoe/clothing sizes naturally: 40, 36, 38, 37 -> 36, 37, 38, 40', () => {
    expect(normalizeSizes(['40', '36', '38', '37'])).toEqual(['36', '37', '38', '40']);
  });

  test('normalizes Free Size to One Size', () => {
    expect(normalizeSizes(['Free Size'])).toEqual(['One Size']);
    expect(normalizeSizes(['OS'])).toEqual(['One Size']);
  });

  test('flags validation warning for mixed One Size and graded sizes', () => {
    let warningLogged = '';
    const result = normalizeSizes(['One Size', 'M'], {
      onWarning: (msg) => {
        warningLogged = msg;
      },
    });

    expect(result).toEqual(['One Size', 'M']);
    expect(warningLogged).toContain('One Size must be used as an exclusive sizing mode');
    const validation = validateSizingMode(['One Size', 'M']);
    expect(validation.isValid).toBe(false);
    expect(validation.hasMixedOneSize).toBe(true);
  });

  test('preserves custom/unknown labels deterministically at the end', () => {
    expect(normalizeSizes(['XS', 'Custom', 'M'])).toEqual(['XS', 'M', 'Custom']);
  });

  test('strips null, undefined, and blank strings cleanly', () => {
    expect(normalizeSizes(['S', '', null as any, '  ', 'M'])).toEqual(['S', 'M']);
  });

  test('correctly compares sizes via compareSizes comparator', () => {
    expect(compareSizes('XS', 'S')).toBeLessThan(0);
    expect(compareSizes('XL', 'S')).toBeGreaterThan(0);
    expect(compareSizes('M', 'M')).toBe(0);
    expect(compareSizes('One Size', 'L')).toBeLessThan(0);
  });
});
