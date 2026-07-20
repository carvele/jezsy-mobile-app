# Table-by-Table Database Audit — JezSy

Date: 2026-07-20. Companion to `DB_AUDIT_2026-07-20.md` (system-level findings). This document audits each of the 31 `public` tables individually: structure, constraints, indexes, code usage from both apps, and — for populated tables — live data-integrity checks. Read-only audit; nothing was changed.

Row counts at audit time: inventory 78, logs 43, categories 29, stock_movements 23, staff_status_history 21, products 21, profiles 10, color_options 8, color_list 8, devices 6, pattern_list 6, conversations 1, user_measurements 1; all other tables 0 rows.

---

## Commerce core

### `products` (21 rows)
- **Structure:** 42 columns — the widest table, carrying catalog data, denormalized rating (`rating`, `review_count`), stock (`stock`, `stockbaseline`), soft-delete (`deleted` + `deleted_at`), and dual categorization (`category`/`sub_category` text **and** `category_id` FK).
- **Issues:**
  - **Dual categorization drift (live hit):** product "Brown Dress" has `category = 'Cocktail & Party'` but `category_id = NULL`. The text columns and the FK can disagree; nothing keeps them in sync. Only 1 row today, but every code path that filters by one or the other will diverge.
  - **Stock drift — CORRECTED 2026-07-20, this was a false positive:** this section originally claimed `products.stock = 32` vs. `inventory` sum `= 40` as a live drift hit. That compared against the wrong inventory field. admin-dashboard's own `syncProductStock()` defines `products.stock` as `sum(inventory.available)`, not `sum(inventory.total)`; White Dress's single inventory row is `total=40, reserved=8, available=32`, so `products.stock=32` was correct all along. No drift existed. A DB trigger (`sync_product_stock`, added in `20260720180000_stock_reconciliation.sql`) now derives `products.stock`/`status` from inventory the same way, so this can no longer drift regardless of which client mutates inventory -- but there was never a bad value to fix. The dual-stock-source *design* (two tables that must stay in sync) was and is a real structural issue; the specific number was not.
  - `price` is nullable with no `CHECK (price >= 0)`; `create_reservation` compensates at runtime by rejecting `price <= 0`, but the constraint belongs on the column.
  - Naming inconsistency within one table: `stockbaseline`, `dateadded` (no underscores) vs `snake_case` everywhere else — Firestore-era imports.
  - `visibility` and `status` are free text (`'public'`, `'Draft'` observed — note the casing mix even here).
- **Indexes:** good — `products_public_catalog_idx`, `idx_products_category_id` present. Unindexed FKs: `created_by`, `updated_by` (low traffic, ignorable).

### `inventory` (78 rows)
- **Structure:** per-product-per-size stock rows (`product_doc_id`, `size`, `total`, `reserved`, `available`), Firestore-era name `product_doc_id`, soft-delete, demand-scoring columns.
- **Live data checks:** `available = total − reserved` holds for all 78 rows; no negatives; no duplicate `(product_doc_id, size)` pairs; no orphaned rows. Internally consistent today.
- **Issues:**
  - **No UNIQUE constraint on `(product_doc_id, size)`** — the admin app's upsert logic assumes it. Today's zero duplicates is luck, not enforcement.
  - **SKU is product-level, not row-level** (17 SKUs shared across 3–6 size rows each, e.g. `JZ-CD-CAC1` across six sizes of Classic Denim Jacket). This is a deliberate pattern, not corruption — but it means `sku` alone can never identify a row, and there is no `UNIQUE (sku, size)` to prevent two size-rows of the same SKU colliding.
  - No `CHECK (total >= 0 AND reserved >= 0 AND reserved <= total)` — all invariants are client-side.
  - `inventory.product_doc_id` FK is unindexed despite being the table's main lookup key (mobile queries it per product page).
  - The `reserved` column is **written by no code path in either repo** — reservations never touch inventory. Reserved counts can only ever be 0 or hand-edited.

### `reservations` (0 rows)
- **Structure:** wide denormalized row (customer/product names and image copied in), rental-era columns, three staff FKs (`staff_id`, `assigned_staff_id` — unclear division of labor).
- **Issues:**
  - **`display_id` has no UNIQUE constraint** while `orders.display_id` does. The RPC's check-then-insert loop is race-prone; two concurrent reservations can share a customer-facing number.
  - **`rental_price` / `return_date` are vestigial** (business is reservation-only, confirmed 2026-07-20). `return_date` is now left NULL by `create_reservation`; the columns and misleading names remain pending a lockstep rename with the admin app.
  - `status` / `payment_status` free text; DB default `'pending'` vs app-written `'Pending'`/`'Completed'` — the casing trap is armed on this table (system finding 6).
  - `date` and `appointment_time` are both `timestamptz` but the apps treat them as a date and a time-of-day respectively (`_date::date`, `_appointment_time::time` casts in the RPC); types don't match semantics.
  - `customer_id` nullable — **intentional** (admin walk-in sales insert `customer_id NULL`); worth a comment in schema, since it looks like a bug until you know.
  - Unindexed FKs: `product_id`, `staff_id`, `assigned_staff_id`. Has good partial indexes for slots and customer lists (`reservations_slot_active_idx`, `reservations_customer_deleted_created_idx`).
  - RLS: customer INSERT/UPDATE still open → price manipulation (system finding 2, fix drafted).

### `orders` (0 rows) / `order_items` (0 rows)
- **Good:** `orders.display_id` UNIQUE; `total_amount`, `shipping_address` NOT NULL; both tables fully indexed (`orders_customer_created_idx`, `order_items_order_id_idx`, `order_items_product_id_idx`).
- **Issues:**
  - **Duplicate identical unique indexes on `orders.display_id`** (`orders_display_id_key` + `orders_display_id_uidx`) — fallout of the migration-ledger drift; one should be dropped.
  - `orders.status` free text, default `'pending'`, but `create_order` inserts `'paid'` unconditionally with no payment verification.
  - No `updated_at` on either table — status changes leave no timestamp trail.
  - `order_items` has no UNIQUE on `(order_id, product_id, selected_size, selected_color)`; duplicates representable.
  - RLS: customer `FOR ALL` policies allow rewriting `total_amount` / `unit_price` (system finding 2).

---

## Identity & staff

### `profiles` (10 rows)
- **Live check:** roles present: `admin`, `customer`, `staff` — clean casing today.
- **Issues:**
  - **`role` is nullable free text with no CHECK** — the single most load-bearing column in the database (all RLS derives from it), and the admin repo's `fix_rls_role_casing` migration proves miscasing already happened once. `employment_status` on the same table *does* have a CHECK — the pattern exists, just not where it matters most.
  - Mixed concerns: customer fields (address, `fit_preference`, `expo_push_token`) and staff fields (`employment_status`, `is_blocked`) in one table. Workable, but it forces staff-related columns to be exposed to customer-row RLS reasoning.
  - `email` duplicated from `auth.users` with no UNIQUE and no sync trigger beyond initial creation.
- **Good:** FK to `auth.users` with cascade; 20 tables correctly FK into it.

### `devices` (6 rows), `staff_status_history` (21 rows), `logs` (43 rows)
- `devices`: **the `USING (true) WITH CHECK (true)` RLS policy is the worst single finding in the project** (system finding 1). Structurally the table is fine (PK on fingerprint, lockout fields); all 6 rows currently `status='approved'`. `login_history` as an ever-growing jsonb array will bloat; fine at thesis scale.
- `staff_status_history`: well-designed (CHECKed `change_type`, NOT NULL essentials, both FKs to profiles). Unindexed FKs `staff_id`/`changed_by` — add when it grows.
- `logs`: fine as an append-only audit trail; `target_id` is text (can't FK — accepted for polymorphic logs); no retention policy; unindexed `user_id`.

---

## Messaging

### `conversations` (1 row) / `messages` (0 rows)
- **Issues:**
  - **`conversations.unread_count` is written by nothing** in either repo; mobile sums it for the Inbox badge → badge is permanently 0. Known issue awaiting admin-app coordination.
  - **`messages.read_at` is written by nothing** in either repo — dead column, or an unbuilt read-receipts feature.
  - **`messages.conversation_id` and `sender_id` are nullable and unindexed** — the chat's primary access path. A message with NULL conversation_id is unreachable garbage; nothing prevents it.
  - `sender_name` denormalized with no sync — stale after profile rename (minor).
  - Admin's reaction feature calls the nonexistent `merge_message_reaction` RPC, and `messages` has **no reactions column** — the feature has no storage (system finding 8).
  - One `conversations` row exists with `customer_id` FK but no UNIQUE on `customer_id` — if the model is one-conversation-per-customer (both apps' code assumes "find the customer's conversation"), that needs a unique index.
- **Good:** `sync_conversation_on_message` trigger keeps the preview atomic (added PR #5).

---

## Customer features (mobile-only tables)

### `user_measurements` (1 row)
- **Good:** `UNIQUE (user_id)` exists (`user_measurements_user_id_uidx`) — matches the app's upsert; confidence columns present and typed.
- Minor: `height`/`weight` no positive-value CHECKs.

### `wardrobe_items`, `saved_outfits`, `wishlists`, `capsules` + `capsule_items`, `user_streaks`, `reviews`, `notifications`, `feedback`, `ar_sessions` (all 0 rows)
- `wishlists`: **duplicate identical unique indexes** (`wishlists_user_id_product_id_key` + `wishlists_user_product_uidx`) — drop one. Otherwise the best-constrained user table (NOT NULL FKs, composite UNIQUE, both FK indexes).
- `reviews`: rating CHECK 1–5 ✓; `trigger_update_product_rating` maintains `products.rating` ✓; **no UNIQUE `(product_id, user_id)`** — one user can review the same product repeatedly and skew ratings; `user_id` unindexed.
- `saved_outfits.items` / `capsules`: jsonb item lists referencing wardrobe/product ids with no referential integrity (accepted trade-off; deletions leave dangling ids the UI must tolerate).
- `user_streaks`: PK on `user_id` ✓; paired RPC `update_user_streak` is callable by **anon with any target user** (system finding 5).
- `notifications`: fine; indexed by `(user_id, created_at)` ✓. Nothing in either repo *inserts* rows (push tokens are used directly) — the table may be aspirational.
- `feedback`, `ar_sessions`: structurally fine; unindexed FKs; `ar_sessions.duration` unit undocumented.
- `wardrobe_items.color_tags` text[] vs `products.color` scalar — same concept, two shapes (minor).

---

## Catalog reference tables

### `categories` (29 rows)
- **Good:** slug UNIQUE, self-FK for hierarchy, `idx_categories_parent_id` present, no duplicate names per parent (live-checked).
- Products' `category`/`sub_category` text columns bypass this table entirely unless `category_id` is set (see `products` above).

### `color_list` (8) / `pattern_list` (6) / `color_options` (8)
- **`color_options` is a dead table**: referenced by neither repo; `color_list` (admin-maintained) holds the same 8 names. Firestore-migration leftover. Its `hex`/`border` columns are the only place color swatches live, though — verify the admin picker truly doesn't need it before dropping.
- `color_list`/`pattern_list`: fine (name UNIQUE, bigint PKs — the only non-uuid PKs in the schema, harmless).

### `pose_guides` (0 rows), `suggested_outfits` (0 rows), `ar_assets` (0 rows), `settings` (0 rows)
- `pose_guides`: text PK, 0 rows, referenced by **neither repo** → dead table.
- `suggested_outfits`: 0 rows, no code references found in either repo → dead or unbuilt.
- `ar_assets`: duplicates `products.model_3d_url`'s job; mobile reads `products.model_3d_url`, nothing reads `ar_assets` → redundant path, pick one.
- `settings`: k/v jsonb, admin-only, fine.

### `stock_movements` (23 rows)
- **Good:** immutability enforced twice (CHECK `updated_at = created_at` + `prevent_stock_movement_updates` trigger) — the best-hardened table in the schema; fully indexed.
- **Issue:** `change_type` CHECK allowed only `manual_adjustment | restock | correction` — sales and reservations could not be recorded, so the movement ledger could never fully explain stock changes (walk-in sales change stock with no movement row). `20260720180000_stock_reconciliation.sql` extended the CHECK to permit `sale`/`reservation`; actually emitting those rows from the sale/reservation code paths is still open (DB_IMPLEMENTATION_PLAN.md Batch 4).

---

## Cross-cutting table-design patterns

1. **Soft-delete inconsistency:** `deleted` boolean on 8 tables; only `products`/`inventory` also have `deleted_at`; `profiles.deleted` exists but mobile never filters on it when reading its own profile. Pick one pattern.
2. **`updated_at` exists on ~half the tables and is maintained by zero triggers** — every value is client-supplied or default-frozen. Either add a standard `moddatetime` trigger or stop pretending the column is reliable.
3. **Free-text enums everywhere:** `status` ×4 tables, `visibility`, `payment_status`, `payment_type`, `measurement_source`, `stock_tier`, `role`. Only 4 CHECK constraints exist in the whole schema (`profiles.employment_status`, `reviews.rating`, `staff_status_history.change_type`, `stock_movements.change_type`) — the newest tables got them, the load-bearing ones didn't.
4. **Denormalized copies without sync:** `customer_name`/`product_name`/`image_url` on reservations, `sender_name` on messages, `user_name` on feedback/logs, `email` on profiles, `rating`/`review_count` on products (this one *is* trigger-synced — the model to copy).
5. **Nullable-FK-by-default:** almost every FK column is nullable; only `wishlists`, `user_measurements`, `capsule_items`, `user_streaks`, `staff_status_history`, `stock_movements`, `orders`, `order_items` mark them NOT NULL. Several nullables are load-bearing (walk-in `customer_id`), most are accidents.

## Priority order (table-level fixes only)

1. `reservations.display_id` UNIQUE (race window, financial document)
2. `profiles.role` CHECK + NOT NULL DEFAULT (RLS foundation)
3. Status-value CHECK constraints + one-time casing normalization on `reservations`/`orders` (needs both-app coordination on canonical casing)
4. `inventory` UNIQUE `(product_doc_id, size)` + non-negative CHECKs; done 2026-07-20. Stock-source-of-truth resolved via a DB trigger deriving `products.stock` from `inventory` (see correction note above -- "White Dress 32 vs 40" was a false positive, not a real drift).
5. `messages.conversation_id` NOT NULL + index; `conversations.customer_id` unique index if one-thread-per-customer is the model
6. `reviews` UNIQUE `(product_id, user_id)`
7. Drop duplicate indexes (`orders`, `wishlists`)
8. Products: backfill `category_id` (1 row), then deprecate text `category`/`sub_category`
9. Drop/archive dead tables after confirmation: `color_options`, `pose_guides`, `suggested_outfits`, `ar_assets` (and dead columns `messages.read_at`, `conversations.unread_count` — or build the features)
10. FK indexes batch (messages, conversations, inventory, reservations, reviews first)

All of the above are Phase-2 candidates: additive migrations with rollbacks, no live execution without sign-off.
