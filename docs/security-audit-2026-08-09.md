# JezSy security and correctness audit

**Date:** 2026-08-09  
**Audited revision:** `origin/main` @ `e981948` (jezsy-mobile-app), `e3ea72b` (admin-dashboard)  
**Supabase project:** `wufcmtndotfvxvvxkamv` (shared live production, no staging)

> Working notes, not a committed artifact. Per `CLAUDE.md`, docs are not auto-committed.

---

## Executive summary

A multi-agent audit covering the mobile app, all 113 Supabase migrations, 3 edge functions, and the
sibling admin-dashboard repo produced **58 candidate findings**. Each was then handed to an
independent agent instructed to *refute* it, defaulting to "refuted" when uncertain. **40 survived**;
**18 were killed** as already-fixed, unreachable, or intentional.

| Severity | Confirmed |
|---|---|
| Critical | 2 |
| High | 10 |
| Medium | 16 |
| Low | 12 |
| **Total** | **40** |

Both critical findings were additionally verified by hand against the live database after the audit
completed, by querying `has_function_privilege` and reading the deployed `pg_proc.prosrc` body. Both hold.

### The two things that matter most

1. **Staff cannot process any reservation.** A `REVOKE` and an INVOKER trigger that depends on it shipped
   in the same migration. Every direct write to `reservations` touching `status`/`date`/`appointment_time`
   fails with `42501` for the Owner, and silently updates zero rows for Staff. One-line fix, ship it alone.
2. **The `profiles.deleted` guard was silently dropped** by a rewrite nine days after it was added. Any
   staff account can soft-delete the sole Owner, or a soft-deleted account can restore itself.

---

## Method

Nine parallel review agents, each scoped to one dimension and seeded with project context (reserve-and-collect
not rental, the retired orders flow, the shared live DB, the two-role model) plus the five bug patterns that
have genuinely shipped in this codebase, so the severity bar was calibrated to real defects rather than lint.

Each candidate finding then went to a dedicated adversarial verifier that opened the actual file, checked for
a later migration that already fixed it, a guard elsewhere, an unreachable precondition, or a documented
deliberate tradeoff. Verifiers were told a false positive costs more than a missed nit.

**Cost:** 68 agents, 5.5M tokens, 1375 tool calls, 2.2h wall clock.

### Findings by dimension

| Dimension | Confirmed |
|---|---|
| Migrations / RLS security | 7 |
| Mobile utils/context/hooks | 6 |
| Admin dashboard correctness | 6 |
| Mobile screens | 5 |
| Cross-repo consistency | 4 |
| Edge functions + payments | 4 |
| Mobile auth + session | 4 |
| Mobile reserve/cart/inventory | 4 |
| Admin dashboard **security** | **agent crashed — 0, see gaps** |

---

## Coverage gaps

Recorded explicitly so the confirmed-findings list is not mistaken for full coverage.

### The admin-dashboard security dimension did not run

That agent died mid-response (`API Error: Connection closed mid-response`) and returned nothing. The
admin-dashboard *correctness* agent completed normally and its findings are included, but the following
were **never checked in either repo**:

- **Service-role key exposure.** The admin app is Vite: anything in an `import.meta.env.VITE_*` var is
  baked into the public client bundle. A service-role key there would grant full RLS-bypassing DB access
  to anyone opening devtools. This was the single highest-value check in that dimension and it did not run.
- Client-side-only role gating (a hidden button is not authorization).
- Staff-vs-Owner privilege escalation paths.
- PostgREST filter injection via string-built `.or()` / `.filter()` calls.
- XSS via `dangerouslySetInnerHTML` or unsanitised customer-supplied content.

**This dimension should be re-run before the audit is considered complete.**

### Not attempted anywhere in this audit

- **Nothing was executed.** No test suite exists, no device run, no end-to-end transaction. Every finding
  is static reading plus live-DB introspection. Race conditions were reasoned about, not reproduced.
- **PayMongo webhook authenticity** — signature verification, replay protection, and idempotency of the
  paid handler. Only the unknown-session path was audited.
- **Storage** — RLS on `storage.objects`, receipt-upload scoping, chat-image access, signed-URL lifetimes,
  and retention of body-scan imagery.
- **Supabase Auth configuration** — session TTL, refresh-token rotation, leaked-password protection, MFA,
  OTP settings. These live outside migrations, and the offboarding cluster hinges on credential lifetime.
- **Most of the admin dashboard** — only a handful of its pages and services were read at all.
- **~100 of the 113 migrations** were not closely reconciled against the deployed schema, and
  `src/types/database.types.ts` was not diffed against live. One finding already proves file-vs-live drift
  is real, so a `db push` may skip a migration it believes is applied.
- **Not run:** Supabase security/performance advisors, dependency and secrets scanning, index/query-plan
  review, push notifications, deep links beyond the recovery URL, native-module permission handling,
  and iOS behaviour generally (no committed `ios/`).

### A note on method

Agents ran probes against the **live production database** to confirm findings, using rolled-back
transactions. Post-audit state was checked and matches what the agents described as pre-existing
(1 soft-deleted profile, 1 admin/owner, 5 reservations, `sum(reserved) = 0`) — no residue. Worth knowing
that the audit touched production read paths at all.

---

## Confirmed findings


### CRITICAL

#### F1. REVOKE on assert_bookable_slot breaks every staff-side reservation write (42501)

- **Location:** `supabase/migrations/20260807145048_extract_assert_bookable_slot.sql:113` _(migrations)_
- **Severity:** critical
- **Found by:** Migrations / RLS security

**What is wrong**

Line 113 does `REVOKE ALL ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) FROM authenticated;`. But the same migration (lines 89-109) rewrites `validate_reservation_time()` to delegate to it:

  PERFORM public.assert_bookable_slot(NEW.date::date, NEW.appointment_time, ...)

`validate_reservation_time()` is SECURITY INVOKER (verified live: `prosecdef = false`), and it is wired as `CREATE TRIGGER trg_validate_reservation_time BEFORE INSERT OR UPDATE OF date, appointment_time, status, deleted ON public.reservations`. A nested function call inside a plpgsql body is a normal call and requires EXECUTE by the *current* user, so any DML on `reservations` performed by a role-`authenticated` session (i.e. a staff/admin login in the admin-dashboard, which uses the anon key + user JWT) hits a permission error before the trigger can do anything.

Verified live on project wufcmtndotfvxvvxkamv:
  - has_function_privilege('authenticated', assert_bookable_slot, 'EXECUTE') = false
  - `SET ROLE authenticated; SELECT public.assert_bookable_slot(null,null);` -> ERROR 42501 permission denied for function assert_bookable_slot
  - a rolled-back probe impersonating the live admin profile (`request.jwt.claims.sub` = admin id, role authenticated) running `UPDATE public.reservations SET status='Cancelled' WHERE id=...` returned: `UPDATE FAILED -> 42501 permission denied for function assert_bookable_slot`

The SECURITY DEFINER RPCs (create_reservation, create_reservation_multi, request_reschedule, resolve_reschedule, verify_pickup, expire_unpaid_reservations) are unaffected because they run as the definer. Only direct table writes are broken. All 5 rows in `reservations` are currently `Cancelled`, consistent with nothing being processed.

**Failure scenario**

A staff member opens the admin dashboard and accepts a customer's reservation (PATCH /rest/v1/reservations?id=eq.<id> {"status":"Confirmed"}). PostgREST returns 42501 'permission denied for function assert_bookable_slot'. The same failure hits every status transition, every soft-delete, and every date/appointment_time edit made directly on the table. Customers can still create reservations (the RPC is DEFINER), so bookings pile up in Pending and the shop cannot accept, cancel, or complete any of them. The payment window (set_payment_due_on_confirm) never starts, so nothing is ever payable.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I could not refute this. I went in assuming it was wrong and checked every standard escape hatch; all of them closed.

Angles I tested and why each failed to save the code:

- "The code isn't what's claimed." It is. Line 113 revokes from authenticated, and lines 89-105 of the same file make the INVOKER trigger depend on that function. The migration broke it in one atomic step, which is why it is easy to miss in review: the delegation and the revoke read as two independently sensible hardening lines.

- "A later migration re-granted it." No. 20260807151239 does CREATE OR REPLACE with the identical 4-arg signature, which preserves ACLs rather than resetting them, and the live proacl is still {postgres, service_role}.

- "PostgreSQL doesn't check EXECUTE inside a trigger." This was the strongest refutation candidate and it is half true — which is exactly what makes the bug subtle. PG does NOT ACL-check the trigger function when the trigger fires (proven here: validate_reservation_time also has auth_exec=false and fired fine). But a nested plpgsql call goes through the normal executor path and IS checked against the current user. My own rolled-back probe returned 42501 rather than succeeding, so I verified this rather than trusting the reviewer's transcript.

- "Unreachable — nothing does direct table writes." Refuted by the sibling repo. The admin dashboard uses the anon key plus the user JWT, and updateReservation goes to a bare .update() PATCH, not an RPC. Every lifecycle action puts status or date in the SET list, matching the trigger's UPDATE OF list exactly.

- "RLS blocks it earlier, so the trigger never fires." Only partially, and this is the one genuine correction to the reviewer's write-up. The RLS UPDATE policy is is_admin_or_owner(), which excludes role='staff'. There are 5 staff profiles and 1 admin profile. So staff-role logins are filtered out by RLS before the trigger (a silent 0-row no-op, a separate pre-existing problem), and the 42501 specifically hits the single admin/owner account. That narrows WHO sees the error but not the impact, because the owner is precisely the account that accepts reservations.

Scope refinements worth passing to whoever fixes it, none of which reduce severity:
- Still working: the SECURITY DEFINER RPCs (create_reservation, create_reservation_multi, request_reschedule, resolve_reschedule, verify_pickup, settle_reservation_balance, expire_unpaid_reservations) run as postgres, which holds EXECUTE.
- Also still working: the payment-status-only toggles at Reservations.jsx:488, 502, 520, because payment_status is not in the trigger's UPDATE OF list, so the trigger never fires for them.
- Broken: approve/confirm, mark ready for pickup, complete, cancel, soft-delete, and reschedule — plus the direct INSERT at admin-dashboard/src/services/productService.js:286.

Severity stays critical rather than being downgraded. Customers can still create reservations through the DEFINER RPC, so bookings accumulate while the shop cannot accept, cancel, complete, or reschedule any of them, and because set_payment_due_on_confirm never runs, nothing becomes payable. There is no application-level workaround short of the service_role key. This is also a near-exact repeat of known bug pattern #2 in this codebase (an INVOKER path failing closed against a privilege it cannot satisfy), and it fails loudly at 42501 rather than silently, which is the only mercy here. The fix is a one-liner: GRANT EXECUTE ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) TO authenticated (the reschedule RPCs at 20260807145303 lines 53 and 106 call it too, though those are DEFINER), or alternatively make validate_reservation_time SECURITY DEFINER — but the grant is the lower-risk change since the function only reads store_hours/store_closures/reservations and raises.

</details>

---

#### F2. check_profile_updates() rewrite silently dropped the profiles.deleted guard added 9 days earlier

- **Location:** `supabase/migrations/20260805235019_block_owner_promotion.sql:23` _(migrations)_
- **Severity:** critical
- **Found by:** Migrations / RLS security

**What is wrong**

20260727080400_cover_deleted_in_profile_guard.sql:24-27 deliberately extended the guard to four columns:

    NEW.role IS DISTINCT FROM OLD.role OR
    NEW.employment_status IS DISTINCT FROM OLD.employment_status OR
    NEW.is_blocked IS DISTINCT FROM OLD.is_blocked OR
    NEW.deleted IS DISTINCT FROM OLD.deleted

20260805235019_block_owner_promotion.sql:23-27 does a full CREATE OR REPLACE of the same function to add the owner-promotion rule, but reintroduces only three of the four conditions -- `NEW.deleted` is gone. No later migration restores it. Verified live: the deployed body of public.check_profile_updates() has no `deleted` branch.

`profiles` has no other protection on that column. Live policies:
  - UPDATE "Enable update for users based on email": USING (auth.uid() = id), no WITH CHECK
  - ALL "Enable all access for admin/staff": USING/WITH CHECK is_staff_or_admin()

And both privilege helpers gate solely on this column -- is_staff_or_admin() / is_admin_or_owner() are `SELECT role ... WHERE id = auth.uid() AND deleted = false`.

Two rolled-back probes on the live DB (executed inside DO blocks that always RAISE, so nothing committed):
  - as a staff user against their own row: `self-set deleted=true SUCCEEDED, rows=1 ; self-restore deleted=false SUCCEEDED, rows=1`
  - as a plain `staff` user against the admin profile: `staff soft-deleting ADMIN profile: rows=1`

Note this also bypasses update_staff_status()'s last-admin-lockout protection entirely, since that function only guards employment_status and is_blocked.

**Failure scenario**

Any of the 6 live `staff` accounts reads the admin's profile id (staff have SELECT on all profiles via is_staff_or_admin) and sends PATCH /rest/v1/profiles?id=eq.<admin_uuid> {"deleted": true}. The Owner/admin instantly fails is_admin_or_owner() and is_staff_or_admin() and loses catalogue writes, reservation writes, device management, payments, store hours, and all-profile access -- with no way to fix it from either app, because their own repair UPDATE also runs is_admin_or_owner(). In the other direction, an offboarded staff or admin whose profile was soft-deleted but whose Supabase Auth login still works sends {"deleted": false} on their own row and reinstates full staff privileges. It also lets a customer undo process_account_deletion()'s deleted=true flag.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding survives every refutation angle I tested.

The cited code says exactly what the reviewer claims, in both the migration file and the deployed function body. No later migration restores the dropped condition. There is no guard earlier in the function, no second trigger, no CHECK constraint, no column-level GRANT restriction, and no RLS WITH CHECK that constrains the `deleted` column -- I checked each one directly rather than assuming.

I specifically hunted for the strongest refutation: that the removal was a deliberate revert, because the 20260727 migration's own header warns "BLAST RADIUS: if the admin-dashboard has a self-service account-deletion flow that sets deleted on the caller's own row, this will start raising. Confirm before applying." If 20260805 had intentionally backed that guard out, this would be a documented tradeoff and I would have refuted it. It did not. The header comment covers only owner promotion and the devices/store_hours tightening, and never mentions `deleted`. The decisive evidence is the rollback file: it too carries only three conditions, when a correct rollback would have restored the four-condition 20260727 body. Both directions were authored against a stale pre-20260727 copy of the function. That is a textbook CREATE OR REPLACE clobber -- the same class as this project's known trigger-referencing-a-dropped-table bug: applies cleanly, breaks silently, surfaces only at runtime. Rolling the migration back would not even fix it.

Reachability is not theoretical. Two paths, both live:
(a) Any of the 5 active staff sends PATCH /rest/v1/profiles?id=eq.<admin_uuid> {"deleted": true}. The ALL policy's WITH CHECK only asserts the caller is staff, so it passes; the trigger's IF block is skipped entirely because role/employment_status/is_blocked are unchanged; the column grant permits it. The sole admin/Owner then fails both is_admin_or_owner() and is_staff_or_admin() and loses catalogue writes, reservation writes, device management, payments, store hours, and all-profile access. This also bypasses the last-admin-lockout protection, which only guards employment_status and is_blocked.
(b) The one already-soft-deleted staff account sends {"deleted": false} on its own row via the bare USING (auth.uid() = id) policy and regains full staff privileges. I confirmed that account's auth.users record is unbanned, undeleted, and still has a password -- so this is exploitable right now, not hypothetically. The same path lets any customer undo process_account_deletion()'s deleted=true flag, reversing a GDPR erasure.

One correction to the reviewer's write-up, which I verified and which does not change the verdict: the claim that a locked-out admin has "no way to fix it from either app" is an overstatement. The admin can self-repair, because the self-update policy permits writes to their own row and the trigger no longer blocks `deleted`. Recovery does require a raw REST call, since no UI surfaces that column, so the practical impact of the lockout stands -- but the recovery claim is stronger than the evidence supports.

Severity: critical is honest, not inflated. This is a genuine authorization bypass in both directions -- privilege regain by a revoked account, and insider takedown of the only Owner account -- on a shared live production database with no staging, matching the bar set by this codebase's prior criticals (the SECURITY INVOKER create_reservation that failed closed for every customer, and the RPC with zero quantity validation that permitted overselling).

</details>

---


### HIGH

#### F3. is_staff_or_admin()/is_admin_or_owner() never check is_blocked, so blocking a staff account revokes nothing

- **Location:** `supabase/migrations/20260728015945_pin_is_staff_or_admin_search_path.sql:6` _(migrations)_
- **Severity:** high
- **Found by:** Migrations / RLS security

**What is wrong**

This migration is the only one in supabase/migrations/ that owns public.is_staff_or_admin(); the body itself was applied out-of-band and lives only in the live DB. Its deployed definition is:

  SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid() AND deleted = false;
  RETURN coalesce(user_role IN ('admin','staff','owner'), false);

is_admin_or_owner() is identical bar the role list. Neither reads `is_blocked`.

That is inconsistent with the rest of the schema and with the app's own offboarding control. The hand-written policies do check it -- e.g. 20260715000000_fix_rls_role_casing.sql:29-35 and 20260728015959_tighten_admin_update_using_predicates.sql:16-22 both require `profiles.is_blocked = false`. And update_staff_status(target, status, new_is_blocked, note) exists specifically so an admin can block a staff member; verified live, it only writes profiles.employment_status and profiles.is_blocked.

Everything gated on the two helpers therefore ignores blocking: profiles ALL access, reservations/reservation_items SELECT, payments SELECT+UPDATE, devices SELECT, store_hours/store_closures, announcements, account_deletion_requests, chat-images storage SELECT, ar_assets/ar_sessions/feedback/inventory/logs/settings/suggested_outfits/pose_guides ALL, plus verify_pickup() and process_account_deletion().

**Failure scenario**

An admin terminates a staff member and blocks them through Team Management (update_staff_status with new_is_blocked = true). The staff member's Supabase Auth session/credentials still work, so they sign in and their role is still 'staff' with deleted = false. is_staff_or_admin() returns true, and they retain read access to every customer profile (names, phone, address, DOB), every reservation and payment row, every chat image, and can still call verify_pickup() to mark reservations collected and process_account_deletion() to irreversibly scrub a customer's profile. The only thing blocking actually stops is the four policies that spell the check out inline (stock_movements INSERT, products UPDATE, color_list, pattern_list, categories).

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding holds on every point I could attack.

1. Code is as claimed. I pulled both helper bodies from live pg_proc rather than trusting the summary. Both filter only on `role` membership and `deleted = false`; neither references is_blocked.

2. Not fixed later. The newest security migration (20260809010000_ultrareview_security_fixes.sql) touches unrelated functions. No migration in the repo even contains a CREATE for these helpers -- confirmed by grep -- so the cited ALTER FUNCTION line is the correct and only available in-repo anchor, exactly as the reviewer stated.

3. No server-side compensating control. update_staff_status writes only employment_status and is_blocked; it does not set `deleted`, which is the sole profile-state column the helpers actually honor. The profiles triggers only audit-log the change. There is no deactivate/ban edge function (only create-staff-account and activate-staff-account exist).

4. Reachable. This was the best refutation avenue and it collapsed: the only is_blocked enforcement for staff is a client-side supabase.auth.signOut() in the admin-dashboard's AuthContext.jsx. Blocking leaves auth.users untouched -- I verified banned_until is NULL for all 6 staff/admin rows -- so a blocked staffer requests a token straight from GoTrue with their unchanged password and calls PostgREST/RPC, never running the JSX guard. 5 active staff accounts exist, so this is a live role, not a dormant one.

5. Blast radius verified independently against pg_policies and matches the report, including the two SECURITY DEFINER RPCs that bypass RLS and gate solely on is_staff_or_admin(), both EXECUTE-granted to authenticated.

Severity: high is honest and I am not downgrading it. It stays below critical because it needs an already-trusted insider (someone the business granted staff to) rather than an unauthenticated attacker, and because a genuinely effective offboarding path does exist -- setting deleted = true, which the helpers do check, and which one staff row already uses. But high is right: the purpose-built Team Management block control revokes nothing at the database layer, the exposure is full customer PII across every profile plus all reservations and payments, and it permits irreversible destruction (process_account_deletion permanently scrubs a customer) by precisely the person the business has decided to cut off. A security control that silently revokes nothing is the same failure class as the create_reservation and dropped-order_items bugs this project already shipped.

</details>

---

#### F4. Scan-result effect depends on `params`, which is a new object every render — unbounded re-render loop and scanned measurements cannot be edited

- **Location:** `app/profile/measurements.tsx:144` _(jezsy-mobile-app)_
- **Severity:** high
- **Found by:** Mobile screens

**What is wrong**

The effect that applies body-scan results is declared `}, [params, unitReady]);` (line 144) where `params = useLocalSearchParams()` (line 80). `useLocalSearchParams` is NOT memoized — node_modules/expo-router/build/hooks.js:150 returns `Object.fromEntries(Object.entries(...).map(...))`, a brand-new object on every call. So this effect re-runs on EVERY render, not once. Two consequences:

(a) Unbounded loop. Line 113 re-parses `const scanData = JSON.parse(params.scanData as string);` on each run, and line 126 does `if (scanData.confidence) setFieldConfidence(scanData.confidence);`. `scanData.confidence` is a freshly-allocated object each parse (BurstCollector.getResult() always returns a `confidence` object — src/utils/burstAverager.ts:104-120), so `setFieldConfidence` never hits React's Object.is bail-out. State change -> render -> new `params` identity -> effect re-runs -> new confidence object -> render... React logs "Maximum update depth exceeded" and the JS thread is pinned.

(b) Edits are reverted. Lines 115-135 unconditionally re-apply `setBust/setWaist/setHips/setInseam/setShoulderWidth/setArmLength/setTorsoLength/setLegLength/setHeight/setWeight` and `setSource('camera_scan')`. The file's own comment at lines 105-108 states this effect "must NOT re-run" — the dependency array does not deliver that.

**Failure scenario**

A customer completes a body scan. body-scan.tsx:194 does `router.replace({pathname:'/profile/measurements', params:{scanned:'true', scanData: JSON.stringify(final), ...}})`. On arrival the screen enters a continuous render loop. If they manage to type a correction into the Bust field, `renderInput`'s `onChangeText` calls `setValue(v)` -> re-render -> effect re-runs -> `setBust(cmToUnit(scanData.bust...))` snaps the field back to the scanned value, and `setSource('camera_scan')` (line 137) overwrites the `setSource('manual')` that onChangeText just set (line 323). The customer physically cannot correct an AI-estimated measurement, and the row saved to `user_measurements` is stamped `measurement_source: 'camera_scan'` with the un-correctable values that then drive every size recommendation.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding holds up. I verified every link in the causal chain against actual file contents rather than the summary, and attempted refutation on five fronts (missing memoization, an earlier guard, an existing fix in another worktree, unreachability, and React version behavior). None succeeded.

Mechanism confirmed: app/profile/measurements.tsx:80 calls useLocalSearchParams() raw (grep confirms no useMemo anywhere in the file), and expo-router 6.0.24's implementation at node_modules/expo-router/build/hooks.js:153 returns Object.fromEntries(...) -- a new object identity on every invocation, with no memoization. Version pinned at ~6.0.24 with no patches/ directory, so this build is what runs. Therefore the dependency array at line 144, [params, unitReady], changes on every render and the effect re-runs every render rather than once.

The loop driver is specifically line 126, `if (scanData.confidence) setFieldConfidence(scanData.confidence);`. Every other setter in the effect body (setBust, setWaist, setSource, setShowAdvanced, setScanConfidence) receives a string, number, or boolean and hits React's Object.is bail-out after first application. Line 126 alone passes an object freshly allocated by the JSON.parse on line 113, so it never bails out: setState -> render -> new params identity -> effect re-runs -> new parse -> new confidence object -> setState.

Reachability confirmed, not theoretical: app/profile/body-scan.tsx:196 navigates with `params: { scanned: "true", scanData: JSON.stringify(final), height, weight, gender }`, satisfying the line 111 guard. `final` always carries a truthy confidence object -- either from burstAverager.ts:122 (`confidence: avgConfidence`) or from the override at body-scan.tsx:187. The `loading` early-return at line 331 provides no protection because both effects are declared above it and hooks run regardless.

The second consequence is the more damaging one and is independent of the exact loop symptom: lines 115-137 unconditionally re-apply the scanned values and setSource('camera_scan') on every re-run, which reverts the setValue(v) and setSource('manual') that renderInput's onChangeText sets at lines 319-323. The file's own comment at lines 105-108 states the effect "must NOT re-run"; the dependency array does not deliver that, and the eslint-disable on line 143 suppressed the exhaustive-deps warning that would have flagged it.

Two corrections to the reviewer's write-up, both about symptom rather than defect. On React 19.1.0 the nested-passive-update limit produces a dev-only console.error, not a thrown red-box error, and updates scheduled from passive effects run at Default lane so React yields between renders -- the JS thread is not hard-frozen as claimed, it re-renders continuously burning CPU and battery, and in a production build it does so silently.

Severity downgraded from critical to high. This codebase's critical bar is total breakage or exploitability (create_reservation failing closed for every customer; overselling reachable by calling the RPC directly). This defect is confined to one opt-in feature path, has no security dimension, and does not block saving. The real harm is that a customer cannot correct an AI-estimated measurement before it is persisted with measurement_source 'camera_scan' and drives every subsequent size recommendation -- which in a reserve-and-collect model means reserving a wrong size and paying a 50% deposit before discovering the mismatch in store. Serious and user-visible, but recoverable and scoped.

</details>

---

#### F5. Chat effect depends on unmemoized `markAsRead`, creating a self-feeding realtime loop that tears down and rebuilds the message channel indefinitely

- **Location:** `app/messages/[conversationId].tsx:192` _(jezsy-mobile-app)_
- **Severity:** high
- **Found by:** Mobile screens

**What is wrong**

The fetch+subscribe effect ends `}, [conversationId, markAsRead, session?.user.id]);` (line 192). `markAsRead` comes from `useMessages()`, and in src/context/MessagesContext.tsx:165 it is a plain function declared in the provider body — `const markAsRead = async (conversationId: string) => {` — so it gets a new identity on every MessagesProvider render. The effect body calls `markAsRead(conversationId)` (line 150), which issues `supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId)` (MessagesContext.tsx:167-170).

That UPDATE always writes a new row version (it is not conditioned on the value differing), `conversations` is in the realtime publication (supabase/migrations/20260715100000_messaging_realtime.sql:85-90), and the customer's own UPDATE policy permits it (same file, lines 23-29). The provider's channel handler (MessagesContext.tsx:61-70) fires `refreshConversations()` on any conversations change, which calls `setConversations(data || [])` with a fresh array -> provider re-renders -> new `markAsRead` identity -> the chat effect's cleanup runs `messageSubscription.unsubscribe()` and the effect re-runs: refetch 30 messages, `supabase.channel(\`messages:${conversationId}\`)` again, `markAsRead` again -> back to the start.

**Failure scenario**

Any customer who opens a conversation triggers a runaway loop for as long as the screen is on: per cycle (~one realtime round trip) it issues an UPDATE on `conversations`, an UPDATE on `messages`, a SELECT of all conversations, a SELECT of 30 messages, and a full unsubscribe/re-subscribe of the `messages:<id>` channel — against the shared live production DB with no staging. Because a new channel with the same topic is created while the previous one is still tearing down, INSERTs that land inside the gap are never delivered, so a staff reply can silently fail to appear in the customer's open thread.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I could not refute the mechanism; every link verified against source and the live DB.

CONFIRMED: (1) app/messages/[conversationId].tsx:192 really does list `markAsRead` in the dep array. (2) src/context/MessagesContext.tsx:165 declares it as a plain `const` in the provider body with no useCallback, so it takes a new identity on every provider render, and the context value (line 239) is a fresh object literal so every consumer re-renders. (3) The effect body calls markAsRead unconditionally at line 150. (4) markAsRead's UPDATE (lines 167-170) is not conditioned on the value differing. (5) setConversations(data || []) at line 47 always receives a fresh array, so React never bails out of the re-render.

My strongest refutation attempt was that writing unread_count=0 onto a row already at 0 might produce no meaningful realtime event. Live DB kills that: public.conversations carries trg_touch_updated_at (BEFORE UPDATE) running touch_updated_at(), whose body is `NEW.updated_at := now()`. Every markAsRead therefore writes a genuinely different row -- elision is impossible. I also confirmed conversations is in the supabase_realtime publication (conv_in_realtime_pub=1) and that the customer's own UPDATE passes RLS ("Enable update for own conversation or admin" USING/WITH CHECK ((customer_id = auth.uid()) OR is_staff_or_admin())), so the write matches the row rather than silently affecting zero rows. No suppress_redundant_updates trigger exists on the table. The provider's own effect (deps [session, refreshConversations], refreshConversations memoized at line 37) does not re-run, so the chat effect at line 192 is the sole unstable consumer -- confirming the loop is specific to this dep and not a general re-render storm.

Loop closes: effect -> markAsRead -> UPDATE conversations (updated_at bumped) -> realtime UPDATE delivered (SELECT policy passes for the customer) -> handler at lines 63-69 -> refreshConversations -> setConversations(new array) -> provider re-render -> new markAsRead identity -> effect cleanup unsubscribes and re-runs. Sustains until unmount.

SEVERITY DOWNGRADED critical -> high. The reviewer's claimed data-loss consequence ("a staff reply can silently fail to appear") does not hold: every cycle also re-runs fetchMessages() (lines 138-153), re-pulling the newest 30 messages, so an INSERT dropped in the resubscribe gap is recovered on the very next cycle -- the loop self-heals the gap it creates. No data loss, no correctness impact, no security impact. What remains is a real resource fault: unbounded UPDATEs/SELECTs/channel re-joins per open chat screen against shared live production with no staging, and per-tenant realtime rate limits mean a few concurrent sessions can degrade realtime for the admin-dashboard sharing the project. Reachable by any customer simply opening a chat, with no further action needed to sustain it -- but not the silent business-flow breakage or RLS hole this codebase reserves "critical" for. Fix is one line: useCallback on markAsRead keyed to session?.user.id, matching refreshConversations at line 37.

</details>

---

#### F6. Mask cross-sections are normalized to frame WIDTH but converted to cm as a fraction of body HEIGHT

- **Location:** `src/utils/measurementCalculator.ts:149` _(jezsy-mobile-app)_
- **Severity:** high
- **Found by:** Mobile utils/context/hooks

**What is wrong**

Two files state contradictory normalization bases, and body-scan.tsx wires one straight into the other.

Producer, `src/utils/bodyMask.ts:64` (inside `extentAtRow`):
    const extent = (last - first + 1) / mask.width;
and `src/utils/bodyMask.ts:91` documents the result: "/** All normalized to the mask's own width. */". So a `BodyExtents` value is the fraction of the FRAME WIDTH the silhouette occupies at that row.

Consumer, `src/utils/measurementCalculator.ts:149`:
    const toCm = (r: number) => r * heightCm;
and the `CrossSection` doc at `src/utils/measurementCalculator.ts:22-25` claims the opposite: "Body width and depth at each circumference site, both normalized to the same head-to-ankle span the ratios use."

Call site, `app/profile/body-scan.tsx:176-183`, passes the mask-width fractions in with no rescaling:
    const measured = circumferencesFromCrossSections(
      { bust: { widthRatio: width.bust, depthRatio: depth.bust }, ... }, height);

`r * heightCm` is only correct if the camera frame is exactly as wide as the customer is tall. It is not -- frame width is the camera's field of view at whatever distance the person is standing. Nothing in this path ever uses the person's own pixel height, unlike the front-only path, which correctly divides by the nose-to-ankle span at `src/utils/poseDetector.ts:158` (`const totalHeight = Math.abs(ankleY - noseY) || 1`).

The damage is not contained: `app/profile/body-scan.tsx:184-188` overwrites the BMI-regression bust/waist/hips with these values AND stamps them `confidence: { bust: 0.95, waist: 0.95, hips: 0.95 }`, so the wrong numbers are marked as the highest-confidence result in the whole scan. They are then persisted and read by `useSizingProfile` -> `recommendSize`.

**Failure scenario**

A customer completes the front + side body scan standing ~2 m from the phone and saves the result. She rescans standing ~1.5 m away. Because `extent` is a fraction of frame width, occupying a larger share of the frame at the closer distance scales widthRatio and depthRatio up together, so the second scan reports bust/waist/hips roughly 33% larger than the first for an unchanged body -- and both are labelled 0.95 confidence. Whichever run she saves feeds `recommendSize()`, whose `tooSmall` guard (src/utils/sizeRecommender.ts:88-102) then rejects every garment size whose chart bust is below her inflated body bust, so `recommendSize` returns null (no size shown) or the largest stocked size, on every product in the catalog.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I attempted four refutation routes and all four failed.

(1) Does the cited code exist and say what is claimed? Yes, verbatim. bodyMask.ts:64 divides by mask.width; measurementCalculator.ts:149 multiplies by heightCm. These are different physical quantities, and the two files' own doc comments (bodyMask.ts:91 vs measurementCalculator.ts:22-25) state directly contradictory normalization bases. The unit error is real: r * heightCm is only correct if frame width equals the customer's height, and frame width is the camera's horizontal field of view at whatever distance the person stands.

(2) Is it rescaled elsewhere? No. extractBodyExtents uses landmarks purely to select which rows to scan (bustY/waistY/hipsY at bodyMask.ts:114-116); the extent magnitude is never divided by the person's own pixel span. body-scan.tsx:176-183 forwards the medians with no adjustment. The front-only pipeline does it correctly at poseDetector.ts:158, which makes the omission in the mask path a genuine inconsistency rather than a deliberate convention.

(3) Is the path dead? This was my best shot at refutation, since bodyMask.ts:77 returns null when mask.width is falsy and isBody returns false when neither typed array is present -- if the TurboModule handed JS bare {} objects, the whole cross-section path would be inert and the finding unreachable. It fails: the library's own Mask type (shared/types.ts:92-98) declares width, height, and the uint8Data/float32Data union that MaskLike mirrors, and body-scan.tsx:337 enables mask output. MediaPipe's Tasks API returns pose masks upscaled to input-image dimensions, which is also the only assumption under which indexing mask rows by full-frame-normalized landmark y is coherent at all.

(4) Is the failure reachable and is the damage real? Yes. isPoseValid (poseDetector.ts:78) imposes only a lower bound on body span (>= 0.5 of frame) with no upper bound, so normal user framing varies roughly 0.5 to 0.95 -- both widthRatio and depthRatio scale together with proximity, so the ellipse perimeter scales nearly linearly with frame occupancy. The reviewer's 2 m -> 1.5 m ~33% inflation is arithmetically correct. The persisted-value chain to recommendSize is intact across three screens, and the tooSmall guard at sizeRecommender.ts:88/115 does disqualify sizes as claimed.

Two corrections to the report. First, the failure scenario says recommendSize returns "null or the largest stocked size"; reading sizeRecommender.ts:115-124, when every size trips tooSmall, bestSize stays null and null is returned -- there is no largest-size fallback. Second, the reviewer missed a duplicate of the same defect inside computeMeasurements at measurementCalculator.ts:196-205, latent today only because body-scan.tsx never populates the optional crossSections field; any future caller would inherit it.

Severity downgraded critical -> high. This is a measurement-accuracy defect in an optional feature, not a security, data-loss, or fail-closed-for-every-customer bug. It is gated behind consent, camera permission, the prep wizard, a completed front burst, a detected quarter turn, and 5 valid side frames, and the result lands in an editable review form (measurements.tsx:115-118) that the customer confirms before saving. Business impact is real for a reserve-and-collect boutique -- a 50% deposit on a garment that will not fit, plus silent loss of size recommendations catalog-wide -- but the balance is settled in-store where fit is checked. Against this repo's calibration bar, where critical meant every customer reservation silently failing, high is the honest rating. The 0.95 confidence stamp at body-scan.tsx:187 is a genuine aggravating factor: the least-calibrated number in the pipeline is labelled the most trustworthy.

</details>

---

#### F7. MessagesContext provider value and all five handlers are rebuilt every render, re-rendering every consumer

- **Location:** `src/context/MessagesContext.tsx:239` _(jezsy-mobile-app)_
- **Severity:** high
- **Found by:** Mobile utils/context/hooks

**What is wrong**

The provider value is an inline object literal with no `useMemo` (`src/context/MessagesContext.tsx:238-250`):
    <MessagesContext.Provider
      value={{ conversations, unreadCount, loading, sendMessage, editMessage, toggleReaction, markAsRead, getOrCreateConversation, refreshConversations }}
    >

And `sendMessage` (line 77), `editMessage` (117), `toggleReaction` (147), `markAsRead` (165) and `getOrCreateConversation` (185) are plain function declarations, not `useCallback`, so all five get fresh identities on every render too. Only `refreshConversations` is memoized (line 37).

This provider sits at the app root (`app/_layout.tsx:245`) and its realtime subscription calls `refreshConversations()` on every `postgres_changes` event on the `conversations` table (lines 61-70) -- an event fired for every message any participant sends, including staff. Each of those triggers a `setConversations`, a provider render, a brand-new value object, and a forced re-render of every `useMessages()` consumer, which includes `app/(tabs)/_layout.tsx:17` (the tab bar) and the open conversation screen. Compare `ThemeContext.tsx:50` and `ToastContext.tsx:77`, which both memoize their value.

**Failure scenario**

A customer has the conversation screen open while staff reply from the admin dashboard. Each inbound message fires a realtime event, refetching conversations and re-rendering the tab bar and the entire message thread rather than just the changed row. Any consumer effect keyed on one of the five unmemoized handlers also re-runs on every unrelated provider render, since their identities change every time.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

Not refutable. Every literal code claim checks out verbatim: the provider value at 238-250 is an unmemoized object literal, the five handlers at 77/117/147/165/185 are plain function declarations, and only refreshConversations (37) is useCallback-wrapped (ThemeContext.tsx:50 does memoize, as cited).

However, the reviewer's stated mechanism is partly wrong while their severity is badly understated. Wrong part: memoizing the value would NOT prevent the re-renders in their failure scenario, because refreshConversations does setConversations(data || []) at line 47 with a brand-new array from the network on every event, so the value's contents genuinely change and any useMemo keyed on `conversations` produces a new object anyway. Their "re-renders the tab bar instead of just the changed row" framing does not hold -- that re-render is caused by the state change, not the missing memo.

The real defect is the one they only gestured at in their last sentence, and it is a self-sustaining feedback loop rather than a cosmetic render cost. app/messages/[conversationId].tsx:192 keys its effect on `markAsRead`. That effect calls markAsRead (line 150), which UPDATEs conversations. The trg_touch_updated_at BEFORE UPDATE trigger sets updated_at = now(), so the row is dirtied on every call even when unread_count is already 0 -- guaranteeing a WAL record. conversations is in the supabase_realtime publication and the customer's own UPDATE passes RLS, so the event is broadcast back to the originating client (postgres_changes has no self-echo suppression). MessagesContext's handler then calls refreshConversations, setConversations installs a new array, the provider re-renders, markAsRead gets a fresh identity, the dep changes, and the effect tears down its messages channel and runs again -- calling markAsRead once more. Unbounded, for as long as the chat screen is mounted.

I checked the plausible loop-breakers and none apply: refreshConversations is useCallback([session?.user.id]) so the conversations channel itself stays stable (only the messages channel churns); the UPDATE matches a row and passes RLS so it is not a silent no-op; and each iteration is separated by network round trips, so React's automatic batching cannot collapse the cycle. I also confirmed the blast radius is one loop, not five: getOrCreateConversation appears only inside onPress handlers (product/[id].tsx:199, reservations/[id].tsx:120), and the other three handlers are not in any dep array.

Severity raised from low to high, not lowered. Every customer who opens a conversation triggers a continuous loop of one 30-row message SELECT, two UPDATEs, one conversations SELECT, and a realtime channel teardown/rebuild per cycle, against a shared live production Supabase project with no staging -- burning request quota plus mobile battery and data. It is not critical: no data corruption, no security boundary crossed, and the thread still displays correctly (the constant refetch even papers over messages that arrive during the resubscribe gap). But it is far above a rendering nit.

Important correction for whoever fixes this: adding useMemo to the provider value alone will NOT break the loop. markAsRead specifically must be wrapped in useCallback (or the effect at line 192 must drop it from its deps via a ref).

</details>

---

#### F8. "Mark paid" transition writes nonexistent `staff` column, so To Pay -> To Pickup always fails

- **Location:** `src/pages/customers/Reservations.jsx:332` _(admin-dashboard)_
- **Severity:** high
- **Found by:** Admin dashboard correctness

**What is wrong**

`handleAction`'s `ready_pickup` branch sends a `staff` key:

'''js
await updateReservation(res.docId, {
  status: 'To Pickup',
  staff: user?.name || 'Staff',
  assigned_staff_id: user?.uid || '',
  countdown: false,
});
'''

`updateReservation` passes this straight to `updateDocument` -> `toSnake` -> PostgREST. I enumerated `information_schema.columns` for `public.reservations` on the live project: the 38 columns include `staff_id` and `assigned_staff_id` but there is **no `staff` column**. PostgREST rejects an unknown key in an UPDATE payload with PGRST204 ("Could not find the 'staff' column of 'reservations' in the schema cache"); it does not ignore it. Secondarily, `assigned_staff_id: user?.uid || ''` would send `''` into a `uuid` column whenever `user.uid` is falsy, which is a second hard error (22P02).

The error is swallowed by the generic `catch` at line 385 which only shows `toast.error('Failed to update reservation')` — no console detail, no PostgREST code surfaced.

**Failure scenario**

Staff receive a customer's GCash payment, open the reservation on the board (or List view) and click the primary action "Mark paid" on a `To Pay` card. `PRIMARY_ACTION['To Pay'] = { action: 'ready_pickup' }` so this is the single, unavoidable button for that column. The UPDATE fails with PGRST204, the toast reads "Failed to update reservation", and the reservation stays in `To Pay` forever. The customer's app never shows the item as ready for collection, no staff member is assigned, and `countdown` is never cleared so the unpaid-sweep countdown keeps running against a customer who has already paid. There is no other code path in the dashboard that sets status to 'To Pickup', so the reservation lifecycle is dead at this step. Corroborating: all 5 reservations in the live DB are 'Cancelled' — none has ever reached 'To Pickup' or 'Completed'.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried hard to kill this one and could not. The core claim survives every attack I made on it.

WHAT I VERIFIED (all paths are in the sibling admin-dashboard repo, C:\Users\carlv\admin-dashboard, not the mobile app):

1. The code is there and says what the reviewer claims. C:\Users\carlv\admin-dashboard\src\pages\customers\Reservations.jsx lines 330-335 send `staff: user?.name || 'Staff'` in the `ready_pickup` branch of `handleAction`.

2. No whitelist anywhere in the chain. `updateReservation` (C:\Users\carlv\admin-dashboard\src\services\reservationService.js:218-236) only rewrites `date`/`appointmentTime`/`reservationDate` and then calls `updateDocument`. `updateDocument` (C:\Users\carlv\admin-dashboard\src\lib\supabaseService.js:129-139) spreads `{...updates, updated_at}` through `toSnake` and hands it straight to `.update()`; it deletes only `id`. `camelToSnake('staff')` is `'staff'`, so the key reaches PostgREST verbatim.

3. The column genuinely does not exist. I enumerated `information_schema.columns` for `public.reservations` on the live project: 38 columns, including `staff_id` and `assigned_staff_id`, and no `staff`. I also confirmed `relkind = 'r'` (a base table, not a view that could be masking a differently-named column), so there is no rename/indirection escape hatch. Grepping every migration in the mobile repo found no `staff` column on reservations ever having existed.

4. The path is the only path and is reachable. `PRIMARY_ACTION['To Pay'] = { action: 'ready_pickup', label: 'Mark paid' }` (C:\Users\carlv\admin-dashboard\src\utils\reservationActions.js:13) is the single primary action for that column, shared by the board and the List view. Grepping the whole dashboard for writes of `'To Pickup'` returns exactly one: line 331. Line 649 is a filter `<option>`, lines 1006-1007 are a display stepper. There is no manual status-edit fallback.

WHAT I DID REFUTE (the reviewer overstated three things):

a) "no console detail" is wrong. `handleError` at C:\Users\carlv\admin-dashboard\src\lib\supabaseService.js:68-71 does `console.error('[Supabase] updateDocument(reservations, id):', error.message)` before rethrowing, so the PostgREST message is in the console. Only the toast is generic. This matters: the bug fails LOUDLY on the first click, unlike the silent-for-weeks failures this project has been bitten by.

b) The secondary `assigned_staff_id: user?.uid || ''` -> 22P02 claim is essentially wrong. `AuthContext` sets `uid: supabaseUser.id` unconditionally when a user exists (C:\Users\carlv\admin-dashboard\src\context\AuthContext.jsx:215), so an authenticated staff member always has a uuid. It is also moot, since the unknown-column rejection aborts the request first.

c) The claimed worst-case harm is wrong. `expire_unpaid_reservations()` keys off `payment_status NOT IN ('paid','submitted')`, not off the `countdown` boolean, and `handleVerifyPayment` / `handleTogglePaid` (Reservations.jsx:488, 502) write only `payment_status`, which is a real column and therefore succeed. So a customer who has paid is NOT swept into Cancelled by the failed transition. The `countdown` column is dead weight here.

CORROBORATION I found independently: the same file has a second instance of the same defect at line 574, where `createReservation` sends `staff: 'Unassigned'` (plus `reservationDate` and `timestamp`, neither of which is a column either), so the staff-side "New Reservation" INSERT is broken the same way. That is a separate finding but confirms the pattern is not a misread.

SEVERITY: downgraded critical -> high. It is real, deterministic, 100% reproducible, and there is no UI workaround: To Pay can never advance to To Pickup, which means Hand over / Completed is also unreachable and reserved stock is never consumed. But it fails visibly (toast plus a console error with the PostgREST message on the very first click), it is staff-tooling only, there is no data corruption, no security exposure, no silent wrong write, and the paid-customer auto-cancel scenario the reviewer used to justify "critical" does not actually occur. The critical-tier bugs in this project's history were critical because they failed silently for weeks; this one announces itself immediately.

</details>

---

#### F9. Staff "New Reservation" form sends three nonexistent columns plus two type-mismatched values; every insert fails

- **Location:** `src/pages/customers/Reservations.jsx:571` _(admin-dashboard)_
- **Severity:** high
- **Found by:** Admin dashboard correctness

**What is wrong**

`handleCreateReservation` builds this payload:

'''js
await createReservation({
  id: mockId,
  customerName: newRes.customer,
  ...
  reservationDate: new Date(newRes.date),
  date: new Date(newRes.date),
  status: 'Pending',
  staff: 'Unassigned',
  assigned_staff_id: '',
  countdown: true,
  size: newRes.size,
  deposit: newRes.deposit,
  timestamp: Date.now(),
  rentalPrice: matchedProduct?.price || 0,
});
'''

`createReservation` (src/services/reservationService.js:208) only destructures `appointmentTime` out; everything else is spread into `...rest`. `addDocument` (src/lib/supabaseService.js:118) applies `toSnake` and deletes only `id`, `created_at`, `updated_at`. So the INSERT payload keeps `reservation_date`, `staff` and `timestamp`.

Verified against the live `public.reservations` schema: **none of `reservation_date`, `staff`, or `timestamp` exists** (the date columns are `date`, `return_date`, `appointment_time`, `created_at`). Each is a PGRST204 rejection.

Two further type errors in the same payload:
- `deposit` is `numeric` in the DB, but line 917 binds it to a checkbox: `checked={newRes.deposit}` / `onChange={(e) => setNewRes({ ...newRes, deposit: e.target.checked })}` — always a boolean. This is the *exact* bug the file already documents as fixed elsewhere, at lines 481-484: "Was handleToggleDeposit, which wrote a boolean into `deposit` -- a numeric column holding the amount owed. Postgres rejects that outright." The create path was never fixed.
- `assigned_staff_id: ''` into a `uuid` column.

Also note `mockId` (line 560) is `RES-${reservations.length + 1}` but `addDocument` deletes `payload.id`, so `display_id` is never populated either.

**Failure scenario**

A staff member takes a walk-in or phone booking, fills in the New Reservation modal and submits. PostgREST rejects the INSERT on the first unknown column, the catch at line 586 shows only "Failed to reservation create reservation" (`toast.error('Failed to create reservation')`), and no row is written. Staff-side reservation creation is completely non-functional — the dashboard can only ever act on reservations created by the mobile app. Because the toast is generic and the PostgREST code is never logged, this looks to staff like an intermittent network problem rather than a schema mismatch.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I could not refute this. I attacked it from four angles and all four failed.

1. Wrong-file/wrong-repo attack: the file does not exist in jezsy-mobile-app, but it does exist at C:\Users\carlv\admin-dashboard\src\pages\customers\Reservations.jsx, and the cited code is present verbatim at the cited line numbers (571 is exactly `reservationDate: new Date(newRes.date),`). This is a real finding filed against the sibling repo -- the parent agent should re-route it, but it is not a refutation.

2. Service-layer-whitelist attack: failed. createReservation (reservationService.js:208) destructures only appointmentTime and spreads ...rest; addDocument (supabaseService.js:118-124) deletes only id/created_at/updated_at. Nothing filters unknown keys.

3. Stale-schema-claim attack: failed. I queried the live DB myself rather than trusting the reviewer. count of reservation_date/staff/timestamp in public.reservations = 0. All three are genuinely absent; PostgREST rejects the INSERT with PGRST204 on the first unknown column.

4. Unreachability attack: failed. The modal is gated by can(user?.role,'create_reservation') and permissions.js:43 grants it to owner/admin. The RLS INSERT policy is_admin_or_owner() matches that same tier, so RLS does not fail first and does not mask the bug -- the payload genuinely reaches PostgREST and dies there. Dashboard.tsx:303 is only a navigate() to the same modal, so there is no alternative working create path. git status shows the file is unmodified, so there is no uncommitted fix.

Two factual corrections to the report, neither of which rescues it:
- The failure scenario says "a staff member," but create_reservation is FULL = [OWNER, ADMIN]; the Staff role cannot see the button. Owner/admin still performs walk-in bookings, so the path remains reachable by a real user -- the persona is just misidentified.
- The finding is filed against the mobile app repo but belongs to admin-dashboard.

Severity downgraded critical -> high. The bug makes dashboard-side reservation creation 100% non-functional with no workaround, which is serious. But it fails closed and LOUDLY: the operator sees "Failed to create reservation" every single time, so it cannot silently rot for weeks the way the order_items trigger bug or the SECURITY INVOKER create_reservation bug did. There is no data corruption, no data loss, and no security or privilege consequence, and the customer-facing mobile reservation path is entirely unaffected, so the business continues taking reservations. That places it below the critical bar this codebase reserves for silent-failure, corruption, or authorization defects.

The deposit boolean-into-numeric and assigned_staff_id ''-into-uuid sub-claims are independently confirmed but are practically moot, since PostgREST rejects on the unknown column before any type coercion is attempted. The display_id sub-point is also correct (addDocument deletes payload.id, and the payload sets `id` rather than `display_id`, so display_id would never populate) but is likewise moot while the insert fails outright.

</details>

---

#### F10. Rescheduling writes nonexistent `reservation_date` column, so every staff reschedule fails

- **Location:** `src/pages/customers/Reservations.jsx:423` _(admin-dashboard)_
- **Severity:** high
- **Found by:** Admin dashboard correctness

**What is wrong**

`handleReschedule` sends:

'''js
await updateReservation(rescheduleModal.docId, {
  reservationDate: new Date(newDate),
  date: new Date(newDate), // Fallback for Android which parses 'date'
  countdown: true,
  ...(stillAwaitingPayment ? { payment_due_at: computePaymentDueAt(newDate) } : {}),
});
'''

`updateReservation` (src/services/reservationService.js:234) explicitly preserves the key rather than dropping it:

'''js
if (updates.reservationDate) updates = { ...updates, reservationDate: toLocalDateString(updates.reservationDate) };
'''

`toSnake` then turns it into `reservation_date`, which does not exist on `public.reservations` (verified against the live schema). PGRST204, whole UPDATE rejected — including the valid `date`, `countdown` and `payment_due_at` values in the same statement.

`reservationDate` is a legacy/Android read-alias used correctly as a *read* fallback throughout the codebase (`r.reservationDate || r.date` at lines 232, 404, 446, 543, 710, 730, 1075). Writing it is the bug. A repo-wide grep shows it is written in only two places, both in this file (423 and 571).

**Failure scenario**

A customer calls to move their fitting appointment. Staff open the reservation, pick a new date in the reschedule modal and submit. The UPDATE is rejected, the catch at line 435 shows "Failed to reschedule", and the appointment is unchanged — while staff have already told the customer the new time over the phone. The customer arrives on the original date, or nobody arrives at all. Note the separate customer-initiated path (`resolveRescheduleRequest` -> `resolve_reschedule` RPC) works fine, so the failure is specific to staff-initiated reschedules and looks inconsistent from the inside.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried hard to kill this one and could not. Every escape hatch is closed:

1. CODE IS AS QUOTED. C:\Users\carlv\admin-dashboard\src\pages\customers\Reservations.jsx:423 passes `reservationDate: new Date(newDate)` verbatim. (Note: the finding cites the path as `src/pages/customers/Reservations.jsx` but it is in the SIBLING admin-dashboard repo, not jezsy-mobile-app — the mobile repo has no `src/pages` at all. Same shared DB, so the finding is still in scope, but the path should be qualified.)

2. NO COLUMN FILTERING ANYWHERE. `updateReservation` (reservationService.js:234) formats and keeps the key, then calls `updateDocument` (src/lib/supabaseService.js:135), which does `toSnake({...updates, updated_at})`, deletes only `id`, and sends the rest straight to PostgREST. `handleError` (line 69-72) rethrows on any error. `camelToSnake` (line 30-31) maps `reservationDate` -> `reservation_date`. There is no whitelist, no allowlist, no drop of unknown keys at any layer.

3. COLUMN GENUINELY DOES NOT EXIST — verified independently against the live DB, not taken from the reviewer. `information_schema.columns` for `public.reservations` returns 38 columns; `date`, `return_date`, `countdown` and `payment_due_at` are all present and valid, `reservation_date` is absent. Also confirmed `reservations` is a BASE TABLE with no same-named view PostgREST could be targeting instead, and grepped BOTH repos' `supabase/migrations/` for `reservation_date` — zero hits, so the column has never existed in the Supabase era.

4. NO LATER FIX. `git blame` shows line 423 landed 2026-03-29 (7a3e0a82) and is unmodified; working tree changes touch only Dashboard.tsx and notificationSound.js.

5. REACHABLE BY REAL STAFF. The modal is wired at line 949 `<form onSubmit={handleReschedule}>` with a "Confirm Reschedule" submit button (974), opened from two rendered controls: the board card `onReschedule` (683-686) and the table-row Calendar icon button (782-791), the latter shown for any reservation whose status is in `CAN_RESCHEDULE_STATUSES`. Not dead code.

One robustness note that makes the conclusion layer-independent: whether PostgREST rejects with PGRST204 from its schema cache or Postgres rejects with 42703, no layer silently drops an unknown column from a write body, so the PATCH fails and the valid `date`/`countdown`/`payment_due_at` in the same statement are lost with it. The reviewer's mechanism is right either way.

SEVERITY DOWNGRADE critical -> high. The bug is real and the feature is 100% broken, but it does not clear this codebase's bar for critical. The stated critical exemplars are SILENT failures (the trigger querying dropped `order_items` for weeks; `create_reservation` failing closed for every customer) or exploitable holes (overselling via direct RPC). This one fails LOUDLY and CLOSED: the catch at line 435 fires `toast.error('Failed to reschedule')` on the spot, no data is corrupted, no security or money exposure, no customer-facing path is blocked (customers still reserve via the mobile app, and the customer-initiated `resolve_reschedule` RPC path is unaffected). It is a fully broken, reachable, staff-facing write path with genuine operational cost — that is "high".

CORROBORATING DETAIL the reviewer missed: the same defect is worse at line 571. `handleAddReservation` calls `createReservation` with `reservationDate`, plus `staff: 'Unassigned'` (line 574) and `timestamp: Date.now()` (line 579) — none of `reservation_date`, `staff`, or `timestamp` are columns on `reservations`. So the admin "Add Reservation" form is broken by the identical mechanism. That two separate staff write paths have both been dead since the Firestore->Supabase migration is also the most likely explanation for why nobody noticed: these are legacy admin conveniences, and real reservations originate in the mobile app.

</details>

---

#### F11. Admin adjusts inventory by hand for events the DB now handles via trigger, double-counting every hold, release and consume

- **Location:** `src/pages/customers/Reservations.jsx:327` _(admin-dashboard)_
- **Severity:** high
- **Found by:** Cross-repo consistency

**What is wrong**

Migration 20260808123756_reservation_inventory_holds.sql made inventory movement fully automatic and server-side. `trg_hold_inventory_on_reservation_item` fires AFTER INSERT ON reservation_items and, because `reservation_holds_stock()` returns `SELECT NOT coalesce(_deleted,false) AND lower(coalesce(_status,'')) NOT IN ('completed','cancelled')`, a brand-new reservation at status 'Pending' ALREADY takes the hold: `UPDATE public.inventory SET available = available - NEW.quantity, reserved = coalesce(reserved,0) + NEW.quantity`. `trg_apply_inventory_on_reservation_status` then releases on Cancelled and consumes (`reserved -= qty, total -= qty`) on Completed.

The admin repo has no reference to any of this and still moves stock itself in `handleAction`:
- line 327 `await adjustStockForReservation(res, -1);` on `approve_pay`
- line 361 `await adjustStockForReservation(res, 1, true);` on `complete`
- line 374 `if (holdsStock(res.status)) { await adjustStockForReservation(res, 1); }` on `cancel`

Those land in `adjustInventoryForReservation` (admin src/services/reservationService.js:317-322), which writes the same columns on the same row: `updates.available = Math.max(0,(invRow.available||0)+delta); updates.reserved = Math.max(0,(invRow.reserved||0)-delta);` and for isConsume `updates.total = ... - amount; updates.reserved = ... - amount`.

The status trigger does NOT absorb the approve step: on Pending -> Confirmed `v_was` and `v_now` are both true, so it returns early — leaving the admin's manual decrement as a pure second deduction. The mobile repo knows the trigger is authoritative (src/context/CartContext.tsx:24 'The real ceiling is enforced server-side by the inventory-hold trigger on reservation_items'); the admin repo does not.

**Failure scenario**

A customer reserves 1 of size M (inventory.available 5 -> 4, reserved 0 -> 1 via the trigger, at creation). Staff click Approve in the dashboard: the status trigger no-ops (Pending and Confirmed both hold stock) but adjustStockForReservation(res,-1) runs anyway, so available 4 -> 3 and reserved 1 -> 2 for a single unit. Two units are now held for one reservation, and products.stock (derived from available) under-reports, hiding sellable inventory. The cancel path is worse in the other direction: on Cancelled the trigger returns the unit (available += 1) and then `holdsStock('Confirmed')` is true so the admin returns it a second time, creating phantom stock that never existed and letting the boutique oversell a garment it does not have.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried hard to kill this and could not. Every load-bearing claim checks out against the actual files and the live database.

1. The triggers are not just in a migration file, they are LIVE. `SELECT tgname, tgenabled FROM pg_trigger ...` returns `trg_hold_inventory_on_reservation_item` (on reservation_items), `trg_apply_inventory_on_reservation_status` (on reservations) and `trg_release_inventory_on_reservation_item_delete`, all `tgenabled = 'O'` (enabled). No later migration disables them; 20260809010000_ultrareview_security_fixes.sql only CREATE OR REPLACEs `apply_inventory_on_reservation_status_change` to add a FOR UPDATE lock, keeping the same early-return logic.

2. The live `reservation_holds_stock` body is exactly as quoted (`pg_get_functiondef`): `NOT coalesce(_deleted,false) AND lower(coalesce(_status,'')) NOT IN ('completed','cancelled')`. So 'Pending' holds stock. Both `create_reservation` and `create_reservation_multi` insert reservations at 'Pending' and insert `reservation_items`, so the hold is taken at creation time by the AFTER INSERT trigger. On Pending -> Confirmed the status trigger's `IF v_was = v_now THEN RETURN NEW;` fires, so it genuinely does not absorb the approve step.

3. The admin code is present and reachable in one click. `src/utils/reservationActions.js` maps `Pending: { action: 'approve_pay', label: 'Approve' }`, and Reservations.jsx:775 wires `handleAction(res.id, PRIMARY_ACTION[res.displayStatus].action)`. So line 327 runs on the ordinary staff Approve button.

4. `updateReservation` (reservationService.js:218-236) is a plain `updateDocument('reservations', ...)` table UPDATE, so it fires the status trigger; the manual adjustment is an independent second write.

5. The manual write is not blocked by RLS. inventory has policy `Enable all access for admin/staff` USING/WITH CHECK `is_staff_or_admin()`, so a logged-in staff member's UPDATE of available/reserved/total succeeds (reservationService.js:311-319).

6. Nothing guards it: no comment, no feature flag, no check for whether the DB already moved the stock. The admin repo has zero references to the trigger (grep for hold_inventory / reservation_holds_stock across admin src returns nothing), and the mobile migration itself only mentions the admin repo to say it will not backfill counts staff maintain by hand (lines 36-38) - that is about the one-off backfill, not the lifecycle.

Where I do correct the reviewer: severity and the cancel narrative.
- The live DB currently holds only 5 reservations, all 'Cancelled', and my reconciliation query (sum of reservation_items quantity for holding reservations vs inventory.reserved) returns zero rows of drift. So no data is corrupted yet; this breaks on the first real reservation, not retroactively.
- The claimed "phantom stock that never existed" on cancel is overstated in the general case. Trace the full path with available=5: create 5->4, approve 4->3 (the double deduct), cancel gives +1 from the trigger and +1 from the admin, back to 5. The two errors cancel. The phantom only materialises when the double deduct hit the `Math.max(0, ...)` floor at line 314, i.e. exactly the low-stock case (total=1: create ->0, approve -> clamped 0, cancel -> 2 available against 1 physical unit). Reachable, but it needs the clamp.
- The impacts that are unconditional and permanent are: (a) while a reservation sits in Confirmed/To Pickup, two units are held for one, so a sellable garment reads as unavailable and `products.stock` (derived from available via sync_product_stock) under-reports; (b) on complete, the trigger does `total -= qty, reserved -= qty` and line 361's `adjustStockForReservation(res, 1, true)` repeats `total -= amount` (reservationService.js:311), so the physical count drops by 2 for every 1 unit handed over, permanently, with no path that restores it; (c) any cancel that does not go through the dashboard (customer in-app cancel, `expire_unpaid_reservations`) releases only once against a double deduct, leaving a unit stranded in reserved forever.

That is a real, deterministic, every-reservation inventory corruption bug in the shared source of truth, so it is well above "high" noise level - but the headline oversell is conditional and the happy path partially self-cancels, so 'critical' is inflated. High.

</details>

---

#### F12. Admin 'Sync Stock' recomputes reserved from a status list that excludes Pending, wiping holds the DB trigger legitimately took

- **Location:** `src/services/productService.js:471` _(admin-dashboard)_
- **Severity:** high
- **Found by:** Cross-repo consistency

**What is wrong**

`recalculateAllInventoryStock` is a destructive full recompute:

  line 471: `.in('status', STOCK_HOLDING_STATUSES);`
  line 492: `const newReserved = matching.reduce((sum, r) => sum + (r.quantity || 1), 0);`
  line 493: `const newAvailable = Math.max(0, (inv.total || 0) - newReserved);`

It then overwrites inventory.reserved and inventory.available with those figures.

STOCK_HOLDING_STATUSES (admin src/utils/reservationStatus.js:78) is `['Approved','Confirmed','To Pay','To Pickup','Fitting','Active']` and its docblock states the rule explicitly: 'Pending is deliberately excluded -- an unvetted request must never be able to lock stock.'

The migration implements the opposite rule. `reservation_holds_stock(_status,_deleted)` returns true for anything not completed/cancelled, so 'Pending' DOES hold stock, and the hold is taken at reservation_items INSERT — i.e. while the reservation is still Pending. The two repos state contradictory definitions of the same rule, and only one of them is enforced by the database.

Separately, line 493 derives available from `total`, but the trigger's pickup path reduces `total` when goods leave (`total = GREATEST(coalesce(i.total,0) - ri.quantity, 0)`), so the recompute's base has already moved under it.

**Failure scenario**

Three customers each have a Pending reservation for the last unit of size S; the trigger has correctly held all three (available 0, reserved 3). A staff member clicks 'Sync Stock' on the Inventory page (src/pages/catalog/Inventory.jsx:454) to fix an unrelated discrepancy. The query pulls only STOCK_HOLDING_STATUSES, matches none of the three Pending rows, computes newReserved = 0 and newAvailable = total, and writes that back. The three live holds vanish, the size shows as fully in stock, and the mobile app happily accepts further reservations for a garment that is already promised three times over. Nothing errors; the sync reports success.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I could not refute the core finding. I read the cited file rather than trusting the summary, and every load-bearing claim reproduced: the code at productService.js:471/492/493 is verbatim as quoted, STOCK_HOLDING_STATUSES excludes Pending with a docblock asserting that as the intended rule, and the live database (queried directly, not inferred from migration files) defines reservation_holds_stock to return true for Pending with the hold taken at reservation_items INSERT — while create_reservation_multi creates the parent with status 'Pending'. The two repos really do encode opposite definitions of the same rule, and only the DB's is enforced.

I worked through every refutation angle available. There is no earlier guard in the function. There is no server-side check that makes the client write moot — the opposite, RLS explicitly permits staff to UPDATE inventory. No later migration redefines the predicate, and no later commit fixes the client list; the admin-side consolidation (2026-08-06) predates the contradicting triggers (2026-08-08), which is precisely how the drift was introduced. The button is not gated by the canManageLookups permission that guards the control next to it.

Two things did not survive scrutiny, and I am correcting them rather than passing them along. The reviewer's headline scenario — three Pending holds on a single last unit — is impossible, because the trigger's own availability check rejects the second INSERT. The defect is real but requires stock >= 3 to demonstrate; the reviewer picked numbers the trigger forbids. And the secondary complaint about deriving available from total is simply wrong: the pickup path reduces total and reserved while leaving available fixed, which maintains total = available + reserved and makes line 493 correct. I verified that by walking the arithmetic. I also found the reviewer understated scope, since 'Request Approval' is a valid status with the same mismatch.

On severity I considered downgrading. The trigger condition needs a staff click, and the live DB currently holds only five Cancelled reservations with sum(reserved)=0, so nothing is broken right now. But that is an empty-data condition, not a mitigation — it reflects a pre-launch dataset, and the defect arms itself the moment normal reservations flow. What keeps this at high is that the harm is silent and self-inviting: the button is labeled "Fix & Sync Stock" and is exactly what staff reach for when inventory numbers look wrong, the operation reports success, and it destroys every live Pending and Request Approval hold at once. The consequence is overselling individual boutique garments that are then physically unavailable at handover. I also noticed the admin app separately double-deducts at approval (Reservations.jsx:327 calls adjustStockForReservation(res, -1) on top of the trigger's INSERT-time hold, and the Pending -> Confirmed transition is a no-op for the status trigger since both statuses hold), which makes visible stock drift more likely and therefore makes staff more likely to click the very button that causes the data loss. That argues for keeping high, not lowering it.

</details>

---


### MEDIUM

#### F13. Two SECURITY DEFINER staff RPCs authorize with a raw role lookup that skips deleted and is_blocked

- **Location:** `supabase/migrations/20260807143823_settle_reservation_balance_rpc.sql:28` _(migrations)_
- **Severity:** medium
- **Found by:** Migrations / RLS security

**What is wrong**

settle_reservation_balance() is SECURITY DEFINER (so it bypasses the admin-only UPDATE policy on reservations) and its entire authorization is lines 27-30:

  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'staff', 'owner') THEN
    RAISE EXCEPTION 'Only staff can record a balance.';

resolve_reschedule() in supabase/migrations/20260807145303_reschedule_request_rpcs.sql:85-88 repeats the identical pattern verbatim.

Unlike is_staff_or_admin() -- which these two could have called, and which verify_pickup() (20260729054158:29) and process_account_deletion() (20260808074327:47) do call -- neither predicate filters `deleted = false`, and neither checks `is_blocked`. So these two RPCs are strictly weaker than every other staff entry point in the schema: they accept a soft-deleted profile that is rejected everywhere else. Both are granted to `authenticated` (verified live: has_function_privilege('authenticated', ...) = true for both).

settle_reservation_balance is the sole record that cash was collected at handover, and resolve_reschedule rewrites a live booking's date and appointment_time.

**Failure scenario**

A staff member is offboarded by soft-deleting their profile (deleted = true) -- the state is_staff_or_admin() is designed to reject and which the admin dashboard treats as removed. Their auth login still works. They POST /rest/v1/rpc/settle_reservation_balance {"_reservation_id":"<any id>","_method":"cash"} and the row is stamped balance_settled_at = now(), balance_settled_by = <their id>, falsely recording that an outstanding balance was collected -- writing off real money owed, with no other record of collection anywhere in the system. The same account can POST /rest/v1/rpc/resolve_reschedule {"_reservation_id":"<any id>","_approve":true} to move any customer's appointment.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding survives every refutation attempt, verified against both the migration files and the live database.

CONFIRMED:
1. Code is present verbatim and matches live. pg_get_functiondef on the live DB shows settle_reservation_balance and resolve_reschedule both still contain the bare role lookup with no deleted filter. Notably the very next statement in each function DOES filter COALESCE(deleted,false)=false -- but on the reservations table, not profiles.
2. No later migration fixes it. Only 4 files repo-wide reference these functions (the two migrations plus their rollbacks).
3. The asymmetry is real. Live is_staff_or_admin() is: SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid() AND deleted = false. verify_pickup (20260729054158:29) and process_account_deletion (20260808074327:47) both call it; these two RPCs do not.
4. Grants confirmed live: has_function_privilege('authenticated', ...) = true, anon = false, for both.
5. PRECONDITION IS LIVE, NOT HYPOTHETICAL. A profile exists today with role='staff' AND deleted=true whose auth.users row still exists, is not banned, has no deleted_at, and has an encrypted_password. Staff archiving is a real product surface (staffService.js:22 "the archived-staff tab also receives deleted rows") and that path never revokes the credential -- only the customer-deletion Edge Function calls auth.admin.deleteUser.
6. No compensating server-side control. The five non-internal triggers on reservations (inventory, notification, payment-due, touch_updated_at, time validation) check no actor identity. SECURITY DEFINER bypasses the admin-only UPDATE policy by design. The dashboard's deleted===true rejection (AuthContext.jsx:174-187) is client-side React calling supabase.auth.signOut() and cannot stop a direct PostgREST call with a valid JWT.

REVIEWER OVERREACH CORRECTED:
- The is_blocked half of the claim is wrong as a differentiator: is_staff_or_admin() does not check is_blocked either, so these RPCs are not weaker than other staff entry points on that axis. Only the deleted axis holds.
- Not "any id": settle requires undeleted + unsettled + payment_status='paid' + outstanding>0; resolve requires reschedule_requested_at IS NOT NULL. Narrower than described, though for settle those guards select exactly the rows where money is genuinely owed.
- balance_settled_by = v_actor does attribute the action, contradicting "no other record anywhere in the system."

SEVERITY DOWNGRADE high -> medium: requires a former staffer who retains their password and issues raw API calls (post-offboarding insider, not anonymous). Single-use per reservation, and self-attributing. The sole live instance has never signed in (last_sign_in_at IS NULL), so current exposure is near zero; the durable cost is that every future offboarded staff member inherits the gap. Real defense-in-depth defect on a money-recording path with a one-line fix (call is_staff_or_admin()), but not high.

</details>

---

#### F14. Unattended-reservation alert can never fire: status='pending' vs the enforced 'Pending' vocabulary

- **Location:** `supabase/migrations/20260809120000_unattended_reservation_alerts.sql:24` _(migrations)_
- **Severity:** medium
- **Found by:** Migrations / RLS security

**What is wrong**

The function filters on a lowercase literal:

  SELECT count(*) INTO unattended_count
  FROM public.reservations
  WHERE status = 'pending'
    AND created_at < now() - interval '15 minutes';

and line 8 builds the supporting partial index with the same predicate (`WHERE status = 'pending'`).

But reservations.status is capitalized and constrained. Verified live, `reservations_status_check` is present AND validated (convalidated = true):

  CHECK (status = ANY (ARRAY['Pending','Request Approval','Confirmed','Approved','To Pay','To Pickup','Fitting','Active','Completed','Cancelled']))

So `status = 'pending'` is provably unsatisfiable -- the constraint makes the lowercase value impossible to store. Live data confirms it: `SELECT count(*) FROM reservations WHERE status='pending'` = 0, and the only distinct value present is 'Cancelled'. Every other status comparison in this schema uses `lower(coalesce(status,''))` (expire_unpaid_reservations, is_awaiting_payment_status, reservation_holds_stock, assert_bookable_slot); this one does not.

The cron job is live and running: cron.job id 3, 'check-unattended-reservations-cron', '*/5 * * * *', active = true.

Secondary defect in the same file, line 32: the webhook Authorization header is a literal placeholder -- 'Bearer anon_key_placeholder' -- so even with a correct predicate the POST to /functions/v1/send-unattended-alert would be rejected 401.

**Failure scenario**

A customer books a fitting and nobody at the boutique looks at the queue. The alerting the shop believes it installed on 2026-08-09 fires every 5 minutes, counts 0, and returns silently -- forever. Staff are never paged, the reservation sits unattended past the appointment, and the failure is invisible because the cron job reports success. The index reservations_pending_unattended_idx is likewise permanently empty.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

Could not refute -- the finding survives every refutation avenue and is if anything understated.

1. Code is there as claimed. Read the file in full: line 24 filters WHERE status = 'pending' and line 8 builds the partial index on the same predicate. Verbatim match to the report.

2. Not fixed later. 20260809120000 is the newest migration touching this; a repo-wide grep for check_unattended_reservations / unattended / send-unattended-alert returns hits in this file ONLY. The single later commit on the file (168e87f, "pin search_path and revoke public execute") addressed the SECURITY DEFINER hardening and left the predicate untouched. Working tree is clean, so what is on disk is what shipped.

3. No guard, no documented tradeoff. There is no earlier filter, no normalizing CTE, and no comment acknowledging the case mismatch. The opposite is true: this file is the only place in the schema comparing reservations.status by raw equality. assert_bookable_slot, configurable_slot_capacity, and the reschedule RPCs all use lower(COALESCE(status,...)), which is the established house pattern the author departed from.

4. Failure is not just reachable, it is already happening in production. I confirmed against the live DB rather than trusting the report: reservations_status_check exists with convalidated = true and permits only capitalized values, so the CHECK makes 'pending' impossible to ever store -- this is provable unsatisfiability, not an empty-table coincidence. A direct expression test returned lowercase_pending_allowed = false. The deployed function body still contains the lowercase literal. The index exists live with the dead predicate and is permanently unpopulated. cron job 3 is active and has run 19 times, every run reporting 'succeeded' with zero failures -- empirically the silently-passing-forever behavior the reviewer described.

5. Reviewer under-reported the secondary defect. The Authorization header is a placeholder as claimed, but the webhook is broken on an independent second axis: the target edge function send-unattended-alert does not exist in this project at all. So even with a corrected predicate AND a real token, the POST 404s. The feature is dead three ways over, which suggests it was merged as unfinished scaffolding -- yet the cron was scheduled active in production regardless.

Severity: holding at medium, deliberately not inflating. Real impact is a monitoring/alerting gap on a live cron that fails invisibly -- squarely the known bug pattern #1 in this codebase (a migration applies cleanly, plpgsql bodies are opaque, break surfaces only at runtime and silently). But it is not high: no data loss, no security exposure, no customer-facing breakage, no privilege escalation, and staff retain the admin-dashboard queue as an existing path to see reservations. It is also a never-worked new feature rather than a regression that removed working capability. Not low either, because it is live, active, and the shop believes alerting was installed on 2026-08-09. Medium as claimed is the honest call.

Recommended fix is the house pattern already used elsewhere: lower(coalesce(status,'')) = 'pending' in both the function and the index predicate (index must be rebuilt, as a partial-index predicate cannot be altered in place), plus wiring a real edge function and pulling the token from vault/settings instead of a literal. Also note this migration ships without the .rollback.sql that CLAUDE.md requires -- separate from this finding, but worth flagging when the fix lands.

</details>

---

#### F15. Admin-only products UPDATE policy silently blocks the review-rating trigger for customer reviews

- **Location:** `supabase/migrations/20260719150000_restrict_staff_write_rls.sql:33` _(migrations)_
- **Severity:** medium
- **Found by:** Migrations / RLS security

**What is wrong**

This migration installed the policy that makes products writable only by admin/owner:

  CREATE POLICY "Enable write access for admin and owner"
  ON public.products FOR ALL
  USING (public.is_admin_or_owner())
  WITH CHECK (public.is_admin_or_owner());

Live, the only UPDATE-capable policies on products are that one and "Allow admins to edit inventory columns on products" (also admin/owner). "Public read products" is SELECT-only.

public.update_product_rating() is the AFTER INSERT OR UPDATE OR DELETE trigger on public.reviews (trigger_update_product_rating) and it is SECURITY INVOKER -- verified live, prosecdef = false. Its body does:

  UPDATE public.products
  SET rating = (SELECT COALESCE(AVG(rating),0) FROM public.reviews WHERE product_id = NEW.product_id),
      review_count = (SELECT COUNT(*) FROM public.reviews WHERE product_id = NEW.product_id)
  WHERE id = NEW.product_id;

Running as the reviewing customer, RLS filters that row out. An UPDATE that matches no visible row affects 0 rows and does NOT raise -- so the trigger returns success and the review insert commits. Verified with a rolled-back probe impersonating a live customer profile: `customer UPDATE products rows_affected=0`.

This is the same shape as the create_reservation SECURITY INVOKER trap already recorded in CLAUDE.md, except it fails silently instead of erroring: the write path succeeds and only the derived column is wrong.

**Failure scenario**

A customer submits a 5-star review. The row lands in public.reviews and renders in ReviewsList, but products.rating and products.review_count are never updated because the invoker-context trigger's UPDATE is filtered to 0 rows. Star ratings shown on Home, Explore and the product card stay frozen at whatever an admin last wrote, for every product, indefinitely -- and deleting a review likewise leaves the inflated count in place. Only reviews inserted or edited by an admin/owner session move the aggregate.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

Finding CONFIRMED after five independent refutation attempts, all of which failed.

1. Is the cited code there and as described? Yes. supabase/migrations/20260719150000_restrict_staff_write_rls.sql lines 33-36 create "Enable write access for admin and owner" ON public.products FOR ALL USING/WITH CHECK public.is_admin_or_owner(), exactly as quoted. Live pg_policy on public.products confirms only three policies: that one (polcmd='*'), "Allow admins to edit inventory columns on products" (polcmd='w', also admin/owner), and "Public read products" (polcmd='r', SELECT-only). No customer-writable UPDATE path exists.

2. Is update_product_rating really SECURITY INVOKER? Yes. Live pg_proc: prosecdef=false. It does carry SET search_path TO 'public','pg_temp' (added by 20260722172736_pin_search_path_remaining_functions.sql:15), but pinning search_path does not alter the security context. Trigger trigger_update_product_rating AFTER INSERT OR DELETE OR UPDATE ON public.reviews is live and enabled (tgenabled='O').

3. Already fixed by a later migration? No. Repo-wide grep for update_product_rating returns only two migrations touching it: 20260720151000_lock_rpc_execution.sql:41 (REVOKE EXECUTE) and 20260722172736:15 (search_path). Neither converts it to SECURITY DEFINER. No fix exists, applied or unapplied.

4. Does the insert path elevate the context? No. src/components/ReviewModal.tsx:82 is a direct PostgREST write (supabase.from('reviews').insert), not an RPC, so the AFTER trigger runs as the authenticated customer. The sibling BEFORE trigger set_review_verified_purchase IS SECURITY DEFINER, but a DEFINER BEFORE trigger does not change the context of a separate INVOKER AFTER trigger.

5. Is RLS actually enforced on products? Yes. relrowsecurity=true, relowner=postgres; authenticated is not the owner and has no BYPASSRLS.

6. Is the derived column actually consumed? Yes, on four surfaces: app/product/[id].tsx:358-363 renders product.rating.toFixed(1) and review_count; app/(tabs)/explore.tsx:515-518 powers the "Best Rated" sort; app/(tabs)/index.tsx:91-93 sorts the trending grid; src/utils/recommendations.ts:36 weights recommendation score.

DECISIVE PROOF - paired rolled-back live probes, identical INSERT, differing only in impersonated caller (see supporting_evidence). Customer: review row commits, products.rating stays 0. Admin: same insert, products.rating becomes 5.0. Confirms the cause is specifically RLS filtering, not a broken trigger. No error is raised in the customer case, so the write path reports success.

Live data is worse than the finding states: reviews currently has ZERO rows, yet products carry seeded aggregates (Cashmere Mockneck Sweater rating 4.7 / review_count 42; High-Rise Skinny Jeans 4.3 / 204). Those fabricated seed values will never be corrected by real customer reviews.

Two minor overstatements in the finding, neither load-bearing: Home and Explore use rating for SORTING, not star rendering (only the product detail page renders stars from products.rating); and src/components/ReviewsList.tsx:78-80 computes its own average from fetched review rows, so the reviews section itself displays correctly. Drift is confined to the denormalized products columns.

SEVERITY: medium is honest. Reachable by every customer via the normal UI, fails silently and permanently, corrupts a user-visible rating plus two sort orders and recommendation ranking. Not high/critical: no security impact, no privilege escalation, no data loss, and the columns are derived and backfillable. Not low: user-visible and silently permanent.

ADDITIONAL: the TG_OP='DELETE' branch has the identical defect, so review deletions leave inflated counts. Separately noted in passing - the live reviews INSERT policy lacks the r.status IN ('Completed','Active') filter specified at supabase/migrations/20260809003000_require_completed_reservation_for_reviews.sql:39, suggesting that migration is not applied to the live DB.

</details>

---

#### F16. Legacy create_reservation prices the deposit off one unit while holding _quantity units of stock

- **Location:** `supabase/migrations/20260805231149_create_reservation_multi.sql:237` _(migrations)_
- **Severity:** medium
- **Found by:** Edge functions + payments

**What is wrong**

The live, `authenticated`-executable RPC `public.create_reservation(...)` computes the amount owed from the unit price only and never multiplies by the client-supplied `_quantity`:

'''sql
  IF v_option = 'full' THEN
    v_deposit := round(v_product.price, 2); v_payment_type := 'Full';
  ELSE
    v_deposit := round(v_product.price * 0.5, 2); v_payment_type := 'Deposit';
  END IF;
'''

yet the same body writes the client's quantity straight through, twice — into the parent row (line 257: `NULLIF(_size, ''), NULLIF(_color, ''), _quantity,` with `rental_price` set to the bare `v_product.price` on line 258) and into the child line (lines 264-270: `..., _quantity, v_product.price`).

I confirmed this is the definition currently in the live DB (`pg_proc.prosrc` for `public.create_reservation` contains exactly `v_deposit := round(v_product.price * 0.5, 2)`), and that it is still granted: `has_function_privilege('authenticated', ..., 'EXECUTE') = true`, `anon = false`.

The header comment of this very migration documents the bug and fixes it only in the new multi-item RPC: "A line's cost is unit_price * quantity. The old RPC ignored quantity when computing price, so reserving 3 of something charged for 1. No existing row has quantity > 1 and the app hardcodes 1, so nothing in flight changes." The rewritten legacy function below it kept the defect, and the mitigation offered ("the app hardcodes 1") is client-side only — `app/reserve/[id].tsx` calls `create_reservation_multi`, but nothing stops a direct PostgREST call to `create_reservation`.

The downstream money path compounds it: `settle_reservation_balance` (supabase/migrations/20260807143823_settle_reservation_balance_rpc.sql:54) computes `v_outstanding := COALESCE(v_res.rental_price, 0) - COALESCE(v_res.deposit, 0)` — i.e. off the same single-unit `rental_price`. And `hold_inventory_for_reservation_item` reserves `NEW.quantity` units, so the goods really are held.

**Failure scenario**

Any logged-in customer POSTs to `/rest/v1/rpc/create_reservation` with their own JWT and `{"_product_id": "<uuid>", "_size": "M", "_quantity": 10, "_date": "...", "_appointment_time": "...", "_payment_option": "deposit"}`. For a PHP 3,000 dress: `deposit` = PHP 1,500, `rental_price` = PHP 3,000, `quantity` = 10, and `reservation_items` holds 10 units of size M. payments-create then opens a PayMongo session for PHP 1,500 (it reads `reservation.deposit`, so its server-side amount resolution faithfully charges the wrong number). At pickup `settle_reservation_balance` reports PHP 1,500 outstanding. Total collected: PHP 3,000 for 10 dresses worth PHP 30,000 — a PHP 27,000 loss on one reservation, repeatable, bounded only by `inventory.available`.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding survives scrutiny on the facts. I read the full file rather than the summary, and the quoted code is present verbatim at the cited location: the legacy create_reservation prices the deposit off v_product.price with no multiplication by _quantity (lines 234-238), while writing _quantity into both the parent reservations row (line 257) and the reservation_items child (lines 264-270), with rental_price set to the bare unit price (line 258). The only quantity validation is a positivity check at line 211.

I independently verified the live database rather than trusting the reviewer's assertion: pg_proc confirms create_reservation is present, SECURITY DEFINER, EXECUTE-granted to authenticated (anon false), and its body still contains 'v_product.price * 0.5'. I searched every migration for a later redefinition and found none -- the two most recent migrations touching this area (20260808123756 inventory holds, 20260809010000 ultrareview fixes) only reference it in comments. I checked for compensating server-side controls -- CHECK constraints, the inventory hold trigger, and the payment edge function -- and none of them constrain price against quantity. The inventory trigger caps quantity at inventory.available but explicitly returns NEW when no inventory row exists, and in any case it does not correct the amount charged. So the defect is not already fixed, not unreachable in principle, and not a documented exculpatory tradeoff: the migration header at lines 14-18 admits the defect and justifies leaving it purely on client-side grounds ("the app hardcodes 1"), which is exactly the class of reasoning that has already caused a shipped bug in this project.

However, the claimed severity of high overstates the reachability of the loss, and the failure scenario as written is inaccurate on a material point. The reviewer describes payments-create opening a PayMongo session for the wrong amount as the automatic next step after the RPC call. It is not: the RPC creates the row as 'Pending' (line 158), and payments-create/index.ts:76-88 refuses any status other than 'confirmed' or 'to pay'. The live RLS policy on reservations restricts UPDATE to is_admin_or_owner() for both USING and WITH CHECK, so the attacker cannot promote their own reservation. Realizing the PHP 27,000 loss therefore requires a staff member to accept a reservation showing quantity 10 against a total of PHP 3,000, and then to physically hand over 10 units at pickup. There is also no in-app path to this RPC at all (the app calls create_reservation_multi at app/reserve/[id].tsx:201), and all existing rows have quantity 1, so nothing is currently exploited.

Net: a genuine server-side money-arithmetic defect in a live, authenticated-callable SECURITY DEFINER function whose only stated mitigation is client-side -- worth fixing, either by multiplying by _quantity or by revoking EXECUTE now that the app no longer calls it. But gated behind admin-only status promotion and physical handover, so medium rather than high.

</details>

---

#### F17. Re-opening a payment nulls provider_ref but never expires the old PayMongo session, and the webhook silently 200s the money away

- **Location:** `supabase/functions/payments-create/index.ts:146` _(edge function)_
- **Severity:** medium
- **Found by:** Edge functions + payments

**What is wrong**

When the reservation amount has changed since the last attempt, payments-create reuses the row and detaches it from the session that is already live at PayMongo:

'''ts
      const { error: resetError } = await admin
        .from("payments")
        .update({ provider_ref: null, amount_centavos: amountCentavos, status: "awaiting_payment" })
        .eq("id", existing.id);
'''

Nothing in this file calls PayMongo to expire or cancel the previous checkout session — the only outbound calls are the GET at line 124 and the POST at line 175. A PayMongo Checkout Session URL stays payable by anyone holding it until PayMongo's own expiry.

The webhook is the sole authority for crediting, and it resolves the payment strictly by session id (index.ts:108-117):

'''ts
      .eq("provider", "paymongo")
      .eq("provider_ref", sessionId)
      .maybeSingle();

    // 200 on an unknown session: retrying will not help, and a non-2xx makes
    // PayMongo redeliver indefinitely.
    if (!payment) return json({ received: true, ignored: "unknown session" });
'''

So once `provider_ref` is overwritten, a genuine `checkout_session.payment.paid` for the old session matches nothing, is answered 200, and is discarded. No row is written, no log line is emitted beyond the ignored response, and `last_event` is not recorded anywhere — there is no artifact left to reconcile against the PayMongo dashboard.

**Failure scenario**

Customer taps Pay on a PHP 2,500 deposit; payments-create opens session S1 and hands over the checkout URL. They background the app without paying. Staff correct the reservation (change the item, apply a price change, or switch payment_type Deposit->Full), so `deposit` becomes PHP 5,000. The customer taps Pay again: `existing.amount_centavos !== amountCentavos`, so the row is reset and relinked to a new session S2. The customer then finishes the S1 checkout still open in their GCash/browser tab. PayMongo captures PHP 2,500 into the merchant account and fires paid for S1; the webhook answers `{received:true, ignored:"unknown session"}`. The reservation stays unpaid, `expire_unpaid_reservations()` cancels it at the deadline, the customer is told "payment was not received in time", and the PHP 2,500 exists only in PayMongo with no matching row in `payments`.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding survives every refutation attempt. (1) The cited code is present verbatim at payments-create/index.ts:144-147, and it is not stale repo state -- get_edge_function("payments-create") returns version 5 ACTIVE with content byte-identical to the working tree, so this is the live deployed behavior. (2) No mitigation exists anywhere in the file: the only outbound PayMongo calls are the GET at line 124 and the POST at line 175, so the previous checkout session is never expired or cancelled. (3) The webhook has no fallback resolution path -- payments-webhook/index.ts:108-113 matches strictly on .eq("provider_ref", sessionId) with no secondary lookup by reservation_id or amount, and line 117 returns 200 with ignored:"unknown session", discarding the event. (4) No client-side reconciliation exists: src/lib/payments.ts:58-66 and both app/payment-return.tsx and app/payment/[paymentId].tsx only poll the payments row that the webhook never wrote.

My strongest refutation attempt actually failed on its own evidence. I hypothesized the claimed consequence was wrong because expire_unpaid_reservations() in 20260730051910_payment_before_confirm.sql:31 sweeps only status='pending', whereas payments-create refuses to open a session unless status is 'confirmed' or 'to pay' (line 76) -- which would have meant no auto-cancellation. But the later migration 20260731170719_confirm_then_pay.sql:204 supersedes that definition with lower(COALESCE(status,''))='confirmed' AND payment_status NOT IN ('paid','submitted'), and the notification trigger at lines 330-335 of the same migration emits exactly "was cancelled because payment was not received in time." The reviewer's claimed end-state is confirmed word for word.

Reachability holds. Reservations UPDATE is admin/owner-only (20260720140000_close_price_manipulation_vector.sql:53), which is precisely the actor the scenario names -- an Owner correcting a price or switching payment_type Deposit->Full mutates reservations.deposit, which payments-create reads at line 98 and compares at line 123. handlePayNow in app/reservations/[id].tsx:179 calls startReservationPayment unconditionally on every tap, so the reset branch is entered on a plain re-tap with no unusual client behavior.

The finding is in fact understated in one respect: the reset does not require an amount change at all. Line 123 also requires the GET at line 124 to yield a checkout_url, and the .catch(() => null) at line 128 means any transient network failure, 429, or 5xx from PayMongo falls through to the same reset at 144-147, orphaning a live payable session with no staff action involved.

Two minor overstatements do not change the substance: "no artifact left to reconcile against the PayMongo dashboard" overreaches, since the PayMongo dashboard itself holds the payment record and what is actually missing is the DB-side row; and "no log line is emitted" is true only of console.error, as Supabase edge function logs still record the invocation and its ignored response.

Severity medium is honest and I am not adjusting it. The funds land in the merchant's own PayMongo account rather than being lost, and manual reconciliation against PayMongo records is possible, so this is not high. But it is real money paired with a wrongly auto-cancelled reservation and a customer told their payment never arrived, so it is not low. It is not attacker-exploitable: no one gains a privilege or free goods, the customer simply pays and loses the reservation.

</details>

---

#### F18. Password-recovery pin is in-memory only; killing the app converts a reset link into a full login

- **Location:** `src/context/AuthContext.tsx:54` _(jezsy-mobile-app)_
- **Severity:** medium
- **Found by:** Mobile auth + session

**What is wrong**

`const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);` (AuthContext.tsx:54) is plain React state — it is never written to SecureStore/AsyncStorage and always initialises to `false` on a cold start. The recovery SESSION, however, IS persisted: `handleRecoveryUrl` calls `supabase.auth.setSession({access_token, refresh_token})` (src/utils/recoveryLink.ts:44) against a client created with `persistSession: true` (src/lib/supabase.ts:115), so the tokens are written to SecureStore by `ExpoSecureStoreAdapter.setItem`. On the next launch `supabase.auth.getSession()` (AuthContext.tsx:166) restores that session, no `PASSWORD_RECOVERY` event fires (that event only fires on link detection, and `Linking.getInitialURL()` returns null on a launch that is not from the link), so `isPasswordRecovery` stays false. The routing guard then falls straight through to the fully-authenticated branch:

'''
if (isPasswordRecovery) {
  if (!onResetPassword) router.replace('/(auth)/reset-password' as any);
} else if (!session) { ... } else {
  if (!profile || !profile.first_name) { ... } else {
    if (inAuthGroup) { router.replace('/(tabs)'); }
  }
}
'''
(app/_layout.tsx:158-176). The secondary guard in app/(tabs)/_layout.tsx:31 (`if (!session || isPasswordRecovery)`) reads the same in-memory flag and is equally blind after a restart. This is exactly the outcome the code's own comments say must not happen — AuthContext.tsx:25-29 ("otherwise the emailed link is a full login") and app/_layout.tsx:155-157.

**Failure scenario**

An attacker with one-time sight of a victim's password-reset email (shared/forwarded inbox, a device left unlocked, an intercepted email) opens the `jezsymobileapp://reset-password#...&type=recovery` link on a device with the app installed. The reset screen appears; instead of setting a password the attacker force-quits the app (or simply lets Android kill it). On relaunch the persisted recovery session is restored, `isPasswordRecovery` is false, and the guard routes to `/(tabs)` with full account access: profile PII (name, phone, DOB, full address), reservation history, the staff chat thread, body measurements. The victim's password is never changed, so nothing looks wrong to them, and `supabase.auth.signOut({scope:'others'})` (reset-password.tsx:53) never runs, so no other session is revoked. The same code path also silently grants permanent access to any user who merely abandons a reset midway.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The mechanism is real and I could not find any mitigation. Verified line by line:

1. src/context/AuthContext.tsx:54 is plain `useState(false)` with no SecureStore/AsyncStorage backing. The only writers are `beginPasswordRecovery()` called from app/_layout.tsx:100 and :107.

2. The reviewer's case is actually STRONGER than argued. src/lib/supabase.ts:116 sets `detectSessionInUrl: false`, so the SDK never parses a recovery URL on its own and the `if (event === 'PASSWORD_RECOVERY')` branch at AuthContext.tsx:184 is unreachable dead code in this app. The flag has exactly one source and it is volatile.

3. I confirmed persistence in the installed SDK rather than assuming it. node_modules/@supabase/auth-js/dist/main/GoTrueClient.js `_setSession`, non-expired path: `await this._saveSession(session); await this._notifyAllSubscribers('SIGNED_IN', session);`. So handleRecoveryUrl (src/utils/recoveryLink.ts:44) writes the recovery tokens through ExpoSecureStoreAdapter.setItem and emits SIGNED_IN, never PASSWORD_RECOVERY.

4. On relaunch, AuthContext.tsx:166 `getSession()` restores the persisted session; the flag is false; app/_layout.tsx:158 falls to the `else` branch and, with a populated profile, hits `router.replace('/(tabs)')` at :173. The defence-in-depth guard at app/(tabs)/_layout.tsx:31 reads the same in-memory flag and also passes. `autoRefreshToken: true` (supabase.ts:114) keeps the session alive indefinitely.

I searched for any persisted recovery marker, cold-start re-check, or server-side constraint (grep for isPasswordRecovery/recovery across app/ and src/) and there is none. The invariant stated in the code's own comments at AuthContext.tsx:25-29 and app/_layout.tsx:154-157 does not survive a process restart.

SEVERITY DOWNGRADE from critical to medium. The precondition is possession of the victim's password-reset link, which means read access to their inbox. An attacker in that position can already fully take over the account through the INTENDED flow: complete the reset at reset-password.tsx:48. The bug therefore grants no capability the attacker lacks. What it grants is stealth and durability: the victim's password is never changed so nothing looks wrong to them, and `supabase.auth.signOut({ scope: 'others' })` at reset-password.tsx:53 never runs, so the victim's own sessions are not revoked and the attacker keeps a self-refreshing session. That is a genuine escalation in persistence and detectability, not in access. The reviewer's secondary scenario ("any user who abandons a reset midway gets permanent access") is the legitimate user reaching their own account on their own device, which is an intent/UX break rather than a security breach and should not carry weight in the rating.

</details>

---

#### F19. App never checks profiles.deleted/is_blocked, so a GDPR-scrubbed account is walked back through re-entering all its erased PII

- **Location:** `app/_layout.tsx:168` _(jezsy-mobile-app)_
- **Severity:** medium
- **Found by:** Mobile auth + session

**What is wrong**

`process_account_deletion` erases PII by NULLing the profile columns and setting `deleted = true` (supabase/migrations/20260808074327_process_account_deletion_rpc.sql:120-138) — it does not delete the row. The edge function then calls `auth.admin.deleteUser`, and explicitly documents the failure path where that does not happen: it returns 207 with "Account data was erased, but the login could not be revoked" (supabase/functions/process-account-deletion/index.ts:104-112). The mobile app never reads `profile.deleted` (nor `profile.is_blocked`, which only appears in staff-side RLS predicates). Its only gate is:

'''
if (!profile || !profile.first_name) {
  if (!onProfileSetup) router.replace('/(auth)/profile-setup');
}
'''
(app/_layout.tsx:168-169). A scrubbed profile has `first_name = NULL`, which is precisely this branch. The user is routed into the setup wizard, whose submit does an unconditional `supabase.from('profiles').upsert({ id: user.id, email, first_name, last_name, phone, gender, date_of_birth, address_line, barangay, city, province, zip_code, ... })` (app/(auth)/profile-setup.tsx:222-238) with no `deleted` check. `AuthContext.syncProfile` does the same re-seed from OAuth metadata for the same reason — `if (existing?.first_name)` short-circuits only when a name is present, so the scrubbed row falls through to the upsert at AuthContext.tsx:119-132.

**Failure scenario**

Staff process a customer's deletion request; the DB scrub succeeds but `auth.admin.deleteUser` fails (the documented 207 path — expired service key, GoTrue hiccup) and staff do not immediately do the manual follow-up. The customer opens the app on their still-valid session, is silently redirected to profile-setup, and re-types name, phone, date of birth and full address straight back onto the row that was just erased — with `deleted` still true, so the record now looks deleted to staff while holding live PII again. The same absence means a customer flagged `is_blocked = true` in the admin dashboard keeps full mobile access.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried hard to kill this one and could not. Every cited line is verbatim-accurate, and I confirmed against the LIVE database that no server-side guard makes it moot. But the reviewer led with their weakest argument and buried their strongest, so the reasoning needs substantial correction even though the verdict stands.

WHAT I VERIFIED (live DB, not just files):
1. profiles RLS is exactly as claimed. `pg_policy` on public.profiles returns UPDATE = `(auth.uid() = id)` with check_expr NULL, INSERT = `(auth.uid() = id)`. No `deleted = false` predicate anywhere, no WITH CHECK on UPDATE. The client upsert is not blocked.
2. The one plausible server-side savior does NOT fire. `check_profile_updates_trigger` (BEFORE UPDATE on profiles) only raises when `NEW.deleted IS DISTINCT FROM OLD.deleted` (and role/employment_status/is_blocked). The profile-setup upsert omits all four columns, so `deleted` stays true, the IF is false, and the trigger returns NEW unchanged. Confirmed the trigger exists and confirmed its body at 20260727080400_cover_deleted_in_profile_guard.sql:23-28.
3. No later migration fixes it. Latest migration is 20260809130000; I read 20260809010000_ultrareview_security_fixes.sql (the only recent security-labeled one) and it touches stock movements, inventory reactivation, and a REVOKE — nothing about profile deleted/blocked state.

WHERE THE REVIEWER IS WRONG:
a) "AuthContext.syncProfile does the same re-seed" is imprecise. For an email/password user, `user_metadata` has no full_name/name, so fullName = "", firstName = "", and `first_name: firstName || null` writes NULL (src/context/AuthContext.tsx:111-126). Name is only re-seeded for OAuth users. Note also the path is src/context/AuthContext.tsx, not src/contexts/.
b) But this cuts AGAINST the reviewer's favor on one point they missed: syncProfile unconditionally writes `email: authUser.email ?? null` (AuthContext.tsx:124). auth.users still holds the email on the 207 path, so the scrubbed `profiles.email` is silently restored on every app open with zero user action. That is a stronger, fully automatic PII restore than the manual re-typing the reviewer described.
c) The reviewer missed the case that actually exists in production. A `deleted = true` profile that still HAS a first_name never hits the profile-setup branch at all — it falls through to the `else` at _layout.tsx:172 and gets full (tabs) access. Querying live, the only `deleted = true` row in the DB is exactly this shape (role staff, name present, email present, auth.users row still live). So the real current state is "soft-deleted account has unrestricted app access," not "scrubbed account re-enters PII."

WHY THE HEADLINE SCENARIO IS WEAK (and why this is not higher than medium):
The GDPR narrative needs a compound chain: deleteUser must fail (207), staff must skip the manual follow-up, the user must still hold a live session, and the user must voluntarily re-type everything. Live DB shows ZERO scrubbed customers — process_account_deletion shipped 2026-08-08 and has never been run on a customer. And the "harm" is a data subject re-entering their own data: no third party gains access, no disclosure, no privilege escalation. The genuine defect there is an inconsistent record (deleted=true holding live PII) that misleads staff — a data-integrity problem, not a confidentiality breach. On its own that half is LOW.

WHY IT STILL LANDS AT MEDIUM — the reviewer's last sentence, which is the real finding:
The is_blocked half needs no compound precondition. Staff clicking "block" is a routine, intentional moderation action. I confirmed it is a complete no-op for customers: `create_reservation` and `create_reservation_multi` are both SECURITY DEFINER and neither function body contains `is_blocked`; a scan of all policies on reservations/reservation_items/payments/reviews/messages for an is_blocked predicate returns the empty set; and `is_blocked` appears nowhere under app/. The `deleted = false AND is_blocked = false` clauses exist only inside staff/admin predicates (20260715000000_fix_rls_role_casing.sql, 20260728015959). So a blocked customer browses, reserves, and pays exactly as before — a shipped moderation control that silently does nothing.

IMPORTANT CORRECTION TO THE FIX LOCATION: this is not fixable at app/_layout.tsx:168 alone. A client gate there is cosmetic — the reservation RPCs are the trusted write path and they do not check is_blocked server-side, so a blocked user calling the RPC directly still transacts. This matches known bug pattern #5 in this codebase (client-side-only cap over an RPC with zero server-side validation).

</details>

---

#### F20. Reserving a subset of the bag clears the ENTIRE bag, deleting unreserved items

- **Location:** `app/reserve/[id].tsx:248` _(jezsy-mobile-app)_
- **Severity:** medium
- **Found by:** Mobile reserve/cart/inventory

**What is wrong**

cart.tsx:359-364 sends only the checked items: `params: { id: 'cart', itemIds: selectedItems.map((i) => i.id).join(',') }`. reserve/[id].tsx:133-136 correctly scopes the reservation to just those: `const selectedIds = itemIds ? new Set(itemIds.split(",")) : null; const scopedItems = selectedIds ? cartItems.filter((item) => selectedIds.has(item.id)) : cartItems;`. But the post-success cleanup is unscoped:

'''js
// Only clear the bag once the reservation is actually on the server,
// so a failed submit does not silently empty it.
if (isCartMode) {
  await clearCart();
}
'''

`clearCart()` (CartContext.tsx:163-166) does `setItems([])` and `AsyncStorage.removeItem(CART_STORAGE_KEY)` — it has no notion of the `itemIds` subset. There is no scoped remove call anywhere in this path even though `removeFromCart(itemId)` exists.

**Failure scenario**

A customer has 5 items in the bag, deselects 3 (wants a separate pickup visit for those, exactly as the footer copy at cart.tsx:376-380 instructs: "Reserve items individually to schedule separate visits"), and reserves the 2 selected. The reservation is created for the 2 correct items — and all 5 rows are wiped from state and from AsyncStorage. The 3 unreserved items are gone permanently with no undo; the customer must rediscover and re-add them, re-picking sizes and colors.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding holds; I could not refute it. All four cited locations say exactly what the reviewer claims, verified by reading the full files rather than the summary.

Not already handled: there is no earlier guard in submitReservation, and no server-side mechanism can compensate because the bag is client-only state (docs/ARCHITECTURE.md:123 documents CartContext as "AsyncStorage only (@jezsy_cart) -- never synced to the server until checkout"). clearCart wipes both React state and the AsyncStorage key, so the unreserved items are unrecoverable.

Not a documented tradeoff: the comment at lines 245-246 justifies only the TIMING of the clear (after server success, so a failed submit does not empty the bag), not the SCOPE. It is silent on the subset case.

Not already fixed by a later commit: `git log -- app/reserve/[id].tsx` shows 1ba2c5b as the most recent touch and the unscoped call is still present at HEAD. Working tree is clean for this file (git status shows only app/ar-tryon/[id].tsx and a migration modified).

The commit history settles intent. 6d741a3 "feat(inventory): server-side stock holds, correct per-size cap, selective reserve" is the commit that introduced selective reserve. Its diff to app/reserve/[id].tsx modifies only the param destructuring, the `lines` memo, and the memo deps -- the clearCart() call is untouched and not even in the diff context. The commit body describes scoping the reservation ("itemIds now scopes /reserve/cart to what's actually checked") and never mentions the cleanup. This is a half-completed refactor: the read path was scoped, the write path was not.

Reachability is real, not theoretical. Per-item checkboxes (app/cart.tsx:124-137) and Select all/Deselect all (95-97) make partial selection a first-class flow; the button is even labeled "Reserve selected ({selectedCount})" (371-373). Selection defaults to all items (65-83), so a user who never touches a checkbox is unaffected -- but any user who deselects hits the bug 100% of the time. On success the screen calls router.replace("/reservations") (line 266), so the emptied bag is not visible at the moment of loss; the user discovers it later with no undo.

Severity downgraded high -> medium. Impact is confined to one user's local bag: no money moves, no security boundary crossed, no server state corrupted, no cross-user effect, and the items are re-addable (at the cost of re-finding each product and re-picking size/color). This repo's "high"/"critical" bar is set by create_reservation failing closed for every customer and by the oversell hole -- silent local data loss in a subset of flows does not sit at that level. Medium is the honest grade.

One detail in the write-up is wrong and should not be repeated: the footer copy at app/cart.tsx:376-380 ("Reserve items individually to schedule separate visits") refers to the per-item Reserve button at 234-251, which routes to /reserve/[productId] with id = item.product.id, so isCartMode is false and clearCart never runs on that path. The reviewer used that copy to motivate the scenario, but the bug does not depend on it -- deselecting for any reason and pressing "Reserve selected" triggers it.

Fix is one line: replace clearCart() with per-item removeFromCart over the reserved keys when itemIds is present, falling back to clearCart only when it is absent (matching the existing fallback rationale at lines 130-132).

</details>

---

#### F21. Inventory hold trigger fails OPEN on any size string that matches no inventory row, and the RPC has no quantity ceiling

- **Location:** `supabase/migrations/20260808123756_reservation_inventory_holds.sql:93` _(migrations)_
- **Severity:** medium
- **Found by:** Mobile reserve/cart/inventory

**What is wrong**

`hold_inventory_for_reservation_item()` looks the row up on an exact key and silently allows the insert when it misses:

'''sql
SELECT i.available INTO v_available
FROM public.inventory i
WHERE i.product_doc_id = NEW.product_id
  AND i.size IS NOT DISTINCT FROM NEW.size
  AND i.deleted = false
FOR UPDATE;

-- No inventory row means this variant is not stock-tracked...
IF NOT FOUND THEN
  RETURN NEW;
END IF;
'''

This is the ONLY quantity enforcement in the entire write path. `create_reservation_multi` (20260805231149_create_reservation_multi.sql:86-89) validates nothing but positivity — `IF v_quantity < 1 THEN RAISE EXCEPTION 'Quantity must be positive.'` — no upper bound, and it passes the client's size straight through unvalidated at line 114: `'size', NULLIF(v_item->>'size', '')`. Nothing checks that the submitted size is a member of `products.sizes` or that an inventory row exists for it.

`IS NOT DISTINCT FROM` is exact and case-sensitive, so `'xs'` does not match a stored `'XS'`, and `NULL` matches nothing unless a NULL-size row exists. The migration's own header calls out that the client cap "is bypassable by calling the RPC directly" — but the server-side replacement it introduces has this hole in it.

**Failure scenario**

Any authenticated customer (the RPC is granted to `authenticated`, line 183 of create_reservation_multi.sql) calls `supabase.rpc('create_reservation_multi', { _items: [{ product_id: '<the one-off gown>', size: 'xs', color: null, quantity: 50 }], _date, _appointment_time })`. The lowercase `'xs'` matches no `inventory` row, `NOT FOUND` fires, the trigger returns NEW without checking or decrementing anything. A reservation for 50 units of an item the boutique owns 2 of is created at 50x the price, `inventory.available` is untouched so other customers can still reserve the same 2 units, and staff see a legitimate-looking accepted booking. Passing `size: null` on a size-tracked product does the same. Correct-case sizes ARE enforced, so this is specifically a fail-open on the key mismatch.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried to kill this four ways and it survived all of them.

Already fixed by a later migration? No — 20260809010000 re-creates only the sibling status-change function, leaving the hold path untouched, and the deployed function body matches the migration exactly.

Guarded elsewhere? No — the only quantity constraint is `quantity > 0`; the RPC validates positivity and a 20-LINE cap (not a per-line unit cap), and nothing in the RPC, an RLS policy, a CHECK, or another trigger validates that the submitted size is a member of `products.sizes` or has an inventory row.

Unreachable precondition? No — the RPC is granted to `authenticated`, all inventory sizes are uppercase, and there are no NULL-size inventory rows, so both `'xs'` and `null` land on `NOT FOUND` for every product.

Documented intentional tradeoff? This was the strongest refutation candidate, and it fails on the specifics. The comment justifies fail-open for "the legacy catalogue (products predating per-size inventory)" and cites stock.ts. But stock.ts's rule is product-level (`product.stock == null`), whereas the trigger applies it to a (product, size) key miss. Those are different conditions, and the difference is exactly the hole. The intended-beneficiary set is measurably empty: 0 of 21 public products lack inventory rows.

Where the reviewer overstated it, and why I downgraded high -> medium:

The headline scenario (50 units at 50x price) is the WEAKEST version of the bug. The attacker gains nothing — `create_reservation_multi` resolves price server-side and bills `unit_price * quantity` with a 50% deposit, so the attacker overcharges themselves, and a 50-unit booking on a one-off gown is conspicuous to the staff who must accept every reservation before any money moves. There is no privilege escalation and no data disclosure.

The defensible version of the same defect is quieter: reserve quantity 2 of the last 2 XS units using `size: 'xs'`. The trigger fails open, `inventory.available` for 'XS' stays at 2, and the booking looks completely ordinary to staff. A second customer then legitimately reserves those same 2 units. Two bookings, one pair of physical units, nothing anomalous on screen. That is a genuine integrity/oversell defect and it defeats the stated purpose of the migration that introduced it.

Bounding it to medium rather than high: exploitation requires a deliberate direct RPC call (the UI cannot emit a mismatched size), every reservation passes mandatory human review before payment, and I confirmed no benign client path currently trips it — all 5 live reservation_items rows match an inventory row, and the one 'One Size' product ("Woven Tote Bag") carries `sizes = ['One Size']` so the picker supplies the exact matching string. So this is a latent hole, not an actively-firing silent break.

Worth flagging for the fix: the correct condition is to fail open only when the PRODUCT has no inventory rows at all, and to reject when the product is tracked but the submitted size matches no row. That preserves the legacy-catalogue intent the comment actually wanted while closing the bypass.

</details>

---

#### F22. Quantity chosen by the customer is silently dropped on both single-item Reserve paths

- **Location:** `app/product/[id].tsx:657` _(jezsy-mobile-app)_
- **Severity:** medium
- **Found by:** Mobile reserve/cart/inventory

**What is wrong**

The product page has a full quantity stepper (lines 474-502) capped at `maxQuantity`, and `effectiveQuantity` is honoured by Add-to-Bag (line 619). The Reserve Now button beside it discards it:

'''js
router.push({
  pathname: "/reserve/[id]",
  params: { id: product.id, size: selectedSize || "", color: selectedColor || "" },
});
'''

No `quantity` param. reserve/[id].tsx:47-52 does not read one either (`useLocalSearchParams<{ id; size; color; itemIds }>`), and the non-cart branch hardcodes it at line 151: `return [{ key: product.id, product, size: size || undefined, color: color || undefined, quantity: 1 }];`

The same defect exists on the bag's per-item Reserve button (cart.tsx:236-245), which passes `id`, `size` and `color` but not `item.quantity`.

Nothing on the reserve screen surfaces the loss: the qty suffix at line 377 is gated on `line.quantity > 1`, which is now always false, and `linePrice` (line 316-319) multiplies by the same 1, so the summary shows a coherent-looking single-unit price.

**Failure scenario**

A customer selects size M, steps quantity to 3 (the page shows "6 available"), and taps Reserve Now. The reserve screen shows one item with no qty line and a subtotal of one unit's price; the server stores `quantity: 1`, holds 1 unit, and computes a 50% deposit on one unit. The customer pays the deposit believing 3 are held, arrives at the boutique to collect 3, and only 1 was ever reserved — the other 2 were resellable the whole time. Via the bag's per-item Reserve the same happens, and because `isCartMode` is false the item is also left sitting in the bag afterwards, so the customer can reserve it again and create a duplicate.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The mechanical claim holds exactly as described and I could not break it. app/product/[id].tsx:658 pushes only {id, size, color} to /reserve/[id]; app/reserve/[id].tsx:47-52 never destructures a quantity param, and its non-cart branch hardcodes quantity: 1 at line 151. app/cart.tsx:236-245 has the same omission on the per-item Reserve. The stepper is genuinely reachable at the same time as the button: both are gated on canPurchase (line 474 renders the stepper, line 662 enables Reserve), and effectiveQuantity is demonstrably wired up on the sibling Add-to-Bag at line 620, so this is a real dropped input, not a nonexistent control.

Nothing downstream recovers it. quantity drives server-side pricing (create_reservation_multi.sql:108, v_total := v_total + v_product.price * v_quantity) and the inventory hold trigger (reservation_inventory_holds.sql:97 and 106-108 check and decrement by NEW.quantity), so a hardcoded 1 really does hold one unit and price one unit. There is no CHECK, RLS policy, or later migration that reconstructs intent. The multi-item branch at app/reserve/[id].tsx:142 forwards item.quantity correctly, which confirms the flow is supposed to carry it.

I checked hard for an intentional-decision defense and it is not there. The only relevant comment, create_reservation_multi.sql:16-18 ("No existing row has quantity > 1 and the app hardcodes 1, so nothing in flight changes"), is a back-compat justification for changing the price formula, not a product decision that single-item Reserve should be one unit.

Severity downgraded from high to medium because the reviewer's impact narrative is partly wrong. (1) It is not fully silent: the reserve screen renders the single-unit figure four times before commit -- linePrice at line 390 and the Subtotal/To-pay/Balance rows at 515, 524, 533 -- so a customer who chose 3 sees one third of the expected price. (2) "The customer pays the deposit believing 3 are held" does not happen in this flow; nothing is charged at reservation time, as line 540 states and submitReservation confirms, and payment only opens after staff accept, putting a human review between the error and any money. (3) The resulting record is internally consistent (quantity, price, deposit, and inventory hold all 1) -- no oversell, no mischarge, no data corruption, no security exposure; the loss is user intent plus an expectation gap at pickup. (4) A correct path to the same outcome exists: Add to Bag preserves effectiveQuantity (line 620) and Reserve-all forwards it (line 142). The secondary "item stays in the bag" observation is accurate (clearCart at 247-249 is gated on isCartMode) but a quick-reserve that does not empty the bag is defensible, and the duplicate needs the customer to reserve the same item twice on purpose.

</details>

---

#### F23. Search-as-you-type has no cancellation or request-generation guard, so a slower earlier query overwrites newer results

- **Location:** `app/(tabs)/explore.tsx:272` _(jezsy-mobile-app)_
- **Severity:** medium
- **Found by:** Mobile screens

**What is wrong**

`useEffect(() => { if (isSearchActive) { fetchSearchResults(searchQuery); } }, [searchQuery, isSearchActive]);` (lines 272-276) fires one un-debounced Supabase query per keystroke. `fetchSearchResults` (line 234) ends with an unguarded `setSearchResults(data);` (line 261) — there is no cancelled flag, no AbortController, and no "is this still the current query" token. Contrast the products effect 50 lines below, which does exactly this correctly: `let cancelled = false; ... if (cancelled) return; ... return () => { cancelled = true; };` (lines 326-345).

**Failure scenario**

A customer types "dress" on a normal mobile connection. Five overlapping queries go out. If the response for "dre" (2 keystrokes earlier, broader OR-clause, more rows) lands after the response for "dress", it wins: the grid renders "dre" results while the input reads "dress" and the sticky header reads `${processedProducts.length} results found for "dress"` (line 881). The customer sees a result set that does not match their query and has no way to force a refresh other than editing the text again.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding holds. I read the cited code in full and every factual claim checks out: the effect at 272-276 fires one un-debounced Supabase query per keystroke, `fetchSearchResults` ends with an unguarded `setSearchResults(data)` at 261, and the only cancellation guard in the file is the products effect at 326-345 that the reviewer correctly cited as the in-file correct pattern.

I found no mitigation. There is no debounce helper imported (lines 1-37), no AbortController, and no competing search route that would make this dead code (glob `app/**/*search*` returns nothing; the TextInput is inline in the Explore tab header at 799-816). No RLS policy, trigger, or migration can address a client-side response-ordering race. The path is fully reachable by a normal customer typing in the search bar, and the stale render persists until the user types again since nothing re-fetches on its own.

Severity is inflated, though. The `orClause` at 246-249 is monotonic in the query text -- `name.ilike.%dre%` matches a superset of `name.ilike.%dress%`, and `subCategoryIdsMatching('dre')` returns a superset of the `'dress'` ids -- so in the exact forward-typing scenario the reviewer describes, the stale set is a SUPERSET: the customer sees everything they searched for plus extra items and an inflated count, and loses nothing. The genuinely-wrong-direction case is backspacing ("dresses" -> "dress"), where a stale narrower response can win and under-report. Either direction is display correctness only: no data corruption, no security exposure, no money, and it self-corrects on the next keystroke or on Cancel (handleBack clears searchResults at line 223).

Against this repo's calibration bar for high -- an RPC failing closed for every customer reservation, a trigger silently killing every review INSERT for weeks, reachable overselling -- a transient search-grid mismatch is not the same tier. Real and cheaply fixable (the `cancelled` pattern already exists 50 lines below), but medium.

Adjacent observation, not part of this finding: the search query at 251-256 has no `.limit()` or `.range()`, so a one-character query pulls every matching row with `*` plus the category embed. That is what makes the earlier broader request reliably the more expensive one, which is precisely what gives this race its window.

</details>

---

#### F24. Raw search text is interpolated into a PostgREST `.or()` filter, so any comma or parenthesis 400s the query and leaves the previous results on screen

- **Location:** `app/(tabs)/explore.tsx:247` _(jezsy-mobile-app)_
- **Severity:** medium
- **Found by:** Mobile screens

**What is wrong**

Lines 245-256 build the filter by string concatenation of unescaped user input:

'''
let orClause = `name.ilike.%${text}%`;
if (matchingCategoryIds.length > 0) {
  orClause += `,category_id.in.(${matchingCategoryIds.join(',')})`;
}
... .or(orClause);
'''

Comma is PostgREST's top-level separator inside `or=(...)`, and parentheses delimit groups. A search containing either splits the clause into fragments that are not valid `column.op.value` triples, so PostgREST rejects the request (PGRST100, HTTP 400). The failure is then invisible: supabase-js resolves rather than rejects, so the `try/catch` at lines 239-268 never fires the `showToast('Search failed...')` — control reaches `if (error) { console.error(...) }` (lines 258-259) and `setSearchResults` is never called, leaving the previous query's results in state.

**Failure scenario**

A customer searches "dress, red" or "gown (long)". The request becomes `or=(name.ilike.%dress, red%)`, PostgREST fails to parse it and returns 400. Nothing is shown to the customer: the grid keeps rendering the results of whatever they typed before the comma, under a header that reads `N results found for "dress, red"`. Only a console.error is emitted, so the failure is undetectable in production.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried to refute this on four fronts and it survived all of them.

1. Code exists as cited. Lines 245-256 of app/(tabs)/explore.tsx match the report verbatim.

2. No handling elsewhere. There is no sanitizer anywhere in src/ (the only sanitize* symbol is measurementPrivacy.ts, unrelated). Of the three `.or()` call sites in the repo, only explore.tsx:256 interpolates user input; messages.tsx:36 and TimeSlotPicker.tsx:137 use server-derived or literal values. postgrest-js `.or()` appends the raw string with zero escaping, unlike a single-column `.ilike()` where the value occupies its own query param and a comma is not a separator. No guard precedes the interpolation except the empty-string check at line 236.

3. The silent-failure mechanism checks out. The client is constructed without throwOnError, so an HTTP 400 resolves rather than rejects; the try/catch cannot fire and only console.error runs. setSearchResults is never called, so prior results persist.

4. Reachability is real and in fact worse than described. The search effect has no debounce, so the 400 triggers on the keystroke that enters the comma, and the header interpolates the live query text over the stale result array, producing an actively misleading "N results found for X".

Severity, however, is inflated. The reviewer said high. The `.eq('deleted', false)` and `.eq('visibility', 'public')` filters at lines 254-255 are emitted as separate AND'd query parameters, so no injected or-term can widen the result set past the publicly visible catalog. There is no disclosure, no privilege escalation, and no data-integrity consequence -- no hidden, soft-deleted, or private product becomes reachable. The blast radius is a broken search for queries containing a comma or parenthesis, plus a stale grid under a mismatched header. Against this codebase's calibration bar (silent write failure for every customer via SECURITY INVOKER create_reservation, overselling via missing server-side quantity validation, RLS bypass), a client-side search-availability bug with no server-side consequence is medium, not high.

</details>

---

#### F25. extractBodyRatios mixes x (normalized to frame width) and y (normalized to frame height) with no aspect-ratio term

- **Location:** `src/utils/poseDetector.ts:161` _(jezsy-mobile-app)_
- **Severity:** medium
- **Found by:** Mobile utils/context/hooks

**What is wrong**

MediaPipe normalized landmarks are x = px/image_width and y = px/image_height -- two different scales on a non-square frame. `src/utils/poseDetector.ts:160-161` treats them as one coordinate system:
    const dist = (a: Landmark, b: Landmark) =>
      Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

Every ratio at `src/utils/poseDetector.ts:206-213` then divides a mostly-horizontal span by a purely vertical one:
    const totalHeight = Math.abs(ankleY - noseY) || 1;   // line 158, pure y
    shoulderWidthRatio: shoulderWidth / totalHeight,     // line 206, shoulderWidth is ~pure x

Algebraically that is (dx_px/W) / (dy_px/H) = (dx_px/dy_px) * (H/W). There is no aspect-ratio compensation anywhere in the file or at the call site (`app/profile/body-scan.tsx:290`), so on a 9:16 camera preview every width-over-height ratio is inflated by 16/9 = 1.78x. `measurementCalculator.ts:176` then multiplies straight through: `shoulderWidth = bodyRatios.shoulderWidthRatio * heightCm`.

Corroborating evidence that the ratios come out too large: the expected bands hardcoded at `measurementCalculator.ts:222-226` (shoulderWidthRatio 0.18-0.35, bustWidthRatio 0.19-0.38) are the correct anthropometric values for a properly scaled ratio, and the inflated values fall outside them, so `ratioConfidence` returns its out-of-range floor of 0.5 (line 129).

**Failure scenario**

A 170 cm customer with a real 38 cm shoulder width and a ~151 cm nose-to-ankle span scans on a phone with a 9:16 preview. dx_px/dy_px = 0.252, but the returned shoulderWidthRatio is 0.252 * 1.78 = 0.448, so `computeMeasurements` reports a shoulder width of 0.448 * 170 = 76 cm -- double the truth. Because 0.448 is outside the 0.18-0.35 band, `ratioConfidence` also drops that field to 0.5, dragging `overallConfidence` down, so the scan looks merely 'low quality' rather than broken. armLength, torsoLength, legLength and inseam are skewed by the same factor in proportion to how horizontal each span is.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I could not refute this. I read the full file rather than the summary, and the code is present and says what the reviewer claims. The premise I most expected to break the finding -- that MediaPipe might hand back landmarks in one uniform coordinate space -- is disproved by the library's own helper, convert.ts:14-19, which denormalizes x by width and y by height. There is no aspect term at the call site, in the calculator, or in the burst averager, and no comment documenting it as an accepted approximation (the BodyRatios doc comment at poseDetector.ts:26 actually asserts the opposite, "relative to frame height", which is only true of the y-derived spans).

I am downgrading high to medium on impact, not on validity:
- The fit engine is largely insulated. src/utils/sizeRecommender.ts:86-112 scores only bust, waist, hips and inseam. shoulderWidth appears only in the type at line 6 and is never read by recommendSize, so the field the reviewer leads with is a stored/displayed number the user can edit, not a sizing input.
- On the default path the affected circumferences are overwritten. body-scan.tsx:337 requests `shouldOutputSegmentationMasks: true`, and finishScan (body-scan.tsx:175-189) replaces bust/waist/hips with circumferencesFromCrossSections, bypassing bustWidthRatio/hipWidthRatio entirely. The inflated ratios only reach the size recommendation on the explicitly coded no-mask fallback (body-scan.tsx:269, 307), where they do cause real damage -- an inflated bustWidth drives every garment to `tooSmall` in sizeRecommender.ts:88 and recommendSize returns null.
- Two details of the report are overstated. legLength and inseam are near-vertical spans (poseDetector.ts:188-200), so their horizontal component is small and they are barely affected, not "skewed by the same factor". And the 1.78x figure assumes a 9:16 frame; a 4:3 stream gives 1.33x. I also could not confirm the on-device frame aspect: the native plugin pins rotation to PORTRAIT (PoseDetectorHelper.kt:240 `this.imageRotation = orientationToDegrees(Orientation.PORTRAIT)`) rather than deriving it from the frame, so the exact multiplier is unverified. The direction and the existence of the error are not in doubt either way.

Net: a real, systematic scale error in the headline body-scan output that averaging cannot correct and that is persisted to user_measurements, but confined in the default path to editable linear fields rather than the sizing decision. Medium, not high.

</details>

---

#### F26. Analytics "Total Revenue" counts unearned pipeline at current catalog price, contradicting the documented single source of truth and the Customers page

- **Location:** `src/pages/admin/Analytics.jsx:156` _(admin-dashboard)_
- **Severity:** medium
- **Found by:** Admin dashboard correctness

**What is wrong**

'''js
const list = filteredReservations.filter(
  (r) => r.status === 'Completed' || r.status === 'Confirmed' || r.status === 'Approved' || r.status === 'To Pickup' || r.status === 'Active' || r.status === 'To Pay',
);
list.forEach((r) => {
  const outfitName = r.productName || r.outfit;
  const item = catalog.find((c) => c.id === r.productId || c.name === outfitName);
  if (item) {
    rev += Number(item.price) || 0;
  } else {
    rev += Number(r.price) || Number(r.totalAmount) || Number(r.rentalFee) || Number(r.rentalPrice) || 0;
  }
});
'''

Three separate defects:

1. **Wrong status set.** `src/utils/reservationStatus.js` is the declared single source of truth and defines `EARNED_STATUSES = ['Completed']`, with an explicit rationale that a deposit is a liability until handover. Analytics ignores this module entirely (it imports nothing from it) and counts five additional non-earned statuses, including `Approved` and `To Pay` where *no money has been received at all*.

2. **Full price booked on a 50% deposit.** Even for statuses where money has landed, the full price is added. This is verbatim the regression `reservationStatus.js` documents at lines 101-107: "a customer who had paid 945 of 1890 had the full 1890 added to their lifetime spend". Analytics never consults `paymentType`/`deposit`, unlike `src/utils/reservationBalance.js`.

3. **Current catalog price, not the agreed price.** `item.price` is preferred over the reservation's own `rental_price`, so editing a product's price retroactively rewrites historical revenue.

The Customers page does it correctly — `src/services/customerService.js:174` reads `if (countsAsRevenue(r)) bucket.totalSpent += Number(r.rental_price) || 0;` — so the two views provably disagree. `Avg Reservation Value` (line 649) and `Revenue by Category` (line 195) inherit the bug. Category share diverges further: its fallback chain `r.price || r.totalAmount || r.rentalFee || item?.price || 0` (line 201) omits `rentalPrice`, and I confirmed `reservations` has no `price`, `total_amount` or `rental_fee` columns — so whenever the catalog lookup misses, the headline adds `rental_price` while the pie chart adds 0.

**Failure scenario**

The Owner opens Analytics to decide on restocking or payroll. "Total Revenue" for the month reports the full catalog price of every reservation that is merely Approved or awaiting payment — money that has not been earned and, for Approved/To Pay, not even received. If ten items at 5,000 each are approved but unpaid, the card reads 50,000 of revenue that does not exist. The same Owner then opens the Customers page, where lifetime spend for those same customers correctly reads 0, and the two screens cannot be reconciled. A staff member who raises a product's price from 3,000 to 4,000 also silently inflates every past month's reported revenue for that product.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding survives. I checked for every escape hatch and found none: no earlier guard in the useMemo (lines 153-168 are the whole computation), no later migration or commit that fixed it (the revenue-recognition fix a62177d "fix(revenue): recognise revenue at handover, not at deposit" landed in customerService.js and reservationStatus.js but never touched Analytics.jsx), no server-side correction possible because this is pure client-side aggregation over a `select('*')` subscription, and no comment documenting it as a deliberate pipeline-vs-revenue tradeoff. The reservationStatus.js header explicitly names Analytics as a page that must import from it, so this is drift the codebase already recognised and tried to prevent, not a difference of opinion.

Two corrections to the report, though.

Defect 2 is not a real third defect and is argued wrongly. The reviewer says full price should not be booked "even for statuses where money has landed" and points to reservationBalance.js as the model. That misreads both modules. reservationStatus.js:39-43 states the opposite on purpose: "Only 'Completed' qualifies, which conveniently makes cash and accrual agree: by the time staff hand the item over the balance has been collected in person, so the full price is both earned and received." At 'Completed', full price IS the documented-correct amount, and customerService.js:174 — the reviewer's own gold standard — also adds the full `rental_price` without consulting deposit. reservationBalance.js answers "what is still owed" (line 2), not "what was earned"; it is not the right model for a revenue figure. Once the status set is fixed to Completed-only, the deposit question disappears entirely. So defect 2 collapses into defect 1 rather than compounding it.

The category-share divergence is real but overstated. It only fires on a catalog lookup miss, and line 96 subscribes to products with `includeDeleted=true`, so soft-deleted products are still in `catalog` and still match. A miss needs a hard-deleted product or a null/renamed product reference. Live data shows 0 such rows right now.

Severity: high is not honest for this. It is a read-only aggregation on an admin-only page — no data written, no data lost, no security or RLS exposure, no customer-facing path, and nothing that fails closed or silently breaks a write (which is the bar the genuinely severe bugs in this codebase set: the dropped-table trigger, the INVOKER create_reservation, the overselling RPC). The concrete harm is that the Owner reads an inflated revenue card and cannot reconcile it against the Customers page. That is a genuine correctness bug in a reporting surface that contradicts an in-repo declared single source of truth, which puts it above low, but it is medium, not high.

One caveat worth passing up: because this file is in the admin-dashboard repo rather than the mobile app, whoever consumes this review should confirm the review was actually scoped to include that sibling repo. If the audit was meant to cover only jezsy-mobile-app, this finding is out of scope regardless of being correct.

</details>

---

#### F27. Dashboard caps every dataset at 100 unordered rows, truncating stock alerts and freezing headline totals

- **Location:** `src/pages/dashboard/Dashboard.tsx:90` _(admin-dashboard)_
- **Severity:** medium
- **Found by:** Admin dashboard correctness

**What is wrong**

'''js
const [resData, cusData, invData, arCount, outfitsData] = await Promise.all([
  getReservations(100),
  getCustomers(100),
  getInventory(100),
  ...
]);
'''

All three limits are hard-coded and the results are presented as complete totals.

**Inventory is the worst case, and it also clobbers good data.** `getInventory(100)` -> `getCollection('inventory', true, 100)` applies `.limit(100)` with **no `ORDER BY`**, so Postgres returns an arbitrary 100 rows. That result feeds `stockBreakdown` (line 148) and `lowStockItems` (line 159), rendered as the authoritative "Stock Health Alerts — {stockBreakdown.alerts} Items".

Worse, there are two writers to the same `inventory` state. The effect at line 135 subscribes via `subscribeToInventory` -> `subscribeToCollection('inventory', ...)`, which fetches the **full** table with no limit. But `loadDashboard` also calls `setInventory(invData || [])` with the truncated 100 rows, and it runs on mount, on a 5-minute interval (line 133), and on every realtime reservation INSERT/UPDATE via `useRealtimeSync(loadDashboard)`. So the complete list is repeatedly overwritten by an arbitrary subset.

**Headline stats are silently capped.** `totalReservations = reservations.length` (line 152) and `activeCustomers` (line 154) can never exceed 100, yet both render the label "Live from DB" with an upward trend arrow. `getCustomers(100)` also has no `ORDER BY`, so "Active Customers" counts an arbitrary 100 profiles.

**Failure scenario**

Once the boutique passes 100 inventory rows (40 products x sizes already puts it well past that), a size that has genuinely run out sits outside the arbitrary 100-row window and never appears in Stock Health Alerts. Staff keep accepting reservations for stock that does not exist. The behaviour is also intermittent and therefore untrustworthy: the realtime subscription loads the full inventory and the item correctly appears, then five minutes later (or the instant any customer places a reservation) `loadDashboard` overwrites state with the truncated set and the alert vanishes — then reappears on the next inventory change. Separately, once the shop passes 100 reservations the "Total Reservations" card is permanently pinned at 100 while still displaying "Live from DB", so the Owner reads a flat number as a real plateau.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

CONFIRMED on the inventory half, with live production evidence. Downgraded high -> medium.

Note on location: the cited path resolves to the SIBLING repo, C:\Users\carlv\admin-dashboard\src\pages\dashboard\Dashboard.tsx, not the mobile app. Nothing in jezsy-mobile-app is affected.

What I verified rather than assumed:

1. The code is there as quoted. Dashboard.tsx:87-93 hard-codes getReservations(100)/getCustomers(100)/getInventory(100).

2. The no-ORDER-BY claim is correct. supabaseService.js:93-103 getCollection applies `if (maxResults > 0) q = q.limit(maxResults)` with no .order() anywhere. customerService.js:35-45 likewise. So those two are genuinely an arbitrary window, not a top-N.

3. The two-writer race is real. subscribeToInventory (productService.js:114-116) -> subscribeToCollection(..., includeDeleted=true), whose doFetch at supabaseService.js:314-329 has NO limit — full table. Dashboard.tsx:135-138 writes that full set into `inventory`; Dashboard.tsx:96 writes the truncated 100 into the SAME state. loadDashboard fires on mount (132), on a 5-min interval (133), and on every reservation INSERT/UPDATE via useRealtimeSync (Dashboard.tsx:106 + useRealtimeSync.js:35,38 `listeners.forEach(cb => cb())`). The 3-min queryCache TTL (cache.js:51) is shorter than the 5-min interval, so each tick genuinely re-queries a fresh arbitrary 100.

4. It is reachable TODAY, not at some future scale. I queried the live DB (ref wufcmtndotfvxvvxkamv): inventory has 170 rows against the 100 cap.

The reviewer actually UNDER-diagnosed the mechanism. getInventory passes includeDeleted=true (productService.js:118-124), so the query is `select * from inventory limit 100` with no deleted filter — 76 of the 170 rows are soft-deleted and burn 45% of the limit budget before Dashboard.tsx:146 (`i.deleted !== true`) discards them client-side. Measured result: only 69 of the 94 active rows survive the window.

Why severity drops to medium:
- Dashboard is the ONLY truncated consumer. Every authoritative stock surface fetches unlimited: Inventory.jsx:65 uses subscribeToInventory (no limit), and ClothingCatalog.jsx:39, Inventory.jsx:259, ProductForm.jsx:448 all call getInventory() with no argument -> maxResults=0 -> no limit. Staff working the actual Inventory screen see correct data.
- "Staff keep accepting reservations for stock that does not exist" is overstated — reservation acceptance does not read this widget's state. The real damage is a wrong summary count and a missed restock nudge.
- The headline-stats half is NOT currently reachable: 5 reservations and 3 customer profiles against a cap of 100. The reviewer also implied arbitrariness for reservations, but reservationService.js:139 does `.order('created_at', { ascending: false })` — it is a genuine newest-100, not an arbitrary 100. That sub-claim is wrong.

</details>

---

#### F28. Unattended-reservation cron matches status = 'pending' but every writer stores 'Pending', so the alert can never fire

- **Location:** `supabase/migrations/20260809120000_unattended_reservation_alerts.sql:24` _(migrations)_
- **Severity:** medium
- **Found by:** Cross-repo consistency

**What is wrong**

The migration filters on lowercase 'pending' in two places:

  line 8:  `WHERE status = 'pending';`  (partial index reservations_pending_unattended_idx)
  line 24: `WHERE status = 'pending' AND created_at < now() - interval '15 minutes';`

Nothing in the system ever stores that value. The authoritative vocabulary is `reservations_status_check` (20260807143425, VALIDATEd by 20260807143718), which permits only title-case 'Pending' — lowercase 'pending' is rejected outright by the CHECK. Both creation RPCs insert the title-case literal: create_reservation_multi and create_reservation both `VALUES (..., 'Pending', 'Pending', v_payment_type, ...)`. The admin dashboard also writes title case (src/pages/customers/Reservations.jsx:577 `status: 'Pending'`, and the board column at :84).

Every other status comparison in this schema normalises first — `lower(COALESCE(r.status,'pending')) NOT IN ('cancelled','completed')` in assert_bookable_slot, `lower(coalesce(_status,''))` in reservation_holds_stock. This migration is the one place that compares raw, and it compares against a value the CHECK constraint forbids.

The cron job is live: `SELECT cron.schedule('check-unattended-reservations-cron','*/5 * * * *', ...)`.

**Failure scenario**

A customer submits a reservation and no staff member touches it. Every 5 minutes the scheduled job runs check_unattended_reservations(), the count query matches zero rows because the stored status is 'Pending' and the predicate asks for 'pending', unattended_count stays 0, the `IF unattended_count > 0` branch never runs, and no webhook is ever sent. Staff are never alerted, the reservation sits until expire_unpaid_reservations or the customer gives up. The job appears healthy in cron.job_run_details — it succeeds, it just always finds nothing. The partial index is likewise dead, indexing zero rows forever.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried to kill this finding on every available angle and could not. The claimed code is present at the cited lines, and the live deployed function body and index predicate are byte-identical to the file, so it is not a stale-file artifact. No later migration corrects it; notably commit 168e87f edited this very file for search_path/revoke hardening and left the casing bug in place.

The refutation attempt that mattered was whether something normalises the comparison or whether lowercase 'pending' could legitimately occur. The opposite is true, and provably so: `reservations_status_check` is live with convalidated=true and admits only title-case 'Pending'. My probe returned lowercase_pending_allowed_by_check=false. So the CHECK constraint does not merely make lowercase unlikely — it makes it impossible. `status = 'pending'` can never match a row, the IF branch can never run, and the partial index will index zero rows forever. The cron job is active on a 5-minute schedule, so it will keep reporting success while doing nothing, which matches known bug pattern #1 in this codebase (silently dead SQL that applies cleanly).

The finding is therefore real and correctly diagnosed. I am downgrading high to medium because the reviewer's failure scenario overstates the operational consequence. It frames the casing as the thing standing between staff and an alert, but two other defects sit behind it: the target edge function `send-unattended-alert` is not deployed at all, and the Authorization header is the literal string "Bearer anon_key_placeholder". Correcting the casing would change nothing observable. This is inert, never-verified scaffolding rather than a working safety net that broke. Staff also retain a primary path to unattended reservations through the dashboard's Pending board column, filter, and countdown timers, and there are currently zero Pending rows, so nothing has actually been missed. It is a genuine bug worth fixing — but it should be fixed as part of finishing the feature (deploy the function, supply a real key, normalise the predicate with lower()), not triaged as a high-severity operational failure.

</details>

---


### LOW

#### F29. Migration is recorded as applied but its DDL is absent from the live database

- **Location:** `supabase/migrations/20260809003000_require_completed_reservation_for_reviews.sql:26` _(migrations)_
- **Severity:** low
- **Found by:** Migrations / RLS security

**What is wrong**

supabase_migrations.schema_migrations contains version 20260809003000 / name 'require_completed_reservation_for_reviews', but neither object this file defines is present live.

The file replaces the reviews INSERT policy with a check that adds `AND r.status IN ('Completed','Active')` (line 39) and rewrites set_review_verified_purchase() with the same filter (line 18). Live state, read from pg_policy and pg_get_functiondef:

  - policy "Customers can insert reviews for reserved products" WITH CHECK is still the 20260808071552 version: ... AND ri.product_id = reviews.product_id AND (COALESCE(r.deleted, false) = false)  -- no status clause
  - set_review_verified_purchase() body is still the 20260808071541 version -- no `r.status IN (...)`

So the file-vs-database 1:1 invariant this project explicitly maintains is broken for this migration, and the intended tightening is not in force. This matters for any future audit that reads the file and concludes the gate exists.

**Failure scenario**

A customer books an item, the shop declines it and the reservation ends up 'Cancelled' (not soft-deleted -- which is exactly the state all 5 live reservations are in). Under the intended policy they could not review that product. Under the policy actually deployed, the reservation_items row still exists and r.deleted is false, so they can POST a 1-star review and set_review_verified_purchase() stamps verified_purchase = true on it -- a 'verified purchase' badge on an item that was never collected or paid for.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I could not refute this. All three legs of the claim verify independently.

FILE: supabase/migrations/20260809003000_require_completed_reservation_for_reviews.sql line 18 (inside set_review_verified_purchase) and line 39 (inside the recreated INSERT policy) both carry `AND r.status IN ('Completed', 'Active')`. The file is committed (df35a42), not a WIP scratch.

LEDGER: supabase_migrations.schema_migrations contains version 20260809003000, name 'require_completed_reservation_for_reviews'.

LIVE: pg_policy WITH CHECK for "Customers can insert reviews for reserved products" terminates at `AND (COALESCE(r.deleted, false) = false)` -- identical to the forward version at 20260808071552_reviews_require_reservation_on_insert.sql lines 19-32, with no status clause. pg_get_functiondef(set_review_verified_purchase) likewise has no `r.status IN` line.

Refutation angles tried and closed:
(1) Later migration re-created the objects -- No. 20260809010000_ultrareview_security_fixes.sql touches set_review_verified_purchase only at lines 101-103 (REVOKE EXECUTE), never CREATE OR REPLACE. Grep for 'review' across 2026081*.sql returns zero files.
(2) The '.rollback' suffix on the 20260808 ledger names means a rollback ran -- No. The rollback would have restored the single policy "Enable all access for own reviews or admin" (rollback file lines 5-12); live pg_policy instead shows the four split per-command policies from the forward file. Those ledger names are this project's known name drift.
(3) The migration's intent is itself broken via case mismatch, making non-application harmless -- No. reservations_status_check is ARRAY['Pending','Request Approval','Confirmed','Approved','To Pay','To Pickup','Fitting','Active','Completed','Cancelled'], matching the migration's capitalization exactly.
(4) Something else guards it -- No. pg_trigger on public.reviews yields only trg_set_review_verified_purchase (BEFORE INSERT, untightened) and trigger_update_product_rating. No CHECK constraint, no second policy. Client side, src/components/ReviewsList.tsx:244 mounts ReviewModal from the product view for any signed-in user and src/components/ReviewModal.tsx:82 does a bare supabase.from('reviews').insert(...), so RLS is the sole gate.
(5) Scenario unreachable -- the opposite. SELECT status, deleted, count(*) FROM reservations returns a single group: Cancelled / false / 5. Every live reservation sits in exactly the state the intended gate excludes and the deployed policy admits.

Severity: low is honest, not inflated. The 20260808071552 gate is still live, so a user still cannot review a product they never reserved; the regression is only the status refinement, letting a declined customer post a verified-badged review on an item never collected or paid for. No data exposure, no privilege escalation, no financial impact. The operationally meaningful half is the broken file-vs-database 1:1 invariant on a shared live DB with no staging -- the same silent-drift class that has bitten this project before -- which justifies keeping it as a real finding rather than dismissing it.

</details>

---

#### F30. Any Staff-role account can file and then process a deletion request for a customer who never asked

- **Location:** `supabase/migrations/20260729101500_account_deletion_requests.sql:56` _(migrations)_
- **Severity:** low
- **Found by:** Edge functions + payments

**What is wrong**

The staff policy on `account_deletion_requests` is `FOR ALL` and its INSERT side checks only the caller's role, never that the row is the caller's own:

'''sql
CREATE POLICY "Staff manage deletion requests"
  ON public.account_deletion_requests FOR ALL
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());
'''

Verified live in `pg_policies`: cmd `ALL`, qual `is_staff_or_admin()`, with_check `is_staff_or_admin()`. The customer-facing policy right above it is correctly bound (`WITH CHECK (auth.uid() = user_id AND status = 'pending')`), so the staff policy is the only unbound INSERT path — and `is_staff_or_admin()` returns true for plain `role = 'staff'`, not just admin/owner.

The processor accepts whatever request id it is handed. `process_account_deletion` (supabase/migrations/20260808074327_process_account_deletion_rpc.sql:47) gates on `IF NOT public.is_staff_or_admin() THEN` and then derives its victim purely from the row: `WHERE customer_id = v_request.user_id`, `UPDATE public.profiles ... WHERE id = v_request.user_id`. There is no check that the request was filed by the user it names, no second approval, and no undo. The Edge Function then escalates to credential destruction (supabase/functions/process-account-deletion/index.ts:101-102):

'''ts
const adminClient = createClient(supabaseUrl, serviceRoleKey);
const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
'''

This sits below the privilege bar the project set everywhere else: migration 20260719150000 deliberately took write access away from Staff ("staff lose write"), and the live `reservations` UPDATE policy is `is_admin_or_owner()`. So a Staff account may not edit a reservation row, but may permanently erase a customer.

**Failure scenario**

A rogue or phished Staff-role account (the admin-dashboard mints these) runs two calls: (1) `INSERT INTO account_deletion_requests (user_id, status) VALUES ('<any-victim-uuid>', 'pending')` via PostgREST — allowed by the ALL policy's `WITH CHECK (is_staff_or_admin())`; (2) `POST /functions/v1/process-account-deletion {"request_id": "<that id>"}`. Provided the victim has no live reservation and no `awaiting_payment`/`processing` payment, their measurements, wishlist, wardrobe, saved outfits, capsules, notifications and streaks are DELETEd, their reviews/logs/feedback/messages are severed from them, their profile name, email, phone, address and date of birth are NULLed, and `auth.admin.deleteUser` removes their login. None of it is recoverable, and the victim never requested deletion.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The MECHANICS hold up — I could not refute them. Every literal claim checks out against the live DB, not just the file:

- `supabase/migrations/20260729101500_account_deletion_requests.sql:51-56` is exactly as quoted. Live `pg_policies` confirms: policyname "Staff manage deletion requests", cmd `ALL`, roles `{authenticated}`, qual `is_staff_or_admin()`, with_check `is_staff_or_admin()`. The INSERT side is genuinely unbound to `user_id`.
- `is_staff_or_admin()` live body returns `coalesce(user_role IN ('admin', 'staff', 'owner'), false)` — plain `staff` passes. There are 6 live `role='staff'` profiles.
- The live body of `process_account_deletion` byte-matches the migration file; it gates only on `IF NOT public.is_staff_or_admin()` (line 47) and derives the victim purely from the fetched row.
- No triggers exist on `account_deletion_requests` (`pg_trigger` returns empty), no CHECK constrains `user_id`, and no later migration touches these policies.
- The Edge Function is deployed and ACTIVE (slug `process-account-deletion`, version 1), so `auth.admin.deleteUser` at index.ts:102 is genuinely reachable.

But the SEVERITY ARGUMENT is refuted, and it is the entire basis for "high". The reviewer wrote: "This sits below the privilege bar the project set everywhere else... So a Staff account may not edit a reservation row, but may permanently erase a customer." They checked `reservations` and generalized to a project-wide bar. The live policy on the table that actually holds the customer identity contradicts that premise directly:

  profiles / "Enable all access for admin/staff" / cmd ALL / roles {authenticated}
  qual: is_staff_or_admin()  with_check: is_staff_or_admin()

That is the identical unbound shape being flagged as anomalous. So a rogue Staff account can already run a single PostgREST call — `UPDATE profiles SET first_name=NULL, last_name=NULL, email=NULL, phone=NULL, address_line=NULL, date_of_birth=NULL, deleted=true WHERE id='<victim>'` — which reproduces essentially verbatim the profile-scrub block at 20260808074327_process_account_deletion_rpc.sql:120-138, and can DELETE profiles rows outright. The same pre-existing policies cover most of the rest of the RPC's blast radius: `user_measurements` (ALL, `(user_id = auth.uid()) OR is_staff_or_admin()`), `wardrobe_items` (same), `saved_outfits` (same), `reviews` (DELETE and UPDATE, `... OR is_staff_or_admin()`).

So the harms the failure scenario leads with — profile name/email/phone/address/DOB NULLed, measurements deleted, wardrobe and saved outfits deleted, reviews severed — are ALL already directly executable by that same actor without touching the deletion-request path at all. This is not a privilege escalation; it is a convenience wrapper over authority Staff already holds.

The genuine residual delta is narrow: (a) `auth.admin.deleteUser`, which is service-role-only and truly unavailable to Staff otherwise and truly irreversible, and (b) DELETEs against `wishlists`, `capsules`, `capsule_items`, `notifications`, `stock_notify_requests`, `announcement_dismissals`, `user_streaks` — I verified each of these has owner-only policies with no staff clause, but they are low-value personalization rows. It is also not covert: the RPC writes `processed_by = auth.uid()` (line 141), leaving an audit record of exactly which staff member did it.

Against this project's calibration bar — every customer reservation silently blocked, anonymous overselling via direct RPC, anon-callable DEFINER with unpinned search_path — an issue requiring an already-fully-compromised insider, whose marginal gain over that insider's existing authority is one credential deletion plus some wishlist rows, is low. Worth binding the policy's WITH CHECK (or splitting the FOR ALL into SELECT/UPDATE and letting the customer INSERT policy be the only insert path), but it is not high.

</details>

---

#### F31. Stock is held at reservation creation before staff acceptance or any payment, with no per-customer cap

- **Location:** `supabase/migrations/20260808123756_reservation_inventory_holds.sql:53` _(migrations)_
- **Severity:** low
- **Found by:** Edge functions + payments

**What is wrong**

The hold predicate treats every state except Completed/Cancelled as holding, which includes the initial 'Pending' state that `create_reservation_multi` writes:

'''sql
CREATE OR REPLACE FUNCTION public.reservation_holds_stock(_status text, _deleted boolean)
...
  SELECT NOT coalesce(_deleted, false)
     AND lower(coalesce(_status, '')) NOT IN ('completed', 'cancelled');
'''

`hold_inventory_for_reservation_item` fires AFTER INSERT on `reservation_items` and immediately does `available = available - NEW.quantity, reserved = reserved + NEW.quantity` (lines 106-111). Both creation RPCs insert `reservation_items` in the same transaction as the parent, whose status is hardcoded `'Pending'` with `payment_due_at` NULL (20260805231149_create_reservation_multi.sql:158-159). So the stock is committed before staff look at it and before a single centavo moves.

Nothing bounds how much one account can hold. `create_reservation_multi` caps a call at 20 lines (line 67) and rejects `quantity < 1` (line 87), but there is no upper bound on quantity beyond `inventory.available` itself, and no per-user reservation limit anywhere — I checked every trigger on `public.reservations` in the live DB: `trg_validate_reservation_time` enforces only store hours and a per-slot capacity (default 3) / optional per-day cap, both global rather than per customer, and neither rejects a date far in the future. `expire_unpaid_reservations()` cannot reclaim these rows either: it requires `payment_due_at IS NOT NULL`, which is only stamped when staff move the row to Confirmed/To Pay.

`products.stock` is derived by summing `inventory.available` (per this migration's own INVENTORY MODEL note), so draining `available` also drives the public catalogue to zero.

**Failure scenario**

Any authenticated customer calls `create_reservation_multi` with 20 lines, each naming a different (product, size) and a quantity equal to that variant's `inventory.available` (readable from the catalogue). One call zeroes 20 variants; three calls per 30-minute slot, repeated across future dates, cover the catalogue. Every affected product shows sold out to real shoppers, `trg_notify_stock_back_in_stock` waitlist signups stop firing, and none of it expires on its own because `payment_due_at` is NULL on a Pending row. Recovery is staff manually cancelling each reservation from the admin dashboard, and the attacker can re-run it immediately from the same free account.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

Not refuted in substance, but the headline is misfiled and the severity is inflated.

HALF ONE IS INTENDED DESIGN, NOT A DEFECT. The finding is filed against 20260808123756:53, but that line is a deliberate, correct predicate. Holding stock from reservation creation is this migration's explicit purpose: its own header (lines 14-21) enumerates the release paths and names "staff decline (admin-dashboard repo)" among them, which only makes sense if a not-yet-accepted reservation is already holding stock. In a reserve-and-collect model, holding at reserve time is the point; if holds only began at staff acceptance, the overselling hole the migration exists to close (header lines 3-12: 30x XS reservable when inventory.available was 6) would remain wide open for the entire pre-acceptance window. Reporting the migration's core intent as the migration's bug is wrong.

HALF TWO IS REAL AND I CONFIRMED IT END TO END. The mechanical chain holds: create_reservation_multi writes status 'Pending' with payment_due_at NULL and an optional _receipt_path (20260805231149:158-159, 71-74), so no payment is required; the AFTER INSERT trigger decrements available immediately (20260808123756:106-111) with only "available < quantity" as a gate; expire_unpaid_reservations requires payment_due_at IS NOT NULL (20260802123455:66) so Pending never self-expires (documented intentionally at 20260731170719:220, "an unaccepted reservation never expires"); and sync_product_stock sets products.stock = sum(available) with status flipping to 'Reserved'/'Out of Stock', so the public catalogue reads sold out. I verified no per-customer cap exists rather than trusting the reviewer: live pg_trigger on public.reservations returns only trg_apply_inventory_on_reservation_status, trg_notify_reservation_status_change, trg_set_payment_due_on_confirm, trg_touch_updated_at, and trg_validate_reservation_time; the only CHECK on reservation_items is CHECK ((quantity > 0)) with no upper bound; and pg_get_functiondef for create_reservation_multi, create_reservation, and assert_bookable_slot shows none of them reference inventory or count per customer. assert_bookable_slot also imposes no bound on how far in the future _date may be, so an attacker can drain stock using far-future slots without ever colliding with real customers' appointments.

REVIEWER FACTUAL ERROR. The claim of "three calls per 30-minute slot" is wrong. 20260807151239_configurable_slot_capacity.sql:138 executes UPDATE public.store_hours SET slot_capacity = 1, and live store_hours confirms slot_capacity = 1 on all seven rows (10:00-17:00, Sunday is_closed). The real rate is one reservation per slot. This slows the attack but does not save it: live data is 90 stock-tracked variants / 559 units, and at 20 lines per call roughly 5 reservations covers the whole boutique.

WHY LOW, NOT MEDIUM. Calibrating against this codebase's real-bug bar (an RPC that failed closed for every customer; a trigger that silently broke every review INSERT for weeks) — those break real users passively. This one requires a deliberate attacker, causes no data loss or privilege escalation, and is bounded and reversible: declining each reservation automatically restores available via apply_inventory_on_reservation_status_change (20260808123756:157-164), and the existing check_unattended_reservations cron (20260809120000) fires on pending reservations older than 15 minutes, polling every 5 minutes, so the shop is alerted within ~20 minutes and recovery is roughly five declines. The reviewer omitted both the automatic release path and the alerting control. The genuine residual gap is the absence of a per-account or per-quantity ceiling on a free, unpaid, non-expiring resource, and it belongs against create_reservation_multi (20260805231149:66-69, which caps line count only), not against reservation_holds_stock.

</details>

---

#### F32. signOut clears only the Supabase session; the persisted cart survives into the next user's session

- **Location:** `src/context/AuthContext.tsx:156` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Mobile auth + session

**What is wrong**

`const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);` (AuthContext.tsx:156-158) is the app's only sign-out path (app/(tabs)/profile.tsx:49, app/(auth)/reset-password.tsx:72). Nothing clears local state. The cart is persisted under a single global, non-user-scoped key — `const CART_STORAGE_KEY = '@jezsy_cart';` (src/context/CartContext.tsx:52) — and `CartProvider` loads it once on mount with no dependency on the signed-in user:

'''
useEffect(() => {
  const loadCart = async () => {
    const stored = await AsyncStorage.getItem(CART_STORAGE_KEY);
    if (stored) { setItems(JSON.parse(stored)); }
  };
  loadCart();
}, []);
'''
(CartContext.tsx:57-69). `clearCart()` is called from exactly one place, after a successful reservation (app/reserve/[id].tsx:248) — never on sign-out. The same applies to `@jezsy_category_affinity` (src/utils/categoryAffinity.ts:3) and `@jezsy_offline/outfit_session` (src/services/offlineSync.ts:28), both global keys. Note by contrast that `recentlyViewed` IS user-scoped (`${STORAGE_KEY}:${userId || 'guest'}`, src/utils/recentlyViewed.ts:10), so the pattern was understood and just not applied here.

**Failure scenario**

Two customers share a phone (or a JezSy in-store demo handset). Customer A builds a bag, signs out. Customer B signs in and the Cart tab is pre-populated with A's items, sizes and quantities — B sees what A was shopping for, and if B proceeds through app/reserve/[id].tsx they submit a reservation containing A's selections under B's own account and deposit.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried to kill this one and could not. Every factual claim checks out against the current files.

VERIFIED AS CLAIMED:
- src/context/AuthContext.tsx:156-158 is exactly `const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);` — nothing else. The only other local cleanup in the file is the unrelated one-time SecureStore PIN purge at lines 163-164, which runs on mount, not on sign-out. The SIGNED_OUT branch (lines 185, 191-194) clears only isPasswordRecovery, profile and isProfileLoading.
- src/context/CartContext.tsx:52 `const CART_STORAGE_KEY = '@jezsy_cart';` is global and non-user-scoped; the load effect at lines 57-69 has an empty dep array.
- clearCart is called from exactly one place, app/reserve/[id].tsx:247-249, and only on a successful reservation submit.
- A repo-wide grep for AsyncStorage.clear / multiRemove / any clear-on-signout helper returns zero matches. No later commit fixed it (git log on both context files: newest touch is 6d741a3, unrelated inventory work).

REACHABILITY CONFIRMED, AND SLIGHTLY WORSE THAN CLAIMED: the providers in app/_layout.tsx:242-250 are rendered unconditionally, so CartProvider never unmounts on sign-out. The residual cart is live in React state, not merely on disk — no app restart is needed. B lands in the tabs with A's items and the bag badge already populated (app/(tabs)/explore.tsx:74, profile.tsx:24), and app/cart.tsx:65-80 auto-selects every item, so "Reserve all" is pre-armed with A's picks.

I also checked whether this is a documented intentional tradeoff. It is not — the opposite. src/utils/recentlyViewed.ts:6-11 carries a comment naming this exact bug class and fixing it there: keyed by user id because "a bare device-wide key meant a brand-new account inherited whatever the previous signed-in user ... had browsed on the same device." Cart simply did not get the same treatment. docs/ARCHITECTURE.md:117/123 calls the cart "device-local", but that describes persistence, not a deliberate cross-account handoff. And since routing (app/_layout.tsx:160-165) forces unauthenticated users into (auth), there is no guest-cart-survives-login flow that would justify the global key.

WHERE THE FINDING OVERREACHES — hence the downgrade from medium to low:
1. The claimed monetary harm is wrong. app/reserve/[id].tsx:210-213 sends `_receipt_path: null` and the comment at 258-259 states "No payment here by design: staff vet the booking first, and only then does a payment window open." Nothing is charged at submit, so B does not "submit ... under B's own deposit" — B submits a request staff must accept before any payment exists, and it is visible on screen the whole time.
2. No security boundary is crossed. create_reservation_multi resolves prices server-side and derives the owner from the caller (app/reserve/[id].tsx:199-201 comment), so nothing is misattributed to A. Profile is nulled at AuthContext.tsx:192, and reservations/wishlist/messages are server-side under RLS — they do disappear correctly.
3. The leaked payload is a cached public `products` row plus A's size/quantity selections. Sizes are mildly personal; this is not PII, credentials, or account data.
4. Precondition is a shared physical handset where A signed out — real, but narrow for a consumer boutique app.

Net: a genuine, unfixed data-hygiene inconsistency with a one-line remedy (clear cart + the other global keys on SIGNED_OUT, or scope CART_STORAGE_KEY by user id the way recentlyViewed.ts already does). Real bug, but low, not medium.

</details>

---

#### F33. Previous user's conversation list and unread badge persist across sign-out and into the next login

- **Location:** `src/context/MessagesContext.tsx:38` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Mobile auth + session

**What is wrong**

`refreshConversations` bails out without clearing state when there is no session:

'''
const refreshConversations = useCallback(async () => {
  if (!session?.user.id) return;
  ...
  setConversations(data || []);
}, [session?.user.id]);
'''
(MessagesContext.tsx:37-53). `MessagesProvider` sits above the navigator in app/_layout.tsx:245, so it is never unmounted by the sign-out redirect. On SIGNED_OUT the effect re-runs, hits the early return, and `conversations` keeps holding the previous user's rows. Those rows carry `last_message` preview text, which the inbox renders verbatim (app/(tabs)/messages.tsx:135 `{item.last_message || 'Start a conversation...'}`) and whose `unread_count` feeds `unreadCount` (MessagesContext.tsx:35), consumed for the tab badge at app/(tabs)/_layout.tsx:17. Nothing resets the array until a *new* fetch resolves for the next user.

**Failure scenario**

Customer A messages staff ("my deposit for the wedding gown, can I move the pickup to Friday"), signs out on a shared/store device. Customer B signs in, is routed to (tabs), and the Messages tab immediately shows A's unread badge and, if B taps it before B's own fetch returns, A's conversation row with A's last message preview and staff display name.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The code claim survives scrutiny. src/context/MessagesContext.tsx:38 is verbatim `if (!session?.user.id) return;` and it returns before the try block, so no state is cleared on sign-out. `setConversations` appears only at lines 47, 210 and 229 — all of which set or prepend rows; a repo-wide grep confirms no reset path exists anywhere. MessagesProvider genuinely sits at app/_layout.tsx:245 wrapping InitialLayout, so the sign-out redirect swaps screens inside the Stack without unmounting it (docs/ARCHITECTURE.md:117 documents that this placement is required so (tabs)/_layout.tsx can read unreadCount). The consumer chain is as claimed: line 35 -> app/(tabs)/_layout.tsx:118 tabBarBadge, and app/(tabs)/messages.tsx:135 renders item.last_message.

I checked the standard refutations and none apply: there is no earlier guard, no comment documenting a tradeoff, and no server-side mitigation is even possible since the stale array is client memory that is never re-queried (RLS only scopes the next fetch). I also checked whether the loading skeleton masks it — it does not, and this strengthens rather than weakens the finding: setLoading is only ever called as setLoading(false) (line 51, in the finally), never back to true, so on a second login messagesLoading is already false and messages.tsx:224 skips the skeleton and renders the stale FlatList directly.

Severity is inflated, however, and the title overstates the lifetime. app/(tabs)/_layout.tsx:31-33 returns <Redirect href="/(auth)" /> whenever !session, so the tab navigator unmounts and nothing stale is visible during the signed-out interval. Exposure is limited to the window between B's tabs mounting and B's fetch resolving, and those are near-concurrent: AuthContext.tsx:187-195 sets the session on SIGNED_IN, which simultaneously starts syncProfile and re-triggers the MessagesContext effect at line 55, while the tabs cannot mount until the profile fetch resolves (app/_layout.tsx:168-174). So it is a sub-second stale-render flash that self-corrects on the very fetch the same effect already dispatched — not state that "persists into the next login." Seeing A's preview text additionally requires B to tap Inbox inside that window. The only non-transient variant is B's fetch erroring, where MessagesContext.tsx:48-50 merely console.errors and leaves A's rows in place indefinitely.

What actually leaks is a stale unread-count integer on the badge for a few hundred milliseconds, plus a tight-race chance at one line of another customer's message preview. No authorization boundary is crossed server-side and there is no way for an attacker to force the window open other than degrading the network. That is low, not medium. Real bug, worth a one-line fix (clear conversations and reset loading in the no-session branch), but not medium.

</details>

---

#### F34. Cart price re-validation is dead code: warnings are computed then never rendered, and the bag shows prices cached at add time

- **Location:** `app/cart.tsx:54` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Mobile reserve/cart/inventory

**What is wrong**

The focus effect labelled "H-1: Re-validate prices against live DB on every screen focus" (lines 28-61) fetches live prices, diffs them against the cached copy, and ends with `setPriceWarnings(warnings);`. `priceWarnings` is declared at line 26 and appears nowhere else in the file — grep for it returns exactly one hit, the `useState`. Nothing in the JSX reads it, so the network round-trip on every focus produces no user-visible output at all.

Meanwhile every money figure on the screen comes from the stale snapshot: line 164-171 renders `item.product.on_sale && item.product.sale_price ? item.product.sale_price : item.product.price`, and `selectedTotal` (line 101-107) and the deposit (line 350) are built from the same cached rows. CartContext.tsx:98 persists the whole `Product` row into AsyncStorage, so a bag restored days later renders week-old pricing. reserve/[id].tsx:316-322 then computes the displayed subtotal, deposit and balance from that same cached row.

**Failure scenario**

A customer adds a dress while it is on sale at ₱1,200 (regular ₱2,400). The sale ends. They reopen the bag: the fetch runs, correctly detects the mismatch, populates `priceWarnings` — and the screen still shows ₱1,200, a ₱600 deposit, and a ₱600 balance. The reserve screen repeats those figures. Only AFTER the reservation row already exists does reserve/[id].tsx:242-243 compare `serverTotal` to `clientTotal` and alert that pricing changed — the customer has committed to a booking for ₱2,400 with a ₱1,200 deposit having been shown ₱1,200/₱600 at every step.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The finding's central claim is verifiable and survives scrutiny, so I cannot refute it. `priceWarnings` is genuinely write-only state: a repo-wide grep returns exactly two hits, the declaration at line 26 and the setter at line 54, and I read the complete JSX to confirm no consumer. The focus effect therefore performs a Supabase round trip on every screen focus and throws the result away, while the comment above it asserts "H-1: Re-validate prices against live DB on every screen focus" — a documented mitigation that does not exist. That is the same class as this project's known bugs (a control that silently does nothing), and app/cart.tsx is the live, reachable cart route, not an orphaned duplicate.

However the claimed severity of medium is inflated, and one supporting claim is factually wrong.

Wrong claim: the reviewer asserts reserve/[id].tsx:316-322 computes displayed figures "from that same cached row." That holds only in cart mode. Lines 101-126 re-fetch the product fresh whenever id !== 'cart', and the per-item Reserve button at cart.tsx:236-245 routes to /reserve/[productId] — the live path. Only the bulk "Reserve selected" button at cart.tsx:359-364 reuses cached rows, so the stale-price surface is roughly half what was reported.

Severity downgrade: the failure scenario's punchline — the customer "has committed to a booking for PHP 2,400 with a PHP 1,200 deposit" — does not survive the server code. create_reservation_multi resolves every line's price server-side under FOR SHARE (migration lines 91-108), so the stale figure can never be charged and no overselling or underpayment is reachable. The reservation inserts as Pending/Pending with payment_due_at NULL, and reserve/[id].tsx:262-263 surfaces the corrected total in the very same alert, before any payment window opens (payment only follows staff acceptance). So the actual harm is a customer seeing a stale price in the bag and being corrected at request time, with nothing charged and the booking cancellable — an expectation mismatch plus a wasted network call, not a money-losing defect.

Net: real, concrete, worth fixing (either render the warnings or delete the effect), but low, not medium.

</details>

---

#### F35. AR pose callback calls setState with a freshly-allocated object on every camera frame, with no throttle — forces a React render per frame

- **Location:** `app/ar-tryon/[id].tsx:60` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Mobile screens

**What is wrong**

The inline `onResults` (lines 43-68) runs per camera frame and ends with:

'''
setMatchScore(match.score);
setIsMatched(match.isMatched);
setMatchFeedback(match.feedback);
if (match.transform) {
  setGarmentTransform(match.transform);
}
'''

`evaluatePoseMatch` allocates a new object literal `const transform: PoseTransform = { scale, translateX, translateY }` on every call (src/utils/poseMatcher.ts:78-82), so `setGarmentTransform` can never hit React's bail-out — a full re-render is scheduled at the camera's frame rate (30-60 fps). Each re-render also produces a new `onResults` identity, which changes `updateDetectorMap` in the library and re-runs its `React.useLayoutEffect` (node_modules/react-native-mediapipe-posedetection/src/index.tsx:233-259), reallocating a `BaseViewCoordinator` every frame. The sibling screen already identified this hazard and fixed it — app/profile/body-scan.tsx:230-235 throttles overlay state to ~12 FPS with the comment "to prevent React JS thread lockup". The AR screen has no equivalent guard.

**Failure scenario**

A customer taps "Use 2D Overlay" on a product. As soon as their shoulders and hips are visible (visibility >= 0.6), the pose callback starts committing a React render per frame on top of the live camera preview, the WebView-free overlay, and the fit panel. The JS thread saturates: the match badge, the shuffle-pose button and the back button become laggy or unresponsive, and the 2s auto-capture timer (lines 153-162) is repeatedly cleared and restarted by the render churn.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The core mechanism survives scrutiny line-by-line, but the impact narrative is partly fabricated and the severity is inflated.

CONFIRMED parts:
1. app/ar-tryon/[id].tsx:43-63 passes a raw inline arrow (not useCallback, no ref-gate, no throttle) as onResults, ending in four setState calls at lines 57-62.
2. src/utils/poseMatcher.ts:79-83 allocates a fresh object literal for `transform` on every successful evaluation, so setGarmentTransform at line 61 can never hit React's Object.is bail-out.
3. node_modules/react-native-mediapipe-posedetection/src/index.tsx:134-141 invokes callbacks.onResults from a TurboModule event listener on the JS thread, once per detection result. updateDetectorMap's dep array includes `onResults` (line 251) and React.useLayoutEffect(() => updateDetectorMap(), [updateDetectorMap]) at lines 257-259 therefore re-fires every render, constructing a new BaseViewCoordinator.
4. The sibling-screen precedent is real: app/profile/body-scan.tsx:211 and 230-235 guard the identical library callback with `if (now - lastOverlayUpdateRef.current > 80)` and the comment "Throttle overlay state updates to ~12 FPS (~80ms) to prevent React JS thread lockup". The project has already diagnosed this exact failure mode elsewhere, which is strong evidence it is reachable and observable rather than theoretical.
5. Amplifier the reviewer missed: BaseViewCoordinator's constructor ends in console.log(..., JSON.stringify({...})) at shared/convert.ts:285-294, and babel.config.js contains NO transform-remove-console plugin (grep for transform-remove-console/remove-console across the repo returns no matches), so that stringify+log runs in release builds. The churn also cascades to frameProcessor's dep list (index.tsx:303-333), handing <Camera> a new frameProcessor prop every render at [id].tsx:414.

REFUTED sub-claim: "the 2s auto-capture timer (lines 153-162) is repeatedly cleared and restarted by the render churn" is false. That useEffect's dep array is [isMatched, mode] (line 162) — both primitives compared by Object.is. Re-renders with unchanged deps do not re-run the effect. That mechanism does not exist.

SEVERITY CORRECTION medium -> low. The claimed 30-60 renders/sec is an unreached upper bound: the hook is configured delegate: Delegate.CPU with pose_landmarker_lite.task ([id].tsx:65-67), which yields materially fewer results/sec on mid-range Android, and RN batches the four setStates into a single render per callback rather than four. Nothing fails silently, no data is lost or corrupted, and no security boundary is crossed — this is UX jank confined to the 2D overlay screen. Measured against this repo's stated calibration bar (an RPC failing closed for every customer reservation, a trigger querying a DROPped table, overselling via direct RPC call), a per-frame render on one screen is low. The finding is worth fixing — copy the body-scan.tsx:230-235 throttle pattern and wrap onResults in useCallback with a currentPose ref — but it is not a medium.

</details>

---

#### F36. Z-score > 2.0 outlier rejection can never fire at the burst size actually used (max possible z is 1.79)

- **Location:** `src/utils/burstAverager.ts:91` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Mobile utils/context/hooks

**What is wrong**

The module header promises: "discards statistical outliers (Z-score > 2.0), and returns the averaged result. This reduces single-frame pose jitter by ~60%".

The filter at `src/utils/burstAverager.ts:85-92`:
    const keptSamples = this.samples.filter((s) =>
      NUMERIC_KEYS.every((key) => {
        const sd = globalSDs[key];
        if (sd === 0) return true;
        const z = Math.abs((s[key] as number) - globalMeans[key]) / sd;
        return z <= 2.0;
      })
    );

`stdDev` (line 26-31) uses the SAMPLE standard deviation (n-1 denominator). For n samples the maximum attainable |z| under that estimator is (n-1)/sqrt(n). With `TARGET_FRAMES = 5` (line 12) that ceiling is 4/sqrt(5) = 1.789, and at the `MIN_FRAMES = 3` floor it is 2/sqrt(3) = 1.155. Both are strictly below the 2.0 cutoff, so `keptSamples` is always identical to `this.samples` and line 94 (`keptSamples.length >= MIN_FRAMES ? keptSamples : this.samples`) is a no-op.

Verified reachable size: `app/profile/body-scan.tsx:297-312` calls `addSample` then `isComplete()` (>= 5) and immediately transitions phase, so `getResult()` always runs on exactly 5 samples. Concretely, samples [0,0,0,0,10] give mean 2, sd 4.472, and z = 8/4.472 = 1.789 for the outlier -- kept.

**Failure scenario**

During the 5-frame front burst the customer's arm swings or a landmark momentarily snaps to the background, producing one frame whose bust reads 40 cm above the other four. The documented guard is supposed to drop it; instead every frame is kept and the bad frame contributes a full 1/5 weight, pulling the averaged bust up by ~8 cm. The result is saved with no indication anything was rejected, and the reported confidence is unaffected because confidences are averaged over the same unfiltered set (lines 105-114).

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried to kill this one and could not kill the mechanism, but I did kill the headline harm.

WHAT SURVIVES (the filter is genuinely inert):
The code is exactly as quoted. `stdDev` (src/utils/burstAverager.ts:26-31) divides by `values.length - 1`, and the filter (lines 85-92) rejects on `z <= 2.0`. Under a sample-SD estimator the maximum attainable |z| for n points is (n-1)/sqrt(n), which needs n >= 6 to reach 2.0. I did not take the algebra on trust -- I re-implemented the module's own `mean`/`stdDev` and ran 3,000,000 randomized 5-sample sets (including deliberately heavy-tailed draws): worst observed maxZ = 1.788854, exactly the (n-1)/sqrt(n) = 1.7889 bound, never once above 2.0. At n=6 it becomes 2.0412, so the cutoff is only barely reachable one sample past the burst size.

Reachability at exactly n=5 also holds. `addSample` is called only in the front phase (app/profile/body-scan.tsx:297). At line 304 `isComplete()` is true at >= 5, and both exits close the door: line 308 `beginTurn()` sets `phaseRef.current` synchronously via `setPhaseBoth` (lines 110-113), so later frames take the turn/side branches and never call `addSample`; line 311 calls `finishScan()` directly. So `getResult()` always runs on exactly 5 samples, where `keptSamples` is provably identical to `this.samples` and the line 94 fallback is a no-op. The module header (line 5) and docs/ARCHITECTURE.md:135 both advertise a guard that cannot fire.

WHAT I REFUTE (the claimed failure scenario):
The reviewer's concrete harm -- "pulling the averaged bust up by ~8 cm" -- does not happen on the normal path. In `finishScan`, when both passes produce a silhouette, bust/waist/hips from the burst average are thrown away entirely and recomputed at app/profile/body-scan.tsx:184-188 from `medianExtents(...)` (lines 171-172), and `medianExtents` (lines 144-152) is a true median. A median over 5 extent samples is itself robust outlier rejection -- one bad frame cannot move it meaningfully. Segmentation masks are explicitly requested (`shouldOutputSegmentationMasks: true`, line 337), so this is the expected path. The three circumference fields the reviewer built the scenario around are precisely the three fields the burst average does not determine.

WHAT RESIDUAL IMPACT IS REAL:
Two narrower gaps remain. (a) The five linear measurements (shoulderWidth, armLength, torsoLength, legLength, inseam) are never replaced and always come from the unfiltered mean -- and the comment at lines 167-170 explicitly justifies leaving them alone because re-deriving "would only discard the burst's outlier rejection," i.e. it reasons from a guard that does nothing. (b) The no-mask fallback (line 269 `if (!mask || ...)` and line 307) keeps the BMI-inferred circumferences from the unfiltered mean.

SEVERITY: medium is inflated; low is honest. A bad frame must first clear `isPoseValid` (src/utils/poseDetector.ts:64-72), which demands visibility >= 0.85 on every required joint plus a mean >= 0.85, so gross landmark snaps are largely filtered upstream. The burst spans ~5 frames of a "hold still" instruction, so realistic frame-to-frame jitter on linear measures is small and the residual error is that jitter divided by 5. There is no security, RLS, data-integrity, or reservation-flow consequence -- the output is an advisory sizing estimate from an already-approximate pose/BMI regression. Real and worth a one-line fix (population SD, a lower threshold, or median/MAD to match the approach already used for extents), but not medium.

</details>

---

#### F37. conversations state is never cleared on sign-out, so the previous user's message previews and unread badge persist

- **Location:** `src/context/MessagesContext.tsx:38` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Mobile utils/context/hooks

**What is wrong**

`refreshConversations` bails out before touching state when there is no session (`src/context/MessagesContext.tsx:37-38`):
    const refreshConversations = useCallback(async () => {
      if (!session?.user.id) return;

The effect at line 55-75 re-runs when `session` goes null, but that early return means `setConversations` is never called, so the array from the previously signed-in user survives. `unreadCount` is derived from it (line 35):
    const unreadCount = conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);

`MessagesProvider` is mounted at the root, above the auth gate (`app/_layout.tsx:245`), so it does not unmount on sign-out and the state is never reinitialized. The stale rows are user-visible content, not just ids: `app/(tabs)/messages.tsx:123` renders `item.last_message` and line 107 renders `item.customer_id.substring(0, 6)`, and `app/(tabs)/_layout.tsx:118` drives the inbox tab badge from `unreadCount`.

The sibling provider does this correctly, which is what makes this an oversight rather than a design choice -- `src/context/WishlistContext.tsx:27`:
    if (!user?.id) { setWishlistIds(new Set()); return; }

**Failure scenario**

On a shared or demo device, customer A signs out and customer B signs in. Until B's own `refreshConversations` round trip resolves, the inbox lists A's conversation with A's last message preview text, and the tab bar shows A's unread count. If B's fetch fails (the catch at line 48-51 only logs), A's conversations stay on screen for the whole session. The same stale list is also what A sees if they sign out and stop -- their message previews remain rendered on the signed-out device.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The core defect is real and I can point at it: MessagesContext.tsx:38 returns before any setState, MessagesProvider sits above the auth gate at app/_layout.tsx:245 so it never unmounts, and the sibling WishlistContext.tsx:27 clears its state in the identical branch. I am not refuting that. But two of the reviewer's three claimed manifestations do not survive contact with the code, and the severity is inflated as a result.

(1) The "signed-out device still shows A's previews" claim is dead. app/(tabs)/_layout.tsx:31-33 returns `<Redirect href="/(auth)" />` whenever `!session`, so the entire tabs tree -- both consumers of the stale state, the message list and the badge -- is not rendered at all once the session is null. The root redirect effect (app/_layout.tsx:160-165) independently pushes to /(auth) too. Nothing from MessagesContext is on screen while signed out. That half of the scenario is unreachable. It would also be A's own data on A's own device, not a leak.

(2) The claimed identity exposure via `item.customer_id.substring(0, 6)` is wrong for the case that matters. messages.tsx:105-107 only renders that branch when `isStaff` is true; a customer viewer always gets the hardcoded string 'Shop Owner'. So in the customer-switching scenario the reviewer describes, no customer identifier is rendered at all.

(3) What actually remains is narrow. After B signs in, `conversations` still holds A's rows until B's fetch resolves, and because `loading` is never reset to true (line 51 is the only writer) the skeleton at messages.tsx:224 does not mask it. So the Inbox tab badge shows A's unread number for one network round trip, and B would see A's `last_message` preview text only by tapping into Inbox inside that same sub-second window. It self-corrects on resolve, and the realtime subscription at lines 61-70 gives a second recovery trigger. The one durable variant -- B's fetch errors, the catch at 48-51 only logs, A's rows persist for the session -- needs a three-way conjunction: a shared device with account switching, a failed fetch, and B opening Inbox. The leaked content is a `last_message` snippet attributed to "Shop Owner" plus a timestamp.

No server-side boundary is crossed here: RLS still governs what B can fetch, and the stale rows are client memory from A's own authenticated session on that device. This is a client-side UI-correctness bug with a transient, self-healing exposure, not the medium-severity cross-user data persistence the write-up implies. Correct fix is one line at MessagesContext.tsx:38 matching WishlistContext.tsx:27 -- `if (!session?.user.id) { setConversations([]); setLoading(false); return; }` -- which is worth doing, but it is a low.

</details>

---

#### F38. Review count and average rating are computed from only the first 10 rows while the exact count is fetched and discarded

- **Location:** `src/components/ReviewsList.tsx:85` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Mobile utils/context/hooks

**What is wrong**

The query asks Postgres for the exact total and takes only 10 rows (`src/components/ReviewsList.tsx:62-67`):
    const { data, error, count } = await supabase
      .from('reviews')
      .select('*', { count: 'exact' })
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(10);

`count` is destructured and then never referenced. The stats block instead aggregates the 10-row page (lines 74-87):
    items.forEach(r => { sum += r.rating; ... });
    setStats({ average: sum / items.length, count: items.length, breakdown: bd });

So `stats.count` saturates at 10 and `stats.average` is the mean of the 10 NEWEST reviews only, not the product's rating. That value is rendered as the headline figure at line 136 (`Reviews ({stats.count})`) and drives the summary card gate at line 148 (`stats.count > 0`). The `breakdown` histogram is likewise a histogram of 10 rows presented as the product's distribution.

**Failure scenario**

A product accumulates 45 reviews: 35 five-star ones from launch and the 10 most recent are one-star complaints about a fit change. The product page shows 'Reviews (10)' and a 1.0 average with a fully bottom-weighted histogram, hiding 35 reviews and misstating the product's rating to every shopper. The inverse also happens -- a product with 40 poor reviews and 10 recent good ones displays 5.0.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The CODE claim is accurate and I could not refute it. C:\Users\carlv\jezsy-mobile-app\src\components\ReviewsList.tsx:62-67 does destructure `count` from an `{ count: 'exact' }` query and never references it again anywhere in the file (only other `count` identifiers are the local loop var at line 156 and `photoReviewCount` at 113). Lines 74-90 aggregate only `items` — the `.limit(10)` page — and `setStats({ average: sum / items.length, count: items.length, breakdown: bd })` at 83-87 is exactly as quoted. `stats.count` is rendered at line 136 and gates the summary card at 148; `stats.average` is the big number at 151 and the star row at 152; `stats.breakdown` drives the bars at 155-166. There is no load-more, no second query, no comment documenting a deliberate page-1-only summary, and ReviewsList is mounted in exactly one place (app\product\[id].tsx:575). So the mechanism is real: past 10 reviews the summary card describes only the 10 newest rows.

What I DID refute is the claimed impact, which is what drives the severity down two notches:

1. The product's real rating is NOT hidden and is NOT misstated. app\product\[id].tsx:358-364 renders `product.rating` and `product.review_count` as the headline rating directly under the product name, above the fold and above ReviewsList. I confirmed against the live DB (ref wufcmtndotfvxvvxkamv) that those two columns are true full-table aggregates maintained by trigger `trigger_update_product_rating` (AFTER INSERT OR DELETE OR UPDATE ON public.reviews), whose function body recomputes `rating = AVG(rating) FROM reviews WHERE product_id = NEW.product_id` and `review_count = COUNT(*)` over the whole table — no LIMIT. In the reviewer's own 45-review scenario the shopper sees the correct "4.2 (45 reviews)" at the top of the screen; the defect is that the summary card lower down would contradict it. That is an internal inconsistency, not "misstating the product's rating to every shopper."

2. The precondition is not currently reachable. `select count(*) from reviews` returns 0 on the live DB — zero rows, zero products with any review. Writing a review additionally requires a Completed/Active reservation on that exact product (eligibility check at ReviewsList.tsx:47-53, enforced for real by RLS). A single product would need 11+ distinct completed reservations before any user ever sees a wrong number. This is a latent defect, not one shipping visible breakage today.

3. No security, money, data-integrity, or silent-write-failure dimension — nothing in the class the project's severity bar is calibrated to (dropped-table trigger refs, INVOKER-vs-admin-policy RPCs, PUBLIC grant no-ops, unvalidated quantity). Worst case is a cosmetic disagreement between two numbers on one screen. `low` is the honest severity; `medium` is inflated.

Incidental, and NOT part of this finding: the seeded `products.review_count` values are fiction relative to the reviews table (High-Rise Skinny Jeans reports review_count 204 with 0 actual rows; Classic Denim Jacket 134 / 0). That means the visible inconsistency on production TODAY is "4.3 (204 reviews)" at line 358 next to "Reviews (0) / No reviews yet" from ReviewsList — caused by seed data, not by the 10-row cap. It also means the first genuine review INSERT will fire the trigger and collapse 204 to 1. Separate issue, different fix.

</details>

---

#### F39. CSV export throws TypeError when the selected date range contains no reservations

- **Location:** `src/pages/admin/Analytics.jsx:317` _(admin-dashboard)_
- **Severity:** low
- **Found by:** Admin dashboard correctness

**What is wrong**

The guard checks the unfiltered array but the code indexes the filtered one:

'''js
const handleExport = (type) => {
  if (reservations.length === 0) return;          // line 288 — guards on ALL reservations

  const data = filteredReservations.map(r => ({ ... }));   // line 290 — may be empty
  ...
  } else {
    // Default CSV
    const headers = Object.keys(data[0]);          // line 317 — data[0] is undefined
'''

`Object.keys(undefined)` throws `TypeError: Cannot convert undefined or null to object`. The call is not wrapped in try/catch and `handleExport` is not async, so the exception propagates out of the React event handler. The `.xlsx` and `.pdf` branches tolerate an empty array; only the default CSV branch (the first menu entry, "Excel (CSV)") dereferences `data[0]`.

**Failure scenario**

A staff member selects "Last 7 Days" (or any custom range) in which no reservations fall — entirely normal for a quiet week, and guaranteed for any range predating the shop's first booking — then opens the Export dropdown and clicks "Excel (CSV)". Because reservations exist overall, the line 288 guard passes. The handler throws, the export silently does nothing, and the uncaught error trips the app's ErrorBoundary. Staff have no indication the range was simply empty.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

The code defect is real and quoted accurately. In C:\Users\carlv\admin-dashboard\src\pages\admin\Analytics.jsx, line 288 guards on the unfiltered `reservations` array while line 290 maps `filteredReservations` (defined lines 142-145 as a date-range filter over `reservations`), and line 317 does `Object.keys(data[0])`. With a range containing no bookings, `data` is `[]`, `data[0]` is `undefined`, and `Object.keys(undefined)` throws. The path is reachable: the Export button at line 401 has no `disabled` prop and the "Excel (CSV)" entry at line 406 calls `handleExport('csv')`, which falls to the else branch.

However the claimed impact -- the centerpiece of the "medium" rating -- is factually wrong. React 18 (react ^18.2.0) error boundaries do not catch errors thrown in event handlers, and the app's boundary at src/components/ErrorBoundary.jsx:10-16 is a plain class boundary (getDerivedStateFromError + componentDidCatch) mounted at main.jsx:29 / App.jsx:8. Nothing registers a window.onerror UI handler. The app does NOT show the "System Error Encountered" screen; the page stays mounted and fully interactive.

More decisively for severity: the buggy behavior is nearly indistinguishable from the intended behavior. The guard at line 288 is itself a silent no-op with no toast and it also skips `setExportRef(false)` at line 326 -- exactly as the throw does. So in both the intended and the buggy case the staff member gets no file, no message, and a still-open dropdown. The only added consequence is a console TypeError plus a Sentry event (Sentry.init at main.jsx:22). The reviewer's "staff have no indication the range was empty" is a pre-existing UX gap in the deliberate guard, not damage caused by this bug.

Real one-line bug (line 288 should test `filteredReservations.length`), but the user-visible blast radius is a console error, not an app crash. Low, not medium. Note also the path is repo-relative to the sibling admin-dashboard repo, not the mobile-app repo at the working directory.

</details>

---

#### F40. Mobile canReschedule is narrower than the RPC it claims to mirror, and its explanatory comment describes a function that is no longer callable

- **Location:** `src/utils/reservationStatus.ts:104` _(jezsy-mobile-app)_
- **Severity:** low
- **Found by:** Cross-repo consistency

**What is wrong**

Mobile gates the reschedule button on two buckets only:

  line 104-105: `export const canReschedule = (status: string | null): boolean =>`
  `  ['pending', 'toPay'].includes(statusBucket(status));`

The docblock above it (lines 96-102) justifies this: 'deliberately matching what reschedule_reservation actually accepts -- it raises on anything outside ('pending','confirmed')' and 'The dashboard's CAN_RESCHEDULE_STATUSES also includes 'To Pickup', so staff can move an appointment in a state the customer cannot.'

Both statements are now out of date. The app no longer calls reschedule_reservation — app/reservations/[id].tsx:155 calls `request_reschedule`, and 20260807145303 explicitly revoked execute on the old function from PUBLIC, anon and authenticated. request_reschedule accepts a much wider set:

  `IF v_status NOT IN ('pending','request approval','confirmed','approved','to pay','to pickup','fitting') THEN RAISE EXCEPTION 'This reservation can no longer be rescheduled.';`

and its own comment records that this was the deliberate fix: "'to pickup' is included here where the old RPC excluded it, which is the gap that let staff move an appointment in a state the customer could not." The server closed the gap; the client still enforces it. Admin's CAN_RESCHEDULE_STATUSES (src/utils/reservationActions.js:17) is `new Set(['Pending','To Pay','To Pickup'])`, matching the RPC.

**Failure scenario**

A customer whose reservation is at 'To Pickup' needs to come in a day later. The RPC would accept the request and staff can already move it from the dashboard, but statusBucket('To Pickup') is 'ready', canReschedule returns false, and the app renders no reschedule control. The customer has to phone the boutique for something the system was explicitly changed to let them self-serve, and the stale comment tells the next developer the restriction is deliberate and server-mandated.

<details>
<summary>Verifier reasoning (adversarial pass)</summary>

I tried to kill this one on four fronts and it survived all of them.

1. Is the code there and does it say what the reviewer claims? Yes, verbatim. src/utils/reservationStatus.ts:104-105 is `export const canReschedule = (status: string | null): boolean => ['pending', 'toPay'].includes(statusBucket(status));`, and the docblock at lines 96-102 does justify the narrowness by reference to `reschedule_reservation`. Neither file is dirty in the working tree (git status shows only app/ar-tryon/[id].tsx and the unattended_reservation_alerts migration modified), so this is committed state, not someone's in-flight edit.

2. Is the caller really on the new RPC? Yes. app/reservations/[id].tsx:155 calls `supabase.rpc('request_reschedule', ...)`. There is no remaining call to `reschedule_reservation` anywhere in app/ or src/ (grep for it hits only database.types.ts, migrations, and docs).

3. Is the docblock's premise still true on the server? No — I checked the LIVE DB, not just the migration file, because migrations here can drift. `pg_get_functiondef` for public.request_reschedule in project wufcmtndotfvxvvxkamv contains `IF v_status NOT IN ('pending', 'request approval', 'confirmed', 'approved', 'to pay', 'to pickup', 'fitting') THEN RAISE EXCEPTION`. And the old function is genuinely dead to the client: `has_function_privilege('authenticated','public.reschedule_reservation(uuid,text,text)','EXECUTE')` returns false (anon also false, while request_reschedule for authenticated is true). So all three assertions in the docblock are stale: the app does not call that function, its ('pending','confirmed') gate is irrelevant, and the "widening would offer a button the server then rejects" rationale is obsolete because the RPC was already widened.

4. Is it handled elsewhere / unreachable? No. `canReschedule` has exactly one consumer (app/reservations/[id].tsx:265), and line 395 gates the entire "Request new time" control on it: `{canRescheduleNow && !showReschedule && !reschedulePending && (`. statusBucket maps 'to pickup' to 'ready' (reservationStatus.ts:53), so the control simply does not render. 'To Pickup' is a normal staff-driven state (admin PRIMARY_ACTION maps 'To Pay' -> ready_pickup), so the scenario is reachable by any customer whose deposit has been marked paid. Current prod has only 5 Cancelled rows, i.e. the data is pre-launch, which explains why nobody has hit it yet — it does not make it unreachable.

What actually tips this from "narrower client is a safe default" to a real defect is the contradiction the reviewer did not fully spell out: the call site at app/reservations/[id].tsx:262-264 comments `// Matches the dashboard's CAN_RESCHEDULE_STATUSES. The old list stopped at 'confirmed', so a customer whose item was already waiting for collection could not move the appointment even though staff could.` That asserts the gap is closed. It is not — admin's CAN_RESCHEDULE_STATUSES (C:\Users\carlv\admin-dashboard\src\utils\reservationActions.js:17) is `new Set(['Pending', 'To Pay', 'To Pickup'])`. So the RPC comment, the admin set, and the mobile call-site comment all agree that 'To Pickup' should be reschedulable, and only the predicate itself disagrees. Two comments in the same call chain state opposite things, which means the next reader gets a wrong answer whichever one they find first.

Severity stays low and I would not inflate it. No security exposure, no data corruption, no silent failure — the server-side guard is the strict one and the client is merely stricter. The customer retains a workaround in-app ("Ask about this reservation", [id].tsx:383) and staff can move it from the dashboard.

One correction to the reviewer's implied fix, worth passing on: do NOT simply widen to `['pending','toPay','ready']`. The 'ready' bucket also contains 'active' (reservationStatus.ts:55), which the live RPC does NOT accept — that would recreate exactly the button-the-server-rejects problem the stale comment warned about. The predicate needs to test the status against the RPC's list ('pending','request approval','confirmed','approved','to pay','to pickup','fitting'), not the coarse display bucket. The two stale comments should be corrected in the same change.

</details>

---


## Synthesis

## JezSy Audit — Synthesis

**Bottom line.** The reservation lifecycle is currently broken end-to-end on the staff side: the Owner account gets a hard `42501` on every status change (F1), the five Staff-role accounts get a silent zero-row no-op instead, and three separate dashboard write paths send columns that do not exist (F8/9/10). Independently, any of the six staff accounts can lock out the sole Owner or resurrect their own revoked access with one REST call (F2), and blocking or offboarding a staff member revokes nothing at the database layer (F3/13/30). Everything else — measurement math, inventory arithmetic, React render loops — sits below those two clusters.

---

### 1. Deduplication

40 findings collapse to **34 distinct defects**. Six were merged:

| Merged | Into | Why |
|---|---|---|
| F28 | **F14** | Identical file and line (`20260809120000:24`), reported from `cross-repo` and `migrations-rls`. Same lowercase-`'pending'` predicate. |
| F37 | **F33** | Identical file and line (`MessagesContext.tsx:38`), reported from `mobile-utils` and `mobile-auth`. Same missing sign-out reset. |
| F7 | **F5** | F7's own verifier re-derived F5's loop and concluded the unmemoized provider value is *not* the defect — `markAsRead`'s identity is. One fix, one finding. |
| F9, F10 | **F8** | Three call sites (`ready_pickup`, reschedule, create) of one defect: `updateDocument`/`addDocument` spread arbitrary camelCase keys to PostgREST with no column allowlist. |
| F12 | **F11** | Both are the admin app maintaining its own inventory arithmetic in contradiction to the DB triggers. Two code changes, one root cause. |

Four further groups share a root cause but need separate fixes and are kept distinct: **F3/F13/F30 + the `is_blocked` half of F19** (offboarding), **F6/F25/F36** (scan math), **F23/F24** (search), **F32/F33** (client state on sign-out).

**Scope flag:** eight findings (F8–F12, F26, F27, F39) and F1's reachability argument live in the *sibling* repo `C:\Users\carlv\admin-dashboard`, not `jezsy-mobile-app`. If the audit was scoped to the mobile repo only, route these to the co-worker rather than dropping them — several are the highest-impact items here.

---

### 2. Cross-cutting themes

These matter more than the individual findings.

**A. Hardening migrations break the invoker-context callers that depend on them.** F1 revokes `assert_bookable_slot` from `authenticated` in the same file that makes an INVOKER trigger depend on it. F15 tightens `products` UPDATE to admin-only, silently filtering the INVOKER rating trigger to zero rows. This is the *third* shipped instance of known pattern #2 (`create_reservation` was the first). **No migration that adds a REVOKE or narrows a policy is currently audited against the set of INVOKER functions and triggers that traverse that object.** That audit step is the single highest-leverage process change here.

**B. The staff lifecycle controls are decorative.** `is_staff_or_admin()` and `is_admin_or_owner()` check `role` and `deleted` only — never `is_blocked` (F3). `update_staff_status` writes only `employment_status` and `is_blocked`, i.e. exclusively the columns nothing reads. Blocking leaves `auth.users.banned_until` NULL, so the credential still mints tokens; the only enforcement is a client-side `signOut()` in the dashboard's React tree. Two money/schedule RPCs skip even the `deleted` check (F13). A `staff` account can file *and* process a deletion request against any customer (F30). And for customers, `is_blocked` appears nowhere in `app/` or in any RPC or policy (F19) — a shipped moderation button that does nothing. **The only offboarding action with any teeth is `deleted = true`, and F2 removed the guard protecting that column.**

**C. Two apps, one database, three different versions of every business rule.** Whether `Pending` holds stock: the DB trigger says yes, `STOCK_HOLDING_STATUSES` says no (F11/F12). Which statuses may reschedule: the RPC allows seven, admin allows three, mobile allows two, and two comments in the same call chain assert opposite things (F40). Status casing: every writer stores `'Pending'`, one cron predicate asks for `'pending'` (F14). The admin app still sends Firestore-era payload shapes with no schema contract (F8). There is no shared vocabulary or generated-type boundary between the repos — each encodes the rules from memory.

**D. Silent failure remains the house failure mode, and it recurred.** Confirmed-silent this pass: F15 (rating updates filtered to zero rows, forever, for every customer), F14 (cron reports `succeeded` 19 times having matched an impossible predicate), F12 ("Fix & Sync Stock" reports success while destroying live holds), F29 (migration in the ledger, DDL absent from the DB), F11 (permanent double-decrement of `total` at handover), F24 (HTTP 400 leaves stale results under a mismatched header), F34 (price-warning state computed and never rendered), F3/F19 (controls that revoke nothing). Notably, **the F1 and F8/9/10 clusters fail *loudly*** — which is why they rank below F2 despite being 100% broken; the operator finds out on the first click.

**E. Client-side validation with no server-side counterpart** (known pattern #5, recurring). Quantity: the UI drops it (F22), the legacy RPC prices one unit while holding N (F16), the hold trigger fails open on a size-key miss and has no ceiling (F21). Price: the bag re-validates and discards the result (F34). Blocking: client-side only (F3, F19). F16's migration header even *documents* the reasoning — "the app hardcodes 1" — which is the exact justification that produced the last shipped bug.

**F. React identity discipline is absent where it costs the most.** F4 (unmemoized `useLocalSearchParams()` in a dep array), F5 (unmemoized `markAsRead` in a dep array), F35 (fresh object per camera frame). Two of these produce *unbounded* loops, and F5's runs UPDATEs and SELECTs against shared production with no staging for as long as any customer has a chat open.

---

### 3. Ranked by real-world risk

Weighted for reachability by an ordinary actor, exposure to money/PII/the shared DB, and silence.

**1. F2 — `check_profile_updates()` lost the `deleted` guard.** *(migration)* Exploitable today by any of five active staff accounts with one PATCH: soft-delete the sole Owner and the shop loses catalogue writes, reservation writes, payments, store hours, and all-profile access. In reverse, the one already-soft-deleted account (auth row unbanned, password intact) restores itself. Also reverses a `process_account_deletion()` GDPR erasure. Silent, bidirectional, live.

**2. F1 — `assert_bookable_slot` revoked from `authenticated`.** *(migration)* Every direct table write touching `status`/`date`/`appointment_time` fails at 42501 for the Owner. Customers can still book via the DEFINER RPC, so Pending piles up and nothing is acceptable, cancellable, completable, or payable. **Surface the derived finding the verifier turned up:** the `reservations` UPDATE policy is `is_admin_or_owner()`, which excludes `role='staff'` — so the five Staff accounts don't get the error, they get a zero-row PATCH that PostgREST reports as success. That's a second, silent, pre-existing hole on the same table.

**3. F3 + F13 + F30 (+ F19's `is_blocked` half) — offboarding revokes nothing.** *(migration + edge function)* A terminated, blocked staff member retains read access to every customer profile (name, phone, address, DOB), every reservation and payment, and can call `verify_pickup()` and `process_account_deletion()`. A soft-deleted one can still write off outstanding balances via `settle_reservation_balance`. Below F1/F2 only because it requires a previously-trusted insider.

**4. F11 + F12 — inventory arithmetic is double-owned.** *(admin app, ideally + migration)* Approve double-deducts on top of the trigger; completion permanently drops `total` by 2 per unit handed over with no restoring path; any non-dashboard cancel strands a unit in `reserved` forever; and the button labelled "Fix & Sync Stock" — precisely what staff reach for when the numbers look wrong — wipes every live Pending hold and reports success. Silent, permanent, corrupts the shared source of truth, and produces overselling. **Current drift is zero (five Cancelled reservations, `sum(reserved) = 0`). This is a clean fix window that closes the moment the shop takes a real booking.**

**5. F8 (+F9, F10) — three dashboard write paths send nonexistent columns.** *(admin app only, no migration)* `staff`, `reservation_date`, `timestamp`. Mark-paid, reschedule, and staff-side create are each 100% dead. Combined with F1, the dashboard cannot advance, reschedule, or create a reservation by any route. Ranked below the silent items only because it announces itself on the first click.

**6. F15 — `update_product_rating()` is INVOKER under an admin-only `products` policy.** *(migration)* Every customer review silently fails to move `products.rating`/`review_count`, permanently. Proven by paired rolled-back impersonation probes. Compounding: the seeded aggregates are fiction (204 reviews against 0 rows) and will collapse to 1 on the first real review that does land.

**7. F17 — re-opening a payment orphans a live PayMongo session.** *(edge function)* Real money captured into the merchant account with no `payments` row, the reservation auto-cancelled, and the customer told payment was not received. Worse than reported: the `.catch(() => null)` at line 128 means any transient PayMongo 429/5xx triggers the same reset with no staff action at all.

**8. F5 (+F7) — chat screen self-feeding realtime loop.** *(mobile)* Every customer who opens a conversation drives, per cycle, two UPDATEs, two SELECTs, and a channel teardown/rebuild against shared production, indefinitely. Shared realtime quota means a handful of concurrent chats can degrade the admin dashboard.

**9. F16 + F21 + F22 — the quantity axis is unvalidated at every layer.** *(migration + mobile)* Legacy `create_reservation` charges for one unit while holding `_quantity` (F16); the hold trigger fails open on any size string with no matching inventory row, enabling silent double-booking of the same physical units (F21); the single-item Reserve button drops the customer's chosen quantity entirely (F22). Each is bounded on its own; together they mean no layer owns quantity.

**10. F4 + F6/F25/F36 — the body-scan pipeline produces wrong numbers and the correction screen is broken.** *(mobile)* Cross-sections normalized to frame *width* but converted using *height* (F6, ~33% variance from standing 0.5 m closer); x/y mixed with no aspect term (F25); the z-score outlier filter is mathematically unreachable at n=5 (F36) — and it is all stamped 0.95 confidence. F4 then makes the review screen re-render continuously and snap any typed correction back to the scanned value, so the customer cannot fix it before it persists as `measurement_source: 'camera_scan'` and drives every size recommendation. **The compounding is the finding: three wrong numbers plus a broken correction path.**

**Below the line** (real, fix opportunistically): F14/F28 dead unattended-alert cron; F19 GDPR re-seed half; F29 ledger-vs-DB drift; F18 recovery-flag persistence; F20 cart-wipe on partial reserve; F26/F27/F39 admin reporting (unearned revenue counted, 100-row unordered cap, CSV crash on empty range); F23/F24 search race and unescaped `.or()`; F31 unpaid non-expiring holds; F32/F33 client state surviving sign-out; F34 dead price warnings; F35 AR per-frame setState; F38 ten-row review summary; F40 stale `canReschedule`.

---

### 4. Concrete fixes for the top items

**Migrations required — coordinate with the co-worker, no staging exists.** Seven of the top ten need DDL against the live shared DB. Batch them into one window, each with the `.rollback.sql` CLAUDE.md requires (note `20260809120000` shipped without one), and re-sync the ledger + regenerate `src/types/database.types.ts` afterwards.

- **F1** — `GRANT EXECUTE ON FUNCTION public.assert_bookable_slot(date, timestamptz, uuid, boolean) TO authenticated;`. Lowest-risk change in this report: the function only reads `store_hours`/`store_closures`/`reservations` and raises. **Ship this one alone as a hotfix, ahead of everything else.** Separately, widen the `reservations` UPDATE policy to `is_staff_or_admin()` — or accept that Staff must go through RPCs — but do not leave a zero-row silent PATCH in place.
- **F2** — `CREATE OR REPLACE check_profile_updates()` restoring the fourth condition (`NEW.deleted IS DISTINCT FROM OLD.deleted`) from `20260727080400`, and fix the rollback file, which is also missing it. The 20260727 header's blast-radius warning still applies: exempt the DEFINER path so `process_account_deletion()` (runs as `postgres`) is not blocked.
- **F3/F13/F30** — add `AND coalesce(is_blocked, false) = false` to both helpers; replace the raw role lookups in `settle_reservation_balance` and `resolve_reschedule` with `is_staff_or_admin()`; bind `account_deletion_requests` INSERT to `WITH CHECK (user_id = auth.uid())` and split the `FOR ALL`. **Operational caution: the helpers back dozens of policies. Verify no currently-active admin or owner has `is_blocked = true` before applying, or you lock the shop out with the fix.** The DB change alone is insufficient — blocking must also revoke the credential (ban the `auth.users` row / global sign-out) via an edge function, or a live JWT keeps working until expiry.
- **F15** — make `update_product_rating()` SECURITY DEFINER **with `SET search_path = public, pg_temp`** (known pattern #4 — do not skip the pin). Then decide whether to zero the fabricated seed aggregates rather than let them collapse mid-launch.
- **F16** — simplest correct fix is `REVOKE EXECUTE ON FUNCTION public.create_reservation(...) FROM authenticated, PUBLIC;` — the app uses `create_reservation_multi`. **Remember pattern #3: revoking from `anon`/`authenticated` alone can no-op; revoke from PUBLIC and verify with `has_function_privilege`.**
- **F21** — change the fail-open condition from "no inventory row for this (product, size)" to "no inventory rows for this product at all", which preserves the legacy-catalogue intent the comment actually wanted, and reject a tracked product with an unmatched size. Add a per-line quantity ceiling in `create_reservation_multi` (it currently caps line *count* at 20, not units).
- **F14** — `lower(coalesce(status,'')) = 'pending'` in both the function and the index predicate (a partial-index predicate cannot be altered in place; drop and recreate). Do this as part of *finishing* the feature: deploy the missing `send-unattended-alert` function and source the token from vault, not the literal `"Bearer anon_key_placeholder"`.

**Admin app only, no migration:**

- **F8/9/10** — fix the three payloads (drop `staff` and `timestamp`, map `reservationDate` → `date`, use `assigned_staff_id`), then fix the class: add a column allowlist in `updateDocument`/`addDocument` so an unknown key is a build-visible error rather than a runtime PGRST204. Surface `error.message` in the toast; the generic string is why F9/F10 read as flaky networking.
- **F11/F12** — delete the `adjustStockForReservation` calls from the reservation lifecycle handlers; the DB triggers already own this. Replace the "Fix & Sync Stock" recompute with a SECURITY DEFINER RPC that reuses `reservation_holds_stock`, so the hold predicate has exactly one definition. That last part is a migration.

**Mobile app only:**

- **F5** — `useCallback` on `markAsRead` keyed to `session?.user.id`, matching `refreshConversations` at line 37. Memoizing the provider value alone does **not** break the loop.
- **F4** — capture the scan payload into a ref and gate the effect with an applied-once flag, or depend on the `scanData` string rather than the `params` object. Do not just re-add the eslint-disable.
- **F6/F25** — normalize extents against the subject's own pixel span (the front-only path already does this correctly at `poseDetector.ts:158`) and apply the frame aspect ratio before combining x- and y-derived spans. Stop stamping 0.95 confidence on the least-calibrated number in the pipeline.

**Sequencing:** F29 proves the ledger already disagrees with the live DB for at least one migration, so a `db push`-style apply may skip `20260809003000` as already-applied. **Reconcile file-vs-live before applying anything new.** And fix F11/F12 while inventory drift is still zero.

---

### 5. Claims to *not* carry forward

Verifiers refuted these; a fixer chasing them will waste time. Paid customers are **not** auto-cancelled by the failed mark-paid transition (F8 — `expire_unpaid_reservations` keys on `payment_status`, not `countdown`). A locked-out admin **can** self-repair via a raw REST call (F2). Missing realtime messages are **not** lost in F5 — every cycle refetches and self-heals the gap. `legLength`/`inseam` are near-vertical and barely affected by F25. The F36 outlier gap does **not** corrupt bust/waist/hips on the default path — those are replaced by a true median. F39 does **not** trip the ErrorBoundary (React 18 boundaries don't catch handler errors). F30 is not privilege escalation — `profiles` already carries the identical unbound staff policy, so the marginal gain is one credential deletion. F27's headline-stats half is not currently reachable, and reservations *are* ordered newest-first.

---

### 6. Not covered — blind spots

- **Nothing was executed.** No test suite exists, no device run, no end-to-end transaction. Every finding is static reading plus live-DB introspection. Race conditions were reasoned about, not reproduced.
- **Concurrency.** Slot-capacity double-booking under simultaneous requests, the `assert_bookable_slot` TOCTOU window, and the correctness of the `FOR UPDATE`/`FOR SHARE` locks added in `20260809010000` were not analysed.
- **PayMongo webhook authenticity.** Only the unknown-session path was audited. Signature verification, replay protection, and idempotency of the paid handler were not.
- **Storage.** RLS on `storage.objects`, receipt-upload scoping, chat-image access, signed-URL lifetimes, and retention of body-scan imagery are entirely unexamined.
- **Supabase Auth configuration.** Session TTL, refresh-token rotation, leaked-password protection, MFA, OTP settings — these live outside migrations and were not reviewed, despite F18 and the offboarding cluster both hinging on credential lifetime.
- **Most of the admin dashboard.** Only `Reservations.jsx`, `Analytics.jsx`, `Dashboard.tsx`, `Inventory.jsx`, `productService`, `customerService`, and `AuthContext` were touched. Its own auth flow and the `create-staff-account` / `activate-staff-account` edge functions were not.
- **The remaining migrations.** Roughly a dozen of 113 were read closely. F29 shows file-vs-live drift is real; the other ~100 have not been reconciled against the deployed schema, and `database.types.ts` was not diffed against live.
- **Not run:** Supabase security/performance advisors, dependency and secrets scanning, index/query-plan review, push notifications and deep links beyond the recovery URL, native-module permission handling, and iOS behaviour generally (no committed `ios/`).

---

## Refuted claims — do not chase these

18 candidate findings did not survive verification. Recorded so a future reader does not
re-investigate them.

1. **supabase/migrations/20260727080200_drop_create_reservations_from_cart.sql: The client-price-trusting create_reservations_from_cart RPC was never actually dropped (wrong signature)**  
   The reviewer's mechanical observation is true but the finding as filed does not hold up: its central premise, its stated failure scenario, and its severity are all contradicted by the repo and the live DB.

WHAT IS TRUE (verified, not disputed):
- `supabase/migrations/20260727080200_drop_create_reservations_from_cart.sql:10` does say `DROP FUNCTION IF EXISTS public.create_reservations_from_cart(jsonb);` while the real signature is 4-arg.
- Live query of pg_proc confirms `create_reservations_from_cart(jsonb,text,text,text)` still exists, prosecdef = true, and its body does take `(item->>'unit_p

2. **supabase/functions/payments-webhook/index.ts: Webhook credits the full deposit on event type alone, never comparing the amount or currency actually captured**  
   The literal observation is true — `supabase/functions/payments-webhook/index.ts:108-113` selects only `id, reservation_id, status, last_event_id`, and the update at 147-156 branches on `eventType` alone with no amount/currency comparison. But every step of the claimed failure chain is broken by code the reviewer did not check.

1. The amount comparison would be a tautology, not a control. `payments.amount_centavos` is not an independently-sourced expectation; it is written by our own server in the same request that creates the session it would be compared against. `payments-create/index.ts:98`

3. **src/lib/payments.ts: getLatestPayment has no user_id filter, so a staff/owner session reads a stranger's newest payment as its own**  
   The quoted code is real and the RLS mechanism is described accurately, but the finding does not hold up as filed, for three independent reasons.

First, the security half is void. The finding frames staff reading another customer's payment id and status as an information disclosure, but "Staff read all payments" (verified live in pg_policies, defined at 20260730093000_payments.sql:66-70) is a deliberate design grant, sitting immediately above "Staff update payments" with the comment "Staff may correct a payment (mark refunded, reconcile a stuck row)". Staff already hold full SELECT on the enti

4. **src/utils/recoveryLink.ts: handleRecoveryUrl accepts recovery tokens from ANY deep link with no scheme/path validation**  
   The quoted code exists verbatim and the wiring claim is accurate, but both the named defect and the claimed impact fall apart on inspection.

1) THE NAMED MISSING CONTROL IS INERT. The finding's title and remedy are "no scheme/path validation" / "no check that the URL matches Linking.createURL('reset-password')". Neither check would block the described exploit.
   - Scheme: app.json declares only `"scheme": "jezsymobileapp"` with NO `android.intentFilters` and NO `ios.associatedDomains` (I grepped the whole repo; there is no app.config.js either, and the only deep-link handler in the codebase 

5. **app/(auth)/welcome.tsx: OAuth callback URL including the leading bytes of the access token is console-logged in release builds**  
   The finding is factually accurate about the code and the character count, but wrong about the security consequence, and the claimed severity rests entirely on that wrong consequence.

The reviewer asserts the truncation "is applied to the wrong boundary: it slices the URL, not the credential." The opposite is true. For the standard Supabase HS256 access token, 80 characters lands exactly on the header/payload boundary: 44 chars of `jezsymobileapp://auth/callback#access_token=` plus the 36-char base64url header `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`. Not one byte of payload or signature is emit

6. **app/product/[id].tsx: Product page reads soft-deleted inventory rows; every other reader filters them out**  
   The cited line is real -- app/product/[id].tsx:89 genuinely omits the `.eq('deleted', false)` filter that EditVariantModal.tsx uses -- but the finding's failure mechanism is structurally impossible, so no failure scenario is reachable.

The claimed harm depends entirely on TWO rows existing for the same (product_doc_id, size): a stale soft-deleted one and an active replacement, with PostgREST returning them in unspecified order and `inventory.find()` (line 243) grabbing the wrong one. A UNIQUE constraint on exactly that pair, which deliberately does not include `deleted` in its key, forbids th

7. **src/components/EditVariantModal.tsx: Per-size cap is dropped whenever no size is selected or the stock map has not resolved, leaving the cart uncapped**  
   The quoted code is accurate but the failure scenario does not survive contact with the live data or the surrounding call sites.

UNREACHABLE HEADLINE SCENARIO. The finding rests on "a sizeless product (empty products.sizes) tracked in inventory under a NULL size with available = 2." I queried the shared production DB: inventory has 170 rows with ZERO where size IS NULL and ZERO where size = ''; products (non-deleted) has 21 rows with ZERO having null/empty sizes and therefore ZERO sizeless products carrying inventory; reservation_items has ZERO rows with size IS NULL. The reviewer is right tha

8. **app/cart.tsx: Bag deposit is unrounded and formatted with toLocaleString, producing three-decimal peso amounts**  
   The cited code exists verbatim at app/cart.tsx:350, but both claims supporting the finding fail.

1) The premise "the bag is the only place in the money path that does not use .toFixed(2)" is factually false. toLocaleString() is the app-wide convention for BROWSE surfaces: src/components/ProductCard.tsx:167 and :171, app/(tabs)/index.tsx:355, app/wishlist.tsx:112. .toFixed(2) is used only on TRANSACTIONAL surfaces (app/reserve/[id].tsx:515/524/533, reservations detail/list). The cart is a browse surface and is consistent with its cohort. No shared currency formatter exists in the repo (grep fo

9. **src/utils/pushNotifications.ts: Date-only strings are parsed as UTC midnight, shifting the reminder and displayed appointment day west of UTC**  
   The finding does not hold up as written, on three counts.

(1) Its most user-visible claim rests on a false premise about the schema. The finding asserts "date-only strings are fed to the Date constructor" at app/reservations.tsx:100 and app/reservations/[id].tsx:257-259. I checked the live DB: reservations.date and reservations.appointment_time are both `timestamp with time zone`, and a live row serializes over PostgREST as "2026-08-06T00:00:00+00:00" — an offset-bearing ISO instant, not "YYYY-MM-DD". Those Date constructors parse an absolute instant and never reach the ECMA-262 date-only/UTC

10. **app/profile/body-scan.tsx: finishScan() has no completion guard and is re-invoked by every camera frame that arrives before the camera deactivates**  
   The quoted code at app/profile/body-scan.tsx:269-271 exists and genuinely lacks a completion latch, but every claimed consequence fails verification.

(1) "Overlapping speech" is refuted by app/profile/body-scan.tsx:192 — Speech.stop() runs immediately before Speech.speak(), so repeats cancel-and-restart rather than overlap. The reviewer quoted lines 191-197 but read past the guard sitting inside them.

(2) "router.replace issued multiple times, each carrying a separate scanData payload, compounding the measurements-screen loop" is refuted by React Navigation's StackRouter REPLACE handler (nod

11. **app/(tabs)/index.tsx: Home runs the cache seed and the network fetch concurrently with no ordering guard, so a slow cache read can overwrite fresh catalog data**  
   The cited code exists exactly as described, but the claimed failure — the network response landing before the cache read so a stale snapshot clobbers fresh catalog data — is not reachable, because the cache path's work is a strict subset of the network path's work.

1. Payload identity kills the "large blob makes JSON.parse slow" premise. The cache is written from the network response itself (index.tsx:129, `cacheProductCatalog(data as unknown as OfflineProduct[])`), so the blob the cache path JSON.parses is the same size as the body the network path must download and JSON.parse inside fetch/s

12. **app/(tabs)/messages.tsx: Supabase results are awaited inside try/catch without inspecting `error`, so the catch is dead code and failed writes silently revert**  
   The mechanism half of the finding is correct, but the impact half — the part that makes it a "medium" — does not survive contact with the code or the live database.

WHAT HOLDS UP. The cited code is verbatim present at C:\Users\carlv\jezsy-mobile-app\app\(tabs)\messages.tsx:71-78 (markAsRead) and :85-88 (dismissAnnouncement), and at C:\Users\carlv\jezsy-mobile-app\src\context\MessagesContext.tsx:167-178. I confirmed in the installed postgrest-js 2.104.1 source (C:\Users\carlv\jezsy-mobile-app\node_modules\@supabase\postgrest-js\src\PostgrestBuilder.ts) that these builders never reject without 

13. **src/components/ReviewsList.tsx: Client review-eligibility gate is far stricter than the RLS policy, hiding the review button from permitted customers**  
   REFUTED at the cited file and line. The claim is "the client invented a stricter gate than the RLS policy." It did not -- it mirrors migration 20260809003000 exactly, including the same exact-case 'Completed'/'Active' literals. The reviewer quoted the older, superseded policy from 20260808071552 and concluded the client was wrong.

Why the reviewer's live query returned the older text: the live DB has DRIFTED. I confirmed pg_policy on public.reviews currently shows the INSERT WITH CHECK without the status predicate, and pg_proc.prosrc for set_review_verified_purchase likewise lacks it -- i.e. 

14. **src/hooks/useRealtimeSync.js: Module-level `isSubscribed` latch is set before subscribe and never reset; channels are never removed and errors are swallowed**  
   All three enumerated defects fail on inspection, and the file is not even in the repo under review.

SCOPE: The cited path src/hooks/useRealtimeSync.js does not exist in jezsy-mobile-app. That directory holds only useSafeBack.ts and useSizingProfile.ts, and the repo has no supabaseService.js (src/lib/ is payments.ts, receipts.ts, supabase.ts). The code lives in the separate admin-dashboard repo, which a co-worker deploys independently.

DEFECT 1 (unrecoverable latch) is the load-bearing claim and it is factually wrong about supabase-js semantics. The reviewer asserts "once the latch is set, no

15. **src/utils/notificationSound.js: Oscillator and gain nodes are never released while the AudioContext is suspended by autoplay policy**  
   REFUTED on four independent grounds.

1) WRONG REPO — the cited path does not exist in the codebase under review. `git ls-files | grep -c notificationSound` in C:\Users\carlv\jezsy-mobile-app returns 0, and the entire tracked mobile tree contains zero `AudioContext` references. React Native has no `window.AudioContext`, so `src/utils/notificationSound.js` line 21 is unreachable as a mobile-app path. The real file is in the sibling repo: C:\Users\carlv\admin-dashboard\src\utils\notificationSound.js. I read it in full anyway and evaluated it on the merits rather than dismissing on scope alone.



16. **src/types/database.types.ts: Generated types missing confirmed_by_id / confirmed_by_name / confirmed_at, which a migration added and the admin app writes**  
   The finding's factual core is accurate but its severity and failure scenario do not survive contact with the code.

VERIFIED AS CLAIMED: migration 20260809130000_track_reservation_accepted_by.sql:3-5 adds the three columns; the live DB has them; src/types/database.types.ts contains none of the three while peer columns (balance_settled_at at 1074/1111/1148, pickup_token at 1092/1129/1166) appear 3x each; and no .rollback.sql exists for any of the four 20260809* migrations.

WHY IT IS REFUTED AS FILED:

1. The failure scenario is already moot. It predicts "a mobile developer adds the 'Accepted b

17. **src/utils/newArrival.ts: New Arrival window computed differently in each repo: 14 days AND flag (mobile) vs manual-override-forever OR 7 days (admin)**  
   The two code quotes are accurate — the rules really do differ — but the finding does not hold up as a defect at src/utils/newArrival.ts:11.

First, the mobile rule is an explicitly documented design decision, in both a file-header comment (lines 2-10) and its own commit (69adbda), which the review guidance names as refutation grounds. Line 11 contains a considered constant, not a bug; there is no schema, RPC, trigger, or shared contract that fixes the window, as the reviewer admits.

Second, the headline failure scenario cannot happen. The reviewer's mirror case requires staff to tick "Force N

18. **src/services/offlineSync.ts: Offline order queue upserts on an offline_id column that exists in no migration and no generated type**  
   Every factual claim in the finding verifies, but the finding fails on reachability, which its own text concedes.

1. The cited code exists and says what is claimed. offline_id is backed by no column in any migration and no line of the generated types; reservation_items INSERT really is admin-only; the NetInfo listener really is registered from app/_layout.tsx:192.

2. But the upsert at line 174 is unreachable dead code. flushOrderQueue returns at line 165 whenever the queue is empty, and the queue is structurally always empty: the sole appender, enqueueOrder, has zero callers anywhere in src/ 

