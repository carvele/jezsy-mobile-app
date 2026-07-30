-- Reverts 20260730093000_payments.sql
--
-- Drops the payments table only. Check for non-terminal payments rows first:
-- any reservation paid through the gateway loses its payment record and there
-- will be nothing left to reconcile it against.
--
-- This file used to also restore create_reservation, carrying a body with
-- `_appointment_time::time` -- the pre-Asia/Manila cast. Running it would have
-- reverted 20260730002045 and reproduced the 42804 error that broke every
-- reservation at INSERT. A rollback that breaks an unrelated feature is not a
-- rollback. create_reservation is owned solely by
-- 20260730051910_payment_before_confirm.sql; use its rollback if you need to
-- move that function.

DROP POLICY IF EXISTS "Staff update payments" ON public.payments;
DROP POLICY IF EXISTS "Staff read all payments" ON public.payments;
DROP POLICY IF EXISTS "Users read own payments" ON public.payments;

DROP TRIGGER IF EXISTS trg_payments_touch_updated_at ON public.payments;

DROP INDEX IF EXISTS public.payments_one_open_per_reservation;
DROP INDEX IF EXISTS public.payments_reservation_id_idx;
DROP INDEX IF EXISTS public.payments_user_id_idx;
DROP INDEX IF EXISTS public.payments_provider_ref_key;

DROP TABLE IF EXISTS public.payments;
