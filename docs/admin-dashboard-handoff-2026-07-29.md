# Shared-DB Handoff → owner-dashboard — 2026-07-29

**Audience:** the developer (or agent) working on `carvele/owner-dashboard`.

**Why you're reading this:** the mobile app applied six migrations to the
**shared live Supabase database** on 2026-07-29. There is no staging
environment, so these are already in effect for your app too. Two of them add
triggers to tables the owner dashboard writes to. Nothing here requires an
immediate change on your side, but three items create work or surprises you
should know about before you debug something confusing.

Read the "Action required" section first; the rest is reference.

---

## Action required

### 1. `announcements` has no compose UI — that's your side

The mobile app can now **read and dismiss** broadcast announcements in its
Inbox → Notifications tab. Nothing anywhere **writes** them. The feature is
inert until a compose surface exists, and that was deliberately left to the
owner dashboard.

To create one, insert directly — no RPC needed:

```sql
INSERT INTO public.announcements (title, body, type, expires_at, created_by)
VALUES ('Holiday Hours', 'We close at 6pm on Dec 24.', 'promo', '2026-12-26', auth.uid());
```

- RLS gates writes on `is_staff_or_admin()`, so an authenticated staff session
  passes; no service-role key required.
- `type` must be `'promo'` or `'system'` (CHECK constraint).
- `expires_at` is nullable — `NULL` means it never expires.
- **Do not** fan out one row per user. One row = one announcement. Visibility
  is computed at read time as "not expired AND not in
  `announcement_dismissals` for this user", which is why a brand-new account
  automatically sees every still-active announcement with no backfill job.

### 2. A trigger now fires on `public.inventory` — this affects restocks

`trg_notify_stock_back_in_stock` (SECURITY DEFINER) fires `AFTER UPDATE` on
every `inventory` row. It returns immediately **unless** `available` goes from
`0` to `> 0`. On that transition it:

1. inserts a `notifications` row for every user watching that
   `(product_id, size)` in the new `stock_notify_requests` table, then
2. deletes those fulfilled requests.

**What this means for you:** restocking a sold-out size through the dashboard
will now generate customer notifications as a side effect. That is intended.
If you see unexplained `notifications` rows appear right after an inventory
edit, this is why — it is not a bug.

### 3. `verify_pickup(uuid)` is live and waiting for a scanner UI

Staff-side handoff confirmation. The mobile app renders a customer's
`reservations.pickup_token` as a QR code encoding `jezsy-pickup:<uuid>`.
`verify_pickup` takes that token, validates it, and flips the reservation to
`Completed`.

```
SELECT public.verify_pickup('<uuid-from-qr>');
```

- SECURITY DEFINER, internally gated on `is_staff_or_admin()`; granted to
  `authenticated` only.
- Raises on: non-staff caller, unknown token, already-completed reservation,
  or a reservation not currently `confirmed`.
- Returns the updated reservation row as `jsonb`.

**Nothing calls this in production yet.** The scanning UI does not exist on
either side. The migration was applied ahead of that UI; if you'd rather it
not exist until you're ready, the rollback is
`supabase/migrations/20260729054158_verify_pickup_rpc.rollback.sql`.

---

## Full list of migrations applied 2026-07-29

| Ledger version | Name | Effect |
|---|---|---|
| `20260729013246` | `announcements` | new `announcements` + `announcement_dismissals` tables |
| `20260729014307` | `review_images_bucket` | new public `review-images` storage bucket |
| `20260729014535` | `review_images_no_listing` | drops that bucket's broad SELECT policy |
| `20260729023327` | `stock_notify_requests` | new table + `AFTER UPDATE` trigger on `inventory` |
| `20260729024656` | `reviews_verified_purchase` | new `reviews.verified_purchase` column + `BEFORE INSERT` trigger |
| `20260729054158` | `verify_pickup_rpc` | new `verify_pickup(uuid)` function |

Every one has a matching `.rollback.sql` in `supabase/migrations/`.

### Notes on the less obvious ones

**`review_images_no_listing`** — the advisor flagged
`public_bucket_allows_listing` on the new bucket, the same finding already
fixed for four other buckets in `20260720260000_storage_no_listing.sql`. Public
buckets serve reads via `getPublicUrl()`, which bypasses RLS entirely, so the
broad SELECT policy was only ever enabling `storage.list()`/`.download()`.
Neither app calls those.

**`reviews.verified_purchase`** — a stored boolean, not a client-side join, and
that distinction matters. `orders` and `reservations` are RLS-scoped to their
own customer, so any client-side check could only ever verify the current
user's own review and would silently mark everyone else's as unverified. A
`BEFORE INSERT` SECURITY DEFINER trigger resolves it once and stores it on the
review row, which all readers can already see. Existing rows were backfilled.

---

## One open finding for whoever gets there first

`public.enforce_message_edit_scope()` is **executable by `anon` and
`authenticated`** via `/rest/v1/rpc/`. It's a trigger function that
`20260728015951_revoke_direct_rpc_on_trigger_functions.sql` missed — that
migration covered `notify_order_status_change`,
`notify_reservation_status_change`, and
`trg_sync_product_stock_from_inventory`.

Impact is low: it's SECURITY **INVOKER**, and it raises when called outside a
trigger context. But it's inconsistent with the project's posture and should be
revoked. Not done yet because it's a shared-DB change and this handoff was
already overdue.

When revoking it, note the trap documented in `CLAUDE.md`: `REVOKE ... FROM
anon` alone is a **no-op**, because `EXECUTE` is granted to `PUBLIC` by
default and both roles inherit it. Revoke from `PUBLIC` explicitly and verify
with `has_function_privilege`, not by reading the grant.

---

## Standing context

- **No staging environment.** Migrations apply straight to the shared live DB.
  Write idempotent SQL (`IF NOT EXISTS`, `CREATE OR REPLACE`) so a re-apply is
  never destructive.
- **`apply_migration` drifts ledger versions.** The version recorded live
  rarely matches the local filename you wrote. Re-sync filenames to the ledger
  after every apply, or a fresh clone won't reproduce the schema.
- **Trusted customer write paths must be SECURITY DEFINER**, not INVOKER. An
  INVOKER RPC whose target table has an owner-only INSERT policy fails closed
  for customers, silently. `create_reservation` shipped that way and blocked
  every customer reservation until it was fixed on 2026-07-27.
- A full database-side configuration snapshot (all policies, functions, grants,
  triggers, buckets, RLS status) is in
  `docs/supabase-project-state-2026-07-29.md`.
