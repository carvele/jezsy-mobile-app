import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

// Opens a PayMongo Checkout Session for a reservation and records it in
// public.payments.
//
// Deploy with verify_jwt: true -- the caller is the customer and we need their
// identity. The amount is never taken from the request body: it is read from the
// reservation row, for the same reason create_reservation resolves price
// server-side rather than trusting the client.

const PAYMONGO_API = "https://api.paymongo.com/v1";

// GCash only for now, by request. Adding "grab_pay" or "card" here is the whole
// change if that widens later -- PayMongo still only offers what the merchant
// account has activated.
const PAYMENT_METHODS = ["gcash"];

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  // Handle CORS preflight from mobile WebView and any browser client.
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secretKey) {
      console.error("PAYMONGO_SECRET_KEY is not set");
      return json(req, { error: "Payments are not configured." }, 503);
    }
    const basicAuth = "Basic " + btoa(secretKey + ":");

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(req, { error: "Authentication required." }, 401);

    // Two clients on purpose: the anon one only resolves who is calling, the
    // service-role one does every read and write that follows.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: userData, error: userError } = await caller.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) return json(req, { error: "Authentication required." }, 401);

    // Every call here opens (or reuses) a real PayMongo Checkout Session --
    // the abuse surface is a scripted burst of session-creation calls, not
    // legitimate retry behavior, which this limit comfortably allows for.
    // Fails open on an unexpected RPC error (e.g. a transient DB hiccup):
    // this is an abuse guard, not the payment's authorization check, so
    // availability wins over strictness here.
    const { data: withinLimit, error: rateLimitError } = await admin.rpc("check_rate_limit", {
      p_key: "payments-create:" + userId,
      p_max_requests: 5,
      p_window_seconds: 60,
    });
    if (rateLimitError) console.error("Rate limit check failed (failing open):", rateLimitError);
    if (withinLimit === false) {
      return json(req, { error: "Too many payment attempts. Please wait a moment and try again." }, 429);
    }

    const body = await req.json().catch(() => null);
    const reservationId: string | undefined = body?.reservation_id;
    if (!reservationId) return json(req, { error: "reservation_id is required." }, 400);

    // Ownership and amount both come from the row itself.
    const { data: reservation, error: reservationError } = await admin
      .from("reservations")
      .select("id, customer_id, deposit, display_id, product_name, payment_status, status, payment_due_at, payment_type")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError || !reservation) return json(req, { error: "Reservation not found." }, 404);
    if (reservation.customer_id !== userId) return json(req, { error: "Not your reservation." }, 403);
    if (String(reservation.payment_status).toLowerCase() === "paid") {
      return json(req, { error: "This reservation is already paid." }, 409);
    }

    // New reservations enter To Pay immediately because creating one is the
    // customer's stock-hold decision; there is no administrator acceptance
    // step. Confirmed/approved remain temporarily for older app versions.
    const status = String(reservation.status ?? "").toLowerCase();
    if (status !== "confirmed" && status !== "approved" && status !== "to pay") {
      const errMsg =
        status === "cancelled"
          ? "This reservation was cancelled."
          : status === "pending"
            ? "This legacy reservation is not ready for payment. Please contact the boutique."
            : "This reservation is no longer awaiting payment.";
      return json(req, { error: errMsg }, 409);
    }

    // Server-side deadline check. The sweep runs every five minutes, so a
    // reservation can be past due but not yet cancelled -- without this, a
    // customer could pay into that gap and then have it cancelled underneath
    // them.
    if (reservation.payment_due_at && new Date(reservation.payment_due_at).getTime() < Date.now()) {
      return json(req, { error: "The payment window for this reservation has closed." }, 409);
    }

    const amountPesos = Number(reservation.deposit ?? 0);
    if (!Number.isFinite(amountPesos) || amountPesos <= 0) {
      return json(req, { error: "Nothing to pay." }, 400);
    }

    // PayMongo works in centavos and enforces a 100-centavo floor.
    const amountCentavos = Math.round(amountPesos * 100);
    if (amountCentavos < 100) return json(req, { error: "Amount is below the minimum." }, 400);

    // Wording follows what is actually being charged: a customer paying the
    // whole price was still shown "Deposit for ..." on the checkout page.
    const label = String(reservation.payment_type ?? "").toLowerCase() === "full"
      ? "Full payment for"
      : "Deposit for";
    const description = label + " " + (reservation.product_name ?? "reservation") + " (" + reservation.display_id + ")";

    // Close any existing pending payment attempts for this reservation and start a fresh one.
    const { data: existingAttempts, error: existingError } = await admin
      .from("payments")
      .select("id")
      .eq("reservation_id", reservationId)
      .in("status", ["awaiting_payment", "processing"]);

    if (existingError) {
      console.error("Failed to fetch existing payment attempts", existingError);
      return json(req, { error: "Could not start the payment." }, 500);
    }

    if (existingAttempts && existingAttempts.length > 0) {
      const ids = existingAttempts.map((p: any) => p.id);
      const { error: closeError } = await admin
        .from("payments")
        .update({ status: "failed" })
        .in("id", ids)
        .in("status", ["awaiting_payment", "processing"]);
      if (closeError) {
        console.error("Could not close stale payment attempt", closeError);
        return json(req, { error: "Could not start the payment." }, 500);
      }
    }

    // Record the payment attempt BEFORE calling PayMongo, not after. The
    // webhook is the sole authority for marking a payment paid and it looks
    // up by provider_ref alone -- creating the session first and inserting
    // second meant a failed insert left a live, payable session with nothing
    // in `payments` pointing back at it. provider_ref starts null (the
    // partial unique index only applies once it's set) and is attached once
    // the session actually exists.
    const { data: inserted, error: insertError } = await admin
      .from("payments")
      .insert({
        user_id: userId,
        reservation_id: reservationId,
        provider: "paymongo",
        amount_centavos: amountCentavos,
        currency: "PHP",
        status: "awaiting_payment",
        attempt_started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      console.error("Could not record payment", insertError);
      return json(req, { error: "Could not start the payment." }, 500);
    }
    const paymentId: string = inserted.id;

    const returnUrl = Deno.env.get("PAYMONGO_RETURN_URL") ?? "jezsymobileapp://payment-return";
    const separator = returnUrl.includes("?") ? "&" : "?";
    const paymentReturnUrl = returnUrl + separator + "payment_id=" + encodeURIComponent(paymentId);

    const createRes = await fetch(PAYMONGO_API + "/checkout_sessions", {
      method: "POST",
      headers: { Authorization: basicAuth, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          attributes: {
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            description,
            payment_method_types: PAYMENT_METHODS,
            success_url: paymentReturnUrl,
            cancel_url: paymentReturnUrl,
            line_items: [
              { name: description, quantity: 1, amount: amountCentavos, currency: "PHP" },
            ],
          },
        },
      }),
    });

    const created = await createRes.json();
    const sessionId = created?.data?.id;
    const checkoutUrl = created?.data?.attributes?.checkout_url;

    if (!createRes.ok || !sessionId || !checkoutUrl) {
      console.error("PayMongo session creation failed", JSON.stringify(created));
      return json(req, { error: "Could not start the payment." }, 502);
    }

    const { error: updateError } = await admin
      .from("payments")
      .update({ provider_ref: sessionId })
      .eq("id", paymentId);

    if (updateError) {
      console.error("Could not link payment to session", updateError);
      return json(req, { error: "Could not start the payment." }, 500);
    }

    return json(req, { payment_id: paymentId, checkout_url: checkoutUrl, reused: false });
  } catch (error) {
    console.error(error);
    return json(req, { error: "Unexpected error." }, 500);
  }
});
