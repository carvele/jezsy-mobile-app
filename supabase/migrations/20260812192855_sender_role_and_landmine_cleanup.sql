-- Three unrelated fixes from a full audit-surface sweep, bundled because each
-- is small and each closes a real gap found by cross-checking file content
-- against the live schema (not just reading the migration files).

-- 1. messages.sender_role was defined in 20260812231500_add_sender_role_and_
-- fix_pose_guides.sql but that migration was never actually applied (same
-- never-applied-landmine pattern found repeatedly this session) -- the
-- column plain does not exist live. owner-dashboard's useRealtimeSync.js
-- has been checking payload.new.sender_type (a column that has never
-- existed under any name) to decide whether an incoming message is from a
-- customer; since that field is always undefined, `undefined !== 'staff'`
-- is always true, so a staff member's own outgoing message currently
-- triggers their own "new customer message" alert sound. Adding the column
-- here; the owner-dashboard fix to actually read sender_role ships
-- alongside this in the same PR.
--
-- The column is set server-side by a BEFORE INSERT trigger rather than
-- trusted from the client, closing a gap the migration-review pass flagged:
-- the messages INSERT RLS policy only checks sender_id = auth.uid() and
-- conversation ownership, never sender_role, so a client could otherwise
-- set sender_role: 'staff' on their own insert and have it accepted as-is.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_role text DEFAULT 'customer';

CREATE OR REPLACE FUNCTION public.set_message_sender_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  SELECT CASE WHEN p.role IN ('staff', 'owner') THEN 'staff' ELSE 'customer' END
  INTO NEW.sender_role
  FROM public.profiles p
  WHERE p.id = NEW.sender_id;

  IF NEW.sender_role IS NULL THEN
    NEW.sender_role := 'customer';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_message_sender_role() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_message_sender_role ON public.messages;
CREATE TRIGGER trg_set_message_sender_role
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.set_message_sender_role();

-- Backfill: every existing row currently reads the just-added column's
-- default ('customer'). Correct the ones actually sent by staff/owner/owner.
UPDATE public.messages m
SET sender_role = 'staff'
FROM public.profiles p
WHERE p.id = m.sender_id
  AND p.role IN ('staff', 'owner')
  AND m.sender_role IS DISTINCT FROM 'staff';

-- 2. conversations has no DELETE policy at all (RLS enabled, INSERT/SELECT/
-- UPDATE only), so owner-dashboard's "delete conversation" action fails
-- closed for every role including owner/owner. Not a security gap -- a
-- broken feature -- but a one-line fix found in the same sweep.
DROP POLICY IF EXISTS "Enable delete for owner" ON public.conversations;
CREATE POLICY "Enable delete for owner"
  ON public.conversations FOR DELETE
  TO authenticated
  USING (public.is_admin_or_owner());

-- 3. 20260809190000_audit_remediation_pack.sql shipped a second, broken
-- create_reservation(uuid,text,text,date,timestamptz,text,text,integer)
-- overload alongside the older working one: it inserts into
-- deposit_amount/payment_option/receipt_path (none exist on reservations;
-- the real columns are deposit/payment_type/receipt_url) and into
-- public.reservation_seq (does not exist as a table). It is currently inert
-- -- EXECUTE is revoked from anon/authenticated on every create_reservation*
-- overload, per 20260805231149_create_reservation_multi.rollback and
-- friends -- but it is a landmine: two live overloads sharing a name is a
-- PostgREST resolution hazard, and if EXECUTE is ever re-granted on
-- "the create_reservation fix" without noticing there are two, this one
-- 500s on every call. Dropping it; the real write path is
-- create_reservation_multi.
DROP FUNCTION IF EXISTS public.create_reservation(
  uuid, text, text, date, timestamptz, text, text, integer
);
