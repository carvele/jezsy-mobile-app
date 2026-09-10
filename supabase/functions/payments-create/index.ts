import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors, isAllowedOrigin } from "../_shared/cors.ts";
import { decideExistingCheckout } from "../../../src/utils/paymongoCheckout.ts";
import {
  isPaymentPurpose,
  paymentAmountCentavos,
  paymentPurposeLabel,
  type PaymentPurpose,
} from "../../../src/utils/reservationPayment.ts";

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

async function expireCheckoutSession(sessionId: string, authorization: string): Promise<boolean> {
  const response = await fetch(PAYMONGO_API + "/checkout_sessions/" + sessionId + "/expire", {
    method: "POST",
    headers: { Authorization: authorization },
  }).catch(() => null);

  return response?.ok === true;
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
    if (body?.purpose !== undefined && !isPaymentPurpose(body.purpose)) {
      return json(req, { error: "Unsupported payment purpose." }, 400);
    }
    const platform: string | undefined = body?.platform;

    // Ownership and amount both come from the row itself.
    const { data: reservation, error: reservationError } = await admin
      .from("reservations")
      .select("id, customer_id, deposit, rental_price, display_id, product_name, payment_status, status, payment_due_at, payment_type, balance_settled_at")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError || !reservation) return json(req, { error: "Reservation not found." }, 404);
    if (reservation.customer_id !== userId) return json(req, { error: "Not your reservation." }, 403);

    const purpose: PaymentPurpose = body?.purpose ?? (
      String(reservation.payment_type).toLowerCase() === "full" ? "full_payment" : "initial_deposit"
    );
    const paymentStatus = String(reservation.payment_status ?? "").toLowerCase();

    // New reservations enter To Pay immediately because creating one is the
    // customer's stock-hold decision; there is no administrator acceptance
    // step. Confirmed/approved remain temporarily for older app versions.
    const status = String(reservation.status ?? "").toLowerCase();
    const initialPayment = purpose !== "remaining_balance";
    if (initialPayment && status !== "confirmed" && status !== "approved" && status !== "to pay") {
      const errMsg =
        status === "cancelled"
          ? "This reservation was cancelled."
          : status === "pending"
            ? "This legacy reservation is not ready for payment. Please contact the boutique."
            : "This reservation is no longer awaiting payment.";
      return json(req, { error: errMsg }, 409);
    }
    if (!initialPayment && (status === "cancelled" || status === "completed")) {
      return json(req, { error: "This reservation can no longer accept a balance payment." }, 409);
    }

    if (initialPayment && paymentStatus === "paid") {
      return json(req, { error: "The initial reservation payment has already been received." }, 409);
    }
    if (initialPayment && paymentStatus !== "pending") {
      return json(req, { error: "This reservation already has a payment under review or reconciliation." }, 409);
    }
    if (!initialPayment && paymentStatus !== "paid") {
      return json(req, { error: "Pay the initial reservation amount before the remaining balance." }, 409);
    }
    if (!initialPayment && reservation.balance_settled_at) {
      return json(req, { error: "This reservation is already paid in full." }, 409);
    }

    // Server-side deadline check. The sweep runs every five minutes, so a
    // reservation can be past due but not yet cancelled -- without this, a
    // customer could pay into that gap and then have it cancelled underneath
    // them.
    if (initialPayment && reservation.payment_due_at && new Date(reservation.payment_due_at).getTime() < Date.now()) {
      return json(req, { error: "The payment window for this reservation has closed." }, 409);
    }

    const { data: paidRows, error: paidRowsError } = await admin
      .from("payments")
      .select("amount_centavos")
      .eq("reservation_id", reservationId)
      .eq("status", "paid")
      .eq("requires_refund", false);
    if (paidRowsError) {
      console.error("Failed to calculate reservation balance", paidRowsError);
      return json(req, { error: "Could not calculate the payment amount." }, 500);
    }
    const paidCentavos = (paidRows ?? []).reduce(
      (sum, row) => sum + Number(row.amount_centavos ?? 0),
      0,
    );

    // The client chooses only the purpose. Prices and already-recorded money
    // remain server-authoritative.
    const amountCentavos = paymentAmountCentavos({
      purpose,
      depositPesos: Number(reservation.deposit ?? 0),
      totalPesos: Number(reservation.rental_price ?? 0),
      paidCentavos,
    });
    if (!Number.isFinite(amountCentavos) || amountCentavos < 100) {
      return json(req, { error: "Nothing remains to be paid." }, 409);
    }

    // Wording follows what is actually being charged: a customer paying the
    // whole price was still shown "Deposit for ..." on the checkout page.
    const label = paymentPurposeLabel(purpose);
    const description = label + " " + (reservation.product_name ?? "reservation") + " (" + reservation.display_id + ")";

    // Reuse a verified active provider session. A local "open" status alone
    // is not enough: the provider may have expired or completed the session
    // while its webhook is still in flight.
    const { data: existingAttempts, error: existingError } = await admin
      .from("payments")
      .select("id, provider_ref, amount_centavos, purpose, status, created_at")
      .eq("reservation_id", reservationId)
      .in("status", ["awaiting_payment", "processing", "failed"])
      .order("created_at", { ascending: false });

    if (existingError) {
      console.error("Failed to fetch existing payment attempts", existingError);
      return json(req, { error: "Could not start the payment." }, 500);
    }

    const attempts = [...(existingAttempts ?? [])].sort((left, right) => {
      const leftOpen = left.status === "awaiting_payment" || left.status === "processing";
      const rightOpen = right.status === "awaiting_payment" || right.status === "processing";
      return Number(leftOpen) - Number(rightOpen);
    });

    for (const attempt of attempts) {
      if (!attempt.provider_ref) {
        if (attempt.status === "failed") continue;
        return json(req, { error: "A payment session is already being prepared. Please try again." }, 409);
      }

      const sessionResponse = await fetch(
        PAYMONGO_API + "/checkout_sessions/" + attempt.provider_ref,
        { headers: { Authorization: basicAuth } },
      ).catch(() => null);

      if (!sessionResponse) {
        return json(req, { error: "Could not verify the existing payment session. Please try again." }, 502);
      }

      if (sessionResponse.status === 404) {
        const { error: closeError } = await admin
          .from("payments")
          .update({ status: "failed" })
          .eq("id", attempt.id)
          .in("status", ["awaiting_payment", "processing"]);
        if (closeError) throw closeError;
        continue;
      }

      if (!sessionResponse.ok) {
        return json(req, { error: "Could not verify the existing payment session. Please try again." }, 502);
      }

      const session = await sessionResponse.json().catch(() => null);
      if (!session?.data) {
        return json(req, { error: "Could not verify the existing payment session. Please try again." }, 502);
      }

      const providerPayments = session.data.attributes?.payments ?? [];
      const decision = decideExistingCheckout({
        providerStatus: session.data.attributes?.status,
        paymentStatuses: providerPayments.map((payment: any) => payment.attributes?.status),
        storedAmount: attempt.amount_centavos,
        requestedAmount: amountCentavos,
        storedPurpose: attempt.purpose,
        requestedPurpose: purpose,
        checkoutUrl: session.data.attributes?.checkout_url,
      });

      if (decision.kind === "paid") {
        return json(req, { error: "Your payment has already been received and is being processed." }, 409);
      }
      if (decision.kind === "amount_changed") {
        const expired = await expireCheckoutSession(attempt.provider_ref, basicAuth);
        if (!expired) {
          return json(req, {
            error: "The previous payment is still active or processing. Please wait before changing the amount.",
          }, 409);
        }

        const { error: closeError } = await admin
          .from("payments")
          .update({ status: "cancelled" })
          .eq("id", attempt.id)
          .in("status", ["awaiting_payment", "processing"]);
        if (closeError) throw closeError;
        continue;
      }
      if (decision.kind === "invalid") {
        return json(req, { error: "Could not verify the existing payment session. Please try again." }, 502);
      }
      if (decision.kind === "reuse") {
        if (attempt.status === "failed") {
          const expired = await expireCheckoutSession(attempt.provider_ref, basicAuth);
          if (!expired) {
            return json(req, {
              error: "An earlier payment is still active or processing. Please wait before trying again.",
            }, 409);
          }
          continue;
        }
        return json(req, { payment_id: attempt.id, checkout_url: decision.checkoutUrl, reused: true });
      }

      const { error: closeError } = await admin
        .from("payments")
        .update({ status: "failed" })
        .eq("id", attempt.id)
        .in("status", ["awaiting_payment", "processing"]);
      if (closeError) throw closeError;
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
        purpose,
        attempt_started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      console.error("Could not record payment", insertError);
      return json(req, { error: "Could not start the payment." }, 500);
    }
    const paymentId: string = inserted.id;

    // Web opens checkout in a new browser tab, not a WebView, so a custom
    // URL scheme has nowhere to land there -- the browser just shows an
    // unhandled-link error instead of returning to the app. A same-origin
    // page can at least say "you're done, close this tab". Native keeps the
    // custom scheme: WebView's onShouldStartLoadWithRequest intercepts it
    // directly, and there is no tab to worry about closing.
    const origin = req.headers.get("Origin");
    const returnUrl =
      platform === "web" && isAllowedOrigin(origin)
        ? origin + "/payment/return"
        : Deno.env.get("PAYMONGO_RETURN_URL") ?? "jezsymobileapp://payment-return";
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
            reference_number: paymentId,
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
    // The webhook's payment.paid event carries a Payment resource with no
    // checkout_session_id field, only payment_intent_id -- capturing it here
    // is what lets the webhook find its way back to this row.
    const paymentIntentId = created?.data?.attributes?.payment_intent?.id ?? null;

    if (!createRes.ok || !sessionId || !checkoutUrl) {
      console.error("PayMongo session creation failed", JSON.stringify(created));
      const { error: failError } = await admin
        .from("payments")
        .update({ status: "failed" })
        .eq("id", paymentId)
        .is("provider_ref", null);
      if (failError) console.error("Could not close failed payment attempt", failError);
      return json(req, { error: "Could not start the payment." }, 502);
    }

    const { error: updateError } = await admin
      .from("payments")
      .update({ provider_ref: sessionId, provider_payment_intent_id: paymentIntentId })
      .eq("id", paymentId);

    if (updateError) {
      console.error("Could not link payment to session", updateError);
      const expired = await expireCheckoutSession(sessionId, basicAuth);
      const { error: alertError } = await admin.from("admin_notifications").insert({
        title: "Unlinked PayMongo session",
        message: `Checkout ${sessionId} for payment ${paymentId} could not be linked${expired ? " and was expired" : "; expiration failed"}.`,
        type: "Payment",
      });
      if (alertError) console.error("Could not alert on unlinked payment session", alertError);
      return json(req, { error: "Could not start the payment." }, 500);
    }

    return json(req, { payment_id: paymentId, checkout_url: checkoutUrl, reused: false });
  } catch (error) {
    console.error(error);
    return json(req, { error: "Unexpected error." }, 500);
  }
});
