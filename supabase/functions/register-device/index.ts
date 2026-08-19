import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.1';
import { corsHeaders, handleCors } from '../_shared/cors.ts';

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  // Handle CORS preflight from admin-dashboard (browser) and mobile dev tools.
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json(req, { error: 'Authentication required.' }, 401);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return json(req, { error: 'Invalid or expired session.' }, 401);

    const { data: profile } = await admin
      .from('profiles')
      .select('role, deleted, is_blocked, employment_status')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile || profile.deleted || profile.is_blocked || profile.employment_status === 'terminated' || !['staff', 'admin', 'owner'].includes(profile.role)) {
      return json(req, { error: 'Staff access required.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const fingerprint = typeof body?.fingerprint === 'string' ? body.fingerprint.trim() : '';
    if (!fingerprint || fingerprint.length > 256) return json(req, { error: 'A valid device fingerprint is required.' }, 400);

    const { data: existing, error: lookupError } = await admin
      .from('devices')
      .select('fingerprint, status')
      .eq('fingerprint', fingerprint)
      .maybeSingle();
    if (lookupError) return json(req, { error: 'Device status unavailable.' }, 503);
    if (existing) return json(req, { device: existing }, 200);

    const { data: device, error: insertError } = await admin
      .from('devices')
      .insert({
        fingerprint,
        status: 'pending',
        user_agent: typeof body?.user_agent === 'string' ? body.user_agent.slice(0, 512) : null,
        staff_email: user.email ?? null,
        staff_name: typeof body?.staff_name === 'string' ? body.staff_name.slice(0, 200) : null,
        last_seen: new Date().toISOString(),
        failed_attempts: 0,
        login_history: [{ email: user.email, time: new Date().toISOString() }],
      })
      .select('fingerprint, status')
      .single();
    if (insertError) return json(req, { error: 'Device registration failed.' }, 503);
    return json(req, { device }, 201);
  } catch (error) {
    console.error('[register-device] unexpected error', error);
    return json(req, { error: 'Unexpected server error.' }, 500);
  }
});
