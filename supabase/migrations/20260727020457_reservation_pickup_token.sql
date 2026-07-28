-- Migration: reservation pickup token
--
-- Adds an unguessable per-reservation token so a future staff-side
-- verify_pickup RPC (in the admin dashboard repo) can confirm handoff without
-- trusting the sequential display_id. The customer app surfaces the
-- reservation as a pickup pass; encoding this token into a scannable code and
-- the staff verify RPC are follow-ups.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS pickup_token uuid DEFAULT gen_random_uuid();

-- Backfill rows that predate the default so every reservation has a token.
UPDATE public.reservations SET pickup_token = gen_random_uuid() WHERE pickup_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_pickup_token_key
  ON public.reservations (pickup_token);
