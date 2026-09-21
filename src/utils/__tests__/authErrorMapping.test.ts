import {
  mapAuthErrorMessage,
  isPhoneUniqueConflict,
  DUPLICATE_PHONE_MESSAGE,
} from '../authErrorMapping';

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

  it('maps user already registered to enumeration-safe copy', () => {
    const res = mapAuthErrorMessage({ message: 'User already registered' });
    expect(res).toBe('An account with this email may already exist. Try signing in or use password recovery.');

    const resCode = mapAuthErrorMessage({ code: 'user_already_exists' });
    expect(resCode).toBe('An account with this email may already exist. Try signing in or use password recovery.');
  });

  it('maps manual_linking_disabled to policy explanation', () => {
    const res = mapAuthErrorMessage({ code: 'manual_linking_disabled' });
    expect(res).toBe('Connecting or disconnecting login providers is disabled by the current authentication policy.');

    const resMsg = mapAuthErrorMessage('Manual linking is disabled');
    expect(resMsg).toBe('Connecting or disconnecting login providers is disabled by the current authentication policy.');
  });

  it('maps single_identity_not_deletable to lockout explanation', () => {
    const res = mapAuthErrorMessage({ code: 'single_identity_not_deletable' });
    expect(res).toBe("You can't disconnect your only linked sign-in method.");

    const res2 = mapAuthErrorMessage({ code: 'cannot_unlink_only_identity' });
    expect(res2).toBe("You can't disconnect your only linked sign-in method.");
  });

  it('maps identity_already_exists to safe account explanation', () => {
    const res = mapAuthErrorMessage({ code: 'identity_already_exists' });
    expect(res).toBe("That sign-in method can't be linked to this account. Try another sign-in method or a different Google account.");
  });

  it('detects and maps idx_profiles_phone_unique constraint violations safely', () => {
    const pgError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_profiles_phone_unique"',
      details: 'Key (phone)=(+639123659917) already exists.',
    };

    expect(isPhoneUniqueConflict(pgError)).toBe(true);

    const mapped = mapAuthErrorMessage(pgError);
    expect(mapped).toBe(DUPLICATE_PHONE_MESSAGE);
    expect(mapped).not.toContain('23505');
    expect(mapped).not.toContain('idx_profiles_phone_unique');
    expect(mapped).not.toContain('+639123659917');
    expect(mapped).not.toContain('Key (phone)');

    // Fallback string detection
    expect(isPhoneUniqueConflict('duplicate key value violates unique constraint "idx_profiles_phone_unique"')).toBe(true);
    expect(isPhoneUniqueConflict({ code: '23505', details: 'phone' })).toBe(true);
    expect(isPhoneUniqueConflict({ message: 'Network error' })).toBe(false);
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
