import {
  parseSignature,
  hmacHex,
  safeEqual,
  verifyPaymongoSignature,
  resolveNextPaymentStatus,
} from './paymongoWebhook';

const SECRET = 'whsec_test_secret';

async function sign(timestamp: number, rawBody: string, secret = SECRET): Promise<string> {
  const hex = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return `t=${timestamp},te=${hex}`;
}

describe('parseSignature', () => {
  test('parses timestamp and test signature', () => {
    expect(parseSignature('t=1699999999,te=abc123')).toEqual({
      timestamp: '1699999999',
      test: 'abc123',
      live: undefined,
    });
  });

  test('parses a live signature', () => {
    expect(parseSignature('t=1699999999,li=def456')).toEqual({
      timestamp: '1699999999',
      test: undefined,
      live: 'def456',
    });
  });

  test('ignores malformed chunks without an =', () => {
    expect(parseSignature('t=1699999999,garbage,te=abc')).toEqual({
      timestamp: '1699999999',
      test: 'abc',
      live: undefined,
    });
  });
});

describe('safeEqual', () => {
  test('true for identical strings', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
  });

  test('false for different-length strings (no early-exit timing on content)', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  test('false for same-length but different strings', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false);
  });
});

describe('verifyPaymongoSignature', () => {
  const rawBody = JSON.stringify({ data: { id: 'evt_1', attributes: { type: 'payment.paid' } } });
  const nowSeconds = 1_700_000_000;

  test('accepts a correctly signed payload within the tolerance window', async () => {
    const signatureHeader = await sign(nowSeconds, rawBody);
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: true });
  });

  test('rejects when the payload has been tampered with after signing', async () => {
    const signatureHeader = await sign(nowSeconds, rawBody);
    const tamperedBody = JSON.stringify({ data: { id: 'evt_1', attributes: { type: 'payment.paid' }, amount: 999999999 } });
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody: tamperedBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'mismatch' });
  });

  test('rejects when signed with the wrong secret (a forged webhook)', async () => {
    const signatureHeader = await sign(nowSeconds, rawBody, 'whsec_wrong_secret');
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'mismatch' });
  });

  test('rejects a missing signature header', async () => {
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader: null, nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'missing_signature' });
  });

  test('rejects an empty signature header the same as missing', async () => {
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader: '', nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'missing_signature' });
  });

  test('rejects a malformed header with no timestamp', async () => {
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader: 'te=abc123', nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'malformed_signature' });
  });

  test('rejects a malformed header with no signature value at all', async () => {
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader: 't=1700000000', nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'malformed_signature' });
  });

  test('rejects a signature older than the 300-second replay tolerance', async () => {
    const oldTimestamp = nowSeconds - 301;
    const signatureHeader = await sign(oldTimestamp, rawBody);
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  test('accepts a signature exactly at the tolerance boundary', async () => {
    const boundaryTimestamp = nowSeconds - 300;
    const signatureHeader = await sign(boundaryTimestamp, rawBody);
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: true });
  });

  test('rejects a signature timestamped in the future beyond tolerance (clock skew abuse)', async () => {
    const futureTimestamp = nowSeconds + 301;
    const signatureHeader = await sign(futureTimestamp, rawBody);
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  test('rejects a non-numeric timestamp', async () => {
    const signatureHeader = 't=not-a-number,te=abc123';
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  test('a live signature verifies the same as a test signature', async () => {
    const hex = await hmacHex(SECRET, `${nowSeconds}.${rawBody}`);
    const signatureHeader = `t=${nowSeconds},li=${hex}`;
    const result = await verifyPaymongoSignature({ webhookSecret: SECRET, rawBody, signatureHeader, nowSeconds });
    expect(result).toEqual({ valid: true });
  });
});

describe('resolveNextPaymentStatus', () => {
  test('maps checkout_session.payment.paid to paid', () => {
    expect(resolveNextPaymentStatus('checkout_session.payment.paid')).toBe('paid');
  });

  test('maps payment.paid to paid', () => {
    expect(resolveNextPaymentStatus('payment.paid')).toBe('paid');
  });

  test('maps payment.failed to failed', () => {
    expect(resolveNextPaymentStatus('payment.failed')).toBe('failed');
  });

  test('checkout_session.expired does NOT map to failed -- event ordering is not guaranteed', () => {
    expect(resolveNextPaymentStatus('checkout_session.expired')).toBeNull();
  });

  test('an unrecognized event type maps to null', () => {
    expect(resolveNextPaymentStatus('some.other.event')).toBeNull();
  });

  test('undefined event type maps to null', () => {
    expect(resolveNextPaymentStatus(undefined)).toBeNull();
  });
});
