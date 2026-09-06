-- Rollback: drop the balance settlement columns and their constraints.
-- Destructive: any recorded settlement is lost with the columns.
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_balance_settled_together_check,
  DROP CONSTRAINT IF EXISTS reservations_balance_method_check;

ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS balance_settled_by,
  DROP COLUMN IF EXISTS balance_method,
  DROP COLUMN IF EXISTS balance_settled_at;
