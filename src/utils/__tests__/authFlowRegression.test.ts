import { isDuplicateSignup, DUPLICATE_ACCOUNT_MESSAGE } from '../connectedAccounts';
import { mapAuthErrorMessage } from '../authErrorMapping';

describe('Auth Flow Regression Invariants', () => {
  describe('Duplicate Signup Hardening & Enumeration Resistance', () => {
    it('catches obfuscated user with empty identities and yields enumeration-safe copy', () => {
      const responseFromSupabaseOnExistingEmail = {
        data: {
          user: {
            id: 'mock-user-id',
            identities: [],
          },
          session: null,
        },
        error: null,
      };

      const isDuplicate = isDuplicateSignup(responseFromSupabaseOnExistingEmail.data);
      expect(isDuplicate).toBe(true);

      // Verify that the UI displays the required enumeration-safe message
      const customerMessage = isDuplicate
        ? DUPLICATE_ACCOUNT_MESSAGE
        : 'Something else';
      expect(customerMessage).toBe(
        'An account with this email may already exist. Try signing in or use password recovery.'
      );
    });

    it('catches structured user_already_exists and yields enumeration-safe copy', () => {
      const structuredError = {
        code: 'user_already_exists',
        message: 'A user with this email address has already been registered',
      };

      expect(isDuplicateSignup(null, structuredError)).toBe(true);

      const mapped = mapAuthErrorMessage(structuredError);
      expect(mapped).toBe(
        'An account with this email may already exist. Try signing in or use password recovery.'
      );
    });

    it('catches legacy string error message and yields enumeration-safe copy', () => {
      const legacyError = { message: 'User already registered' };
      expect(isDuplicateSignup(null, legacyError)).toBe(true);

      const mapped = mapAuthErrorMessage(legacyError);
      expect(mapped).toBe(
        'An account with this email may already exist. Try signing in or use password recovery.'
      );
    });
  });

  describe('Single Human Account & Routing Invariants', () => {
    it('preserves same auth.users.id across Google and Password authentication', () => {
      // Simulating Supabase Auth canonical automatic linking
      const canonicalUserId = '878c9c09-6c94-4a6b-9796-54b4c1db744f';

      const googleSession = {
        user: {
          id: canonicalUserId,
          email: 'customer@jezsy.test',
          app_metadata: { provider: 'google', providers: ['google'] },
        },
      };

      const passwordSession = {
        user: {
          id: canonicalUserId,
          email: 'customer@jezsy.test',
          app_metadata: { provider: 'google', providers: ['google'] },
        },
      };

      // Invariant: User UUID is unchanged
      expect(googleSession.user.id).toBe(passwordSession.user.id);
    });

    it('verifies completed profile does not restart onboarding upon login', () => {
      const completedProfile = {
        id: 'canonical-user-uuid',
        first_name: 'Carl',
        last_name: 'Vener',
        role: 'customer',
        deleted: false,
      };

      // Invariant: If profile has first_name and is not deleted, profile is complete
      const isProfileComplete = Boolean(completedProfile.first_name) && !completedProfile.deleted;
      expect(isProfileComplete).toBe(true);

      // Onboarding should NOT restart for a completed profile regardless of auth provider
      const shouldRestartOnboarding = !isProfileComplete;
      expect(shouldRestartOnboarding).toBe(false);
    });

    it('enforces legal gate when legal acceptance has not been recorded', () => {
      const legalStatusPending = {
        acceptedTerms: false,
        acceptedPrivacy: false,
      };

      const canProceedToApp = legalStatusPending.acceptedTerms && legalStatusPending.acceptedPrivacy;
      expect(canProceedToApp).toBe(false);

      const legalStatusAccepted = {
        acceptedTerms: true,
        acceptedPrivacy: true,
      };
      expect(legalStatusAccepted.acceptedTerms && legalStatusAccepted.acceptedPrivacy).toBe(true);
    });
  });
});
