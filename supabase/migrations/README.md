# Supabase Canonical Migration Lineage

> **CANONICAL STATUS: THIS REPOSITORY IS THE SINGLE CANONICAL SOURCE OF TRUTH FOR DATABASE SCHEMA MIGRATIONS.**

All database migrations for the shared live Supabase project (`wufcmtndotfvxvvxkamv`) are authored, reviewed, sequenced, and applied exclusively from this directory (`jezsy-mobile-app/supabase/migrations/`). The admin-dashboard migrations directory is deprecated and deactivated.

Because this database is shared and live across Mobile, Admin Dashboard, and background services, every migration must adhere to strict idempotency, disaster-recovery, and authorization standards.

---

## Canonical Authoring & Lifecycle Rules

### 1. File Naming Conventions
- **Forward Migration:** `<timestamp>_<name>.sql`
- **Disaster Recovery Companion:** `<timestamp>_<name>.sql.rollback`
- **Naming Rule:** The companion MUST use the extension `.sql.rollback` (extension first, never `.rollback.sql`). The Supabase CLI detects any `*.sql` file as an active forward migration, which causes phantom unapplied migration errors if `.rollback.sql` is used.
- **Timestamps:** Every new migration must use a sequential timestamp strictly greater than the frozen live baseline (`20260911181020`).

### 2. Mandatory Idempotency Patterns

Every migration must be safe to execute multiple times against a live database where objects may already exist:

#### A. Policies — Always `DROP POLICY IF EXISTS` Before `CREATE POLICY`
```sql
DROP POLICY IF EXISTS "Staff can view devices" ON public.devices;
CREATE POLICY "Staff can view devices" ON public.devices FOR SELECT
  USING (public.is_staff_or_admin());
```

#### B. Tables & Columns — Always `IF NOT EXISTS`
```sql
CREATE TABLE IF NOT EXISTS capsules ( ... );
ALTER TABLE public.user_measurements ADD COLUMN IF NOT EXISTS scan_confidence real DEFAULT 0;
```

#### C. Constraints — Always Wrapped in `DO $$` Guard or Drop First
```sql
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

#### D. Functions — Restate All Grants and Security Settings
`CREATE OR REPLACE FUNCTION` is inherently idempotent, but a replace silently reverts to default SQL settings. Always explicitly restate:
- `SECURITY DEFINER` / `SECURITY INVOKER`
- Explicit pinned `SET search_path = public, pg_temp` (or `SET search_path = ''`)
- Explicit grants: `REVOKE EXECUTE ON FUNCTION ... FROM anon, PUBLIC;` and `GRANT EXECUTE ON FUNCTION ... TO authenticated;`

### 3. Grant Revocation Hygiene
- PostgreSQL defaults to granting `EXECUTE` to `PUBLIC`.
- `REVOKE EXECUTE ... FROM anon` alone can be a no-op if the default `PUBLIC` grant is intact.
- Always revoke from both `anon, PUBLIC` explicitly and verify using:
  ```sql
  SELECT has_function_privilege('anon', 'public.my_function(uuid)'::regprocedure, 'EXECUTE');
  ```

### 4. Post-Migration Synchronization Workflow
After any migration is applied to the live Supabase project:
1. Regenerate TypeScript definitions:
   ```bash
   npx supabase gen types typescript --linked > src/types/database.types.ts
   ```
2. Mirror the exact generated `database.types.ts` into `admin-dashboard/src/types/database.types.ts`.
3. Verify type-checking and contract guards across both repositories.
