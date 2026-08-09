# Activity log

## 2026-08-07

Started as "finish Stage 3 of the token sweep" and turned into most of the
outstanding work in both repos. Written down because several findings only make
sense with the reasoning attached.

### Design tokens — the sweep is now complete

Every screen in the app carries tokens. Stages 3, 4, 5, 6, 7 and the remainder
of 1 all landed today, plus a 16pt step (`bodyLarge` / `bodyLargeStrong`) added
to the scale because 16 was the most-used size in the app and had no slot.

**The plan was wrong in two directions**, and neither was found by reading it:

- It listed four areas. Three more existed -- the inbox, product/cart/wishlist,
  and a set of strays -- totalling 6,771 lines including `product/[id]`, one of
  the busiest screens. The areas had been chosen from memory rather than from
  the route table.
- Stage 1 was described as "largely done". Only its enablers had landed; the
  sweep had never run.

Both root causes are recorded in `token-sweep-remaining-plan.md`.

**Method that held up:** exact-match spacing and radius as one commit, proven by
back-substituting the tokens and checking the line reproduces the original byte
for byte; typography as a second commit, because it adds `lineHeight` and
genuinely reflows.

**Standing rules discovered along the way:** never give a `TextInput` a
`lineHeight` (Android shifts the baseline); never convert only one half of a
label/amount pair (they fall off a shared baseline); radii that are half an
element's fixed size are circle geometry, not a corner scale.

### Contrast defects

Four found, all invisible to the #47 sweep because that pass was scoped by
grepping `#0D0D0D`:

| Where | Was | Now |
|---|---|---|
| Gender chips, `profile/edit` | **1.10:1** -- unselected chips took `onTint` unconditionally | branches with selection |
| Sign Out, `(tabs)/profile` | 3.43:1, pre-sweep `#F72585` | `colors.error` |
| Unread badge, Inbox | 3.55:1 | `notification`/`onNotification`, 5.03:1 |
| "Only N left", `product/[id]` | 3.59:1 | `colors.warning`, 5.02:1 |

**Scoping a sweep by one literal only finds screens that use that literal.**

### Reservation status was out of sync with the dashboard

The app and the dashboard had two different vocabularies over one free-text
column. Consequences, all customer-visible:

- `To Pickup` matched no filter tab, so a customer whose item was ready to
  collect could only find it under "All".
- `Confirmed` means "approved, not yet paid" and the dashboard shows staff
  "To Pay" -- the app said "Confirmed" while a payment deadline ran.
- **The pickup pass QR was gated on `confirmed`**, the unpaid state. It showed
  to customers who owed money and hid from those who had paid.

`src/utils/reservationStatus.ts` now mirrors the dashboard's module, and a CHECK
constraint stops the vocabulary drifting again.

### Money

**A deposit is not revenue.** `countsAsRevenue` returned true once
`payment_status` was `'Paid'`, which the webhook sets after the *50% deposit* --
so lifetime spend counted the full price of an item the customer did not have
and had half paid for. The >₱50,000 "high value" flag was reachable on money
neither earned nor received.

Revenue is now recognised at handover only (IFRS 15 / ASC 606). That also makes
cash and accrual agree, since the balance is collected in person at that point.

**The balance had no path at all.** The reserve screen promises "Balance on
collection"; nothing implemented it, and nothing recorded that the cash arrived.
Now: shown to staff at handover, recordable via `settle_reservation_balance`,
and `balance_settled_at` / `balance_method` / `balance_settled_by` persist it.

### Booking capacity

There was a maximum -- three per 30-minute slot -- written down twice, in
`assert_bookable_slot` and again as a constant in `TimeSlotPicker`. Now
`store_hours.slot_capacity`, per weekday, read by both. Set to **1**. A daily
ceiling (`max_daily_bookings`) exists and is NULL, meaning off.

### Reschedule

Was immediate and invisible to staff. Now a request that staff approve or
decline, with the proposal held separately from the live booking.

### Process notes worth keeping

- **Stacked PRs stranded work.** #52 and #56 merged into their *base branches*
  after main had already taken #50, so GitHub showed MERGED while
  `git branch -r --no-merged main` showed otherwise. Recovered in #57. Branch
  off `main` and accept conflicts -- a conflict is visible, this was not.
- **Scripts that rewrite code need proving.** One built a regex from a string
  whose escapes were eaten and matched nothing; another split style blocks on
  commas and shredded every `rgba(...)` value, breaking five files. Ten edits
  never justified a parser.
- **Fast refresh does not always apply StyleSheet changes.** A fix looked like
  it did nothing until a full reload; the opposite trap to a fix that genuinely
  does nothing.
- **Device testing found what review did not** -- the squashed filter chips and
  the payment note overflowing its card were both spotted on screen, the second
  by the user in a screenshot I had already read twice.

### Known unverified

The `payments` table is empty: no deposit has ever cleared. Balance settlement,
reschedule approval and the balance display are covered by guards and tests, not
by an observed transaction. `profile-setup` light mode has still never rendered.
`body-scan` and `ar-tryon` need a dev-client build.

## 2026-08-08

Bug fixing that turned into a review, and the review found that one of the
fixes had not been a fix.

### Reviews were unpostable, and unguarded

Two separate faults in the same feature, neither visible from the client.

`set_review_verified_purchase` still queried `orders` and `order_items`, which
`20260730142705_drop_orders` had dropped eight days earlier. A plpgsql body is
opaque until it runs, so `DROP TABLE` succeeded and the break only surfaced at
execution -- as a `BEFORE INSERT` trigger, it meant *every* review submission
had been failing since. Nothing in the app reported it because the failure was
a toast the tester would have read as "my code is wrong".

Separately, the only INSERT rule was `user_id = auth.uid()`: any signed-in
customer could review any product. `verified_purchase` was a display badge, not
a gate -- it labelled reviews after the fact and blocked nothing. Now the
policy requires a matching `reservation_items` row, which is the
Amazon/Shopify verified-purchase model rather than an invention.

While fixing the trigger, a second gap: it checked `reservations.product_id`,
but `create_reservation_multi` only denormalises the *first* line there --
items 2+ live solely in `reservation_items`. Anyone reviewing the second item
of a multi-item reservation would never have looked verified. Both the trigger
and the new policy read `reservation_items`, which carries every line.

### Account deletion had no processing side

`account_deletion_requests` shipped 2026-07-29 with a note that the
admin-dashboard owned processing. Nothing ever built it: requests sat at
`pending` forever and no function existed that could complete one.

The schema decided the shape. `payments.user_id` is RESTRICT and
`reservations.customer_id` is NO ACTION, so a hard `DELETE FROM profiles`
is refused by Postgres for any customer with history -- which is also the
correct outcome under GDPR Art. 17(3), where erasure yields to retention for
legal and accounting obligations. So: erase the personal data, anonymise what
has audit value, leave reservations and payments alone, and scrub the profile
row rather than delete it, since it has to survive as the anchor those rows
point at. Revoking the login needs `auth.admin.deleteUser`, which is
service-role only, so it lives in an Edge Function that calls the RPC first
and only revokes if that succeeded.

### The stock cap that was not one

Earlier in the session the bag was "fixed" to cap quantity at available stock.
Reviewing it against the database afterwards showed the fix was cosmetic in
two ways at once:

- It capped on `products.stock`, which `sync_product_stock` maintains as a
  **sum across every size**. Live example: Seamless Sports Bra had
  `products.stock = 30` while size XS had `available = 6`, so the cap allowed
  30 of a size that had 6.
- `create_reservation_multi` never referenced stock at all -- only
  `quantity < 1` and a 20-line ceiling. The client cap was bypassable by
  calling the RPC directly, so it enforced nothing.

Fixing it properly meant holding stock, not just validating it, and holds have
to be released on cancel, staff decline, payment expiry and pickup. Patching
those four call sites is how holds leak permanently, so instead: both creation
paths write `reservation_items`, and every termination path is a status update
on `reservations`, so two triggers cover all of them including paths nobody has
written yet. `SELECT ... FOR UPDATE` in the hold closes the
two-customers-race-the-last-unit case, which validation alone cannot.

Two things fell out for free: `products.stock` stays correct because the
existing inventory trigger already syncs it, and a cancellation that frees the
last unit fires the existing back-in-stock waitlist notification, which only
triggers on `available <= 0 -> > 0` and so is never fired by a hold.

### Standing lesson

A client-side check is not a control, and calling one a fix is worse than
leaving the bug open, because it closes the ticket. The review that caught this
only worked because it read the *server* function body rather than trusting the
earlier summary of what had been changed. Three other items from the same
session survived that test -- the reviews policy, the deletion RPC, the admin
route guard -- so the pattern was specifically about which layer the check
lives in, not about care taken.

`stepUpAuth.ts` is the deliberate counter-example: still client-side, now
labelled NOT A SECURITY CONTROL in its own header, with the reasoning for not
enforcing it server-side written down so the decision is auditable rather than
accidental.

### Known unverified

None of today's mobile work has run on a device: the glass surfaces converted
to real `expo-blur` (which needs a dev-client rebuild), the AR first-use hint,
the pending-deletion notice, and the reservation shortfall message, whose exact
rendering through PostgREST has only been observed through the SQL console.
The admin-dashboard deletion queue has not been run against a real request.
