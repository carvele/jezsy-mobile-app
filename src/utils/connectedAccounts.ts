import type { UserIdentity } from '@supabase/supabase-js';

/**
 * Authentication policy flag for manual identity linking and unlinking.
 * Supabase project policy currently returns code: manual_linking_disabled.
 * This policy flag must remain false until explicitly enabled in Supabase Auth.
 */
export const MANUAL_LINKING_POLICY_ENABLED = false;

export const DUPLICATE_ACCOUNT_MESSAGE =
  'An account with this email may already exist. Try signing in or use password recovery.';

export const PASSWORD_SAVED_MESSAGE = 'Password saved successfully.';

export const MANUAL_LINKING_POLICY_MESSAGE =
  'Connecting or disconnecting login providers is disabled by the current authentication policy.';

export const SINGLE_IDENTITY_LOCKOUT_MESSAGE =
  "You can't disconnect your only linked sign-in method.";

export interface ParsedIdentities {
  hasGoogleIdentity: boolean;
  hasEmailIdentity: boolean;
  googleIdentity: UserIdentity | null;
  googleEmail: string | null;
  emailIdentity: UserIdentity | null;
  emailAddress: string | null;
  identitiesCount: number;
  canUnlinkGoogle: boolean;
}

/**
 * Derives authoritative identity status from Supabase getUserIdentities().
 *
 * Invariant: Never infer password capability from hasEmailIdentity.
 * Setting a password on a Google-first account via updateUser({ password })
 * enables password login, but does NOT create an email row in auth.identities.
 */
export function parseUserIdentities(
  identities: UserIdentity[] | null | undefined
): ParsedIdentities {
  const list = Array.isArray(identities) ? identities : [];
  const googleIdentity = list.find((i) => i.provider === 'google') ?? null;
  const emailIdentity = list.find((i) => i.provider === 'email') ?? null;

  const googleEmail =
    (googleIdentity?.identity_data?.email as string | undefined) ||
    ((googleIdentity as Record<string, unknown> | null)?.email as string | undefined) ||
    null;

  const emailAddress =
    (emailIdentity?.identity_data?.email as string | undefined) ||
    ((emailIdentity as Record<string, unknown> | null)?.email as string | undefined) ||
    null;

  // canUnlinkGoogle requires both policy enablement AND at least two linked identities
  const canUnlinkGoogle =
    MANUAL_LINKING_POLICY_ENABLED && list.length >= 2;

  return {
    hasGoogleIdentity: Boolean(googleIdentity),
    hasEmailIdentity: Boolean(emailIdentity),
    googleIdentity,
    googleEmail,
    emailIdentity,
    emailAddress,
    identitiesCount: list.length,
    canUnlinkGoogle,
  };
}

/**
 * Detects whether a signup attempt was rejected or intercepted as a duplicate.
 *
 * Supabase returns an obfuscated user with an empty identities array when
 * an existing user attempts to sign up, preventing enumeration.
 * Alternatively, structured error codes or server messages may be returned.
 */
export function isDuplicateSignup(
  data?: { user?: { identities?: unknown[] } | null } | null,
  error?: unknown
): boolean {
  // 1. Obfuscated user with empty identities
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return true;
  }

  // 2. Structured error code
  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    if (errObj.code === 'user_already_exists') {
      return true;
    }

    // 3. Fallback message matching
    const msg = typeof errObj.message === 'string'
      ? errObj.message.toLowerCase()
      : typeof errObj.error_description === 'string'
      ? errObj.error_description.toLowerCase()
      : '';

    if (msg.includes('user already registered') || msg.includes('already registered')) {
      return true;
    }
  }

  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    if (lower.includes('user already registered') || lower.includes('already registered')) {
      return true;
    }
  }

  return false;
}
