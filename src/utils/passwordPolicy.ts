/**
 * The three password screens (signup, reset, change) all checked only
 * `password.length < 8`. The Supabase project's own password policy requires
 * a lowercase letter, an uppercase letter, a digit and a symbol, and none of
 * the three screens knew that -- a password like "TestPass123" passes every
 * client check, gets submitted, and comes back with Supabase's own error
 * verbatim: "Password should contain at least one character of each:
 * abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, ...".
 * That is not customer copy, and the toast's 3-line cap cut it off mid-word.
 *
 * One validator, checked before every submit, so the requirement is stated
 * up front instead of discovered from a raw server error after the fact.
 */

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_REQUIREMENT_HINT =
  'At least 8 characters, with a lowercase letter, an uppercase letter, a number and a symbol.';

/** Null when the password satisfies the policy; otherwise the message to show. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Please use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password)) {
    return 'Please add a lowercase letter.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Please add an uppercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Please add a number.';
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return 'Please add a symbol, like ! or #.';
  }
  return null;
}

/**
 * Defence in depth: if Supabase's own message ever reaches a catch block
 * anyway -- the policy changes, or a call site adds a password field this
 * module does not know about -- translate it rather than show the raw
 * character-class listing.
 */
export function translatePasswordServerError(message: string): string {
  if (/password should contain/i.test(message)) {
    return PASSWORD_REQUIREMENT_HINT;
  }
  return message;
}
