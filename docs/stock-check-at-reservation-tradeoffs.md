# Stock checking at reservation time -- tradeoffs

## Current behavior

`create_reservation_multi()` (`supabase/migrations/20260805231149_create_reservation_multi.sql`)
resolves price and availability (`visibility = 'public'`, `deleted = false`) per line, but never
reads a stock/quantity count. A customer can request any size/quantity combination regardless of
what's physically on the rack.

Stock is only ever touched by staff, in `owner-dashboard`'s `Reservations.jsx`
(`adjustStockForReservation`), on approve/cancel/complete -- i.e. stock moves on the *staff
decision*, not the *customer request*. This was a deliberate prior-session choice, not an
oversight, and the multi-item RPC didn't add or remove that behavior; it inherited it from the
single-item RPC unchanged.

## Option A -- leave as-is (no check at request time)

**How it works today:** customer requests, staff reviews and either approves (decrements stock)
or rejects. Overbooking is caught by a human at approval, not by the system at request time.

**Pros**
- Matches the "staff-approval" model already deliberately chosen over Uniqlo-style
  auto-confirm (per prior session notes) -- staff are already the checkpoint, so a second
  automated checkpoint is partially redundant.
- No RPC change, no race-condition surface to reason about.
- Boutique volume is low; the handover notes assumed this was "unnecessary at boutique volume."

**Cons**
- A customer can request (and see as "Pending") something already reserved by someone else, then
  get rejected at approval with no reason given automatically -- a worse experience than an
  immediate "out of stock" at request time.
- Nothing stops the same item being requested by N different customers simultaneously; staff sort
  out the conflict manually, which doesn't scale past a handful of concurrent requests.

## Option B -- soft check at request time (informational only)

Read current stock when building the reservation screen/RPC and block submission (client + RPC
guard) if requested quantity exceeds available stock *at the moment of the request*, but don't
reserve/decrement anything until staff approval -- purely a "don't let them ask for something
already gone" guard, not a hold.

**Pros**
- Cuts the most common bad case (item's already gone) at the door, with a clear message, instead
  of a silent rejection later.
- Small RPC change: add an `available >= quantity` check per line in the existing per-line loop
  in `create_reservation_multi`, raising the same style of exception already used for unavailable
  products (`'One of the selected products is unavailable.'`).

**Cons**
- Doesn't fully close the race: two customers can both pass the check for the last unit within
  the same window, since nothing is actually held. Staff still resolve the last-one-wins case at
  approval -- same as today, just less frequently triggered.
- Stock isn't on `products` at all -- it's a separate `inventory` table (`total`/`reserved`/
  `available` per `product_doc_id` + `size`), matched by `adjustInventoryForReservation`
  (`owner-dashboard/src/services/reservationService.js:199`) via a 3-way fallback lookup
  (`product_doc_id`, then `sku`, then `item` name). The RPC would need to join on the same key
  owner-dashboard actually populates reliably (`product_doc_id`+`size`) rather than reproduce
  the fuzzy fallback -- confirm `product_doc_id` is always set before relying on it, since the
  fallback paths existing at all implies it sometimes isn't.

## Option C -- hard check + hold at request time

Decrement (or place a soft hold on) stock the moment a reservation is created, matching typical
e-commerce "reserve at checkout" behavior; release the hold if staff reject or if the payment
deadline lapses unpaid.

**Pros**
- Fully closes the race condition -- no double-booking possible.
- Matches customer expectation from e-commerce (Uniqlo etc.), where "I could request it" implies
  "it's mine unless something goes wrong."

**Cons**
- Directly conflicts with the deliberate anti-refund-churn design: reservations here are
  staff-approved specifically to avoid the payment/refund churn of auto-confirm. Holding stock
  before approval reintroduces exactly the failure mode that design avoided (stock tied up by
  requests staff would have rejected anyway).
- Needs a hold-expiry mechanism synced with `payment_due_at` (`LEAST(24h, appointment_time - 1h)`)
  and a release path on rejection/expiry/cancel -- meaningfully more code than Option B, and more
  states to get wrong (held-but-unapproved, held-but-unpaid, held-but-expired).
- Largest surface area of the three: touches the RPC, the approval flow, the payment-deadline
  trigger, and probably needs its own migration for a `stock_holds` concept or a `held_quantity`
  column separate from actual stock.

## Recommendation (historical)

The analysis above recommended Option B and deferred Option C. **This recommendation is now
outdated.** Option C (hard hold at request time) was subsequently built as
`20260808123756_reservation_inventory_holds.sql`, which introduces an `inventory_holds` table and
a full hold/release lifecycle tied to `payment_due_at`. The production concurrency model is
therefore the hard-hold model, not the soft-check model described in Option B.

The tradeoff analysis above is kept for historical context. The "Cons" of Option C listed here
were addressed in the migration: the hold-expiry mechanism is handled by the server-side sweep
(`expire_all_stale_reservations`), and holds are released on cancellation and payment-deadline
expiry.
