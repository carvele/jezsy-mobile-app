import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyPaymongoSignature, resolveNextPaymentStatus } from "../../../src/utils/paymongoWebhook.ts";

// Receives PayMongo webhooks and is the ONLY thing that may mark a payment paid.
//
// Deploy with verify_jwt: false -- PayMongo does not send a Supabase JWT. The
// request is authenticated instead by verifying the Paymongo-Signature header
// against the webhook secret, which is why that check must run before anything
// else and must fail closed.
//
//   supabase functions deploy payments-webhook --no-verify-jwt
//
// Signature parsing/verification and the event-type-to-status mapping live in
// src/utils/paymongoWebhook.ts (pure logic, no Deno-specific APIs) so they can
// be unit-tested from Jest -- this file can't be imported directly into a
// Node test.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  const signatureHeader = req.headers.get("Paymongo-Signature");

  const verification = await verifyPaymongoSignature({ webhookSecret, rawBody, signatureHeader });
  if (!verification.valid) {
    if (verification.reason === "mismatch") console.error("Signature mismatch");
    const messages: Record<typeof verification.reason, string> = {
      missing_signature: "Missing signature",
      malformed_signature: "Malformed signature",
      expired: "Signature expired",
      mismatch: "Invalid signature",
    };
    return json({ error: messages[verification.reason] }, 401);
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

    const nextStatus = resolveNextPaymentStatus(eventType);

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
