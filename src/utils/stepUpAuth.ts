import { User } from '@supabase/supabase-js';

/**
 * One reading of "does this sensitive action need a fresh credential check".
 *
 * NOT A SECURITY CONTROL. This runs in the app, so it is a UX prompt and
 * defence-in-depth only -- it is not enforcement. create_reservation_multi
 * requires nothing more than a non-null auth.uid(), so anything calling that
 * RPC directly skips this check entirely and the reservation still succeeds.
 * Enforcing it server-side is possible (the RPC is SECURITY DEFINER and could
 * read auth.users.last_sign_in_at) but was deliberately not done: the threat
 * is a stolen session older than the window, on a flow where staff review
 * every reservation before any payment is taken, so the blast radius did not
 * justify turning a friendly modal into an opaque RPC failure. Revisit if
 * reservations ever take money without human review.
 *
 * Gated on user.last_sign_in_at, not a locally-stored timestamp: GoTrue only
 * updates that field on an actual credential grant (password, OTP, OAuth),
 * never on a silent refresh-token exchange, so it can't be faked stale by
 * simply leaving the app open. A prior local re-auth gate here (a 6-digit
 * PIN checked after the session was already valid) was tried and reverted --
 * see commit 93d3222 -- because it guarded nothing the session didn't
 * already guard. This checks the one signal that actually reflects real
 * authentication age.
 */
const STEP_UP_WINDOW_DAYS = 30;

export function needsStepUpReauth(user: Pick<User, 'last_sign_in_at'> | null | undefined): boolean {
  if (!user?.last_sign_in_at) return true;

  const ageMs = Date.now() - new Date(user.last_sign_in_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > STEP_UP_WINDOW_DAYS;
}
