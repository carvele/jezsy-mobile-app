# Migration conventions

This directory is applied against a **live, shared** Supabase Postgres project — a
second repo (admin-dashboard) reads and writes the same database, and applying a
migration can silently drift the ledger version away from the filename (see the
project's shared-DB workflow notes). Because of that drift, any migration can end
up re-applied against a database where its objects already exist. Every migration
in this directory must be safe to run twice.

## The four required patterns

### 1. `CREATE POLICY` — always preceded by `DROP POLICY IF EXISTS`

`CREATE POLICY` has no `IF NOT EXISTS` form. Without a preceding drop, a re-apply
fails with `policy already exists`.

```sql
-- Bad
CREATE POLICY "Staff can view devices" ON public.devices FOR SELECT
  USING (public.is_staff_or_admin());

-- Good
DROP POLICY IF EXISTS "Staff can view devices" ON public.devices;
CREATE POLICY "Staff can view devices" ON public.devices FOR SELECT
  USING (public.is_staff_or_admin());
```

### 2. `CREATE TABLE` / `ADD COLUMN` — always `IF NOT EXISTS`

```sql
-- Bad
CREATE TABLE capsules ( ... );
ALTER TABLE user_measurements ADD COLUMN scan_confidence real DEFAULT 0;

-- Good
CREATE TABLE IF NOT EXISTS capsules ( ... );
ALTER TABLE user_measurements ADD COLUMN IF NOT EXISTS scan_confidence real DEFAULT 0;
```

### 3. `ADD CONSTRAINT` — wrapped in a `DO $$ ... IF NOT EXISTS` guard

`ADD CONSTRAINT` has no `IF NOT EXISTS` form either. Check `pg_constraint` first.

```sql
-- Bad
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_display_id_key UNIQUE (display_id);

-- Good
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_display_id_key'
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_display_id_key UNIQUE (display_id);
  END IF;
END $$;
```

If you also need to `DROP CONSTRAINT` first (e.g. widening a `CHECK`), use
`DROP CONSTRAINT IF EXISTS` — the unconditional `ADD CONSTRAINT` that follows is
then safe on its own, since the drop guarantees a clean slate every time.

### 4. Every forward migration needs a matching `.rollback.sql`

`<name>.sql` and `<name>.rollback.sql`, same base filename. The rollback should
restore the previous state (e.g. drop what the forward migration created, or
`CREATE OR REPLACE` the function body back to its prior version) — not just be a
placeholder.

## Other things this ledger has been bitten by before

- **`CREATE OR REPLACE FUNCTION` doesn't need a guard** (it's inherently
  idempotent) — but check whether an earlier migration set `SECURITY DEFINER` or
  specific `GRANT`/`REVOKE`s that your replace needs to restate. A bare
  `CREATE OR REPLACE` silently reverts to the SQL you wrote, not to whatever
  grants/security mode were layered on afterward. This exact bug shipped twice
  in this repo's history (`create_reservation`, `create_order`).
- **`REVOKE ... FROM anon` alone is a no-op** if the function still has its
  default `PUBLIC` grant — revoke from `PUBLIC, anon, authenticated` explicitly
  and verify with `has_function_privilege('anon', '...', 'EXECUTE')` before
  trusting it's closed.
- **New migrations should be sequenced after the functions/columns they
  reference actually exist in this ledger**, not just on the live DB. A
  migration applied ad hoc outside this ledger (common during incident response)
  needs a follow-up migration recording it here — otherwise a fresh-database
  replay from this directory alone will fail partway through.
