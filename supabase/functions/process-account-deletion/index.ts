// process-account-deletion
//
// The staff-facing entry point for account_deletion_requests. Two privileged
// steps happen here, neither of which can happen anywhere else:
//
// 1. public.process_account_deletion(_request_id) -- a SECURITY DEFINER RPC
//    that scrubs/erases/anonymizes everything in the public schema. Called
//    with the CALLER's own JWT (not the service-role client) so its internal
//    is_staff_or_admin() check resolves against the actual staff member,
//    same pattern create-staff-account uses for identity vs. privilege.
// 2. auth.admin.deleteUser(user_id) -- revokes the ability to ever log back
//    in with that email/password. This is a GoTrue Admin API call, which
//    only works with the service-role key; it cannot run inside a plain
//    Postgres function, which is why step 1 alone was never enough.
//
// Order matters: the DB-side scrub runs first and can report "blocked" (open
// reservation/payment) without touching auth.users at all. Only a fully
// successful scrub proceeds to actually deleting the login credential.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.1';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? ''));
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(req, { error: 'Missing authorization header' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const requestId = body?.request_id;
    if (!requestId || typeof requestId !== 'string') {
      return json(req, { error: 'request_id is required.' }, 400);
    }

    // Bound to the caller's own JWT -- the RPC's own is_staff_or_admin()
    // check runs against this identity, not the service role.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerData } = await callerClient.auth.getUser();
    const callerId = callerData?.user?.id;
    if (!callerId) return json(req, { error: 'Authentication required.' }, 401);

    // Created once here and reused below for auth.admin.deleteUser -- both
    // need the service-role key.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // This runs an irreversible data-erasure RPC -- the guard here is
    // against a runaway retry loop or a scripted burst, not legitimate
    // staff usage, which this limit comfortably allows for. Fails open on
    // an unexpected RPC error: this is an abuse guard, not the RPC's own
    // is_staff_or_admin() authorization check, so availability wins over
    // strictness here.
    const { data: withinLimit, error: rateLimitError } = await adminClient.rpc('check_rate_limit', {
      p_key: `process-account-deletion:${callerId}`,
      p_max_requests: 10,
      p_window_seconds: 60,
    });
    if (rateLimitError) console.error('[process-account-deletion] Rate limit check failed (failing open):', rateLimitError);
    if (withinLimit === false) {
      return json(req, { error: 'Too many requests. Please wait a moment and try again.' }, 429);
    }

    const { data: requestRow, error: requestLookupError } = await adminClient
      .from('account_deletion_requests')
      .select('user_id, status')
      .eq('id', requestId)
      .maybeSingle();
    if (requestLookupError || !requestRow) return json(req, { error: 'Deletion request not found.' }, 404);

    let rpcData = null;
    let rpcError = null;
    if (requestRow.status === 'auth_revocation_pending') {
      rpcData = { blocked: false, user_id: requestRow.user_id };
    } else {
      const result = await callerClient.rpc('process_account_deletion', { _request_id: requestId });
      rpcData = result.data;
      rpcError = result.error;
    }

    if (rpcError) {
      // is_staff_or_admin() failures, already-processed requests, and
      // not-found requests all surface here as Postgres exceptions.
      return json(req, { error: rpcError.message }, 400);
    }

    if (rpcData?.blocked) {
      await adminClient.from('account_deletion_requests').update({ status: 'auth_revocation_pending' }).eq('id', requestId);
      return json(req, {
        blocked: true,
        blockingReservations: rpcData.blocking_reservations,
        blockingPayments: rpcData.blocking_payments,
      }, 200);
    }

    const targetUserId = rpcData?.user_id;
    if (!targetUserId) {
      return json(req, { error: 'Deletion processed but no user id was returned.' }, 500);
    }

    // Only now, after the DB-side scrub fully succeeded, revoke the login
    // credential itself. A failure here leaves the account data already
    // scrubbed but the login still live -- surfaced to staff rather than
    // silently swallowed, since it needs a manual follow-up either way.
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetUserId);

    if (authDeleteError) {
      console.error('[process-account-deletion] auth.admin.deleteUser failed:', authDeleteError);
      return json(req, {
        blocked: false,
        dataErased: true,
        loginRevoked: false,
        error: `Account data was erased, but the login could not be revoked: ${authDeleteError.message}. Please retry or remove the auth user manually.`,
      }, 207);
    }

    const { error: finalizeError } = await adminClient
      .from('account_deletion_requests')
      .update({ status: 'completed', processed_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'auth_revocation_pending');
    if (finalizeError) throw finalizeError;
    return json(req, { blocked: false, dataErased: true, loginRevoked: true }, 200);
  } catch (err) {
    console.error('[process-account-deletion] Unexpected error:', err);
    return json(req, { error: 'Unexpected server error' }, 500);
  }
});
