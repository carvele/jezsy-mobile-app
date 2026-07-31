import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secretKey) {
      console.error("PAYMONGO_SECRET_KEY is not set");
      return json({ error: "Payments are not configured." }, 503);
    }
    const basicAuth = `Basic ${btoa(`${secretKey}:`)}`;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Authentication required." }, 401);

    // Two clients on purpose: the anon one only resolves who is calling, the
    // service-role one does every read and write that follows.
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: userData, error: userError } = await caller.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) return json({ error: "Authentication required." }, 401);

    const body = await req.json().catch(() => null);
    const reservationId: string | undefined = body?.reservation_id;
    if (!reservationId) return json({ error: "reservation_id is required." }, 400);

    // Ownership and amount both come from the row itself.
    const { data: reservation, error: reservationError } = await admin
      .from("reservations")
      .select("id, customer_id, deposit, display_id, product_name, payment_status, status, payment_due_at, payment_type")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError || !reservation) return json({ error: "Reservation not found." }, 404);
    if (reservation.customer_id !== userId) return json({ error: "Not your reservation." }, 403);
    if (String(reservation.payment_status).toLowerCase() === "paid") {
      return json({ error: "This reservation is already paid." }, 409);
    }

    // Payment happens while the reservation is still Pending; staff confirm
    // afterwards. Anything already Cancelled or Completed must not be payable.
    const status = String(reservation.status ?? "").toLowerCase();
    if (status !== "pending") {
      return json(
        {
          error:
            status === "cancelled"
              ? "This reservation was cancelled."
              : "This reservation is no longer awaiting payment.",
        },
        409,
      );
    }

    // Server-side deadline check. The sweep runs every five minutes, so a
    // reservation can be past due but not yet cancelled -- without this, a
    // customer could pay into that gap and then have it cancelled underneath
    // them.
    if (reservation.payment_due_at && new Date(reservation.payment_due_at).getTime() < Date.now()) {
      return json({ error: "The payment window for this reservation has closed." }, 409);
    }

    const amountPesos = Number(reservation.deposit ?? 0);
    if (!Number.isFinite(amountPesos) || amountPesos <= 0) {
      return json({ error: "Nothing to pay." }, 400);
    }

    // PayMongo works in centavos and enforces a 100-centavo floor.
    const amountCentavos = Math.round(amountPesos * 100);
    if (amountCentavos < 100) return json({ error: "Amount is below the minimum." }, 400);

    // Wording follows what is actually being charged: a customer paying the
    // whole price was still shown "Deposit for ..." on the checkout page.
    const label = String(reservation.payment_type ?? "").toLowerCase() === "full"
      ? "Full payment for"
      : "Deposit for";
    const description = `${label} ${reservation.product_name ?? "reservation"} (${reservation.display_id})`;

    // Reuse an open session rather than stacking them; the partial unique index
    // would reject a second one anyway.
    const { data: existing } = await admin
      .from("payments")
      .select("id, provider_ref, amount_centavos")
      .eq("reservation_id", reservationId)
      .in("status", ["awaiting_payment", "processing"])
      .maybeSingle();

    if (existing?.provider_ref && existing.amount_centavos === amountCentavos) {
      const session = await fetch(`${PAYMONGO_API}/checkout_sessions/${existing.provider_ref}`, {
        headers: { Authorization: basicAuth },
      })
        .then((r) => r.json())
        .catch(() => null);

      const url = session?.data?.attributes?.checkout_url;
      if (url) return json({ payment_id: existing.id, checkout_url: url, reused: true });
    }

    // Record the payment attempt BEFORE calling PayMongo, not after. The
    // webhook is the sole authority for marking a payment paid and it looks
    // up by provider_ref alone -- creating the session first and inserting
    // second meant a failed insert left a live, payable session with nothing
    // in `payments` pointing back at it. provider_ref starts null (the
    // partial unique index only applies once it's set) and is attached once
    // the session actually exists.
    let paymentId: string;
    if (existing) {
      paymentId = existing.id;
      const { error: resetError } = await admin
        .from("payments")
        .update({ provider_ref: null, amount_centavos: amountCentavos, status: "awaiting_payment" })
        .eq("id", existing.id);
      if (resetError) {
        console.error("Could not reset payment row", resetError);
        return json({ error: "Could not start the payment." }, 500);
      }
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("payments")
        .insert({
          user_id: userId,
          reservation_id: reservationId,
          provider: "paymongo",
          amount_centavos: amountCentavos,
          currency: "PHP",
          status: "awaiting_payment",
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        console.error("Could not record payment", insertError);
        return json({ error: "Could not start the payment." }, 500);
      }
      paymentId = inserted.id;
    }

    const returnUrl = Deno.env.get("PAYMONGO_RETURN_URL") ?? "jezsymobileapp://payment-return";

    const createRes = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
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
            success_url: returnUrl,
            cancel_url: returnUrl,
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
      return json({ error: "Could not start the payment." }, 502);
    }

    const { error: updateError } = await admin
      .from("payments")
      .update({ provider_ref: sessionId })
      .eq("id", paymentId);

    if (updateError) {
      console.error("Could not link payment to session", updateError);
      return json({ error: "Could not start the payment." }, 500);
    }

    return json({ payment_id: paymentId, checkout_url: checkoutUrl, reused: false });
  } catch (error) {
    console.error(error);
    return json({ error: "Unexpected error." }, 500);
  }
});
