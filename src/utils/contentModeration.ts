/**
 * contentModeration.ts
 *
 * Centralized client-side moderation error handling and message resolution.
 * Coordinates with the authoritative PostgreSQL moderation layer (PT422 / CONTENT_MODERATION_BLOCKED).
 */

export const CONTENT_MODERATION_CODE = 'PT422';
export const CONTENT_MODERATION_BLOCKED = 'CONTENT_MODERATION_BLOCKED';

export const DEFAULT_SUBMISSION_MODERATION_MESSAGE =
  'Please remove inappropriate or offensive language before submitting.';

export const DEFAULT_MESSAGE_MODERATION_MESSAGE =
  'Please remove inappropriate or offensive language before sending.';

/**
 * Checks whether an error object, string, or domain error represents
 * a content moderation block (PostgreSQL PT422 / CONTENT_MODERATION_BLOCKED).
 */
export function isContentModerationError(error: unknown): boolean {
  if (!error) return false;

  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    return (
      error.includes('PT422') ||
      lower.includes('content_moderation_blocked') ||
      lower.includes('inappropriate or offensive language')
    );
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, any>;
    const code = String(err.code || err.statusCode || err.status || '');
    const message = String(err.message || '');
    const details = String(err.details || '');
    const hint = String(err.hint || '');

    if (code === CONTENT_MODERATION_CODE) return true;
    if (message.includes(CONTENT_MODERATION_BLOCKED)) return true;
    if (details.includes(CONTENT_MODERATION_BLOCKED)) return true;
    if (hint.includes('inappropriate or offensive language')) return true;

    // Check nested cause (e.g. DomainError or Axios/Fetch error)
    if (err.cause) {
      return isContentModerationError(err.cause);
    }
  }

  return false;
}

/**
 * Extracts a user-friendly, actionable copy when content moderation blocks a write.
 * Prioritizes the server-provided HINT, falling back to clean context-aware phrasing.
 */
export function getContentModerationMessage(
  error: unknown,
  fallbackAction: 'submitting' | 'sending' = 'submitting'
): string {
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, any>;
    const hint = err.hint || err.cause?.hint;
    if (typeof hint === 'string' && hint.trim().length > 0) {
      return hint.trim();
    }
    const message = err.message || err.cause?.message;
    if (typeof message === 'string' && message.includes('Please remove inappropriate')) {
      return message.trim();
    }
  }

  return fallbackAction === 'sending'
    ? DEFAULT_MESSAGE_MODERATION_MESSAGE
    : DEFAULT_SUBMISSION_MODERATION_MESSAGE;
}
