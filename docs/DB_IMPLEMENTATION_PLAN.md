# Implementation Plan — Database Reconstruction

> ## STATUS as of 2026-07-20 (end of execution)
>
> **Batches 0–5 are complete and applied live**, except the items listed as blocked below. The migration ledger is 1:1 with `supabase/migrations/` (47 files ↔ 47 rows, verified). Every migration has a paired `.rollback.sql`.
>
> | Batch | Status |
> |---|---|
> | 0 — repo hygiene | Done. PRs #2–#5 were merged by a co-worker mid-execution; audit docs committed. |
> | 1 — critical security | Done. `devices` true/true policy removed, price-manipulation vector closed, RPC execution locked down. |
> | 2 — ledger repair | Done, then superseded/merged with a co-worker's parallel consolidation. Ledger now clean. |
> | 3 — integrity constraints | Done, incl. stock reconciliation via trigger. |
> | 4 — cross-app repairs | 4a reactions ✅, 4b unread badge ✅, 4c category backfill ✅ (done by co-worker's taxonomy migrations). **4d rental rename — BLOCKED, see below.** |
> | 5 — hygiene | 5a policy consolidation ✅, 5b FK indexes ✅, 5c storage listing ✅, 5d `updated_at` triggers ✅. **5e, 5f blocked/deferred, see below.** |
>
> ### Additional issues found *during* execution and fixed (not in the original audit)
> - **`profiles` INSERT had no ownership check** (`WITH CHECK auth.role() = 'authenticated'`) — any authenticated user could create a profile row for an arbitrary id. Fixed in `20260720170000`.
> - **`messages` INSERT allowed cross-conversation injection** — the policy's `sender_id = auth.uid()` disjunct stood alone, letting any user post into a stranger's private conversation. Fixed in `20260720270000`, verified by impersonation test.
>
> ### Corrections to the audit reports (findings that turned out to be wrong)
> - **"White Dress stock drift 32 vs 40" was a false positive** — compared `products.stock` against `sum(inventory.total)` when the app defines it as `sum(available)`. No drift existed.
> - **"`messages.read_at` is written by nothing" was a false positive** — `markAsRead()` stamps it and the chat screen renders read receipts from it.
>
> ### Still open — requires a human
> 1. **This branch is not merged.** Its original PR (#3) was merged early, so GitHub will not pick up the ~14 commits pushed since. A **new PR against current `main` is required**; `gh pr create` is blocked by the tool-permission classifier in this environment.
> 2. **4d — `rental_price` → `reservation_price` rename: BLOCKED.** Requires a lockstep change in `admin-dashboard`, which I cannot push to. Renaming unilaterally would break the admin app immediately.
> 3. **5e — leaked-password protection** is a Supabase *dashboard* setting, not SQL. Must be toggled in Auth settings by hand.
> 4. **5f — dead-object removal** (`color_options`, `pose_guides`, `suggested_outfits`, `ar_assets`, `create_reservations_from_cart`, `rls_auto_enable`) is destructive and deliberately not executed. Needs an archive export + explicit confirmation.
> 5. **Two bugs found in `admin-dashboard`** that need fixing in that repo: `uploadChatImage()` still writes to the `avatars` bucket despite its own docstring saying `chat-images` (`communicationService.js:44-48`), and `syncProductStock()` is now redundant (superseded by the `sync_product_stock` DB trigger) though harmless.
> 6. **Coordinate migrations with your co-worker.** We both independently reconstructed the same phantom migrations on the same day. Agree on a single owner for `supabase/migrations` before the next change.

---

Date: 2026-07-20. Executes the findings in `DB_AUDIT_2026-07-20.md` (system) and `DB_TABLE_AUDIT_2026-07-20.md` (per-table). Ground rules carried over from the audit brief:

- Every change is a **new, additive migration file** with a paired rollback. No existing migration is edited.
- **Nothing runs against the live project without explicit sign-off per batch.**
- Anything destructive or requiring backfill is flagged ⚠ and stops for confirmation.
- Both repos ship in lockstep where a change touches shared tables.

## Decision points needed before the relevant batch (not before starting)

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| D1 | Canonical status casing (`'Pending'` vs `'pending'`) | Batch 3 | Capitalized — both apps already write it; only DB defaults are lowercase |
| D2 | Stock source of truth (`inventory` rows vs `products.stock`) | Batch 3 | `inventory` is truth; `products.stock` becomes derived |
| D3 | White Dress reconciliation (32 vs 40) | Batch 3 | ⚠ needs owner's knowledge of physical stock |
| D4 | Message reactions: build (add column + RPC) or remove the admin UI | Batch 4 | Remove unless the feature is wanted for the thesis demo |
| D5 | `unread_count` semantics (who increments, who resets) | Batch 4 | DB trigger increments on insert where sender ≠ customer; mobile resets on open |
| D6 | Rename `rental_price` → `reservation_price`? | Batch 4 | Yes, but last — it's cosmetic and touches both apps |
| D7 | Drop dead tables (`color_options`, `pose_guides`, `suggested_outfits`, `ar_assets`)? | Batch 5 | ⚠ archive-then-drop after owner confirms no dashboard picker uses `color_options.hex` |

---

## Batch 0 — Repo hygiene (no DB changes) — ~30 min

1. Commit the three audit docs (`DB_AUDIT`, `DB_TABLE_AUDIT`, this plan) to the current branch.
2. Merge PRs #2 (docs), #3 (RLS+RPC, includes the `return_date` fix), #5 (profile sync + conversation trigger). All verified conflict-free and already live-applied; merging just ends the git↔DB drift growth.
3. PR #4 (body scan) stays open pending device test — separate track, not part of this plan.
4. Add `supabase/migrations/README.md` declaring the **mobile repo as the sole migration owner** going forward; admin repo gets a pointer file. (Two repos writing migrations to one DB is how the ledger split-brain happened.)

## Batch 1 — Critical security migrations — ~2 h

Three migration files + rollbacks. **Order matters** (1a is the active exploit path).

- **1a. `lock_devices_table.sql`** — drop `Enable upsert for authenticated users` (true/true); create staff-only SELECT/INSERT/UPDATE/DELETE via `is_staff_or_admin()`.
  - **Pre-step (verification, read-only):** trace the admin login flow (`AuthContext.jsx`, `Login.jsx`) to confirm device upsert happens *after* `signInWithPassword`, not before. If registration is pre-auth, the policy needs an INSERT carve-out — plan assumes post-auth until verified.
  - Rollback: recreate the permissive policy.
- **1b. `close_price_manipulation_vector.sql`** — **already drafted** at `supabase/migrations/20260720140000_...`. Drops customer INSERT/UPDATE on `reservations`, customer FOR-ALL on `orders`/`order_items`; keeps owner SELECT; flips `create_reservation`/`create_order` to SECURITY DEFINER. Admin walk-in-sale path verified preserved. Needs renumbering to follow 1a. Rollback: recreate dropped policies, ALTER back to INVOKER.
- **1c. `lock_rpc_execution.sql`** —
  - Revoke anon+authenticated EXECUTE on all trigger functions (`handle_new_user`, `sync_conversation_on_message`, `approve_device`, `check_profile_updates`, `log_staff_status_change`, `prevent_stock_movement_updates`, `update_product_rating`, `rls_auto_enable`, `validate_reservation_time`).
  - Rewrite `update_user_streak()` to take **no target parameter** and use `auth.uid()`; revoke anon. ⚠ mobile currently doesn't call it (dead), so no client change needed — confirm before rewrite.
  - Read `update_staff_status` body; if it lacks an internal `is_admin_or_owner()` guard, add one.
  - `check_email_exists`: keep (mobile pre-signup uses it) but document the enumeration trade-off; optionally add a fixed-delay to blunt timing.
- **Verify:** re-run security advisors; probe as `anon`/`authenticated` PostgREST roles that direct writes 403.

## Batch 2 — Migration-ledger repair (procedural, ⚠ touches `supabase_migrations` ledger only, not schema) — ~2 h

Goal: one repo (mobile), one ledger, every file matches a ledger row.

1. **Recover the six untracked live migrations** (`add_profile_self_insert_policy`, `drop_insecure_profile_self_insert`, `restrict_staff_write_rls`, `add_products_category_fk`, `backfill_inventory_rows`, `fix_category_id_ambiguous_match`): reconstruct SQL from live schema state, commit as files with their live version numbers.
2. **Import admin's five migrations** into the mobile repo verbatim (they own the live versions `20260712000000`–`20260716000000`).
3. **Resolve the collision:** mobile's `20260715000000_wardrobe_setup.sql` renames to a free version slot (e.g. `20260715000001`); ledger row inserted marking it applied.
4. **Reconcile the double-version PR #3 files:** keep the file timestamps, `supabase migration repair --status applied` each; delete the four MCP-created ledger rows (`202607191411xx`) or vice-versa — one canonical row per migration.
5. **Add ledger rows** for the nine out-of-band mobile migrations (`20260629…`–`20260716130000`).
6. **End state check:** `supabase db diff` against the live project returns empty; `supabase migration list` shows local = remote exactly.
7. Admin repo: delete its `supabase/migrations` (replaced by pointer README from Batch 0).

Rollback: the ledger table is fully reconstructible from the recorded end-state list; snapshot it (`select * from supabase_migrations.schema_migrations`) before touching it.

## Batch 3 — Integrity constraints — ~3 h, one migration file per item

- **3a. `reservations_display_id_unique.sql`** — `UNIQUE (display_id)`. Table has 0 rows; no backfill. Also make the RPC rely on the constraint (retry on unique-violation) instead of check-then-insert.
- **3b. `profiles_role_constraint.sql`** — `role SET NOT NULL, SET DEFAULT 'customer'`, `CHECK (role IN ('customer','staff','admin','owner'))`. Pre-check live rows (all 10 currently valid). ⚠ blocks any future role value — confirm the four-role list is complete.
- **3c. `normalize_status_values.sql`** (needs **D1**) — ⚠ one-time UPDATE backfill of `reservations.status/payment_status`, `orders.status` to canonical casing; new defaults `'Pending'`; CHECK constraints listing the full state machines (enumerate from both apps' literals first — small code sweep included in this step). Rollback: drop CHECKs, restore old defaults (data backfill is one-way ⚠).
- **3d. `inventory_constraints.sql`** — `UNIQUE (product_doc_id, size)`, `CHECK (total >= 0 AND reserved >= 0 AND reserved <= total)`, index on `product_doc_id`. Live data already satisfies all three (verified).
- **3e. `stock_reconciliation.sql`** (needs **D2, D3**) — extend `stock_movements.change_type` CHECK with `'sale'` and `'reservation'`; ⚠ one-row UPDATE fixing White Dress per D3; **admin code change**: `recordBoutiqueSale` writes a movement row and stops writing `products.stock` directly (or a trigger derives `products.stock` from inventory — preferred under D2).
- **3f. `messaging_integrity.sql`** — `messages.conversation_id SET NOT NULL` + index; `messages.sender_id` index; `UNIQUE (customer_id)` on conversations (both apps assume one thread per customer). 0 message rows, 1 conversation row — no backfill.
- **3g. `reviews_one_per_user.sql`** — `UNIQUE (product_id, user_id)`; index `user_id`. 0 rows.
- **3h. `drop_duplicate_indexes.sql`** — drop `orders_display_id_uidx`, `wishlists_user_product_uidx`. Pure win, rollback recreates.

## Batch 4 — Cross-app feature repairs (each = migration + code in one or both repos) — ~4 h

- **4a. Reactions (D4):** either `messages.reactions jsonb DEFAULT '{}'` + real `merge_message_reaction` function, or delete the dead call in `communicationService.js`. Admin repo PR either way.
- **4b. Unread badge (D5):** extend `sync_conversation_on_message` trigger to increment `unread_count` when sender is staff; mobile marks-read on conversation open (sets 0 + stamps `messages.read_at`, resurrecting the dead column); admin mirrors for its own badge. Migration + both-repo PRs.
- **4c. Category backfill:** UPDATE Brown Dress's `category_id` from its text category; then admin `ProductForm` writes `category_id` always; text `category`/`sub_category` become read-only legacy (dropped in a later cycle).
- **4d. Rental rename (D6):** ⚠ `rental_price` → `reservation_price`, drop `return_date`. Lockstep: migration + regenerate `database.types.ts` + mobile `reservations.tsx` + admin `productService/reservationService` in one coordinated release. Last because it's naming-only.

## Batch 5 — Hygiene sweep (one consolidated migration + settings) — ~3 h

- **5a. Policy consolidation:** per table, one policy per command, wrapping `(select auth.uid())` (fixes the 64 initplan warnings and the 152 multiple-permissive warnings). Mechanical but wide — generate from a live policy dump, review table-by-table against the access matrix in `DB_AUDIT_2026-07-20.md`.
- **5b. FK index batch:** the audit's remaining unindexed FKs (skip `logs`, `staff_status_history`, `products.created_by/updated_by` until row counts justify).
- **5c. Storage:** replace broad SELECT policies on the four public buckets with object-URL-only access (drops listing); keep `payment_receipts` private as-is.
- **5d. `updated_at` triggers:** one `moddatetime` trigger applied to every table carrying the column.
- **5e. Dashboard settings (not SQL):** enable leaked-password protection in Auth settings.
- **5f. Dead-object removal (D7):** ⚠ after archive export: drop `color_options`, `pose_guides`, `suggested_outfits`, `ar_assets`; revoke-then-drop `create_reservations_from_cart`, `rls_auto_enable`.

## Sequencing & verification

```
Batch 0 ──► Batch 1 (security) ──► Batch 2 (ledger) ──► Batch 3 (constraints) ──► Batch 4 (features) ──► Batch 5 (hygiene)
```

- Batch 1 jumps the queue because finding 1 is an open exploit; it can ship before the ledger repair since each file will be committed and ledger-recorded properly as part of Batch 2's end-state check.
- After every batch: re-run both advisors, `supabase db diff` must stay empty, and the relevant app flow gets a smoke test (mobile: reserve + chat; admin: walk-in sale + device login).
- Estimated total: ~14–15 h of focused work across both repos, excluding the PR #4 device-test track.

**Nothing in this plan has been executed.** Per-batch sign-off starts with Batch 0 + 1 whenever you're ready.
