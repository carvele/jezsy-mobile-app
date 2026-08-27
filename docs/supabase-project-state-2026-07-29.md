# Supabase Project State — 2026-07-29

Machine-readable snapshot of the live project's database-side configuration,
pulled via the Supabase MCP connection. Intended as context for AI agents and
for the owner-dashboard collaborator.

**Scope note:** this covers everything stored *in the database* — RLS, policies,
functions, grants, triggers, buckets. It does **not** cover Auth dashboard
toggles (password rules, redirect URLs, provider settings), which live outside
Postgres and require the Management API with a Personal Access Token to read.
See "Auth settings" at the bottom for how to pull those separately.

Plan: **Free tier**.

## Row Level Security

RLS is enabled on all 36 public tables. No exceptions.

## Storage buckets

| Bucket | Public | Notes |
|---|---|---|
| `ar-models` | yes | staff-only writes |
| `avatars` | yes | own-folder or staff |
| `chat-images` | **no** | privatized in `20260722172800`; participant-scoped SELECT |
| `payment_receipts` | **no** | own-folder SELECT/INSERT only |
| `review-images` | yes | own-folder upload; no listing policy (by design) |
| `wardrobe-images` | yes | own-folder writes |

No bucket sets `file_size_limit` or `allowed_mime_types` — both are null
everywhere. Worth considering: an unbounded upload size on six buckets is a
free-tier quota risk.

## Functions — security mode and grants

`has_function_privilege` results, not a reading of GRANT statements.

### SECURITY DEFINER, executable by anon AND authenticated
These are the real external surface. Each is intentional but worth periodic review:

| Function | Notes |
|---|---|
| `check_email_exists(text)` | enumeration vector; revoke staged in `20260727135433`, **not applied** because the shipped client still calls it |
| `create_order(jsonb, jsonb)` | trusted write path, server-side price resolution |
| `is_admin_or_owner()` | authorization helper |
| `is_staff_or_admin()` | authorization helper |
| `sync_product_stock(uuid)` | deliberately left callable; owner-dashboard may call it directly |
| `update_staff_status(...)` | guarded internally |

### SECURITY DEFINER, authenticated only
- `create_reservation(...)` — the trusted customer reservation path
- `update_user_streak()`

### SECURITY DEFINER, no external execute (correct)
`check_profile_updates`, `create_reservations_from_cart`,
`force_conversation_unread_zero`, `handle_new_user`, `log_staff_status_change`,
`notify_order_status_change`, `notify_reservation_status_change`,
`notify_stock_back_in_stock`, `prevent_stock_movement_updates`,
`rls_auto_enable`, `set_review_verified_purchase`,
`sync_conversation_on_message`, `trg_sync_product_stock_from_inventory`

Note `create_reservations_from_cart` shows no anon/authenticated execute, so the
staged-but-unapplied `20260727080200` drop migration is less urgent than it
looked — the grants are already closed even though the function still exists.

### SECURITY INVOKER
- `reschedule_reservation(...)` — authenticated only; INVOKER is correct here
  because it updates a row the caller already owns
- `merge_message_reaction(...)` — authenticated only
- `approve_device`, `touch_updated_at`, `update_product_rating`,
  `validate_reservation_time` — no external execute

### ⚠ Finding: one trigger function still publicly executable
`enforce_message_edit_scope()` — SECURITY INVOKER, but **executable by both
`anon` and `authenticated`** via `/rest/v1/rpc/`. The
`20260728015951_revoke_direct_rpc_on_trigger_functions` migration covered
`notify_order_status_change`, `notify_reservation_status_change`, and
`trg_sync_product_stock_from_inventory` but missed this one. Impact is low (it
raises when called outside a trigger context, and it is INVOKER not DEFINER),
but it is inconsistent with the established posture and should be revoked.

All functions except `rls_auto_enable` (which uses `pg_catalog`) are pinned to
`search_path = public, pg_temp`.

## Triggers

| Table | Trigger | Function |
|---|---|---|
| `inventory` | `trg_notify_stock_back_in_stock` | `notify_stock_back_in_stock` |
| `inventory` | `trg_sync_product_stock_from_inventory` | (same name) |
| `messages` | `trg_enforce_message_edit_scope` | `enforce_message_edit_scope` |
| `messages` | `trg_sync_conversation_on_message` | `sync_conversation_on_message` |
| `orders` | `trg_notify_order_status_change` | `notify_order_status_change` |
| `profiles` | `check_profile_updates_trigger` | `check_profile_updates` |
| `profiles` | `log_staff_status_change_trigger` | `log_staff_status_change` |
| `reservations` | `trg_notify_reservation_status_change` | `notify_reservation_status_change` |
| `reservations` | `trg_validate_reservation_time` | `validate_reservation_time` |
| `reviews` | `trg_set_review_verified_purchase` | `set_review_verified_purchase` |
| `reviews` | `trigger_update_product_rating` | `update_product_rating` |
| `stock_movements` | `stock_movements_prevent_updates_trigger` | `prevent_stock_movement_updates` |
| `devices` | `approve_device_trigger` | `approve_device` |
| 10 tables | `trg_touch_updated_at` | `touch_updated_at` |

**For the owner-dashboard developer:** `trg_notify_stock_back_in_stock` on
`inventory` fires on every UPDATE but returns immediately unless `available`
transitions from 0 to greater than 0. On that transition it writes
`notifications` rows and clears the fulfilled `stock_notify_requests`.

## Known accepted gaps

- **Leaked password protection: OFF, and cannot be enabled** — it is a Pro-plan
  feature. This will appear in every `get_advisors` run indefinitely on Free.
  Not an outstanding task.
- **`check_email_exists` reachable by anon** — closing it requires shipping the
  client change first, otherwise duplicate signup dead-ends at OTP.
- **RLS policy consolidation deferred** — roughly 48 initplan and 17
  multiple-permissive advisor lints, scoped in `DB_IMPLEMENTATION_PLAN.md:111`.
  Needs one reviewed change coordinated with the owner-dashboard repo.
- **Do not act on `unused_index` lints** — artifacts of a small dataset; several
  indexes were added deliberately by `20260720240000_fk_indexes.sql`.

## Auth settings (not covered above)

Dashboard auth toggles are not stored in Postgres and cannot be read through the
MCP connection or `supabase db pull` (that command pulls schema only). To export
them, use the Management API with a **Personal Access Token** — a `service_role`
key will not authenticate against it:

```
GET https://api.supabase.com/v1/projects/{project-ref}/config/auth
Authorization: Bearer <personal-access-token>
```

That returns password minimum length, required character classes, the HIBP
toggle, redirect URLs, provider settings, and rate limits as one JSON object.

Generate the token at Account → Access Tokens. Treat it as a credential: it
grants management access to every project on the account, so keep it out of the
repo and out of chat transcripts.

Known current auth state, from this session:
- Redirect URL `jezsymobileapp://reset-password` — added
- Leaked password protection — off (plan-gated)
- Client-side minimum password length — 8 (signup and reset now agree)
