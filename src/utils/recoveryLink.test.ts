const mockSetSession = jest.fn();

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      setSession: (...args: unknown[]) => mockSetSession(...args),
    },
  },
}));

import { parseRecoveryTokens, handleRecoveryUrl } from './recoveryLink';

const RECOVERY_URL =
  'jezsymobileapp://reset-password#access_token=at123&refresh_token=rt456&type=recovery';

describe('parseRecoveryTokens', () => {
  test('extracts tokens from a fragment-based recovery URL', () => {
    expect(parseRecoveryTokens(RECOVERY_URL)).toEqual({
      accessToken: 'at123',
      refreshToken: 'rt456',
    });
  });

  test('extracts tokens from a query-string-based recovery URL', () => {
    const url = 'jezsymobileapp://reset-password?access_token=at123&refresh_token=rt456&type=recovery';
    expect(parseRecoveryTokens(url)).toEqual({ accessToken: 'at123', refreshToken: 'rt456' });
  });

  test('prefers the fragment over the query string when both are present', () => {
    const url = 'jezsymobileapp://reset-password?foo=bar#access_token=frag&refresh_token=frag2&type=recovery';
    expect(parseRecoveryTokens(url)).toEqual({ accessToken: 'frag', refreshToken: 'frag2' });
  });

  test('returns null for a URL with no fragment or query string', () => {
    expect(parseRecoveryTokens('jezsymobileapp://home')).toBeNull();
  });

  test('returns null when type is not "recovery" (e.g. a signup confirmation link)', () => {
    const url = 'jezsymobileapp://confirm#access_token=at123&refresh_token=rt456&type=signup';
    expect(parseRecoveryTokens(url)).toBeNull();
  });

  test('returns null when access_token is missing', () => {
    const url = 'jezsymobileapp://reset-password#refresh_token=rt456&type=recovery';
    expect(parseRecoveryTokens(url)).toBeNull();
  });

  test('returns null when refresh_token is missing', () => {
    const url = 'jezsymobileapp://reset-password#access_token=at123&type=recovery';
    expect(parseRecoveryTokens(url)).toBeNull();
  });

  test('returns null for a plain app open with no params at all', () => {
    expect(parseRecoveryTokens('jezsymobileapp://')).toBeNull();
  });
});

describe('handleRecoveryUrl', () => {
  afterEach(() => mockSetSession.mockReset());

  test('returns false for a null URL without touching the session', async () => {
    expect(await handleRecoveryUrl(null)).toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  test('returns false for a non-recovery URL without touching the session', async () => {
    expect(await handleRecoveryUrl('jezsymobileapp://home')).toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  test('establishes the session and returns true for a valid recovery URL', async () => {
    mockSetSession.mockResolvedValue({ error: null });
    const result = await handleRecoveryUrl(RECOVERY_URL);
    expect(result).toBe(true);
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'at123', refresh_token: 'rt456' });
  });

  test('returns false when setSession itself errors (e.g. an expired recovery link)', async () => {
    mockSetSession.mockResolvedValue({ error: new Error('Token has expired') });
    const result = await handleRecoveryUrl(RECOVERY_URL);
    expect(result).toBe(false);
  });
});
