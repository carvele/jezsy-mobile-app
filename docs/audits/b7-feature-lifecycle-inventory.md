# Phase B7-a: Feature Lifecycle, Zombie Architecture, and Documentation Hygiene Inventory

**Status:** 🟢 AUDIT BASELINE (READ-ONLY) — RECONCILED FOR B7-b FREEZE  
**Date:** 2026-09-12  
**Repositories:** `jezsy-mobile-app` (Head: `3667713`), `admin-dashboard` (Head: `2db84b8` + working branch `fix/ar-color-gate-behind-manage-inventory`)  
**Shared Database:** Supabase `wufcmtndotfvxvvxkamv` (Ledger version: `20260912000001`)  
**Lifecycle Standard:** STRAT-006 / Dual-Repo Architecture Lifecycle  

---

## 1. Executive Summary & Inventory Baseline

Phase **B7-a** establishes an evidence-based, read-only baseline of executable code, architectural contracts, user routes, services, database procedures, and documentation across the JezSy ecosystem. In accordance with the governing mandate:
1. **Strictly Read-Only:** Zero source modifications, zero database alterations, zero schema mutations, and zero documentation rewrites were performed during this audit phase.
2. **Exhaustive Dependency Tracing:** The presence of "zero client callers" was **not** assumed to imply dead architecture. Every entity was evaluated across:
   - Client applications (Mobile Expo Router screens, Admin React pages)
   - Function-to-function database call graphs
   - Table triggers, constraints, and Row Level Security (RLS) helper functions
   - Supabase Edge Functions (`payments-create`, `payments-webhook`, `process-account-deletion`)
   - `pg_cron` scheduled maintenance jobs
   - Supabase Database Webhooks and Realtime publications
   - Administrative and operational diagnostic workflows

### 1.1 Classification Standard

Every evaluated artifact is classified under one of the six frozen STRAT-006 categories:
- **`ACTIVE`**: Proven reachable and intentionally used in current production workflows.
- **`INTERNAL`**: Used exclusively by backend primitives (another RPC, trigger, RLS policy, Edge Function, cron job, or webhook).
- **`DORMANT / HALF-SHIPPED`**: Valid architectural foundations exist (database schemas, RPCs, state models), but the intended client user interface or pipeline is incomplete, bypassed, or disconnected.
- **`ZOMBIE`**: Executable code, styling, or database routines with zero substantiated runtime, internal, operational, migration, or supported feature dependencies.
- **`HISTORICAL`**: Deprecated or superseded code retained intentionally as audit, legal, or schema ledger evidence (not executable in active paths).
- **`UNVERIFIED`**: Suspected dormant or zombie, but dependency tracing remains inconclusive.

### 1.2 Recommended Dispositions

- **`PRUNE`**: Safely remove from source code or drop from the live database via standard migration.
- **`WIRE`**: Complete the user-facing integration to activate the dormant capability.
- **`STANDARDIZE`**: Refactor client code to route through the canonical database RPC or type system, eliminating client-side bypasses or contract mismatches.
- **`RETAIN`**: Keep in current state without alteration; architectural need is substantiated or already resolved.
- **`INVESTIGATE`**: Product/stakeholder decision required to determine feature roadmap priority.

---

### 1.3 Quantitative Inventory Reconciliation

The inventory reconciles across two distinct dimensions: the **Public Database Catalog** (127 procedures) and the **Detailed Finding Ledger** (33 audited artifacts).

#### A. Public Database Catalog Breakdown (127 Procedures)

| Procedure Category | Total | ACTIVE | INTERNAL | DORMANT / BYPASSED | ZOMBIE | Dispositions |
|---|---|---|---|---|---|---|
| **Trigger & Event Procedures** | 43 | 0 | 43 | 0 | 0 | 43 Retain (Active table triggers) |
| **Callable RPCs & Predicates** | 84 | 53 | 19 | 6 | 6 | 72 Retain, 6 Prune, 3 Wire, 3 Investigate |
| **Total Database Procedures** | **127** | **53** | **62** | **6** | **6** | **115 Retain, 6 Prune, 3 Wire, 3 Investigate** |

*Note on Database Classification:*
- **43 Trigger Procedures:** Attached to database tables (e.g. `trg_cascade_soft_delete_inventory`, `on_auth_user_created`, `handle_new_connection`). All 43 are `INTERNAL` and retained.
- **53 Active Callable RPCs:** Directly invoked by Mobile/Admin UI, services, or B6 security verification test harness (includes `get_pose_guides_for_product`).
- **19 Internal Infrastructure RPCs:** 15 RLS security predicates (`is_admin_or_owner`, `can_manage_inventory`, `is_blocked_between`, etc.), 1 proc helper (`reservation_holds_stock`), 1 cron procedure (`send_payment_deadline_reminders`), and 2 Edge Function primitives (`check_rate_limit`, `settle_payment_webhook`).
- **6 Dormant / Bypassed RPCs:** `get_slot_booked_counts` (Active correctness defect), `get_suggested_connections`, `admin_manage_device`, `admin_prune_devices`, `reschedule_reservation`, `search_catalog_fuzzy`.
- **6 Zombie RPCs:** `auto_cancel_expired_reservations`, `expire_unpaid_reservations`, `update_staff_role`, `complete_reservation_pickup`, `verify_pickup`, `check_email_exists`.

#### B. Detailed Finding Ledger Breakdown (33 Findings)

| Subsystem | Total Findings | ACTIVE | INTERNAL | DORMANT / HALF-SHIPPED | ZOMBIE | HISTORICAL | Dispositions |
|---|---|---|---|---|---|---|---|
| **Database Procedures (`B7-RPC-001..014`)** | 14 | 1 | 2 | 6 | 5 | 0 | 3 Retain, 5 Prune, 3 Wire, 3 Investigate |
| **Mobile Application (`B7-MOB-001..008`)** | 8 | 3 | 0 | 4 | 1 (8 files) | 0 | 3 Retain, 1 Prune cluster, 3 Wire, 1 Standardize |
| **Admin Dashboard (`B7-ADM-001..008`)** | 8 | 0 | 0 | 1 | 6 | 1 | 4 Prune, 1 Wire, 2 Standardize, 1 Retain (Resolved in B6) |
| **Documentation & Hygiene (`B7-DOC-001..003`)** | 3 | 0 | 0 | 3 | 0 | 0 | 3 Standardize |
| **Total Findings in Ledger** | **33** | **4** | **2** | **14** | **12** | **1** | **7 Retain, 11 Prune, 7 Wire, 5 Standardize, 3 Investigate** |

*(Note: Finding `B7-RPC-007` consolidates both `complete_reservation_pickup` and `verify_pickup`, bringing the 5 zombie RPC findings to 6 physical procedures.)*

---

## 2. Subsystem 1: Database Catalog & Public Functions

---

### [B7-RPC-001] Edge Function Rate Limiting Primitive
- **Repo / Subsystem:** Shared Database / Supabase Edge Functions
- **Artifact:** `public.check_rate_limit(p_key text, p_max_requests integer, p_window_seconds integer)`
- **Current Purpose:** Fixed-window rate limiting counter backed by `public.rate_limits` table with 1% probabilistic vacuum.
- **Entrypoints / Callers:** 
  - `supabase/functions/payments-create/index.ts:25`
  - `supabase/functions/process-account-deletion/index.ts:31`
- **Downstream Dependencies:** `public.rate_limits` table.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** Covered by Edge Function invocation test suites.
- **Documentation References:** `docs/backend-security-audit-2026-07-23.md`.
- **Classification:** `INTERNAL`
- **Evidence:** Function body in live database; direct RPC calls from Edge Function TypeScript sources. Zero direct mobile/admin client callers by design.
- **Impact:** Critical abuse prevention for payment creation and account deletion webhooks.
- **Recommended Disposition:** `RETAIN`
- **Recommended B7 Phase:** B7-e (No action needed).

---

### [B7-RPC-002] Atomic Payment Webhook Settlement Pipeline
- **Repo / Subsystem:** Shared Database / Supabase Edge Functions
- **Artifact:** `public.settle_payment_webhook(_event_id text, _payment_id uuid, _next_status text, _method text, _provider_payment_id text, _event jsonb)`
- **Current Purpose:** Idempotent transactional settlement for PayMongo webhook events (`payment.paid`, `payment.failed`), updating reservation status, ledger balances, and sending in-app/admin notifications.
- **Entrypoints / Callers:** `supabase/functions/payments-webhook/index.ts:74`
- **Downstream Dependencies:** `public.payments`, `public.reservations`, `public.processed_payment_webhook_events`, `public.notifications`, `public.admin_notifications`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** Payment test harness scripts.
- **Documentation References:** `docs/paymongo-setup.md`, `docs/audits/security-performance-hardening-closure-ledger.md`.
- **Classification:** `INTERNAL`
- **Evidence:** Function body in live database lines 1-118; invoked by webhook serverless runner.
- **Impact:** Core revenue and reservation state transition engine.
- **Recommended Disposition:** `RETAIN`
- **Recommended B7 Phase:** B7-e (No action needed).

---

### [B7-RPC-003] Product Pose Guide Association RPC
- **Repo / Subsystem:** Shared Database / Mobile UI
- **Artifact:** `public.get_pose_guides_for_product(p_product_id uuid)`
- **Current Purpose:** Returns active, non-deleted pose guides linked to a specific clothing product for display in the product detail screen.
- **Entrypoints / Callers:** `components/StyledLooksSection.tsx:49` in `jezsy-mobile-app`.
- **Downstream Dependencies:** `public.pose_guides`, `public.pose_guide_products`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** Mobile component rendering.
- **Documentation References:** `supabase/migrations/20260910130000_pose_guides_domain_and_reverse_lookup.sql`.
- **Classification:** `ACTIVE`
- **Evidence:** Direct call in `StyledLooksSection.tsx:49` rendered inside `app/product/[id].tsx:391`.
- **Impact:** Delivers curated styling suggestions on product pages.
- **Recommended Disposition:** `RETAIN`
- **Recommended B7 Phase:** None (Active).

---

### [B7-RPC-004] Redundant Auto-Cancel Expired Reservations Wrapper
- **Repo / Subsystem:** Shared Database / Cron Maintenance
- **Artifact:** `public.auto_cancel_expired_reservations()`
- **Current Purpose:** One-line wrapper executing `SELECT public.expire_all_stale_reservations();`.
- **Entrypoints / Callers:** None. Former `cron.job` was retired in migration `20260910183200`. Active `cron.job` #4 directly runs `SELECT public.expire_all_stale_reservations();`.
- **Downstream Dependencies:** `public.expire_all_stale_reservations()`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `supabase/migrations/20260910183200_retire_dead_reservation_alert_cron_jobs.sql`.
- **Classification:** `ZOMBIE`
- **Evidence:** pg_proc definition: `SELECT public.expire_all_stale_reservations();`. Zero callers across mobile, admin, edge functions, triggers, and cron.
- **Impact:** Redundant wrapper left behind after cron consolidation.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-e (Drop via migration).

---

### [B7-RPC-005] Redundant Expire Unpaid Reservations Wrapper
- **Repo / Subsystem:** Shared Database / Cron Maintenance
- **Artifact:** `public.expire_unpaid_reservations()`
- **Current Purpose:** One-line wrapper executing `SELECT public.expire_all_stale_reservations();`.
- **Entrypoints / Callers:** None. Zero callers across all repositories, edge functions, and database jobs.
- **Downstream Dependencies:** `public.expire_all_stale_reservations()`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `docs/activity-log.md`.
- **Classification:** `ZOMBIE`
- **Evidence:** pg_proc definition: `SELECT public.expire_all_stale_reservations();`.
- **Impact:** Redundant schema artifact.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-e (Drop via migration).

---

### [B7-RPC-006] Redundant Staff Role Updater Forwarding Wrapper
- **Repo / Subsystem:** Shared Database / RBAC
- **Artifact:** `public.update_staff_role(target_user_id uuid, new_role text)`
- **Current Purpose:** Single-statement forwarding wrapper executing `PERFORM public.update_staff_role_v2(target_user_id, new_role);`.
- **Entrypoints / Callers:** None. Admin Dashboard `src/services/adminService.js:189` and `src/services/staffService.js:201` call `update_staff_role_v2` directly.
- **Downstream Dependencies:** `public.update_staff_role_v2`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY INVOKER` (`prosecdef: false`), search_path `public`.
- **Tests:** None.
- **Documentation References:** `docs/audits/profile-writer-inventory.md`.
- **Classification:** `ZOMBIE`
- **Evidence:** pg_proc definition: `BEGIN PERFORM public.update_staff_role_v2(target_user_id, new_role); END;`. Security mode is `SECURITY INVOKER`. Delegates directly to `update_staff_role_v2`, which enforces `can_manage_staff()` authorization and full invariants.
- **Impact:** Redundant compatibility alias and unnecessary public contract surface. Does not bypass RBAC, but adds no value over `update_staff_role_v2`.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-e (Drop via migration).

---

### [B7-RPC-007] Superseded Legacy Pickup Verification RPCs
- **Repo / Subsystem:** Shared Database / Reservation Lifecycle
- **Artifact:** `public.complete_reservation_pickup(_reservation_id uuid, _pickup_token uuid, _method text)` and `public.verify_pickup(_pickup_token uuid)`
- **Current Purpose:** Legacy handover RPCs requiring a UUID `_pickup_token`.
- **Entrypoints / Callers:** `verify_pickup` calls `complete_reservation_pickup`. Zero client callers in Mobile or Admin. Admin handover in `Reservations.jsx:1085` and `reservationService.js:401` uses `complete_reservation_handover(_reservation_id, _method)`.
- **Downstream Dependencies:** `public.reservations`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `docs/admin-dashboard-handoff-2026-07-29.md`.
- **Classification:** `ZOMBIE`
- **Evidence:** Both functions exist in pg_proc. Neither is invoked anywhere in Mobile, Admin, or Edge Functions. Superseded by `complete_reservation_handover`.
- **Impact:** Dead RPC contracts left behind by the migration to `complete_reservation_handover`.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-e (Drop via migration).

---

### [B7-RPC-008] Unused Single-Step Reschedule RPC
- **Repo / Subsystem:** Shared Database / Reservation Lifecycle
- **Artifact:** `public.reschedule_reservation(_reservation_id uuid, _date text, _appointment_time text)`
- **Current Purpose:** Atomically updates reservation date and appointment time directly.
- **Entrypoints / Callers:** None. Mobile utilizes the two-phase reschedule architecture: customer calls `request_reschedule` (`reservationService.ts:167`), and boutique staff/manager resolves via `resolve_reschedule_as_manager` (`reservationService.js:380`).
- **Downstream Dependencies:** `public.reservations`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `supabase/migrations/20260724094922_reschedule_reservation_rpc.sql`.
- **Classification:** `DORMANT`
- **Evidence:** Valid function body enforcing ownership and status checks, but bypassed by the two-phase manager-approval workflow.
- **Impact:** If invoked, it would circumvent staff review and create scheduling conflicts.
- **Recommended Disposition:** `INVESTIGATE` / `PRUNE`
- **Recommended B7 Phase:** B7-e (Drop or officially deprecate).

---

### [B7-RPC-009] Bypassed Slot Booking Aggregation RPC (Active Correctness Defect)
- **Repo / Subsystem:** Shared Database / Mobile UI
- **Artifact:** `public.get_slot_booked_counts(_date date)`
- **Current Purpose:** Aggregates and returns booking counts grouped by slot time for a specific calendar date.
- **Entrypoints / Callers:** None. Mobile component `components/TimeSlotPicker.tsx:78-100` executes a raw PostgREST query on `reservations` and performs manual JavaScript grouping in memory.
- **Downstream Dependencies:** `public.reservations`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `supabase/migrations/20260806093510_slot_booking_counts.sql`.
- **Classification:** `DORMANT / BYPASSED (ACTIVE CORRECTNESS DEFECT — HIGH PRIORITY)`
- **Evidence:** 
  - Live reservation SELECT RLS (`Enable select for own reservations or owner`) restricts customer queries strictly to `customer_id = auth.uid()`.
  - Normal customers running the client-side query in `TimeSlotPicker.tsx` cannot see reservations booked by other customers.
  - Slots appear 100% available even when fully booked by other users.
  - `get_slot_booked_counts(_date)` is `SECURITY DEFINER`, returning aggregated booking counts per slot without exposing customer data or violating RLS.
- **Impact:** **Active user-facing bug.** Customers can select already-booked time slots, resulting in booking collisions or unexpected checkout failures.
- **Recommended Disposition:** `WIRE` / `STANDARDIZE` (High Priority)
- **Recommended B7 Phase:** B7-c (Refactor `TimeSlotPicker.tsx` to invoke `get_slot_booked_counts`).

---

### [B7-RPC-010] Half-Shipped Friend-of-Friend Recommendation Engine
- **Repo / Subsystem:** Shared Database / Mobile Social Layer
- **Artifact:** `public.get_suggested_connections()`
- **Current Purpose:** Advanced social recommendation algorithm: computes friends-of-friends mutual connection counts, respects block lists, filters pending requests, and falls back to recently active profiles.
- **Entrypoints / Callers:** None. Mobile screen `app/network.tsx` features tabs for "Connections", "Requests", and "Discover", but the Discover tab only executes raw substring queries against `profiles`.
- **Downstream Dependencies:** `public.connections`, `public.profiles`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `docs/audits/mobile-social-layer-user-discovery-audit.md`, `supabase/migrations/20260905133326_social_privacy_and_suggestions.sql`.
- **Classification:** `DORMANT / HALF-SHIPPED`
- **Evidence:** High-quality, 65-line SQL implementation with CTEs for mutuals and active user fallbacks. Unwired in `app/network.tsx`.
- **Impact:** Key social discovery feature is built and tested in Postgres but invisible to users.
- **Recommended Disposition:** `WIRE`
- **Recommended B7 Phase:** B7-c (Wire Mobile's `app/network.tsx` Discover tab to display suggested connections when search input is empty).

---

### [B7-RPC-011] Half-Shipped Community Outfit Association RPC
- **Repo / Subsystem:** Shared Database / Mobile Social Layer
- **Artifact:** `public.get_public_outfits_for_product(p_product_id uuid)`
- **Current Purpose:** Retrieves public community outfit posts that include a given product.
- **Entrypoints / Callers:** None. Mobile product detail screen `app/product/[id].tsx` integrated stylist pose guides via `get_pose_guides_for_product` instead.
- **Downstream Dependencies:** `public.outfits`, `public.outfit_items`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `supabase/migrations/20260905140200_social_outfits_and_looks.sql`.
- **Classification:** `DORMANT`
- **Evidence:** Schema exists in database; UI currently renders `StyledLooksSection.tsx` (pose guides) instead of community looks.
- **Impact:** Community look discovery on product pages remains dormant.
- **Recommended Disposition:** `INVESTIGATE` / `RETAIN`
- **Recommended B7 Phase:** B7-c (Evaluate if product page should show community looks alongside pose guides).

---

### [B7-RPC-012] Superseded Fuzzy Trigram Catalog Search RPC
- **Repo / Subsystem:** Shared Database / Catalog Search
- **Artifact:** `public.search_catalog_fuzzy(search_term text, p_limit integer)`
- **Current Purpose:** Trigram similarity search over products and categories using `pg_trgm`.
- **Entrypoints / Callers:** None. Mobile catalog search in `app/(tabs)/search.tsx` and `catalogService.ts:31` uses `search_catalog` (which supports facets, category IDs, price ranges, and sort filters).
- **Downstream Dependencies:** `public.products`, `public.categories`, `extensions.pg_trgm`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `supabase/migrations/20260902232720_add_trigram_search.sql`.
- **Classification:** `DORMANT`
- **Evidence:** Superseded by faceted `search_catalog`.
- **Impact:** Redundant search implementation.
- **Recommended Disposition:** `INVESTIGATE` / `PRUNE`
- **Recommended B7 Phase:** B7-e (Drop or mark deprecated).

---

### [B7-RPC-013] Orphaned Pre-Signup Email Check RPC
- **Repo / Subsystem:** Shared Database / Authentication
- **Artifact:** `public.check_email_exists(lookup_email text)`
- **Current Purpose:** Queries `auth.users` to check if an email is already registered.
- **Entrypoints / Callers:** None. Execute permission was revoked from `anon` in `20260720151000` to mitigate user enumeration. Supabase Auth handles email collisions natively on signup.
- **Downstream Dependencies:** `auth.users`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `docs/DB_AUDIT_2026-07-20.md`, `docs/backend-security-audit-2026-07-23.md`.
- **Classification:** `ZOMBIE`
- **Evidence:** Zero callers in Mobile, Admin, or Edge Functions.
- **Impact:** Unnecessary `SECURITY DEFINER` function touching `auth.users`.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-e (Drop via migration).

---

### [B7-RPC-014] Bypassed Audited Device Management RPCs
- **Repo / Subsystem:** Shared Database / Admin Dashboard
- **Artifact:** `public.admin_manage_device(_fingerprint text, _action text, _value text)` and `public.admin_prune_devices(_cutoff timestamptz)`
- **Current Purpose:** Transactional mutation of registered staff/admin devices with mandatory audit logging to `public.logs`.
- **Entrypoints / Callers:** None. Admin Dashboard `src/services/deviceService.js:37-65` performs direct table DML (`.update({ status })`, `.delete()`), bypassing the RPC.
- **Downstream Dependencies:** `public.devices`, `public.logs`, `public.is_admin_or_owner()`.
- **Live DB Dependency:** Live Supabase `wufcmtndotfvxvvxkamv`, `SECURITY DEFINER`, search_path `public`.
- **Tests:** None.
- **Documentation References:** `docs/audits/security-performance-hardening-closure-ledger.md`.
- **Classification:** `DORMANT / BYPASSED`
- **Evidence:** Functions exist in database with full audit logging; Admin's `deviceService.js` directly mutates `devices` table without creating `public.logs` records.
- **Impact:** Device approval, revocation, and deletion bypass security audit logs.
- **Recommended Disposition:** `WIRE` / `STANDARDIZE`
- **Recommended B7 Phase:** B7-d (Refactor Admin `deviceService.js` to call `admin_manage_device` and `admin_prune_devices`).

---

## 3. Subsystem 2: Mobile Application Features & Routes

---

### [B7-MOB-001] Boilerplate Expo Starter Template Screen Cluster
- **Repo / Subsystem:** `jezsy-mobile-app` / Navigation & Components
- **Artifact:** 
  - `app/modal.tsx` (Route screen)
  - `app/_layout.tsx:376` (Stack route registration)
  - `components/themed-text.tsx`
  - `components/themed-view.tsx`
  - `components/hello-wave.tsx`
  - `components/external-link.tsx`
  - `components/parallax-scroll-view.tsx`
  - `components/ui/collapsible.tsx`
- **Current Purpose:** Unused sample screens and components generated by `create-expo-app`.
- **Entrypoints / Callers:** Zero client links or navigation targets. Only `app/modal.tsx` uses `ThemedText`/`ThemedView`.
- **Downstream Dependencies:** None.
- **Live DB Dependency:** None.
- **Tests:** None.
- **Documentation References:** None.
- **Classification:** `ZOMBIE`
- **Evidence:** `app/modal.tsx` renders `<ThemedText type="title">This is a modal</ThemedText>`. No `<Link href="/modal">` or `router.push('/modal')` exists in the entire codebase. Theming components are unused by all production screens.
- **Impact:** Clutters bundle, navigation stack, and component tree with 8 dead files.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-c (Delete unused starter files and unregister route in `_layout.tsx`).

---

### [B7-MOB-002] Dormant Username Editing in Profile Screen
- **Repo / Subsystem:** `jezsy-mobile-app` / Profile Management
- **Artifact:** `app/profile/edit.tsx`
- **Current Purpose:** Profile edit screen allowing customers to update profile fields.
- **Entrypoints / Callers:** Profile screen navigation (`/profile/edit`).
- **Downstream Dependencies:** `public.profiles` table (`username` column).
- **Live DB Dependency:** Unique constraint on `profiles.username`.
- **Tests:** TypeScript compilation.
- **Documentation References:** `docs/audits/mobile-social-layer-user-discovery-audit.md` (SOC-005).
- **Classification:** `DORMANT / HALF-SHIPPED`
- **Evidence:** In `app/profile/edit.tsx`:
  - Line 49: State initialized: `username: ''`
  - Line 72: Populated from profile: `username: profile.username || ''`
  - Lines 134, 150: Update payload and uniqueness check: `username: data.username.trim() || null`
  - **Lines 180-335 (JSX):** No `TextInput` for `username` is rendered anywhere in the form. The form proceeds directly from Name to Personal Info.
- **Impact:** Users who set their username during onboarding (`app/(auth)/profile-setup.tsx`) can never view or modify it later.
- **Recommended Disposition:** `WIRE`
- **Recommended B7 Phase:** B7-c (Add Username `<TextInput>` with validation into `app/profile/edit.tsx`).

---

### [B7-MOB-003] Contract Mismatch in User Profile Wardrobe Display
- **Repo / Subsystem:** `jezsy-mobile-app` / Social Profile
- **Artifact:** `app/user/[id].tsx`
- **Current Purpose:** Displays a target user's public profile, connection status, and wardrobe.
- **Entrypoints / Callers:** Route `/user/[id]`, navigated from social discovery, comments, and Loved By sections.
- **Downstream Dependencies:** `public.wishlists` (actual query) vs `public.wardrobe_items` (intended domain).
- **Live DB Dependency:** `public.profiles.wardrobe_privacy`, `public.wishlists` RLS policies.
- **Tests:** TypeScript compilation.
- **Documentation References:** `docs/audits/mobile-social-layer-user-discovery-audit.md` (SOC-004).
- **Classification:** `DORMANT / CONTRACT MISMATCH`
- **Evidence:** `app/user/[id].tsx:42-48` labels the UI "Wardrobe", gates client visibility using `profile.wardrobe_privacy`, but executes a query against `public.wishlists`:
  ```typescript
  const { data, error } = await supabase
    .from('wishlists')
    .select('*, product:products(*)')
    .eq('user_id', targetId);
  ```
  Live database RLS on `wishlists` independently enforces `wishlist_privacy` (`private/public/connections`), preventing actual unauthorized data leakage. However, client gating is mismatched against wardrobe privacy.
- **Impact:** Domain/UI confusion. Public wishlists are presented to visitors under the "Wardrobe" title, and a user's wardrobe privacy setting may inadvertently hide shareable wishlist items.
- **Recommended Disposition:** `STANDARDIZE`
- **Recommended B7 Phase:** B7-c (Align query with `wardrobe_items` for the wardrobe section, or provide distinct Wishlist and Wardrobe tabs with independent privacy handling).

---

### [B7-MOB-004] Dormant Suggested Connections Tab in Social Discovery
- **Repo / Subsystem:** `jezsy-mobile-app` / Social Network
- **Artifact:** `app/network.tsx`
- **Current Purpose:** Social networking screen with tabs for My Connections, Pending Requests, and Discover/Search.
- **Entrypoints / Callers:** Bottom navigation and user profile links.
- **Downstream Dependencies:** `public.get_suggested_connections()` RPC.
- **Live DB Dependency:** Supabase RPC `get_suggested_connections`.
- **Tests:** None.
- **Documentation References:** `docs/audits/mobile-social-layer-user-discovery-audit.md` (SOC-007).
- **Classification:** `DORMANT / HALF-SHIPPED`
- **Evidence:** `app/network.tsx` contains a Discover tab, but when search text is empty, it displays a static empty state or recent queries rather than invoking `get_suggested_connections()`.
- **Impact:** Customers see an empty Discover screen rather than friend-of-friend boutique recommendations.
- **Recommended Disposition:** `WIRE`
- **Recommended B7 Phase:** B7-c (Wire `get_suggested_connections()` into the default state of `app/network.tsx`).

---

### [B7-MOB-005] Bypassed Slot Booking Aggregation in TimeSlotPicker (Active Correctness Defect)
- **Repo / Subsystem:** `jezsy-mobile-app` / Booking & Appointments
- **Artifact:** `components/TimeSlotPicker.tsx`
- **Current Purpose:** Renders available appointment time slots for fitting and reservation visits.
- **Entrypoints / Callers:** `app/reserve/[id].tsx`.
- **Downstream Dependencies:** `public.reservations` table.
- **Live DB Dependency:** `public.get_slot_booked_counts(date)` RPC, reservation RLS policies.
- **Tests:** None.
- **Documentation References:** `supabase/migrations/20260806093510_slot_booking_counts.sql`.
- **Classification:** `DORMANT / BYPASSED (ACTIVE CORRECTNESS DEFECT — HIGH PRIORITY)`
- **Evidence:** 
  - Lines 78-100 query raw reservations:
    ```typescript
    const { data } = await supabase.from('reservations').select('appointment_time, status').eq('date', dateStr)...
    ```
    and perform client-side grouping in a loop.
  - Live reservation SELECT RLS restricts customers to `customer_id = auth.uid()`.
  - Normal customers cannot see bookings belonging to other users. The client-side count yields only the customer's own reservations, presenting fully booked slots as completely empty.
- **Impact:** **Active scheduling defect.** Customers are offered occupied slots, causing booking rejections or checkout conflicts.
- **Recommended Disposition:** `WIRE` / `STANDARDIZE` (High Priority)
- **Recommended B7 Phase:** B7-c (Refactor `TimeSlotPicker.tsx` to invoke canonical `get_slot_booked_counts` RPC).

---

### [B7-MOB-006] Dual Messaging Route Architecture
- **Repo / Subsystem:** `jezsy-mobile-app` / Messaging
- **Artifact:** `app/messages/[conversationId].tsx` vs `app/chat/[id].tsx`
- **Current Purpose:** 
  - `app/messages/[conversationId].tsx`: Boutique customer support & order inquiries (backed by `conversations` / `messages`).
  - `app/chat/[id].tsx`: Peer-to-peer customer direct messaging (backed by `direct_chats`, `direct_chat_participants`, and `direct_messages`).
- **Entrypoints / Callers:** 
  - Support: Order details screen, boutique contact button.
  - P2P Direct Chat: User profile screens, social connection list.
- **Downstream Dependencies:** Separate database tables and realtime channels.
- **Live DB Dependency:** `conversations`/`messages` vs `direct_chats`/`direct_chat_participants`/`direct_messages`.
- **Tests:** Unit tests in `src/services/__tests__/chatService.test.ts`.
- **Documentation References:** `docs/audits/b5-messaging-realtime-inventory.md`.
- **Classification:** `ACTIVE`
- **Evidence:** Both routes are actively maintained and serve distinct functional domains established in Phase B5. `chatService.ts` explicitly queries and inserts into `direct_messages` and calls `get_direct_chat_summaries`.
- **Impact:** None (Architecture is sound, but needs explicit documentation to prevent developer confusion).
- **Recommended Disposition:** `RETAIN`
- **Recommended B7 Phase:** B7-f (Clarify dual messaging domains in normative architecture docs).

---

### [B7-MOB-007] Dual Payment Return Route Architecture
- **Repo / Subsystem:** `jezsy-mobile-app` / Payments
- **Artifact:** `app/payment/return.tsx` vs `app/payment-return.tsx`
- **Current Purpose:**
  - `app/payment/return.tsx`: Web redirect handler for PayMongo checkout sessions in web/browser environments.
  - `app/payment-return.tsx`: Native mobile deep-link handler (`jezsy://payment-return`) triggered when mobile banking apps redirect back to the app.
- **Entrypoints / Callers:** PayMongo checkout redirect URLs.
- **Downstream Dependencies:** `public.payments`, `public.reservations`.
- **Live DB Dependency:** Supabase payment ledger.
- **Tests:** None.
- **Documentation References:** `docs/paymongo-setup.md`.
- **Classification:** `ACTIVE`
- **Evidence:** Both routes are active and handle distinct platform return flows.
- **Impact:** None.
- **Recommended Disposition:** `RETAIN`
- **Recommended B7 Phase:** None (Retain as active).

---

### [B7-MOB-008] Product Detail Look Integration: Pose Guides vs Community Outfits
- **Repo / Subsystem:** `jezsy-mobile-app` / Catalog & Styling
- **Artifact:** `components/StyledLooksSection.tsx` inside `app/product/[id].tsx:391`
- **Current Purpose:** Renders curated stylist pose guides for the current garment.
- **Entrypoints / Callers:** Product detail page.
- **Downstream Dependencies:** `public.get_pose_guides_for_product` RPC.
- **Live DB Dependency:** `public.pose_guides`, `public.pose_guide_products`.
- **Tests:** UI verification.
- **Documentation References:** `supabase/migrations/20260910130000_pose_guides_domain_and_reverse_lookup.sql`.
- **Classification:** `ACTIVE`
- **Evidence:** Fully functional component calling `get_pose_guides_for_product`. Community outfit sharing remains dormant on product pages.
- **Impact:** Stylist inspiration is delivered; community outfit inspiration is deferred.
- **Recommended Disposition:** `RETAIN`
- **Recommended B7 Phase:** None.

---

## 4. Subsystem 3: Admin Dashboard Features, Services & Assets

---

### [B7-ADM-001] Orphaned Customer Feedbacks Stylesheet
- **Repo / Subsystem:** `admin-dashboard` / Customers Page
- **Artifact:** `src/pages/customers/Feedbacks.css` (144 lines, 3,179 bytes)
- **Current Purpose:** Legacy styling for a customer feedback moderation interface.
- **Entrypoints / Callers:** Zero imports in any JavaScript, JSX, or CSS file across the repository.
- **Downstream Dependencies:** None. No `Feedbacks.jsx` file exists in `src/pages/customers/` or anywhere in `admin-dashboard`.
- **Live DB Dependency:** None.
- **Tests:** None.
- **Documentation References:** None.
- **Classification:** `ZOMBIE`
- **Evidence:** Repository-wide search for `Feedbacks.css` yields zero matches. `Feedbacks.jsx` does not exist.
- **Impact:** Dead CSS inflating repo size.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-d (Delete file).

---

### [B7-ADM-002] Orphaned Feedback Service
- **Repo / Subsystem:** `admin-dashboard` / Services
- **Artifact:** `src/services/feedbackService.js` (30 lines, 959 bytes)
- **Current Purpose:** Defines `subscribeToFeedbacks` and `deleteFeedback`.
- **Entrypoints / Callers:** Zero imports across the entire `admin-dashboard` codebase.
- **Downstream Dependencies:** `src/lib/supabaseService.js`.
- **Live DB Dependency:** `public.feedback` table.
- **Tests:** None.
- **Documentation References:** None.
- **Classification:** `ZOMBIE`
- **Evidence:** Comprehensive scan of all 28 services in Admin showed `feedbackService` is the **only** service with exactly 0 callers.
- **Impact:** Orphaned service file.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-d (Delete file).

---

### [B7-ADM-003] Orphaned Outfit Suggestions Stylesheet
- **Repo / Subsystem:** `admin-dashboard` / Wardrobe Page
- **Artifact:** `src/pages/wardrobe/OutfitSuggestions.css` (842 lines, 17,432 bytes)
- **Current Purpose:** Legacy styling for outfit suggestions and inspiration cards.
- **Entrypoints / Callers:** Zero imports across the entire repository.
- **Downstream Dependencies:** None. `src/pages/wardrobe/StyleInspiration.jsx` uses Tailwind utility classes exclusively.
- **Live DB Dependency:** None.
- **Tests:** None.
- **Documentation References:** None.
- **Classification:** `ZOMBIE`
- **Evidence:** Zero grep matches for `OutfitSuggestions` across the entire admin dashboard repository.
- **Impact:** 842 lines of dead CSS.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-d (Delete file).

---

### [B7-ADM-004] Accidental Root Scratch Script
- **Repo / Subsystem:** `admin-dashboard` / Repo Root
- **Artifact:** `test_modal_regex.py` (25 lines, 836 bytes)
- **Current Purpose:** Temporary regex script used during an earlier modal refactoring to find `<div className="modal-overlay">`.
- **Entrypoints / Callers:** None.
- **Downstream Dependencies:** None.
- **Live DB Dependency:** None.
- **Tests:** None.
- **Documentation References:** None.
- **Classification:** `ZOMBIE`
- **Evidence:** Python script sitting in the web frontend root directory; not part of CI, build, or runtime.
- **Impact:** Repository hygiene defect.
- **Recommended Disposition:** `PRUNE`
- **Recommended B7 Phase:** B7-d (Delete file).

---

### [B7-ADM-005] Legacy Firestore Schema Types Escape
- **Repo / Subsystem:** `admin-dashboard` / Type Definitions
- **Artifact:** `src/types/index.ts` (226 lines, 5,433 bytes)
- **Current Purpose:** Type definitions from early Firebase/Firestore architecture with union timestamp types: `createdAt: string | Date | number | Record<string, number>`.
- **Entrypoints / Callers:** Only `src/components/TopNav.tsx:16` imports `User` from `../types`.
- **Downstream Dependencies:** None.
- **Live DB Dependency:** Supabase canonical types reside in `src/types/database.types.ts`.
- **Tests:** TypeScript build.
- **Documentation References:** None.
- **Classification:** `ZOMBIE / CONTRACT ESCAPE`
- **Evidence:** 226 lines of dead Firebase models (`User`, `Product`, `Order`, `Reservation`, `Review`, `Feedback`). Only `TopNav.tsx` imports a single interface `User`.
- **Impact:** Developers may mistakenly import stale Firestore types instead of generated Supabase PostgreSQL types.
- **Recommended Disposition:** `STANDARDIZE` / `PRUNE`
- **Recommended B7 Phase:** B7-d (Migrate `TopNav.tsx` to use canonical user profile typing from auth context or `database.types.ts`, then remove `src/types/index.ts`).

---

### [B7-ADM-006] Dead Legacy Soft-Delete Exports & Domain Scoping
- **Repo / Subsystem:** `admin-dashboard` / Supabase Service Layer
- **Artifact:** `src/lib/supabaseService.js:185-194` (`softDeleteDocument`), `src/services/productService.js:456` (`deleteCategory`), `src/services/customerService.js:334` (`deleteReservation`)
- **Current Purpose:** Generic soft-deletion helper and legacy service export wrappers.
- **Entrypoints / Callers:**
  - `productService.deleteCategory`: Zero UI callers. Production category UI (`AdminInventoryPanel.jsx:253`) uses `deleteCategoryAdmin` (which executes guarded hard delete).
  - `customerService.deleteReservation`: Zero UI callers. Production reservation deletion uses `reservationService.deleteReservation`.
  - `productService.deleteProduct`: Production caller for `products`.
- **Downstream Dependencies:** `public.products`.
- **Live DB Dependency:** `public.products` (has `deleted`, `deleted_at`, `updated_at`). `reservations` and `categories` tables lack `deleted_at`.
- **Tests:** `customerService.test.js` (uses mock).
- **Documentation References:** None.
- **Classification:** `ZOMBIE / CONTRACT CLEANUP`
- **Evidence:** 
  - `softDeleteDocument` writes `{ deleted: true, deleted_at: now, updated_at: now }`.
  - Calling this on `reservations` or `categories` would trigger `PGRST204` / PostgreSQL 42703 column errors.
  - However, neither invalid export is called by active production UI.
- **Impact:** Dead legacy export vectors clutter the service layer with invalid schema mutations.
- **Recommended Disposition:** `PRUNE` / `STANDARDIZE`
- **Recommended B7 Phase:** B7-d (Prune dead exports `deleteCategory` in `productService.js` and `deleteReservation` in `customerService.js`. Constrain `softDeleteDocument` to its known-compatible domain `products`).

---

### [B7-ADM-007] Direct Table DML Bypass of Audited Device Management
- **Repo / Subsystem:** `admin-dashboard` / Security & Devices
- **Artifact:** `src/services/deviceService.js:37-65`
- **Current Purpose:** Admin device approval, revocation, and deletion.
- **Entrypoints / Callers:** `src/pages/admin/DeviceManagement.jsx`.
- **Downstream Dependencies:** `public.devices` table.
- **Live DB Dependency:** Database RPCs `admin_manage_device` and `admin_prune_devices`.
- **Tests:** None.
- **Documentation References:** `docs/audits/security-performance-hardening-closure-ledger.md`.
- **Classification:** `DORMANT / BYPASSED`
- **Evidence:** `deviceService.js` directly executes `supabase.from('devices').update(...)` and `supabase.from('devices').delete(...)`, completely bypassing `admin_manage_device` and leaving zero audit trail in `public.logs`.
- **Impact:** Device approval, revocation, and deletion bypass security audit logs.
- **Recommended Disposition:** `WIRE` / `STANDARDIZE`
- **Recommended B7 Phase:** B7-d (Refactor `deviceService.js` to invoke `admin_manage_device` and `admin_prune_devices`).

---

### [B7-ADM-008] Deprecated Asymmetric Migration Directory in Admin (Resolved in B6)
- **Repo / Subsystem:** `admin-dashboard` / Supabase Migrations
- **Artifact:** `supabase/migrations/` in `admin-dashboard`
- **Current Purpose:** Historical migration surface, fully decommissioned in Phase B6.
- **Entrypoints / Callers:** None. Phase B6 centralized all migrations in `jezsy-mobile-app/supabase/migrations/`.
- **Downstream Dependencies:** None.
- **Live DB Dependency:** Shared Supabase database.
- **Tests:** B6 closure verification.
- **Documentation References:** `docs/audits/b6-verification-closure.md`.
- **Classification:** `HISTORICAL / RESOLVED IN B6`
- **Evidence:** On current Admin `main`, `supabase/migrations/` contains **only `README.md`** declaring the directory deactivated. Historical SQL files were already relocated to `docs/schema-history/admin-legacy-migrations/` during Phase B6.
- **Impact:** Already resolved. No duplicate migration execution surface exists on Admin `main`.
- **Recommended Disposition:** `RETAIN` (No action in B7-d).
- **Recommended B7 Phase:** None (Resolved in B6).

---

## 5. Subsystem 4: Documentation Hygiene & Systemic Drift

---

### [B7-DOC-001] Mobile Architecture Document Drift
- **Repo / Subsystem:** `jezsy-mobile-app` / Documentation
- **Artifact:** `docs/ARCHITECTURE.md` (272 lines, 26,642 bytes)
- **Current Purpose:** Primary normative architecture reference for the mobile application.
- **Entrypoints / Callers:** Referencing engineers, agent prompts, thesis documentation.
- **Downstream Dependencies:** None.
- **Live DB Dependency:** None.
- **Tests:** None.
- **Documentation References:** None.
- **Classification:** `DORMANT / OUTDATED NORMATIVE`
- **Evidence:** 
  - Section 1.1 states: "PostgreSQL: 31 tables, all with RLS enabled; `create_order` RPC". Actual live: **48 tables, 84 callable RPCs**.
  - Section 1.2 asserts ML stack uses `@six33/react-native-bg-removal` and `react-native-fast-tflite`. Actual stack: `react-native-vision-camera`, `react-native-mediapipe-posedetection`, and `react-native-worklets-core`.
  - Section 1.2 states no payment gateway exists (only receipt image upload). Actual system: Full PayMongo integration with electronic payment webhooks.
  - Section 1.2 claims realtime is on `messages` and `conversations`. Actual system: `chat_messages`, `direct_messages`, `notifications`, `reservations`, `inventory`.
- **Impact:** Misleads developers and automated agents into designing against a July 2026 architecture.
- **Recommended Disposition:** `STANDARDIZE`
- **Recommended B7 Phase:** B7-f (Update `ARCHITECTURE.md` to reflect current 48-table, MediaPipe, PayMongo, and dual messaging reality).

---

### [B7-DOC-002] Admin Dashboard README Drift
- **Repo / Subsystem:** `admin-dashboard` / Documentation
- **Artifact:** `README.md` (74 lines, 3,613 bytes)
- **Current Purpose:** Primary onboarding document for the web admin dashboard.
- **Entrypoints / Callers:** New developers and repository visitors.
- **Downstream Dependencies:** None.
- **Live DB Dependency:** None.
- **Tests:** None.
- **Documentation References:** None.
- **Classification:** `DORMANT / OUTDATED NORMATIVE`
- **Evidence:**
  - Line 7 claims: "Styling: Vanilla CSS (no Tailwind)". Actual: Tailwind CSS is installed and actively used in `StyleInspiration.jsx` and other modern components.
  - Line 9 claims: "Image Storage: Cloudinary". Actual: Cloudinary is completely replaced by Supabase Storage buckets (`products`, `pose-images`).
  - Line 18 claims: "Settings: Advanced overrides, app configuration, and schema migration tools." Actual: No schema migration tools exist in Settings.
- **Impact:** Distorts developer expectations regarding styling, storage, and database capabilities.
- **Recommended Disposition:** `STANDARDIZE`
- **Recommended B7 Phase:** B7-f (Align README with current Tailwind, Supabase Storage, and RBAC features).

---

### [B7-DOC-003] Documentation Taxonomy & Governance Index
- **Repo / Subsystem:** Both Repositories (`jezsy-mobile-app/docs/` and `admin-dashboard/docs/`)
- **Artifact:** Documentation indices and category taxonomy
- **Current Purpose:** Governance of project documentation across engineering cycles.
- **Entrypoints / Callers:** Engineering teams and AI agents.
- **Downstream Dependencies:** None.
- **Live DB Dependency:** None.
- **Tests:** None.
- **Documentation References:** STRAT-006 Documentation Hygiene Rule.
- **Classification:** `DORMANT / GOVERNANCE DEFICIT`
- **Evidence:** The documentation directories contain a mixture of active normative specifications, historical point-in-time audits, and frozen verification ledgers without a centralized index. Automated agents risk treating historical snapshots as active requirements.
- **Impact:** Stale assumptions leak into implementation cycles.
- **Recommended Disposition:** `STANDARDIZE`
- **Recommended B7 Phase:** B7-f (Establish a normative `docs/README.md` documentation index in each repository classifying documents as `NORMATIVE`, `HISTORICAL SNAPSHOT`, `AUDIT LEDGER`, or `SUPERSEDED`, **without** modifying frozen historical audit ledgers).

---

## 6. Approved 7-Stage Execution Roadmap (B7-a through B7-g)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PHASE B7 LIFECYCLE ROADMAP                            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
  ┌────────────────────────────────────┴────────────────────────────────────┐
  ▼                                                                         ▼
[B7-a: Read-Only Inventory & Audit] (Current)           [B7-b: Architecture & Design Freeze]
  • Comprehensive 33-finding baseline                      • Formal authorization of scope & PRs
  • Quantitative database catalog (127 procs)              • Finalized rollback & migration plans
  • Reconciled metrics & evidence                          • Gating checklist for B7-c..B7-g
  └────────────────────────────────────┬────────────────────────────────────┘
                                       │
     ┌─────────────────────────────────┼─────────────────────────────────┐
     ▼                                 ▼                                 ▼
[B7-c: Mobile Remediation]     [B7-d: Admin Remediation]         [B7-e: Database Pruning]
  • High-Priority Slot Fix:      • Prune Feedbacks.css &           • Author forward migration:
    Wire TimeSlotPicker to         feedbackService.js                20260912000002_prune_
    get_slot_booked_counts       • Prune OutfitSuggestions.css       zombie_public_rpcs.sql
  • Prune modal.tsx cluster      • Prune test_modal_regex.py       • Companion .sql.rollback
  • Wire Profile Username        • Prune dead soft-delete          • Drop 6 confirmed zombies:
  • Wire Suggested Connections     exports (deleteCategory,          auto_cancel_expired,
  • Standardize Wardrobe/          deleteReservation)                expire_unpaid, update_staff,
    Wishlist query contract      • Wire deviceService to             complete_pickup, verify_pickup,
                                   admin_manage_device               check_email_exists
                                 • Replace types/index.ts          • Regenerate types in both repos
     └─────────────────────────────────┼─────────────────────────────────┘
                                       │
     ┌─────────────────────────────────┴─────────────────────────────────┐
     ▼                                                                   ▼
[B7-f: Documentation Hygiene]                            [B7-g: Final Verification & Closure]
  • Update Mobile ARCHITECTURE.md                          • Run complete test suites (TS, lint, Jest)
  • Update Admin README.md                                 • Verify persona RLS & live database
  • Author normative docs/README.md index                  • Verify zero runtime regression
    (NORMATIVE vs HISTORICAL vs AUDIT LEDGER)              • Final closure ledger & PR merges
```

### 6.1 Detailed Phase Scope Summary

- **B7-a: Read-Only Inventory & Audit Baseline (RECONCILED)**  
  Frozen baseline of 127 database procedures and 33 audited subsystem artifacts. Zero modifications made.
- **B7-b: Architecture & Design Freeze**  
  Formal sign-off on the 11 Prune, 7 Wire, 5 Standardize, 7 Retain, and 3 Investigate dispositions.
- **B7-c: Mobile Remediation (`jezsy-mobile-app`)**  
  Fix active slot availability defect (`TimeSlotPicker.tsx`), wire username edit and suggested connections, standardize profile wardrobe query, and prune dead template files.
- **B7-d: Admin Remediation (`admin-dashboard`)**  
  Prune orphaned stylesheets (`Feedbacks.css`, `OutfitSuggestions.css`), dead service (`feedbackService.js`), scratch script, and dead soft-delete exports; wire device management to audited RPC; replace legacy Firestore types.
- **B7-e: Database Zombie-RPC Pruning (Shared Live Supabase)**  
  Author and apply single idempotent migration dropping the 6 confirmed zombie RPCs with matching rollback; re-sync types across both repositories.
- **B7-f: Documentation Standardization & Governance Index**  
  Align normative documents with current architecture and create a central taxonomy index without altering frozen historical ledgers.
- **B7-g: Final Verification, Regression Testing & Closure Ledger**  
  Execute full automated verification across both repositories, confirm live database integrity, and publish the B7 closure ledger.
