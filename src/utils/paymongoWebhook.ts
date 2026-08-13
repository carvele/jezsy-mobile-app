/**
 * Pure signature-verification and event-mapping logic for the PayMongo
 * webhook, extracted out of supabase/functions/payments-webhook/index.ts so
 * it can be unit-tested from Jest -- the edge function itself is Deno
 * (Deno.env, deno.land imports) and can't be imported directly into a Node
 * test. Uses only Web Crypto (crypto.subtle), which is a global in both
 * Deno and Node 19+, so behavior is identical in both runtimes.
 *
 * Any change here changes what the live webhook accepts as a genuine
 * PayMongo request -- this is the entire authentication boundary for a
 * function with no Supabase JWT to fall back on.
 */

const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Header format: t=<unix>,te=<test sig>,li=<live sig> */
export function parseSignature(header: string): { timestamp?: string; test?: string; live?: string } {
  const parts = header.split(',').reduce<Record<string, string>>((acc, chunk) => {
    const [key, value] = chunk.split('=');
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});

  return { timestamp: parts.t, test: parts.te, live: parts.li };
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Length-independent compare, so a mismatch cannot be timed. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SignatureVerification =
  | { valid: true }
  | { valid: false; reason: 'missing_signature' | 'malformed_signature' | 'expired' | 'mismatch' };

/**
 * Full verification pipeline the webhook runs before trusting a request:
 * parse the header, reject if malformed, reject if the timestamp is outside
 * the replay tolerance window, then compare the computed HMAC against
 * whichever of the test/live signatures was provided.
 */
export async function verifyPaymongoSignature(params: {
  webhookSecret: string;
  rawBody: string;
  signatureHeader: string | null;
  nowSeconds?: number;
}): Promise<SignatureVerification> {
  const { webhookSecret, rawBody, signatureHeader, nowSeconds = Math.floor(Date.now() / 1000) } = params;

  if (!signatureHeader) return { valid: false, reason: 'missing_signature' };

  const { timestamp, test, live } = parseSignature(signatureHeader);
  if (!timestamp || (!test && !live)) return { valid: false, reason: 'malformed_signature' };

  const age = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'expired' };
  }

  const expected = await hmacHex(webhookSecret, `${timestamp}.${rawBody}`);
  const provided = live || test;
  if (!provided || !safeEqual(expected, provided)) {
    return { valid: false, reason: 'mismatch' };
  }

  return { valid: true };
}

/**
 * checkout_session.expired deliberately does NOT map to "failed" here.
 * Event delivery order across a session's lifecycle is not guaranteed, so
 * treating expiry as instantly terminal risks a customer whose payment
 * actually succeeded seeing a false "payment not completed" a few seconds
 * before the correcting payment.paid event lands -- worse than the stuck
 * row it would resolve. expire_stale_payments() (2-hour cron) already
 * resolves genuinely abandoned sessions safely, with nothing watching it
 * in real time to be misled by the race.
 */
export function resolveNextPaymentStatus(eventType: string | undefined): 'paid' | 'failed' | null {
  if (eventType === 'checkout_session.payment.paid' || eventType === 'payment.paid') return 'paid';
  if (eventType === 'payment.failed') return 'failed';
  return null;
}
