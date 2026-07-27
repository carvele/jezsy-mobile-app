-- Rollback: remove reservation pickup token
DROP INDEX IF EXISTS public.reservations_pickup_token_key;
ALTER TABLE public.reservations DROP COLUMN IF EXISTS pickup_token;
