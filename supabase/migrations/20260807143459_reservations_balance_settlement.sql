-- Record that the balance was actually collected at handover.
--
-- A deposit reservation takes 50% up front and the rest in person. Nothing has
-- ever recorded that the rest arrived: staff hand the item over, the status
-- moves to Completed, and the cash is invisible to the system. A member of
-- staff who forgets to collect loses the money silently.
--
-- The balance itself stays derived (rental_price - deposit). These columns
-- record only the event of collection, which cannot be derived from anything.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS balance_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_method text,
  ADD COLUMN IF NOT EXISTS balance_settled_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_balance_method_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_balance_method_check
      CHECK (balance_method IS NULL OR balance_method IN ('cash','transfer','card','other'));
  END IF;
END $$;

-- A method without a timestamp is a half-written row: the settlement is the
-- timestamp, the method only describes it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_balance_settled_together_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_balance_settled_together_check
      CHECK (balance_method IS NULL OR balance_settled_at IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.reservations.balance_settled_at IS
  'When the remaining balance was collected in person. NULL means outstanding. Full-payment reservations never have a balance, so this stays NULL for them.';
COMMENT ON COLUMN public.reservations.balance_method IS
  'How the balance was taken: cash, transfer, card or other. NULL when nothing has been collected.';
COMMENT ON COLUMN public.reservations.balance_settled_by IS
  'Staff profile id that recorded the collection. No FK: profiles rows can be removed and losing the audit row with them would be worse than a dangling id.';
