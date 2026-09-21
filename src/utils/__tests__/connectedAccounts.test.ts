import {
  parseUserIdentities,
  isDuplicateSignup,
  MANUAL_LINKING_POLICY_ENABLED,
  DUPLICATE_ACCOUNT_MESSAGE,
  PASSWORD_SAVED_MESSAGE,
  MANUAL_LINKING_POLICY_MESSAGE,
  SINGLE_IDENTITY_LOCKOUT_MESSAGE,
} from '../connectedAccounts';
import type { UserIdentity } from '@supabase/supabase-js';

describe('connectedAccounts utils', () => {
  describe('parseUserIdentities', () => {
    it('handles empty or null identities gracefully', () => {
      const parsedNull = parseUserIdentities(null);
      expect(parsedNull.hasGoogleIdentity).toBe(false);
      expect(parsedNull.hasEmailIdentity).toBe(false);
      expect(parsedNull.googleIdentity).toBeNull();
      expect(parsedNull.googleEmail).toBeNull();
      expect(parsedNull.emailIdentity).toBeNull();
      expect(parsedNull.emailAddress).toBeNull();
      expect(parsedNull.identitiesCount).toBe(0);
      expect(parsedNull.canUnlinkGoogle).toBe(false);

      const parsedEmpty = parseUserIdentities([]);
      expect(parsedEmpty.hasGoogleIdentity).toBe(false);
      expect(parsedEmpty.hasEmailIdentity).toBe(false);
      expect(parsedEmpty.identitiesCount).toBe(0);
      expect(parsedEmpty.canUnlinkGoogle).toBe(false);
    });

    it('parses Google-only identity correctly', () => {
      const mockGoogle: UserIdentity = {
        id: '123456789',
        identity_id: 'ident-google-1',
        user_id: 'user-uuid-1',
        identity_data: {
          email: 'customer@gmail.com',
          name: 'Google Customer',
        },
        provider: 'google',
        created_at: '2026-09-01T00:00:00Z',
        last_sign_in_at: '2026-09-20T00:00:00Z',
        updated_at: '2026-09-20T00:00:00Z',
      };

      const parsed = parseUserIdentities([mockGoogle]);
      expect(parsed.hasGoogleIdentity).toBe(true);
      expect(parsed.hasEmailIdentity).toBe(false);
      expect(parsed.googleIdentity).toBe(mockGoogle);
      expect(parsed.googleEmail).toBe('customer@gmail.com');
      expect(parsed.emailIdentity).toBeNull();
      expect(parsed.identitiesCount).toBe(1);
      // Invariant: identities.length < 2 can NEVER unlink
      expect(parsed.canUnlinkGoogle).toBe(false);
    });

    it('parses multi-identity account (Google + Email) correctly', () => {
      const mockGoogle: UserIdentity = {
        id: '123456789',
        identity_id: 'ident-google-1',
        user_id: 'user-uuid-1',
        identity_data: { email: 'customer@gmail.com' },
        provider: 'google',
        created_at: '2026-09-01T00:00:00Z',
        last_sign_in_at: '2026-09-20T00:00:00Z',
        updated_at: '2026-09-20T00:00:00Z',
      };

      const mockEmail: UserIdentity = {
        id: 'user-uuid-1',
        identity_id: 'ident-email-1',
        user_id: 'user-uuid-1',
        identity_data: { email: 'customer@gmail.com' },
        provider: 'email',
        created_at: '2026-09-02T00:00:00Z',
        last_sign_in_at: '2026-09-21T00:00:00Z',
        updated_at: '2026-09-21T00:00:00Z',
      };

      const parsed = parseUserIdentities([mockGoogle, mockEmail]);
      expect(parsed.hasGoogleIdentity).toBe(true);
      expect(parsed.hasEmailIdentity).toBe(true);
      expect(parsed.googleIdentity).toBe(mockGoogle);
      expect(parsed.emailIdentity).toBe(mockEmail);
      expect(parsed.identitiesCount).toBe(2);

      // Invariant: Even if identitiesCount >= 2, canUnlinkGoogle is false when manual linking policy is disabled
      if (!MANUAL_LINKING_POLICY_ENABLED) {
        expect(parsed.canUnlinkGoogle).toBe(false);
      }
    });

    it('preserves invariant: does NOT fabricate an email identity or infer password capability', () => {
      // Simulating a Google-first user who executed updateUser({ password })
      // Live test proved identities remain ONLY google!
      const mockGoogle: UserIdentity = {
        id: 'google-sub-99',
        identity_id: 'ident-google-99',
        user_id: 'user-uuid-99',
        identity_data: { email: 'googlefirst@jezsy.internal' },
        provider: 'google',
        created_at: '2026-09-21T00:00:00Z',
        last_sign_in_at: '2026-09-21T00:00:00Z',
        updated_at: '2026-09-21T00:00:00Z',
      };

      const parsed = parseUserIdentities([mockGoogle]);
      expect(parsed.hasEmailIdentity).toBe(false);
      expect(parsed.identitiesCount).toBe(1);
    });
  });

  describe('isDuplicateSignup', () => {
    it('detects duplicate signup from obfuscated user with 0 identities', () => {
      const data = {
        user: {
          id: 'obfuscated-id',
          identities: [],
        },
      };
      expect(isDuplicateSignup(data, null)).toBe(true);
    });

    it('returns false for fresh signup with 1 identity', () => {
      const data = {
        user: {
          id: 'fresh-user-id',
          identities: [{ id: 'new-id' }],
        },
      };
      expect(isDuplicateSignup(data, null)).toBe(false);
    });

    it('detects duplicate signup from structured user_already_exists error code', () => {
      const error = { code: 'user_already_exists', message: 'User already exists' };
      expect(isDuplicateSignup(null, error)).toBe(true);
    });

    it('detects duplicate signup from message string containing "User already registered"', () => {
      const error = { message: 'User already registered' };
      expect(isDuplicateSignup(null, error)).toBe(true);
    });

    it('detects duplicate signup from raw string error', () => {
      expect(isDuplicateSignup(null, 'A user already registered with this address')).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isDuplicateSignup(null, { message: 'Network request failed' })).toBe(false);
      expect(isDuplicateSignup(null, new Error('Invalid email'))).toBe(false);
    });
  });

  describe('constants & copy', () => {
    it('provides enumeration-safe duplicate account message', () => {
      expect(DUPLICATE_ACCOUNT_MESSAGE).toBe(
        'An account with this email may already exist. Try signing in or use password recovery.'
      );
    });

    it('provides neutral password saved message', () => {
      expect(PASSWORD_SAVED_MESSAGE).toBe('Password saved successfully.');
    });

    it('provides policy explanation message', () => {
      expect(MANUAL_LINKING_POLICY_MESSAGE).toBe(
        'Connecting or disconnecting login providers is disabled by the current authentication policy.'
      );
    });

    it('provides lockout guard message', () => {
      expect(SINGLE_IDENTITY_LOCKOUT_MESSAGE).toBe(
        "You can't disconnect your only linked sign-in method."
      );
    });
  });
});
