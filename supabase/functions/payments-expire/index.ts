import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const PAYMONGO_API = "https://api.paymongo.com/v1";

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(req, { error: "Authentication required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: userData, error: userError } = await caller.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) return json(req, { error: "Authentication required." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role, deleted, is_blocked, employment_status")
      .eq("id", userId)
      .maybeSingle();
    if (
      profileError ||
      !profile ||
      profile.deleted ||
      profile.is_blocked ||
      (profile.employment_status && profile.employment_status !== "active") ||
      !["owner", "admin", "staff"].includes(String(profile.role).toLowerCase())
    ) {
      return json(req, { error: "Reservation payment access required." }, 403);
    }

    const body = await req.json().catch(() => null);
    const reservationId: string | undefined = body?.reservation_id;
    if (!reservationId) return json(req, { error: "reservation_id is required." }, 400);

    const { data: attempts, error: attemptsError } = await admin
      .from("payments")
      .select("id, provider_ref, status, created_at")
      .eq("reservation_id", reservationId)
      .eq("provider", "paymongo")
      .in("status", ["awaiting_payment", "processing", "failed"]);
    if (attemptsError) throw attemptsError;
    if (!attempts?.length) return json(req, { expired: 0 });

    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secretKey) return json(req, { error: "Payments are not configured." }, 503);

    const authorization = "Basic " + btoa(secretKey + ":");
    let expired = 0;

    for (const attempt of attempts ?? []) {
      if (!attempt.provider_ref) {
        if (["awaiting_payment", "processing"].includes(attempt.status)) {
          const ageMs = Date.now() - new Date(attempt.created_at).getTime();
          if (ageMs < 120_000) {
            return json(req, { error: "A payment session is still being prepared. Try again shortly." }, 409);
          }
          
          // If it's been more than 2 minutes without a provider_ref, the session
          // creation crashed. Fail it locally to unblock staff actions.
          const { error: closeError } = await admin
            .from("payments")
            .update({ status: "failed" })
            .eq("id", attempt.id);
          if (closeError) throw closeError;
        }
        continue;
      }

      const sessionResponse = await fetch(
        PAYMONGO_API + "/checkout_sessions/" + attempt.provider_ref,
        { headers: { Authorization: authorization } },
      ).catch(() => null);
      if (!sessionResponse) return json(req, { error: "Could not verify the active payment." }, 502);

      if (sessionResponse.status === 404) {
        await admin.from("payments").update({ status: "failed" }).eq("id", attempt.id)
          .in("status", ["awaiting_payment", "processing"]);
        continue;
      }
      if (!sessionResponse.ok) return json(req, { error: "Could not verify the active payment." }, 502);

      const session = await sessionResponse.json().catch(() => null);
      const providerPayments = session?.data?.attributes?.payments ?? [];
      if (providerPayments.some((payment: any) => payment?.attributes?.status === "paid")) {
        return json(req, { error: "A payment was already received and is still being recorded." }, 409);
      }
      if (session?.data?.attributes?.status !== "active") {
        await admin.from("payments").update({ status: "cancelled" }).eq("id", attempt.id)
          .in("status", ["awaiting_payment", "processing", "failed"]);
        continue;
      }

      const expireResponse = await fetch(
        PAYMONGO_API + "/checkout_sessions/" + attempt.provider_ref + "/expire",
        { method: "POST", headers: { Authorization: authorization } },
      ).catch(() => null);
      if (!expireResponse) return json(req, { error: "Could not close the active payment." }, 502);
      if (!expireResponse.ok) {
        if (expireResponse.status !== 400) {
          return json(req, { error: "Could not close the active payment." }, 502);
        }
        // PayMongo returns 400 when an attempt is attached to the session and cannot be expired via API.
        // If a payment was actually paid, it was already handled above (status === "paid" returns 409).
        // For uncompleted/failed attempts, proceed with local cancellation so staff operations
        // (cash balance recording, handover, cancellation) are not permanently blocked.
        console.warn(
          `[payments-expire] PayMongo refused to expire session ${attempt.provider_ref} (status 400). Proceeding with local cancellation.`,
        );
      }

      const { error: closeError } = await admin
        .from("payments")
        .update({ status: "cancelled" })
        .eq("id", attempt.id)
        .in("status", ["awaiting_payment", "processing", "failed"]);
      if (closeError) throw closeError;
      expired += 1;
    }

    return json(req, { expired });
  } catch (error) {
    console.error(error);
    return json(req, { error: "Could not close active payments." }, 500);
  }
});
