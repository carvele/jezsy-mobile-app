import { translatePasswordServerError } from './passwordPolicy';

/**
 * Maps raw auth and Supabase error messages to clear, actionable customer copy.
 * Ensures internal technical messages, schema details, or stack traces are never
 * exposed directly to end users.
 */
export function mapAuthErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;

  let rawMessage = '';
  if (typeof error === 'string') {
    rawMessage = error;
  } else if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;
    rawMessage = typeof errObj.message === 'string'
      ? errObj.message
      : typeof errObj.error_description === 'string'
      ? errObj.error_description
      : '';
  }

  const lower = rawMessage.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'Incorrect email, mobile number, or password. Please try again.';
  }

  if (lower.includes('email not confirmed')) {
    return 'Please verify your email address to sign in.';
  }

  if (lower.includes('user already registered') || lower.includes('already registered')) {
    return 'An account with this email may already exist. Please sign in instead.';
  }

  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('over_email_send_rate_limit')) {
    return 'You have requested too many codes or attempts recently. Please wait a few moments and try again.';
  }

  if (
    lower.includes('token has expired') ||
    lower.includes('invalid token') ||
    lower.includes('token is invalid') ||
    lower.includes('otp expired') ||
    lower.includes('otp_expired')
  ) {
    return 'The verification code is invalid or has expired. Please request a new code.';
  }

  if (lower.includes('phone number is already confirmed') || lower.includes('phone_exists')) {
    return 'This mobile number is already linked to another account.';
  }

  if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network error')
  ) {
    return 'Network connection issue. Please check your internet connection and try again.';
  }

  if (lower.includes('password should contain')) {
    return translatePasswordServerError(rawMessage);
  }

  // If a known friendly message was passed, keep it; otherwise return the fallback
  if (rawMessage && !rawMessage.includes('{') && !rawMessage.includes('500') && !rawMessage.includes('PostgREST')) {
    return rawMessage;
  }

  return fallback;
}
