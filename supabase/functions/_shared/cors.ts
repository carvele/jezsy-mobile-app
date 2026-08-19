/**
 * Shared CORS helper for Supabase Edge Functions.
 *
 * Reads the comma-separated ALLOWED_ORIGINS secret (set via `supabase secrets set`).
 * Falls back to '*' only if the secret is not configured -- set it explicitly in
 * production to lock down to known origins.
 *
 * Usage:
 *   import { corsHeaders, handleCors } from '../_shared/cors.ts';
 *
 *   Deno.serve(async (req) => {
 *     const preflight = handleCors(req);
 *     if (preflight) return preflight;
 *     // ... handler body
 *     return new Response(JSON.stringify(data), {
 *       headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
 *     });
 *   });
 */

const ALLOWED_ORIGINS: string[] = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes('*')
    ? '*'
    : ALLOWED_ORIGINS.includes(origin)
    ? origin
    : (ALLOWED_ORIGINS[0] ?? '');

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

/** Returns a 200 preflight response if the request is OPTIONS, otherwise null. */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders(req) });
  }
  return null;
}
