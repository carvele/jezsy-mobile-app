# Completion plan

Everything outstanding as of 2026-08-07, ordered by dependency and risk. Five PRs
(#50-#54) are open and unmerged; several items below are blocked on them.

## The one question that changes the work

**What should a customer's lifetime spend mean: money received, or business
committed?**

`countsAsRevenue` currently returns true as soon as `payment_status = 'Paid'`,
and the caller then adds the full `rental_price`. Since the webhook sets
`payment_status = 'Paid'` after a 50% deposit, lifetime spend counts money that
has not arrived.

- If **money received**, add `deposit` while the balance is outstanding, and the
  full price only once the balance is settled. This needs A3 to be meaningful,
  because nothing currently records settlement.
- If **business committed**, the current total is defensible and the fix is only
  to stop calling it "spent" and to show the split.

A1 cannot be written correctly until this is answered. Everything else can
proceed regardless.

---

## A. Balance collection

The reserve screen promises "Balance on collection" and no code implements it.
`payments-create` charges `reservations.deposit` only, the webhook sets
`payment_status = 'Paid'`, and the admin's "Hand over" action moves status and
stock without touching money. The remaining 50% is taken in person and nothing
records it.

`payment_type` already distinguishes `'Deposit'` from `'Full'` correctly. Nothing
reads it. That column is the hook for all of the below.

### A1. Stop overstating revenue — admin-dashboard, no schema

`src/services/customerService.js:174` and `countsAsRevenue` in
`src/utils/reservationStatus.js`. Blocked on the question above.

Ship with a unit test: the repo has `customerService.test.js`, and a deposit
reservation counting its full price is exactly the case to pin.

### A2. Show the balance at handover — admin-dashboard, no schema

Staff currently see "Paid ✓" on a reservation still owing half. The To Pickup
card and the list row should show `rental_price - deposit` when
`payment_type = 'Deposit'`.

Derived, not stored. No migration. Highest value per unit of risk in this whole
plan, and independent of the question above.

### A3. Record that the balance was collected — schema

Migration adding `balance_settled_at timestamptz` and `balance_method text` to
`reservations`, plus a "Balance received" step on the Hand over action.

Idempotent, with a rollback, applied only after explicit confirmation. The
dashboard writes this table too, so it needs coordinating.

### A4. Let the customer pay the balance in app — optional, last

Reuses `payments-create` with a balance amount rather than `deposit`. Only worth
doing after A3 exists, since it needs somewhere to record the result.

---

## B. Reschedule request and approve

Today `reschedule_reservation` writes the new date straight to the row: no
approval, no staff notification. It also accepts only `('pending', 'confirmed')`,
while the dashboard's `CAN_RESCHEDULE_STATUSES` includes `To Pickup` -- so staff
can move an appointment in a state the customer cannot.

Needs a proposed-date column pair or a requests table, an RPC that writes the
request rather than the booking, an admin approve/reject action, and a
notification back. Schema change, so same confirmation gate as A3.

Sequence after A, since A2 and A3 touch the same admin surfaces and doing them
together avoids two passes over the same components.

---

## C. Finish the token sweep

Mobile only, no schema, low risk. The method is settled: exact-match spacing and
radius as one provably 1:1 commit, typography as a second, verified on device in
both themes.

### C1. Stage 4 remainder -- blocked

`app/reservations.tsx` and `app/reservations/[id].tsx` are in #51 and #53. A third
branch on the same files is the conflict CLAUDE.md warns about. Do this once those
merge.

### C2. Stage 1 mechanical -- ~4,100 lines

The plan calls Stage 1 "largely done", but only the enablers landed. `auth.tsx`,
`welcome.tsx`, `profile-setup.tsx`, `reset-password.tsx`, `(tabs)/index.tsx` and
`(tabs)/explore.tsx` still carry zero tokens.

Watch the documented exclusions: `otpBox` arithmetic, `pricePresetCard` at 48% in
a gapped row, the editorial stagger, and the three dark-locked screens.

`profile-setup` light mode has still never rendered. It is the highest-risk screen
in the app and needs a real signup to reach.

### C3. Stage 6, new -- 1,426 lines

`app/product/[id].tsx` (808), `app/cart.tsx` (394), `app/wishlist.tsx` (224). In no
stage of the original plan. Product detail is among the highest-traffic screens in
the app.

### C4. Strays -- ~1,900 lines

`app/outfit-builder.tsx` (791), `app/profile/body-scan.tsx` (530),
`app/ar-tryon/[id].tsx` (447), `app/payment-return.tsx` (126),
`app/(tabs)/_layout.tsx` (125).

`body-scan` and `ar-tryon` depend on the three load-bearing native modules, so
they cannot be verified without a dev-client build and must degrade safely.
`_layout.tsx` contains the `barBottom` arithmetic that is explicitly out of scope.

---

## D. Record the gaps in the sweep plan

Add Stages 1, 6 and the strays to `token-sweep-remaining-plan.md` with honest
line counts, so a future reader does not inherit the same blind spot twice.

Cheap, zero risk, and it is what stopped these being lost this time. Do it first.

---

## Order

1. **D** -- record the gaps
2. **A2** -- balance visible at handover, no schema, stops staff being misled
3. **A1** -- revenue math, once the question above is answered
4. **C2, C3, C4** -- token sweep, in that order, while merges settle
5. **C1** -- once #51 and #53 land
6. **A3, then B** -- the two migrations, each confirmed before applying
7. **A4** -- only if wanted

## Standing constraints

- No migration applied without explicit confirmation; every one idempotent and
  paired with a rollback.
- Admin-dashboard work is a separate repo, separate branch and PR.
- Per stage: `tsc` clean, eslint at or below the 9-problem baseline, device pass
  in both themes.
- Anything unverifiable gets said so, not claimed.
