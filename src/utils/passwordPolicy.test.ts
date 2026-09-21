import {
  passwordPolicyError,
  evaluatePasswordRequirements,
  areAllPasswordRequirementsMet,
  translatePasswordServerError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENT_HINT,
} from './passwordPolicy';

describe('passwordPolicyError', () => {
  test('accepts a password satisfying every requirement', () => {
    expect(passwordPolicyError('Secur3Pass!')).toBeNull();
  });

  test('rejects a password shorter than the minimum length', () => {
    expect(passwordPolicyError('Ab1!')).toBe(`Please use at least ${PASSWORD_MIN_LENGTH} characters.`);
  });

  test('rejects a password missing a lowercase letter', () => {
    expect(passwordPolicyError('SECUR3PASS!')).toBe('Please add a lowercase letter.');
  });

  test('rejects a password missing an uppercase letter', () => {
    expect(passwordPolicyError('secur3pass!')).toBe('Please add an uppercase letter.');
  });

  test('rejects a password missing a number', () => {
    expect(passwordPolicyError('SecurePass!')).toBe('Please add a number.');
  });

  test('rejects a password missing a symbol', () => {
    expect(passwordPolicyError('Secur3Pass')).toBe('Please add a symbol, like ! or #.');
  });

  test('checks requirements in order -- length first, then character classes', () => {
    // Too short AND missing every character class: length message wins.
    expect(passwordPolicyError('ab')).toBe(`Please use at least ${PASSWORD_MIN_LENGTH} characters.`);
  });
});

describe('areAllPasswordRequirementsMet', () => {
  test('returns true only when every requirement is satisfied', () => {
    expect(areAllPasswordRequirementsMet('Secur3Pass!')).toBe(true);
    expect(areAllPasswordRequirementsMet('invalid')).toBe(false);
    expect(areAllPasswordRequirementsMet('')).toBe(false);
  });
});

describe('evaluatePasswordRequirements', () => {
  test('returns all 5 requirement checks in correct order with labels and shortLabels', () => {
    const checks = evaluatePasswordRequirements('');
    expect(checks).toHaveLength(5);
    expect(checks.map(c => c.id)).toEqual(['length', 'uppercase', 'lowercase', 'number', 'symbol']);
    expect(checks.map(c => c.shortLabel)).toEqual(['8+ chars', 'A-Z', 'a-z', '0-9', 'Symbol']);
    expect(checks.every(c => c.met === false)).toBe(true);
  });

  test('correctly evaluates individual rules independently', () => {
    // Only uppercase
    const upperOnly = evaluatePasswordRequirements('A');
    expect(upperOnly.find(c => c.id === 'uppercase')?.met).toBe(true);
    expect(upperOnly.find(c => c.id === 'lowercase')?.met).toBe(false);
    expect(upperOnly.find(c => c.id === 'length')?.met).toBe(false);

    // Length and lowercase
    const lenLower = evaluatePasswordRequirements('abcdefgh');
    expect(lenLower.find(c => c.id === 'length')?.met).toBe(true);
    expect(lenLower.find(c => c.id === 'lowercase')?.met).toBe(true);
    expect(lenLower.find(c => c.id === 'uppercase')?.met).toBe(false);
    expect(lenLower.find(c => c.id === 'number')?.met).toBe(false);
    expect(lenLower.find(c => c.id === 'symbol')?.met).toBe(false);

    // Fully valid
    const full = evaluatePasswordRequirements('Valid123!');
    expect(full.every(c => c.met)).toBe(true);
  });
});

describe('translatePasswordServerError', () => {
  test('translates the raw Supabase character-class error into the friendly hint', () => {
    const raw = 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789';
    expect(translatePasswordServerError(raw)).toBe(PASSWORD_REQUIREMENT_HINT);
  });

  test('is case-insensitive when matching the raw error', () => {
    expect(translatePasswordServerError('PASSWORD SHOULD CONTAIN something')).toBe(PASSWORD_REQUIREMENT_HINT);
  });

  test('passes through any other server error message unchanged', () => {
    expect(translatePasswordServerError('Network request failed')).toBe('Network request failed');
  });
});
