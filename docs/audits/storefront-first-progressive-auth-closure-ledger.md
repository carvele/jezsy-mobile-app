# Storefront-First Progressive Commitment & Guest Browsing: Comprehensive Closure Ledger

**Document ID**: `AUTH-PROG-CLOSE-20260915-V1`  
**Target Environment**: Supabase Production / Shared Live Database (`wufcmtndotfvxvvxkamv`)  
**Repositories**: `carvele/jezsy-mobile-app`, `carvele/admin-dashboard`  
**Status**: **VERIFIED / CLOSED**  
**Date**: September 15, 2026  
**Pull Requests**:
- PR #346 (`feat/storefront-first-progressive-auth`) — Merge commit `fc07736`
- PR #347 (`fix/reservation-staff-isolation-bypass`) — Merge commit `8170a09`

---

## 1. Executive Summary

The **Storefront-First Progressive Commitment Model and Guest Browsing Architecture** transforms JezSy's entry model from a rigid login-gated entry to an industry-standard progressive commitment experience. Merchandise is the front door: unauthenticated guests launch directly into product discovery on the storefront (`/(tabs)`), while authentication is requested only when performing identity-dependent actions.

The implementation and verification strictly satisfy all frozen architectural contracts:
1. **Storefront-First Launch**: Unauthenticated shoppers with completed onboarding land directly on `/(tabs)`. No forced Welcome or Sign-in screen.
2. **Pure Binary Identity**: `session != null` $\rightarrow$ Authenticated account; `session == null` $\rightarrow$ Anonymous storefront shopper. Zero synthetic guest accounts or pseudo-profiles are created.
3. **Intent-Based Soft Auth**: Private and transactional actions (Wishlist, Reserve Now, Ask Boutique Staff, Write Review, Save Wardrobe) trigger soft-auth modals explaining member privileges.
4. **Context Preservation**: Post-authentication and onboarding seamlessly resume user intent via strictly allowlisted `AuthReturnTarget` (15m TTL) and `PendingEntryTarget` (24h TTL).
5. **Sanitized Availability Projection**: Public view `product_variants` exposes boolean availability (`is_available`, `is_low_stock`, `stock_status`) with zero operational numeric stock counts. Direct `SELECT` on raw `inventory` and `settings` is locked down.
6. **Airtight Staff Transactional Isolation**: Staff, admin, and owner identities are blocked with SQLSTATE `42501` across all customer reservation and review creation entry points (`create_reservation`, `create_reservation_multi`, `create_reservation_multi_idempotent`, and `submit_verified_review`).

---

## 2. Deployed Migrations & Rollback Scripts

### 2.1 Primary Architecture Migration
- **Migration File**: `supabase/migrations/20260914220000_progressive_auth_sanitized_projections.sql`
- **Rollback File**: `supabase/migrations/20260914220000_progressive_auth_sanitized_projections.sql.rollback`
- **Scope**:
  - Drops public reads from raw `inventory` and `settings`.
  - Creates sanitized `public.product_variants` view projecting `id, product_doc_id, size, color, hex_color, pattern, sku, is_available, is_low_stock, stock_status`.
  - Creates `public.get_public_store_setting(text)` SECURITY DEFINER RPC with strict key allowlist (`boutique_hours`, `store_contact`, `announcement_banner`).
  - Hardens `public.create_reservation` with staff transactional isolation (42501).
  - Hardens `public.submit_verified_review` and `public.reviews` INSERT RLS policy with staff/customer role checks (42501).
  - Restricts `public.conversations` INSERT policy to customer role or staff acting for non-self.

### 2.2 Bypass Hardening Migration
- **Migration File**: `supabase/migrations/20260915071500_harden_idempotent_reservation_staff_isolation.sql`
- **Rollback File**: `supabase/migrations/20260915071500_harden_idempotent_reservation_staff_isolation.sql.rollback`
- **Scope**:
  - Hardens `public.create_reservation_multi` to reject staff/admin/owner accounts acting as customers with SQLSTATE `42501`.
  - Hardens `public.create_reservation_multi_idempotent` with early SQLSTATE `42501` check before advisory locks or idempotency checks.
  - Preserves authorized boutique staff capability (`can_operate_reservations() = true`) to create walk-in reservations for actual customers in `admin-dashboard` via `_customer_id`.

---

## 3. Live Database Probes & Role Assertions

All assertions were executed against the live shared Supabase production database:

| Action / Query Tested | Role Tested | Parameters | Expected Output | Live DB Result | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `SELECT * FROM inventory` | `anon` | None | 0 rows | **0 rows returned** | **PASS** |
| `SELECT * FROM inventory` | `customer` | None | 0 rows | **0 rows returned** | **PASS** |
| `SELECT * FROM inventory` | `staff` / `admin` | None | Raw inventory data | Operational counts returned | **PASS** |
| `SELECT * FROM product_variants` | `anon` | None | Sanitized rows, boolean flags, zero numeric counts | **220 active variants returned**, `is_available` boolean, no `available` numeric count | **PASS** |
| `SELECT * FROM settings` | `anon` | None | 0 rows | **0 rows returned** | **PASS** |
| `SELECT * FROM settings` | `customer` | None | 0 rows | **0 rows returned** | **PASS** |
| `SELECT get_public_store_setting('store_contact')` | `anon` | Allowlisted key | Setting JSON | Returned non-sensitive setting | **PASS** |
| `SELECT get_public_store_setting('secret_key')` | `anon` | Disallowed key | NULL | NULL returned | **PASS** |
| `create_reservation(...)` | `staff` / `admin` | Self | SQLSTATE 42501 | **42501**: "Staff accounts cannot create customer reservations" | **PASS** |
| `create_reservation_multi(...)` | `staff` / `admin` | Self (`_customer_id = NULL`) | SQLSTATE 42501 | **42501**: "Staff accounts cannot create customer reservations" | **PASS** |
| `create_reservation_multi_idempotent(...)` | `staff` / `admin` | Self (`_customer_id = NULL`) | SQLSTATE 42501 | **42501**: "Staff accounts cannot create customer reservations" | **PASS** |
| `create_reservation_multi_idempotent(...)` | `customer` | Self | Allowed (proceeds to stock check) | **Allowed** (passes auth/isolation check) | **PASS** |
| `create_reservation_multi(..., _customer_id)` | `staff` (`admin-dashboard`) | Valid Customer UUID | Allowed through `can_operate_reservations()` | **Allowed** (passes auth/isolation check) | **PASS** |
| `submit_verified_review(...)` | `staff` / `admin` | Self | SQLSTATE 42501 | **42501**: "Staff accounts cannot submit customer reviews" | **PASS** |
| `INSERT INTO reviews` | `staff` / `admin` | Direct SQL | RLS violation | Blocked by RLS policy | **PASS** |
| Alternative Review Creation RPCs | N/A | Public schema routines | Zero alternative RPCs | **Verified**: `submit_verified_review` is the only RPC | **PASS** |

---

## 4. Client Layer Architecture & Guarantees

### 4.1 Navigation & Deep-Link Route Matrix
- **Root Layout (`app/_layout.tsx`)**:
  - Anonymous visitor with `onboardingSeen == true` $\rightarrow$ Routes to `/(tabs)`.
  - External deep links $\rightarrow$ Validated against `ALLOWED_ENTRY_ROUTES` (`/product/[id]`, `/product/reviews`, `/explore`, `/cart`, `/brand/...`, `/category/...`).
  - Private deep links (`/reserve/[id]`, `/messages`, `/messages/[id]`) $\rightarrow$ Rejected from cold entry.
  - One-shot atomic intent consumption (`consumeAuthReturnTarget`, `consumePendingEntryTarget`) branches directly to action-specific resumption targets:
    - **Wishlist**: `/product/[id]` + idempotent `ensureWishlisted(productId)` call.
    - **Reserve**: `/reserve/[id]` with variant prefilled for customer review & confirmation.
    - **Message**: `getOrCreateConversation()` $\rightarrow$ `/messages/[conversationId]` with product context attached.
    - **Review**: Server eligibility check $\rightarrow$ `/product/reviews` form (opened only if purchase verified).
    - **Tabs**: Returns customer to the active tab (Profile, Wardrobe, Messages).

### 4.2 Canonical Cart Model (`src/utils/cartMerge.ts`, `src/context/CartContext.tsx`)
- All cart items require canonical `variantId: string` matching `public.product_variants.id`.
- Transparent fallback migration parser for legacy display-string keys (`productId:size:color`).
- Guest-to-authenticated merge reconciles quantities, respects maximum thresholds, and persists to user storage upon sign-in.

### 4.3 Realtime Channel Teardown
- `AuthContext.signOut()` issues `supabase.removeAllChannels()` and purges private caches.
- Full subscription inventory audited:
  - `notifications` $\rightarrow$ private, user-scoped
  - `messages` $\rightarrow$ private, user-scoped
  - `presence` $\rightarrow$ private, user-scoped
  - `typing` $\rightarrow$ private, user-scoped
  - Zero anonymous/public realtime listeners exist across the entire codebase.

---

## 5. Verification Suite & CI Results

- **TypeScript Typecheck**: `npx tsc --noEmit` $\rightarrow$ **0 errors**
- **Linter**: `npm run lint` (`expo lint`) $\rightarrow$ **0 errors, 0 warnings**
- **Test Suite**: `npm test` $\rightarrow$ **55 / 55 suites passed (435 / 435 unit and integration tests)**
- **GitHub Pull Requests**:
  - PR #346 (`feat/storefront-first-progressive-auth`) merged to `main` (`fc07736`)
  - PR #347 (`fix/reservation-staff-isolation-bypass`) merged to `main` (`8170a09`)
- **Git State**: Local `main` branch fully synchronized at commit `8170a09`.

---

## 6. Formal Closure Declaration

```text
================================================================================
JEZSY STOREFRONT-FIRST PROGRESSIVE COMMITMENT & GUEST BROWSING ARCHITECTURE
STATUS: VERIFIED / CLOSED
================================================================================
Storefront-first launch:               VERIFIED (PR #346)
Anonymous catalog browsing:            VERIFIED (PR #346)
No synthetic guest identity:           VERIFIED (PR #346)
Null-session provider safety:          VERIFIED (PR #346)
Soft authentication modals:            VERIFIED (PR #346)
Auth intent & target preservation:     VERIFIED (PR #346)
Public deep-link allowlisting:         VERIFIED (PR #346)
Sanitized product_variants projection: VERIFIED (PR #346)
Numeric stock count isolation:         VERIFIED (PR #346)
Public settings RPC allowlist:         VERIFIED (PR #346)
Canonical variantId cart model:        VERIFIED (PR #346)
Private state & realtime purge:        VERIFIED (PR #346)
create_reservation staff isolation:    VERIFIED (PR #346)
create_reservation_multi isolation:    VERIFIED (PR #347)
create_reservation_multi_idempotent:   VERIFIED (PR #347)
Staff walk-in reservation delegation:  VERIFIED & AUTHORIZED (PR #347)
submit_verified_review isolation:      VERIFIED (PR #346)
Zero review creation bypasses:         VERIFIED (PR #346)
================================================================================
```
