# Phase B6 Verification Closure: Contracts, RLS Verification & Schema Ownership

**Phase Status:** CLOSED & FROZEN 🧊  
**Date:** 2026-09-12  
**Repositories:** `carvele/jezsy-mobile-app` (Canonical Schema Owner) & `carvele/admin-dashboard`  
**Database:** Shared Live Supabase Project (`wufcmtndotfvxvvxkamv`)  
**Mobile Head on `main`:** `3667713` (PR #278, PR #279, PR #280, PR #281)  
**Admin Head on `main`:** `2db84b8730ade884249778873277809b008c9b2c` (PR #131)  
**Live Database Ledger Version:** `20260912000001` (`revoke_anon_increment_wear_count`)  

---

## 1. Executive Summary

Phase B6 has formally resolved the systemic schema drift, contract desynchronization, credential exposure, and database ownership ambiguity between `jezsy-mobile-app` and `admin-dashboard`.

Key accomplishments:
1. **Canonical Schema Lineage Established**: `jezsy-mobile-app/supabase/migrations/` is codified as the **single authoritative repository** for all database schema migrations.
2. **Admin Migration Directory Deprecated**: `admin-dashboard/supabase/migrations/` is retired as an execution surface. All 39 legacy migrations were relocated to `admin-dashboard/docs/schema-history/admin-legacy-migrations/` (standardizing 16 `.rollback.sql` files to `.sql.rollback`), and an automated CI guard (`migrationGovernance.test.js` + `check:migrations`) ensures zero `.sql` files can be added to Admin.
3. **Zombie RPC Debt Purged (`B6-RPC-DEFECT-001`)**: Defunct callers `adjustInventoryStockDelta` and `adjustInventoryForReservation` and obsolete test mocks calling dropped `adjust_inventory_stock` were cleanly removed from Admin.
4. **Single-Source Type Parity & AST Contract Guard**: Regenerated `src/types/database.types.ts` from the live database, establishing 100% byte-for-byte schema type parity across both repos. Instituted an AST-based static RPC contract test in Admin (`contractVerification.test.js`) parsing all 21 `supabase.rpc` call sites with the TypeScript Compiler API.
5. **Least-Privilege Live Migration (`B6-GRANT-LEAK-001`)**: With explicit user authorization, applied canonical migration `20260912000001_revoke_anon_increment_wear_count.sql` to the shared live database, revoking anonymous and `PUBLIC` execute privileges on `increment_wear_count(uuid)`.
6. **Multi-Persona RLS Test Harness with Verified Cleanup**: Hardened and committed `scripts/security/verify_persona_rls.py`, executing multi-persona probes (Anon, authenticated Customer JWT, authenticated Staff JWT) with 100% pass rate on automated probes (13/13 PASS, 1 DEFERRED Layer 1 SQL probe, 0 FAIL) and verified pre-probe snapshot restoration guaranteeing **zero residual database state**.
7. **Secret Exposure Remediation & Governance Guard (`B6-SECRET-EXPOSURE-001`)**:
   - Rotated encrypted passwords in live `auth.users` for both harness accounts (`test_harness_customer@jezsy.internal` and `test_harness_staff@jezsy.internal`).
   - Revoked all active sessions and refresh tokens in `auth.sessions` and `auth.refresh_tokens`.
   - Purged registered staff devices in `public.devices`.
   - Stripped all hardcoded fallback credentials from `scripts/security/verify_persona_rls.py` and implemented strict fail-closed validation.
   - Added automated CI secret governance test `src/services/__tests__/secretGovernance.test.ts` enforcing rejection of credential fallbacks and exposed password literals.
8. **Zero Production Ledger Surgery**: The 250 immutable historical ledger entries in `schema_migrations` were preserved intact without rewrites.

---

## 2. Seven Governance Decisions — Execution Summary

| # | Policy Decision | Execution Treatment | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **1** | **Single Canonical Lineage** | Mobile `supabase/migrations/` is the sole authoring surface. Codified in `supabase/migrations/README.md`. | PR #278 merged; authoring rules strictly codified. |
| **2** | **Admin Migration Deprecation** | 39 legacy migrations moved to `docs/schema-history/admin-legacy-migrations/`. `README.md` pointer established. | `migrationGovernance.test.js` PASS; `npm run check:migrations` PASS. |
| **3** | **Immutable Live Ledger** | Historical 250 rows in `schema_migrations` preserved intact without destructive deletion or rewriting. | Ledger sequenced from baseline `20260911181020` to `20260912000001`. |
| **4** | **`.sql.rollback` Convention** | All rollbacks use `.sql.rollback` (extension first), designating offline manual disaster-recovery companions. | Supabase CLI skips `.sql.rollback` files without unapplied phantom errors. |
| **5** | **Single-Source Types** | Generated `database.types.ts` synchronized between Mobile and Admin. Hand-edits prohibited. | 100% byte-for-byte type parity across repos; `npm run type-check` PASS. |
| **6** | **AST Contract Verification** | Deleted dead `adjust_inventory_stock` callers (`B6-RPC-DEFECT-001`). AST test verifies literal RPC calls. | `contractVerification.test.js` PASS (21/21 call sites verified). |
| **7** | **Multi-Persona Harness & Secret Governance** | Committed `scripts/security/verify_persona_rls.py` with real tokens, fail-closed env validation, deferred accounting, and pre-probe snapshot/restoration. Added `secretGovernance.test.ts`. | PR #279, #280, & #281 merged; 13/13 automated probes PASS (100%), 1 DEFERRED, verified 0 residual modifications. |

---

## 3. Production Migration Gate & Live Verification (B6-e)

### Live Database: Shared Supabase Project (`wufcmtndotfvxvvxkamv`)

#### Applied Migration
- **Forward**: `supabase/migrations/20260912000001_revoke_anon_increment_wear_count.sql`
- **Rollback Companion**: `supabase/migrations/20260912000001_revoke_anon_increment_wear_count.sql.rollback`
- **SQL Applied**:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.increment_wear_count(uuid) FROM anon, PUBLIC;
  GRANT EXECUTE ON FUNCTION public.increment_wear_count(uuid) TO authenticated;
  ```

#### Post-Application Gate Verification

| Gate Check | Expected | Observed Live Value | Status |
| :--- | :--- | :--- | :--- |
| `anon` EXECUTE Privilege | `false` | `false` (`has_function_privilege` returned `false`) | ✅ PASS |
| `authenticated` EXECUTE Privilege | `true` | `true` (`has_function_privilege` returned `true`) | ✅ PASS |
| `PUBLIC` EXECUTE Privilege | `false` | `false` (proacl: `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`) | ✅ PASS |
| Public Tables under RLS | 48 / 48 (100%) | 48 / 48 (100%) with `rowsecurity = true` | ✅ PASS |
| SECURITY DEFINER `search_path` | 92 / 92 (100%) | 92 / 92 (100%) with explicitly pinned `search_path` | ✅ PASS |
| Live Migration Ledger | `20260912000001` | Version `20260912000001`, name `revoke_anon_increment_wear_count` | ✅ PASS |
| Persona RLS Test Harness | 100% Automated PASS | 13 passed, 0 failed, 1 deferred (`verify_persona_rls.py`) | ✅ PASS |
| Residual Test State | Zero | Pre-probe state snapshotted, restored, and verified | ✅ PASS |
| Live Credential Invalidation | Old Passwords Rejected | HTTP 400 (`invalid_credentials`) for previous fallbacks | ✅ PASS |

#### Empirical Multi-Persona Probe Output
```text
=== LAYER 1: Catalog & Governance Verification ===
[DEFERRED] Layer 1 | system | Direct catalog SQL probe: Deferred to direct database runner (non-REST catalog probe)

=== LAYER 2: Runtime Persona Probes ===

--- Persona: Anonymous Client ---
[PASS] Layer 2 | anon | Public catalog read access: HTTP 200 - Catalog readable
[PASS] Layer 2 | anon | Private table user_measurements read denial: HTTP 200 - Rows returned: 0
[PASS] Layer 2 | anon | Private table devices read denial: HTTP 200 - Rows returned: 0
[PASS] Layer 2 | anon | increment_wear_count anonymous execution denial: HTTP 401 - permission denied for function increment_wear_count
[PASS] Layer 2 | anon | create_reservation_multi_idempotent anonymous execution denial: HTTP 401 - permission denied for function create_reservation_multi_idempotent

--- Persona: Authenticated Customer ---
[PASS] Layer 2 | customer | Own profile read access: HTTP 200 - Retrieved own profile record
[PASS] Layer 2 | customer | Own profile and measurement RPC update: HTTP 200 - Profile and measurements updated successfully
[PASS] Layer 2 | customer | Other-user private row read denial: HTTP 200 - Rows visible: 0
[PASS] Layer 2 | customer | Direct table write to reservations fails closed: HTTP 403 - new row violates row-level security policy for table "reservations"
[PASS] Layer 2 | customer | Reservation command authorization verified safely (zero residual state): HTTP 400 - Execution authorized, validated cleanly (A reservation must contain at least one item.)
[PASS] Layer 2 | customer | Customer state restored and verified (zero residual state): HTTP 200 - Pre-probe profile and measurement state restored cleanly

--- Persona: Authenticated Staff ---
[PASS] Layer 2 | staff | Representative inventory manager read access: HTTP 200 - Retrieved inventory variant stock records
[PASS] Layer 2 | staff | Owner-only action denial (announcements mutation): HTTP 403 - new row violates row-level security policy for table "announcements"

============================================================
PERSONA RLS & PRIVILEGE VERIFICATION SUMMARY
============================================================
  [*] [DEFERRED] Layer 1 | system | Direct catalog SQL probe
      L-- Deferred to direct database runner (non-REST catalog probe)
  [+] [PASS] Layer 2 | anon | Public catalog read access
      L-- HTTP 200 - Catalog readable
  [+] [PASS] Layer 2 | anon | Private table user_measurements read denial
      L-- HTTP 200 - Rows returned: 0
  [+] [PASS] Layer 2 | anon | Private table devices read denial
      L-- HTTP 200 - Rows returned: 0
  [+] [PASS] Layer 2 | anon | increment_wear_count anonymous execution denial
      L-- HTTP 401 - permission denied for function increment_wear_count
  [+] [PASS] Layer 2 | anon | create_reservation_multi_idempotent anonymous execution denial
      L-- HTTP 401 - permission denied for function create_reservation_multi_idempotent
  [+] [PASS] Layer 2 | customer | Own profile read access
      L-- HTTP 200 - Retrieved own profile record
  [+] [PASS] Layer 2 | customer | Own profile and measurement RPC update
      L-- HTTP 200 - Profile and measurements updated successfully
  [+] [PASS] Layer 2 | customer | Other-user private row read denial
      L-- HTTP 200 - Rows visible: 0
  [+] [PASS] Layer 2 | customer | Direct table write to reservations fails closed
      L-- HTTP 403 - new row violates row-level security policy for table "reservations"
  [+] [PASS] Layer 2 | customer | Reservation command authorization verified safely (zero residual state)
      L-- HTTP 400 - Execution authorized, validated cleanly (A reservation must contain at least one item.)
  [+] [PASS] Layer 2 | customer | Customer state restored and verified (zero residual state)
      L-- HTTP 200 - Pre-probe profile and measurement state restored cleanly
  [+] [PASS] Layer 2 | staff | Representative inventory manager read access
      L-- HTTP 200 - Retrieved inventory variant stock records
  [+] [PASS] Layer 2 | staff | Owner-only action denial (announcements mutation)
      L-- HTTP 403 - new row violates row-level security policy for table "announcements"
------------------------------------------------------------
Total: 14 | Passed: 13 | Failed: 0 | Deferred: 1
============================================================
```

---

## 4. Cross-Repository Quality Gates & Pull Requests

### Mobile App (`jezsy-mobile-app`)
- **PR #278**: [feat/b6-schema-governance-and-rls](https://github.com/carvele/jezsy-mobile-app/pull/278) -> Merged as `c64d91526e2df24425eedabb223b40591bc63a6e`
- **PR #279**: [fix(security): implement authenticated persona probes and deferred accounting in RLS harness (B6-e)](https://github.com/carvele/jezsy-mobile-app/pull/279) -> Merged as `1b93f6c`
- **PR #280**: [fix(security): snapshot and restore customer profile state in RLS harness (B6-e)](https://github.com/carvele/jezsy-mobile-app/pull/280) -> Merged as `fb67c61`
- **PR #281**: [fix(security): remove credential fallbacks and add secret governance guard (B6-e)](https://github.com/carvele/jezsy-mobile-app/pull/281) -> Merged as `3667713`
- **Quality Gates**:
  - `npx tsc --noEmit` -> **0 errors**
  - `npm run lint` -> **0 errors**
  - `npm test` -> **41 suites passed, 324 tests passed** (including `secretGovernance.test.ts`)
  - `scripts/security/verify_persona_rls.py` -> **13/13 automated probes passed (100%), 1 deferred, 0 failed, 0 residual modifications**
  - GitHub Actions CI Run PR #278: [`34640732409`](https://github.com/carvele/jezsy-mobile-app/actions/runs/34640732409/job/103399460882) (**PASSED** in 1m44s)
  - GitHub Actions CI Run PR #279: [`34643289177`](https://github.com/carvele/jezsy-mobile-app/actions/runs/34643289177/job/103407943712) (**PASSED** in 1m14s)
  - GitHub Actions CI Run PR #280: [`34644081589`](https://github.com/carvele/jezsy-mobile-app/actions/runs/34644081589/job/103410548545) (**PASSED** in 1m46s)
  - GitHub Actions CI Run PR #281: [`34645809961`](https://github.com/carvele/jezsy-mobile-app/actions/runs/34645809961/job/103416194273) (**PASSED** in 1m41s)

### Admin Dashboard (`admin-dashboard`)
- **PR #131**: [feat/b6-admin-contracts-and-governance](https://github.com/carvele/admin-dashboard/pull/131) -> Merged as `2db84b8730ade884249778873277809b008c9b2c`
- **Quality Gates**:
  - `npm run check:migrations` -> **PASS**
  - `npm run type-check` -> **0 errors**
  - `npm run lint` -> **0 errors** (92 stylistic warnings)
  - `npm test` -> **29 suites passed, 217 tests passed** (including AST contract verification and migration governance suites)
  - `npm run build` -> **Built successfully in 5.32s**
  - GitHub Actions CI Run: [`34640712331`](https://github.com/carvele/admin-dashboard/actions/runs/34640712331/job/103399398276) (**PASSED** in 1m11s)

---

## 5. Formal Phase Status

```text
============================================================
PHASE B6 — CONTRACTS, RLS VERIFICATION & SCHEMA OWNERSHIP
============================================================

B6-a  Inventory & Audit Baseline
  ✅ COMPLETE & FROZEN (docs/audits/b6-schema-contracts-inventory.md)

B6-b  Governance Architecture & Design Freeze
  ✅ COMPLETE & FROZEN (docs/audits/b6-design-freeze.md)

B6-c  Migration History Reconciliation & Governance Remediation
  ✅ VERIFIED & MERGED — PR #131 & PR #278
  ✅ ADMIN MIGRATIONS RETIRED & RELOCATED
  ✅ MOBILE CANONICAL LINEAGE CODIFIED
  ✅ CI GUARDS ACTIVE

B6-d  Cross-Repo Generated-Type & Contract Synchronization
  ✅ VERIFIED & MERGED — PR #131
  ✅ B6-RPC-DEFECT-001 PURGED
  ✅ SINGLE-SOURCE TYPE PARITY ESTABLISHED (Git SHA 8d1a7f1)
  ✅ AST RPC CONTRACT TEST ACTIVE (21/21 CALL SITES VERIFIED)

B6-e  RLS & Function Privilege Verification & Live Gate
  ✅ AUTHORIZED & APPLIED TO LIVE SUPABASE
  ✅ B6-GRANT-LEAK-001 REMEDIATED (anon EXECUTE -> false)
  ✅ B6-SECRET-EXPOSURE-001 REMEDIATED (credentials rotated, fallbacks removed, fail-closed enforced, CI secret scanning added)
  ✅ MULTI-PERSONA verify_persona_rls.py COMMITTED & MERGED (PR #279, #280, #281)
  ✅ 13/13 AUTOMATED PROBES PASS (100%), 0 FAIL, 1 DEFERRED
  ✅ PRE-PROBE SNAPSHOT RESTORATION VERIFIED (ZERO RESIDUAL DATABASE STATE)
  ✅ 48/48 PUBLIC TABLES UNDER RLS (100%)
  ✅ 92/92 SECURITY DEFINER FUNCTIONS PINNED (100%)

B6-f  Cross-Repo Verification Ledger & Phase Closure
  ✅ VERIFIED AGAINST LIVE DATABASE & BOTH MAIN BRANCHES
  ✅ ALL FIVE PRS MERGED TO MAIN WITH PASSING CI EVIDENCE
  ✅ PHASE B6 FORMALLY CLOSED & FROZEN 🧊
============================================================
```
