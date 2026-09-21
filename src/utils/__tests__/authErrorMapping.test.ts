import { mapAuthErrorMessage } from '../authErrorMapping';

describe('mapAuthErrorMessage', () => {
  it('returns fallback for null or empty error', () => {
    expect(mapAuthErrorMessage(null)).toBe('Something went wrong. Please try again.');
    expect(mapAuthErrorMessage(undefined)).toBe('Something went wrong. Please try again.');
    expect(mapAuthErrorMessage('')).toBe('Something went wrong. Please try again.');
  });

  it('maps invalid login credentials', () => {
    const res = mapAuthErrorMessage(new Error('Invalid login credentials'));
    expect(res).toBe('Incorrect email, mobile number, or password. Please try again.');
  });

  it('maps unconfirmed email', () => {
    const res = mapAuthErrorMessage('Email not confirmed');
    expect(res).toBe('Please verify your email address to sign in.');
  });

  it('maps user already registered', () => {
    const res = mapAuthErrorMessage({ message: 'User already registered' });
    expect(res).toBe('An account with this email may already exist. Please sign in instead.');
  });

  it('maps rate limits and over email send rate limit', () => {
    expect(mapAuthErrorMessage({ message: 'over_email_send_rate_limit' })).toContain('too many codes');
    expect(mapAuthErrorMessage('Rate limit exceeded')).toContain('too many codes');
  });

  it('maps invalid or expired OTP tokens', () => {
    expect(mapAuthErrorMessage({ message: 'Token has expired or is invalid' })).toContain('invalid or has expired');
    expect(mapAuthErrorMessage({ error_description: 'otp_expired' })).toContain('invalid or has expired');
  });

  it('maps network errors', () => {
    expect(mapAuthErrorMessage(new Error('Network request failed'))).toContain('Network connection issue');
  });

  it('maps password policy server errors to friendly checklist message', () => {
    const res = mapAuthErrorMessage('Password should contain at least one character of each: abc.');
    expect(res).toBe('At least 8 characters, with a lowercase letter, an uppercase letter, a number and a symbol.');
  });

  it('sanitizes technical PostgREST / JSON / 500 error strings to fallback', () => {
    expect(mapAuthErrorMessage('500 Internal Server Error: PostgREST error')).toBe('Something went wrong. Please try again.');
    expect(mapAuthErrorMessage('{"code": "500", "details": "stack trace"}')).toBe('Something went wrong. Please try again.');
  });
});
