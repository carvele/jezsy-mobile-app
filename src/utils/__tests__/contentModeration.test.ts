import {
  isContentModerationError,
  getContentModerationMessage,
  DEFAULT_SUBMISSION_MODERATION_MESSAGE,
  DEFAULT_MESSAGE_MODERATION_MESSAGE,
  CONTENT_MODERATION_CODE,
} from '../contentModeration';

describe('contentModeration utility', () => {
  it('correctly identifies PT422 error code', () => {
    const error = { code: 'PT422', message: 'CONTENT_MODERATION_BLOCKED' };
    expect(isContentModerationError(error)).toBe(true);
  });

  it('correctly identifies nested cause error', () => {
    const error = {
      code: 'ERR_REVIEW_SUBMIT_FAILED',
      message: 'Failed to submit review',
      cause: {
        code: 'PT422',
        message: 'CONTENT_MODERATION_BLOCKED',
        hint: 'Please remove inappropriate or offensive language before submitting.',
      },
    };
    expect(isContentModerationError(error)).toBe(true);
    expect(getContentModerationMessage(error, 'submitting')).toBe(
      'Please remove inappropriate or offensive language before submitting.'
    );
  });

  it('falls back to default message for messaging when hint is missing', () => {
    const error = { code: 'PT422', message: 'CONTENT_MODERATION_BLOCKED' };
    expect(getContentModerationMessage(error, 'sending')).toBe(
      DEFAULT_MESSAGE_MODERATION_MESSAGE
    );
  });

  it('returns false for unrelated errors', () => {
    expect(isContentModerationError(null)).toBe(false);
    expect(isContentModerationError({ code: 'P0001', message: 'Not authenticated' })).toBe(false);
    expect(isContentModerationError({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
