-- Reverts the NOT NULL/DEFAULT constraints only. Does NOT un-backfill the
-- 31 historical rows this migration set -- by the time a rollback runs,
-- other rows may have been legitimately written with these same values by
-- normal application traffic, so a blind "set back to NULL" would destroy
-- real data, not just undo this migration's own change.
ALTER TABLE public.reservations
  ALTER COLUMN purchase_mode DROP NOT NULL,
  ALTER COLUMN sales_channel DROP NOT NULL,
  ALTER COLUMN purchase_mode DROP DEFAULT,
  ALTER COLUMN sales_channel DROP DEFAULT;
