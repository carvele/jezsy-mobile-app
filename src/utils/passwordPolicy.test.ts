import { passwordPolicyError, translatePasswordServerError, PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENT_HINT } from './passwordPolicy';

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
