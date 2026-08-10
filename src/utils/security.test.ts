import { needsStepUpReauth } from './stepUpAuth';

describe('Security & Step-Up Auth Logic', () => {
  test('returns true when user or last_sign_in_at is missing', () => {
    expect(needsStepUpReauth(null)).toBe(true);
    expect(needsStepUpReauth(undefined)).toBe(true);
    expect(needsStepUpReauth({ last_sign_in_at: undefined })).toBe(true);
  });

  test('returns false when last sign in was within the 30-day window', () => {
    const recentSignIn = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(needsStepUpReauth({ last_sign_in_at: recentSignIn })).toBe(false);
  });

  test('returns true when last sign in was older than 30 days', () => {
    const oldSignIn = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    expect(needsStepUpReauth({ last_sign_in_at: oldSignIn })).toBe(true);
  });
});
