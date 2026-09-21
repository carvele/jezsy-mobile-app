import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHandler } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const userClient = (token: string) => createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createHandler({
  env: (key) => Deno.env.get(key),
  authenticate: async (token) => {
    const { data, error } = await userClient(token).auth.getUser(token);
    return error || !data.user?.id ? null : { id: data.user.id };
  },
  checkRateLimit: async (key, maxRequests, windowSeconds) => {
    if (!supabaseUrl || !serviceKey) return null;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });
    return error || typeof data !== 'boolean' ? null : data;
  },
  fetchImpl: fetch,
  log: (message, detail) => console.error('[analyze-wardrobe-image]', message, detail ?? ''),
}));
