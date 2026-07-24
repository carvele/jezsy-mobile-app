# Backend & Database Security Audit — JezSy

Date: 2026-07-23. Structural audit of the shared Supabase backend (project `wufcmtndotfvxvvxkamv`) as consumed by this mobile app. Scope: schema, RLS policies, functions/triggers, storage buckets, auth config, and client key handling. **No customer row data was read; no credential value was accessed or printed.** Audit only — nothing was changed.

Companion to the prior `DB_AUDIT_2026-07-20.md` / `DB_TABLE_AUDIT_2026-07-20.md` (data-integrity focus). This pass is security-focused.

## What was and was not inspected

- **Inspected (metadata only):** 34 public tables, all RLS policies, 20+ functions and their definitions, all non-internal triggers, 5 storage buckets and their object policies, Supabase security/performance advisors, and mobile-app client code for key/redirect usage.
- **Not inspected:** actual row contents of any table; Supabase Auth dashboard settings that are not exposed to tooling (Site URL, redirect allow-list, email templates — flagged where relevant); the separate `admin-dashboard` repo (see item L-7 / next steps).

## Severity summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| H-1 | **High** | Orphaned `SECURITY DEFINER` reservation RPC bypasses RLS with client-controlled pricing and no auth check | `create_reservations_from_cart()` |
| M-1 | Medium | Account-enumeration RPC callable by anon | `check_email_exists()` |
| M-2 | Medium | `SECURITY DEFINER` functions with mutable `search_path` | 10 functions |
| M-3 | Medium | Message UPDATE policy lets either party edit the counterparty's messages | `messages` RLS |
| M-4 | Medium | `chat-images` bucket is public — private chat photos world-readable by URL | storage |
| M-5 | Medium | `approve_device` trigger auto-approves every device, defeating the approval gate | `devices` trigger |
| M-6 | Medium | Leaked-password protection disabled | Auth config |
| L-1 | Low | `wardrobe-images` bucket public | storage |
| L-2 | Low | `USING (true)` on UPDATE policies (gated by WITH CHECK, linter-flagged) | 4 tables |
| L-3 | Low | `inventory` and `stock_movements` are anon-readable | RLS |
| L-4 | Low | Privileged-column protection on `profiles` is trigger-only; `deleted` not covered | `profiles` |
| L-5 | Low | `.gitignore` env pattern leaves some `.env.*` variants trackable | `.gitignore` |
| L-6 | Low | Several trigger/util `SECURITY DEFINER` functions directly RPC-callable by anon | functions |
| L-7 | Info | `create_reservation` is SECURITY INVOKER but reservation INSERT is admin-only (likely blocks customer reservations) | correctness |
| L-8 | Info | Password-reset deep link must be in the Auth redirect allow-list (known 404) | Auth config |
| L-9 | Info | Admin-dashboard shares this DB and holds the staff/admin roles the entire RLS model trusts | cross-repo |

**Overall posture is solid on the highest-risk axis:** every one of the 34 public tables has RLS **enabled**, and the per-user policies (`auth.uid() = user_id`) are correct and consistent across `wardrobe_items`, `wishlists`, `capsules`, `user_measurements`, `saved_outfits`, `notifications`, `orders`, `reservations`, and `conversations`/`messages`. No table leaks a full user list via the anon key. The findings below are targeted gaps, not a broken model.

---

## High

### H-1 — `create_reservations_from_cart()` bypasses RLS with client-supplied prices

- **What:** This function is `SECURITY DEFINER` (runs as owner, bypassing RLS), has **no `auth.uid() IS NULL` check**, does **not** set `search_path`, and inserts reservation rows using `rental_price` and `deposit` taken **directly from the client-supplied `_items` JSON** — it never reads the real price from `products`.
- **Why it matters:** The `reservations` INSERT policy is deliberately "admin only" (`is_admin_or_owner()`). This function is an RLS bypass around that. Anyone holding the public anon key can `POST /rest/v1/rpc/create_reservations_from_cart` and insert reservations at **any price they choose**, without authenticating. This is the same price-trust bug class already fixed elsewhere this month — but here it is worse because it is unauthenticated and RLS-bypassing.
- **Mitigating fact:** The app does **not** call this function. The live reservation path is `create_reservation` (singular), which is correctly written (auth-gated, server-side price recompute, receipt-ownership check). `DB_IMPLEMENTATION_PLAN.md` already lists `create_reservations_from_cart` as a dead object slated for removal.
- **Recommendation:** Drop the function, or at minimum `REVOKE EXECUTE ... FROM anon, authenticated`. An unused, unauthenticated, RLS-bypassing, price-trusting RPC is live attack surface regardless of whether the app calls it. This is the single most important item.

---

## Medium

### M-1 — `check_email_exists()` enables account enumeration by anonymous callers

- **What:** `SECURITY DEFINER`, callable by `anon` via `/rest/v1/rpc/check_email_exists`. Returns a boolean of whether an email exists in `auth.users`. Called from `app/(auth)/auth.tsx` (5 call sites) to give "email already registered" UX.
- **Why it matters:** Anyone can probe arbitrary emails to learn which are registered — a classic enumeration primitive that aids credential-stuffing and phishing targeting.
- **Recommendation:** This is a deliberate UX trade-off, so treat as a risk-acceptance decision. If retained, rate-limit it (e.g. via an edge function) rather than exposing it as a raw table-reading RPC; the current form has no throttling. At minimum, confirm this exposure is intended.

### M-2 — `SECURITY DEFINER` functions without a fixed `search_path`

- **What:** Advisor lint `0011`. Ten functions run `SECURITY DEFINER` (or as triggers) with a role-mutable `search_path`: `handle_new_user`, `check_email_exists`, `is_admin_or_owner`, `check_profile_updates`, `update_staff_status`, `log_staff_status_change`, `approve_device`, `update_product_rating`, `prevent_stock_movement_updates`, `create_reservations_from_cart`.
- **Why it matters:** A `SECURITY DEFINER` function with a mutable `search_path` can be hijacked if an attacker can create an object (table/function) in a schema that resolves earlier on the path — the definer's elevated privileges then execute attacker-chosen code. `is_admin_or_owner` and `check_profile_updates` are especially sensitive since they gate authorization.
- **Recommendation:** Add `SET search_path = public, pg_temp` (or `= ''` with fully-qualified names) to each. `create_order`, `create_reservation`, `is_staff_or_admin`, `notify_order_status_change`, and `sync_product_stock` already do this — apply the same to the rest.

### M-3 — `messages` UPDATE policy allows editing the other party's messages

- **What:** Policy "Users can update their messages or mark as read" (UPDATE, `authenticated`) uses `USING` = *is this message in a conversation I belong to (or am I admin)* — it does **not** require `sender_id = auth.uid()`, and there is **no `WITH CHECK`**.
- **Why it matters:** A customer can update **any** message row in their own conversation, including editing the `text` or `reactions` of messages the staff/admin sent (and vice-versa). The policy name implies "their messages" but the predicate does not enforce sender ownership.
- **Recommendation:** Split intent: allow full edit only when `sender_id = auth.uid()`, and restrict the "mark as read" case to the specific columns (`read_at`) via a `WITH CHECK` that forbids changing `text`/`sender_id`. If free editing of counterparty messages is genuinely intended for staff, scope that to the admin branch only.

### M-4 — `chat-images` bucket is public

- **What:** `storage.buckets.chat-images.public = true`. Upload is correctly restricted to the owner's folder (`(storage.foldername(name))[1] = auth.uid()`), but **read is unauthenticated** because the bucket is public.
- **Why it matters:** Images shared inside a private customer↔staff conversation are readable by anyone who obtains (or guesses/leaks) the object URL — no session required. Chat attachments can contain personal or sensitive content.
- **Recommendation:** Make the bucket private and serve chat images through signed URLs, with a read policy mirroring the message-visibility rule (participant or staff/admin only).

### M-5 — `approve_device` trigger auto-approves every inserted device

- **What:** `approve_device_trigger` is `BEFORE INSERT ON devices` and unconditionally sets `NEW.status := 'approved'`, overriding the column default of `'pending'`.
- **Why it matters:** The `devices` table (fingerprint, `failed_attempts`, `lockout_until`, `login_history`, `staff_email`) is a staff device-trust control used by the admin dashboard. This trigger makes every new device immediately trusted, silently nullifying any "pending → manual approval" gate. Insert is limited to staff/admin by RLS, so blast radius is the staff surface, but the security control it appears to implement is inert.
- **Recommendation:** Confirm intent with the admin-dashboard owner. If device approval is meant to be a real gate, the trigger should not force `approved`. This lives in admin-dashboard territory — flag, don't fix here.

### M-6 — Leaked-password protection disabled

- **What:** Advisor `auth_leaked_password_protection`. Supabase's HaveIBeenPwned check is off.
- **Why it matters:** Users can set known-breached passwords, raising credential-stuffing success rates.
- **Recommendation:** Enable in Auth → Policies (dashboard setting, not SQL). Noted as pending in `DB_IMPLEMENTATION_PLAN.md`.

---

## Low / Informational

- **L-1 — `wardrobe-images` bucket public.** Same shape as M-4 but lower sensitivity (a user's own wardrobe photos). Upload is folder-scoped; read is public-by-URL. Consider private + signed URLs.
- **L-2 — `USING (true)` on UPDATE policies** for `categories`, `color_list`, `pattern_list`, `products` (advisor `0024`). Each pairs `USING (true)` with an admin-only `WITH CHECK`, so a non-admin's UPDATE still fails the check — **not currently exploitable**. But `USING (true)` is fragile: it relies entirely on `WITH CHECK` never being dropped, and it lets non-admins target any row for update attempts. Tighten `USING` to the same admin predicate for defense-in-depth.
- **L-3 — `inventory` and `stock_movements` are anon-readable** (`SELECT USING (true)` to `public`). Stock levels/SKUs and the full stock-movement audit trail are readable without authentication. Likely acceptable for a storefront, but confirm the movement history isn't considered internal.
- **L-4 — `profiles` privileged-column protection is trigger-only.** The UPDATE policy is just `auth.uid() = id` (no column restriction); role/employment/block escalation is blocked by the `check_profile_updates` trigger, which is correct and effective. Note the trigger does **not** cover `deleted` — a user can set their own `profiles.deleted = true`, which only self-locks (since `is_staff_or_admin` requires `deleted = false`), so impact is self-harm only. Consider covering `deleted` too, or enforcing column immutability in the policy.
- **L-5 — `.gitignore` env coverage.** Ignores `.env` and `.env*.local` but not variants like `.env.production` (no `.local` suffix). No env file is currently tracked (`git ls-files` shows only `.env.example`, which holds empty placeholders), so this is preventative. Broaden to `.env*` (keeping `!.env.example`).
- **L-6 — Directly RPC-callable trigger/util `SECURITY DEFINER` functions.** `sync_product_stock`, `trg_sync_product_stock_from_inventory`, `notify_order_status_change`, `notify_reservation_status_change`, `update_user_streak`, `is_admin_or_owner`, `is_staff_or_admin` are all reachable via `/rpc/`. The auth/role gates make them low-impact (the `notify_*`/`trg_*` ones error when called outside a trigger; the `is_*` ones just report the caller's own role; `sync_product_stock` only recomputes derived stock). Still, `REVOKE EXECUTE FROM anon, authenticated` on the ones not meant to be called directly reduces surface.
- **L-7 (Info) — `create_reservation` vs. RLS.** The live reservation function is `SECURITY INVOKER` (`prosecdef = false`) yet the `reservations` INSERT policy is admin-only. A customer invoking it should be blocked by RLS at the INSERT. Either reservations are effectively un-creatable by customers (a functional bug — the table has 0 rows) or the function is intended to be `SECURITY DEFINER`. **Verify the customer reservation flow actually succeeds end-to-end.** This is correctness, not a hole (it fails closed).
- **L-8 (Info) — Password-reset redirect.** The app calls `resetPasswordForEmail(email, { redirectTo: Linking.createURL('reset-password') })` → `jezsymobileapp://reset-password` (dev build) / `exp://…` (Expo Go). The known reset-link 404 is a Supabase Auth **dashboard** config issue: the deep-link scheme must be present in the redirect allow-list and Site URL. Not visible to tooling — verify by hand in Auth → URL Configuration.
- **L-9 (Info) — Shared admin-dashboard trust boundary.** Every staff/admin RLS branch (`is_staff_or_admin()`, `is_admin_or_owner()`) is only as strong as the protection of the accounts carrying those roles, which are administered from the separate `admin-dashboard` repo (github.com/carvele/admin-dashboard). That repo is a first-class consumer of this same database and warrants its own equivalent audit — in particular: where it runs the service-role key (must be server-side only, never shipped in a client bundle), and whether any of its flows assume a restriction not actually enforced by the RLS above. Not covered in this pass.

## Client key handling (section 4 result)

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` is the only Supabase key referenced in mobile client code. `SUPABASE_SERVICE_ROLE_KEY` appears only in `.env.example` (empty placeholder) and in `supabase/functions/notify-status/index.ts` (an edge function — server-side, correct). No service-role reference in `app/`. **Clean.**
- `.env` is not tracked; only `.env.example` with empty values is committed. **Clean** (see L-5 for the pattern-hardening nit).

## Suggested remediation order

1. **H-1** — drop / revoke `create_reservations_from_cart` (unauthenticated RLS bypass).
2. **M-3, M-4** — fix the message-edit policy and privatize `chat-images` (real data-tampering / privacy exposure).
3. **M-2** — pin `search_path` on the remaining `SECURITY DEFINER` functions.
4. **M-6** — toggle leaked-password protection (one dashboard switch).
5. **M-1, M-5** — decide/confirm intent on email-enumeration and device auto-approval.
6. Low items as hygiene; L-7 and L-8 as functional verifications; L-9 as a separate audit.
