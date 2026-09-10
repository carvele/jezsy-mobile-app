# Security & Performance Hardening Lifecycle: Comprehensive Closure Ledger

**Document ID**: `SEC-PERF-CLOSE-20260910-V2`  
**Target Environment**: Supabase Production / Shared Live Database (`wufcmtndotfvxvvxkamv`)  
**Repositories**: `carvele/jezsy-mobile-app`, `carvele/admin-dashboard`  
**Status**: **DATABASE HARDENING COMPLETE; PASS E OPERATIONAL CONFIGURATION PENDING**  
**Date**: September 10, 2026  

---

## 1. Executive Summary & Production Baseline Reconciled

Between September 9 and September 10, 2026, an exhaustive multi-pass security and performance remediation program was executed across the shared live Supabase database and client applications. 

The campaign systematically targeted and resolved:
1. **Unrestricted Anonymous Function Execution (Pass A1 & Post-F3)**: Eliminated all unintended unauthenticated execution paths on privileged `SECURITY DEFINER` functions, leaving four explicitly reviewed public endpoints.
2. **Search Path Hijacking Vulnerabilities (Pass A2)**: Hardened all user-defined database functions and triggers against search path mutation attacks.
3. **RLS InitPlan Performance Degradations (Pass B)**: Eliminated per-row scalar subquery re-evaluations across all active Row Level Security (RLS) policies.
4. **Multiple Permissive Policy (MPP) Proliferation (Pass F)**: Consolidated redundant RLS policies across 23 distinct tables, completely eliminating redundant policy evaluation overhead (`MPP = 0`).
5. **Role-Scoped RLS Decoupling (Post-F3 Stages 1 & 2)**: Migrated 19 legacy `TO public` administrative helper policies across 8 tables (`admin_notifications`, `conversations`, `logs`, `messages`, `reservation_items`, `reservations`, `reviews`, `user_measurements`) to `TO authenticated` without modifying policy expressions (`20260910290000`), followed by the total revocation of anonymous `EXECUTE` privileges on role-check helpers (`20260910300000`).
6. **Critical E-Commerce & Social Runtime Flaws**: Fixed reservation expiration floor gaps (`20260910270000`), payment webhook correlation race conditions (`20260910280000`), web checkout return routing (`480096a`), and tripled social proof rendering (`37b03f5`).

### 1.1 Live Advisor Snapshot vs. Lifecycle Objects Addressed

To prevent historical confusion between the initial live Advisor snapshot at the start of each individual pass and the total volume of database objects addressed over the entire lifecycle, both metrics are explicitly distinguished below:

| Advisor Gate / Metric | Initial Live Snapshot | Lifecycle Objects Addressed | Target | Final Live Status | Final Disposition |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `anon_security_definer_function_executable` | **17** (Pass A1) | 17 unique functions (13 resolved + 4 accepted) [2 temporary fallback restorations subsequently remediated in Post-F3] | $\le 4$ | **4** | **13 Resolved / 4 Accepted Public Endpoints** |
| `function_search_path_mutable` | **12** (Pass A2) | 10 hardened + 2 dropped | 0 | **0** | **100% Remediated via `SET search_path = public, pg_temp`** |
| `auth_rls_initplan` | **11** (Pass B) | 11 policies across 6 tables | 0 | **0** | **100% Remediated via `(select auth.<func>())`** |
| `extension_in_public` | **2** (Pass D) | 2 extensions (`pg_trgm`, `pg_net`) | 1 | **1** | `pg_trgm` moved to `extensions`; `pg_net` accepted (`SEC-EXT-001`) |
| `rls_enabled_no_policy` | **2** (Pass C) | 2 tables (`webhook_events`, `rate_limits`) | 2 | **2** | Formally accepted fail-closed deny-all client RLS (`SEC-RLS-001`, `002`) |
| `multiple_permissive_policies` | **83** (Pass F) | 83 findings across 23 distinct tables | 0 | **0** | **100% Remediated across Batches F1, F2, F3** |
| `auth_leaked_password_protection` | **1** (Pass E) | 1 auth configuration setting | 0 | **1** | **Pending Operational Activation in Dashboard** |
| Anonymous Helper Reachability | **19** policies (Post-F3 Stage 1) | 19 policies across 8 tables (pre-F3 spanned 10 tables) | 0 | **0** | **Zero anonymous reachability database-wide** |

---

## 2. Master Finding Directory & Canonical Classification

### 2.1 Security Pass A1 & Post-F3: Anonymous `SECURITY DEFINER` Functions
*Primary Migration: [`20260910180000_harden_anon_security_definer_functions.sql`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910180000_harden_anon_security_definer_functions.sql) (PR #228) & [`20260910300000_revoke_anon_execute_on_rls_helpers.sql`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910300000_revoke_anon_execute_on_rls_helpers.sql) (PR #246)*

> **Accounting Reconciliation**: Exactly 17 unique functions were assessed in Pass A1. All 17 were secured (13 resolved + 4 accepted intentional). When two helper functions (`is_admin_or_owner`, `is_staff_or_admin`) had anonymous `EXECUTE` temporarily restored in `20260910190000` to prevent `42501` regression during public policy evaluation, they were re-tracked as `SEC-A1-018` and `SEC-A1-019` until their permanent revocation in Post-F3 Stage 2 (`20260910300000`). Total unique functions: $13 + 4 = 17$.

| Function Signature / Entity | Group / Role | Remediation Action | Canonical Finding ID | Final Status |
| :--- | :--- | :--- | :---: | :---: |
| `public.is_blocked_between(uuid, uuid)` | Privacy Guard | Verified safe; enforces `auth.uid()` caller check on non-null input | `SEC-A1-008` | **ACCEPTED INTENTIONAL** |
| `public.get_outfit_privacy(uuid)` | Catalog Privacy | Verified safe; scalar privacy state only, zero customer data | `SEC-A1-015` | **ACCEPTED INTENTIONAL** |
| `public.get_wishlist_privacy(uuid)` | Wishlist Privacy | Verified safe; scalar privacy state only, zero customer data | `SEC-A1-016` | **ACCEPTED INTENTIONAL** |
| `public.get_product_loved_by(uuid)` | Social Proof | Hardened double-opt-in filter, block suppression, LIMIT 3 public fans | `SEC-A1-017` | **ACCEPTED INTENTIONAL** |
| `public.is_admin_or_owner()` | RLS Role Helper | Rescoped 19 RLS callers in Stage 1; revoked anon `EXECUTE` in Stage 2 | `SEC-A1-018` | **RESOLVED** |
| `public.is_staff_or_admin()` | RLS Role Helper | Rescoped 19 RLS callers in Stage 1; revoked anon `EXECUTE` in Stage 2 | `SEC-A1-019` | **RESOLVED** |
| `public.handle_auto_acknowledgment()` | Trigger Function | `REVOKE ALL FROM PUBLIC, anon, authenticated` | Pass A1 Group 1 | **RESOLVED** |
| `public.harden_reviews_update_trigger()` | Trigger Function | `SET search_path`; `REVOKE ALL FROM PUBLIC, anon, authenticated` | Pass A1 Group 1 | **RESOLVED** |
| `public.prevent_self_accept()` | Trigger Function | `REVOKE ALL FROM PUBLIC, anon, authenticated` | Pass A1 Group 1 | **RESOLVED** |
| `public.tr_review_votes_sync_counts()` | Trigger Function | `REVOKE ALL FROM PUBLIC, anon, authenticated` | Pass A1 Group 1 | **RESOLVED** |
| `public.tr_reviews_set_reviewer_name()` | Trigger Function | `SET search_path`; `REVOKE ALL FROM PUBLIC, anon, authenticated` | Pass A1 Group 1 | **RESOLVED** |
| `public.get_or_create_direct_chat(uuid)` | Authenticated RPC | `REVOKE ALL FROM PUBLIC, anon; GRANT TO authenticated` | Pass A1 Group 2 | **RESOLVED** |
| `public.get_suggested_connections()` | Authenticated RPC | `SET search_path`; `REVOKE FROM anon; GRANT TO authenticated` | Pass A1 Group 2 | **RESOLVED** |
| `public.vote_on_review(uuid, text)` | Authenticated RPC | `REVOKE ALL FROM PUBLIC, anon; GRANT TO authenticated` | Pass A1 Group 2 | **RESOLVED** |
| `public.get_wardrobe_privacy(uuid)` | Authenticated RPC | `REVOKE ALL FROM PUBLIC, anon; GRANT TO authenticated` | Pass A1 Group 2 | **RESOLVED** |
| `public.is_chat_participant(uuid, uuid)` | Authenticated Helper| Enforced `auth.uid()` / staff check; revoked anon `EXECUTE` | Pass A1 Group 2 | **RESOLVED** |
| `public.get_most_wishlisted_products()` | Staff Analytics RPC | Enforced `is_staff_or_admin()` guard; revoked anon `EXECUTE` | Pass A1 Group 3 | **RESOLVED** |

### 2.2 Security Pass A2: Mutable Search Paths
*Primary Migration: [`20260910190000_harden_mutable_search_paths.sql`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910190000_harden_mutable_search_paths.sql) (PR #229)*
- **10 Functions Pinned**: Added `SET search_path = public, pg_temp;` to `sync_product_category_id`, `seed_inventory_for_new_product`, `sync_profile_full_name`, `notify_admin_on_reservation`, `set_connections_updated_at`, `set_direct_chats_updated_at`, `search_catalog`, `search_catalog_fuzzy`, `get_trending_products`, `get_review_stats`.
- **2 Obsolete Objects Retired**: Removed unused `public.min(uuid)` aggregate and `public.min_uuid_step(uuid, uuid)` transition function via `DROP ... RESTRICT`.
- **Result**: `function_search_path_mutable` dropped from **12 to 0** (**RESOLVED**).

### 2.3 Security & Performance Pass B: Auth RLS InitPlans
*Primary Migration: [`20260910200000_optimize_auth_rls_initplans.sql`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910200000_optimize_auth_rls_initplans.sql) (PR #230)*
- Remediated all 11 flagged policies across 6 tables: `capsules`, `capsule_items`, `connections`, `direct_chats`, `direct_chat_participants`, `direct_messages`.
- Converted volatile `auth.uid()` calls into scalar subqueries `(select auth.uid())` evaluated once as query `InitPlan` constants.
- **Result**: `auth_rls_initplan` dropped from **11 to 0** (**RESOLVED**).

### 2.4 Security Pass C: Deny-All Client RLS Tables
*Architecture Verification & Grant Minimization*
- `SEC-RLS-001`: `public.processed_payment_webhook_events` — RLS enabled, 0 client policies, `REVOKE ALL FROM anon, authenticated`. Dedicated internal webhook log table.
- `SEC-RLS-002`: `public.rate_limits` — RLS enabled, 0 client policies, `REVOKE ALL FROM anon, authenticated`. Dedicated Edge Function rate limit table.
- **Result**: Both tables formalize a deliberate fail-closed client posture (**ACCEPTED INTENTIONAL**).

### 2.5 Security Pass D: Extension Schema Isolation
*Primary Migration: [`20260910210000_relocate_pg_trgm_extension.sql`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910210000_relocate_pg_trgm_extension.sql) (PR #231)*
- `pg_trgm`: Relocated from `public` to `extensions` schema. Pinned `search_catalog_fuzzy` search path to `public, extensions, pg_temp` (**RESOLVED**).
- `SEC-EXT-001` (`pg_net` in `public`): Supabase core extension dependency (`extrelocatable: false`) (**ACCEPTED INTENTIONAL**).
- **Result**: `extension_in_public` dropped from **2 to 1** (**RESOLVED**).

### 2.6 Security Pass E: Leaked Password Protection (HIBP)
*Dashboard Operational Configuration*
- `SEC-E-001` (`auth_leaked_password_protection`): Supabase Auth HaveIBeenPwned.org integration.
- **Current Posture**: **READY / PENDING OPERATIONAL ACTIVATION (Supabase Dashboard)**.
- Note: This is an Auth service configuration toggle, not a SQL migration. Awaiting operator activation in the dashboard followed by signup/reset-password smoke verification.

### 2.7 Performance Pass F: Multiple Permissive Policies (MPP) Remediation
*Migrations: F1 ([`20260910220000`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910220000_remediate_mpp_batch_f1.sql)), F2 ([`20260910230000`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910230000_remediate_mpp_batch_f2.sql)), F3 ([`20260910240000`](file:///c:/Users/carlv/jezsy-mobile-app/supabase/migrations/20260910240000_remediate_mpp_batch_f3.sql))*
- Complete remediation of **83 findings** across **23 distinct tables** (see Section 3 for detailed table breakdown).
- **Result**: `multiple_permissive_policies` dropped from **83 to 0** (**RESOLVED**).

### 2.8 Adjacent E-Commerce & UX Runtime Bug Fixes
- `BUG-RES-001`: `20260910270000_fix_reservation_payment_window_floor.sql` — Enforced positive floor on `payment_window_minutes` to prevent dead-on-arrival reservations (**RESOLVED**).
- `BUG-PAY-001`: `20260910280000_payments_payment_intent_correlation.sql` — Correlated webhook `payment.paid` events by `payment_intent_id` (**RESOLVED**).
- `BUG-PAY-002`: Web checkout same-origin return route handler (`480096a`) — Prevented cross-origin redirect failures on PayMongo completion (**RESOLVED**).
- `BUG-SOC-006`: Catalog detail social proof deduplication (`37b03f5`) — Eliminated tripled JSX rendering block in `app/product/[id].tsx` and corrected pluralization ("1 person saved this") (**RESOLVED**).
- `CHORE-MIG-001`: Standardized all rollback filenames to `.sql.rollback` across the repository (`5c1ced8`, PR #248) (**RESOLVED**).

---

## 3. Verified Pass F Execution History & Target Tables

The Pass F campaign resolved all 83 multiple permissive policy findings across **23 distinct target tables** in three strictly staged batches:

```
                          83 MPP Findings
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
      Batch F1               Batch F2               Batch F3
    42 Findings            31 Findings            10 Findings
     10 Tables               6 Tables               7 Tables
(83 ───► 41 findings)  (41 ───► 10 findings)  (10 ───► 0 findings)
```

### 3.1 Batch F1 (42 Findings Remediated across 10 Tables)
- **Target Tables**:
  1. `wishlists` (18 findings)
  2. `products` (6 findings)
  3. `settings` (6 findings)
  4. `pose_guide_products` (6 findings)
  5. `pose_guides` (1 finding)
  6. `ar_assets` (1 finding)
  7. `suggested_outfits` (1 finding)
  8. `announcements` (1 finding)
  9. `store_closures` (1 finding)
  10. `store_hours` (1 finding)
- **Key Mechanics**: Replaced wide `FOR ALL` management policies with discrete `FOR INSERT`, `FOR UPDATE`, and `FOR DELETE` policies scoped `TO authenticated`. Separated anonymous catalog `SELECT` from authenticated management. Preserved `.upsert()` compatibility for wishlists.
- **Migration & PR**: `20260910220000_remediate_mpp_batch_f1.sql` (PR #233). Advisor dropped **83 $\to$ 41**.

### 3.2 Batch F2 (31 Findings Remediated across 6 Tables)
- **Target Tables**:
  1. `devices` (6 findings)
  2. `saved_outfits` (6 findings)
  3. `outfit_items` (6 findings)
  4. `wardrobe_items` (6 findings)
  5. `review_votes` (6 findings)
  6. `connections` (1 finding)
- **Key Mechanics**: Preserved guest public outfit access via explicit `Saved outfits public read anon` policy. Consolidated authenticated SELECT policies with `(SELECT auth.uid())` and enforced `c.status = 'accepted'` for connection-shared outfits. Enforced soft-delete semantic filtering (`coalesce(deleted, false) = false`). Blocked direct writes to `review_votes` and `devices` in favor of audited RPC paths (`vote_on_review`, `admin_manage_device`).
- **Migration & PR**: `20260910230000_remediate_mpp_batch_f2.sql` (PR #236). Advisor dropped **41 $\to$ 10**.

### 3.3 Batch F3 (10 Findings Remediated across 7 Tables)
- **Target Tables**:
  1. `account_deletion_requests` (2 findings)
  2. `ar_sessions` (1 finding)
  3. `feedback` (1 finding)
  4. `inventory` (1 finding)
  5. `payments` (1 finding)
  6. `profiles` (3 findings)
  7. `stock_notify_requests` (1 finding)
- **Key Mechanics**: Enforced `F3-PROFILES-INSERT` security tightening requiring `id = (SELECT auth.uid())` AND `email = ((SELECT auth.jwt()) ->> 'email')` during customer signup. Maintained staff-only visibility on `ar_sessions` and `feedback`. Preserved column-level SQL privileges on `inventory`. Verified staff device authorization gate via `is_staff_or_admin()`.
- **Migration & PR**: `20260910240000_remediate_mpp_batch_f3.sql` (PR #239). Advisor dropped **10 $\to$ 0**.

---

## 4. Return Contract & Privacy Guarantees: `get_product_loved_by()`

Finding `SEC-A1-017` (`public.get_product_loved_by`) was intentionally preserved as an anonymous `SECURITY DEFINER` function to power social proof indicators across public product pages.

### 4.1 Function Return Contract
```sql
CREATE OR REPLACE FUNCTION public.get_product_loved_by(p_product_id uuid)
RETURNS TABLE(total_count integer, public_users json)
```

The function returns a single row containing two strictly governed fields:
1. `total_count` (`integer`): The aggregate count of all non-deleted, non-blocked customer profiles who have wishlisted the product.
2. `public_users` (`json`): A JSON array of up to three (`LIMIT 3`) recent fans who have explicitly opted into public discovery.

### 4.2 Privacy Filtering & Multi-Tenant Isolation
The function's internal query implements five layered privacy guards:
- **Double-Opt-In Visibility Requirement**: A customer profile is included in `public_users` **only if** both `wishlist_privacy = 'public'` AND `profile_visibility = 'public'`. Users with default private or connection-only visibility are excluded from the fan list while still contributing anonymously to `total_count`.
- **Account Health Filtering**: Soft-deleted accounts (`coalesce(p.deleted, false) = false`) and blocked accounts (`coalesce(p.is_blocked, false) = false`) are completely excluded from both counts and lists.
- **Caller Self-Exclusion**: When invoked by an authenticated user (`auth.uid() IS NOT NULL`), the caller's own profile is excluded from `public_users` (`w.user_id IS DISTINCT FROM auth.uid()`).
- **Bidirectional Block Suppression**: If an authenticated viewer has an active block relationship with a fan in `connections` (`c.status = 'blocked'`), that fan is stripped from the returned `public_users` array.
- **Least Privilege Projection**: Only public profile attributes (`id`, `username`, `first_name`, `last_name`) are exposed. Sensitive customer PII (email, phone, home address, account credentials, payment records) is structurally excluded. If no public fans exist, the function safely returns an empty JSON array (`'[]'::json`).

---

## 5. Pass E Operational Activation Protocol

While all database DDL migrations are applied and live, **Pass E** (`SEC-E-001`: `auth_leaked_password_protection`) remains reported as 1 warning by the Supabase Security Advisor because it requires project-level Auth configuration in the Supabase Dashboard.

### 5.1 Activation Procedure
1. Navigate to **Supabase Dashboard** $\to$ **Authentication** $\to$ **Password Protection** for project `wufcmtndotfvxvvxkamv`.
2. Toggle **Check passwords against HaveIBeenPwned.org**.
3. Set password policy parameters (e.g. prevent signups/updates with compromised passwords).
4. Save configuration.

### 5.2 Verification & Smoke Testing Protocol
1. **Negative Smoke Test (Compromised Password Rejection)**:
   - Call `/auth/v1/signup` with a known compromised password (e.g. `Password123!`).
   - Assert request is rejected with status `422 Unprocessable Entity` or `400 Bad Request` citing leaked password policy.
2. **Positive Smoke Test (Strong Password Acceptance)**:
   - Call `/auth/v1/signup` with a unique, high-entropy password.
   - Assert account creation succeeds normally.
3. **Password Reset Verification**:
   - Verify `/auth/v1/recover` and password update endpoints enforce identical HIBP validation.
4. **Advisor Verification**:
   - Re-fetch `get_advisors(type: 'security')`.
   - Confirm `auth_leaked_password_protection` warning drops from **1 to 0**.

---

## 6. Architectural Synthesis Readiness

With the corrections established in this ledger:
1. **The Database Layer is Formally Closed**: All RLS policies, functions, extensions, and grants are synchronized across production and Git `main`.
2. **Historical Accuracy Preserved**: Pass F table counts (23 distinct tables), initial Advisor baselines, Pass A1 function scopes, and `get_product_loved_by()` privacy contracts are documented with complete fidelity.
3. **Pass E Status Explicit**: Qualified as pending operational dashboard configuration, ensuring the architecture synthesis does not operate under false assumptions.
4. **Platform Status**: Fully primed for `/architecture-synthesis ultra`.
