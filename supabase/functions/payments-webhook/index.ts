import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Receives PayMongo webhooks and is the ONLY thing that may mark a payment paid.
//
// Deploy with verify_jwt: false -- PayMongo does not send a Supabase JWT. The
// request is authenticated instead by verifying the Paymongo-Signature header
// against the webhook secret, which is why that check must run before anything
// else and must fail closed.
//
//   supabase functions deploy payments-webhook --no-verify-jwt

const SIGNATURE_TOLERANCE_SECONDS = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Header format: t=<unix>,te=<test sig>,li=<live sig>
function parseSignature(header: string) {
  const parts = header.split(",").reduce<Record<string, string>>((acc, chunk) => {
    const [key, value] = chunk.split("=");
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});

  return { timestamp: parts.t, test: parts.te, live: parts.li };
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Length-independent compare, so a mismatch cannot be timed.
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("PAYMONGO_WEBHOOK_SECRET is not set");
    return json({ error: "Not configured" }, 503);
  }

  // Must be the raw body: re-serializing JSON would change the bytes and break
  // the signature.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Paymongo-Signature") ?? "";
  if (!signatureHeader) return json({ error: "Missing signature" }, 401);

  const { timestamp, test, live } = parseSignature(signatureHeader);
  if (!timestamp || (!test && !live)) return json({ error: "Malformed signature" }, 401);

  // Replay guard: a captured payload stays valid forever without this.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
    return json({ error: "Signature expired" }, 401);
  }

  const expected = await hmacHex(webhookSecret, `${timestamp}.${rawBody}`);
  const provided = live || test;
  if (!safeEqual(expected, provided!)) {
    console.error("Signature mismatch");
    return json({ error: "Invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(rawBody);
    const eventId: string | undefined = event?.data?.id;
    const eventType: string | undefined = event?.data?.attributes?.type;
    const resource = event?.data?.attributes?.data;

    if (!eventId || !eventType) return json({ received: true, ignored: "no event id or type" });

    // A Checkout Session event carries the session on the resource; a payment
    // event carries the payment, whose session id is on its attributes.
    const sessionId: string | undefined =
      resource?.type === "checkout_session"
        ? resource?.id
        : resource?.attributes?.checkout_session_id ?? resource?.attributes?.data?.id;

    if (!sessionId) return json({ received: true, ignored: "no session id" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: payment } = await admin
      .from("payments")
      .select("id, reservation_id, status, last_event_id")
      .eq("provider", "paymongo")
      .eq("provider_ref", sessionId)
      .maybeSingle();

    // 200 on an unknown session: retrying will not help, and a non-2xx makes
    // PayMongo redeliver indefinitely.
    if (!payment) return json({ received: true, ignored: "unknown session" });

    // Idempotency: PayMongo retries, and a repeat must not apply twice.
    if (payment.last_event_id === eventId) return json({ received: true, duplicate: true });

    // checkout_session.expired deliberately does NOT map to "failed" here.
    // Event delivery order across a session's lifecycle is not guaranteed, so
    // treating expiry as instantly terminal risks a customer whose payment
    // actually succeeded seeing a false "payment not completed" a few seconds
    // before the correcting payment.paid event lands -- worse than the stuck
    // row it would resolve. expire_stale_payments() (2-hour cron) already
    // resolves genuinely abandoned sessions safely, with nothing watching it
    // in real time to be misled by the race.
    let nextStatus: string | null = null;
    if (eventType === "checkout_session.payment.paid" || eventType === "payment.paid") {
      nextStatus = "paid";
    } else if (eventType === "payment.failed") {
      nextStatus = "failed";
    }

    if (!nextStatus) {
      await admin
        .from("payments")
        .update({ last_event_id: eventId, last_event: event })
        .eq("id", payment.id);
      return json({ received: true, ignored: eventType });
    }

    // Never walk a settled payment backwards.
    if (payment.status === "paid" && nextStatus !== "paid") {
      return json({ received: true, ignored: "already paid" });
    }

    const paymentResource =
      resource?.type === "payment"
        ? resource
        : resource?.attributes?.payments?.[0]?.data ?? null;

    await admin
      .from("payments")
      .update({
        status: nextStatus,
        method: paymentResource?.attributes?.source?.type ?? null,
        provider_payment_id: paymentResource?.id ?? null,
        last_event_id: eventId,
        last_event: event,
      })
      .eq("id", payment.id);

    // Only payment_status moves. Confirming a reservation also means committing
    // stock and an appointment slot, which stays a staff decision.
    if (nextStatus === "paid" && payment.reservation_id) {
      await admin
        .from("reservations")
        .update({ payment_status: "Paid" })
        .eq("id", payment.reservation_id);
    }

    return json({ received: true, status: nextStatus });
  } catch (error) {
    console.error(error);
    // 500 so PayMongo retries a genuine processing failure.
    return json({ error: "Processing failed" }, 500);
  }
});
