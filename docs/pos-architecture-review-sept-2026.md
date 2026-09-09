# JezSy POS & Purchase System — Architecture Review & Evolution Plan

**Reviewed:** September 2026

**Purpose.** This document records the architectural review of JezSy's Walk-in Sales (Boutique POS) system and the consensus decisions about how to evolve it. It corrects the earlier domain framing and establishes the target architecture.

---

## Critical Domain Correction

JezSy reservations are **not rentals**. They are **deferred-completion purchases with inventory allocation**. A walk-in sale is an **immediate-completion purchase**.

Both represent the same commerce domain. The difference is lifecycle timing.

```text
PURCHASE

Mode A — Reserved Purchase
Choose item → Reserve inventory → Item allocated exclusively
→ Pay later / finish payment → Take ownership → Completed

Mode B — Walk-in Purchase
Choose item → Pay immediately → Take ownership → Completed
```

This means the decision to unify both flows in the `reservations` table is not a shortcut — it is architecturally valid, provided the model is formalized correctly.

---

## Current State Assessment

### What is strong

- **Atomic RPC (`record_boutique_sale`)**: Row lock, stock validation, inventory mutation, ledger entry, reservation write, and audit log all in one database transaction.
- **Authorization**: `SECURITY DEFINER` + `auth.uid()` + `can_operate_inventory()` is the correct pattern.
- **Inventory invariant**: `total = available + reserved`. Selling decrements both `total` and `available`, leaving `reserved` untouched.
- **Strict rejection**: Stock validation rejects insufficient inventory rather than clamping with `GREATEST(0, ...)`.

### What needs formalization

| Issue | Current State | Target State |
|---|---|---|
| Walk-in identification | Inferred from `customer_id IS NULL AND status = 'Completed'` | Explicit `purchase_mode = 'walk_in'` |
| Price semantics | `p_sale_price` — ambiguous unit vs total | `p_unit_price` with `line_total = unit_price * quantity` computed in RPC |
| Column naming | `rental_price` | Schema terminology debt — should become `agreed_price`, `total_amount`, or similar |
| Line items | Walk-in sales skip `reservation_items` | Walk-in sales should create `reservation_items` for product-level analytics |
| Payment tracking | No payment method/reference | Separate `payments` table or at minimum `payment_method` on header |
| Idempotency | None | Client-generated `idempotency_key` with unique constraint |
| Refunds/voids | Not modeled | First-class atomic RPCs |
| Status dimensions | Single `status` column covers purchase + payment + allocation | Separate `purchase_status`, `payment_status` |
| Multi-item checkout | One RPC call per variant | Basket-level RPC accepting `items[]` |

---

## Target Domain Model

### Unified Purchase System

```text
                     JEZSY PURCHASE SYSTEM
                            |
              +-------------+-------------+
              |                           |
       RESERVE & PAY LATER          WALK-IN POS
              |                           |
      Customer identified          Customer optional
      Inventory held               No holding period
      Payment may be deferred      Paid immediately
              |                           |
              +-------------+-------------+
                            |
                     Purchase Completed
                            |
               Inventory permanently sold
                            |
                     Revenue Analytics
```

### Table Responsibilities

| Domain | Purpose |
|---|---|
| `reservations` | Purchase/order transaction header (both reserved and walk-in) |
| `reservation_items` | Individual products/variants, quantity, unit price, line totals |
| `payments` (new) | Cash/card/e-wallet/payment-reference records |
| `stock_movements` | Authoritative immutable inventory movement ledger |
| `refunds` / `sale_refunds` (new) | Reversal/refund history |
| `logs` / `audit_events` | Who performed sensitive operations |

### Explicit Discriminators

```text
purchase_mode:
  reservation | walk_in

sales_channel:
  mobile | boutique_pos | admin

payment_status:
  unpaid | partially_paid | paid | partially_refunded | refunded

purchase_status:
  reserved | ready_for_pickup | completed | cancelled | expired
```

### Inventory Transitions

**Reserved purchase creation:**
```text
available -= qty
reserved  += qty
```

**Reserved purchase completion:**
```text
reserved -= qty
total    -= qty
```

**Walk-in sale (immediate):**
```text
available -= qty
total     -= qty
```

**Cancellation / expiry:**
```text
reserved -= qty
available += qty
```

---

## Pricing Architecture

### Transaction Header
```text
subtotal
discount_total
tax_total
total_amount
currency
```

### Line Items (`reservation_items`)
```text
unit_price
quantity
line_subtotal
discount_amount
line_total
```

Prices are **immutable transaction history**. Never depend on today's `products.price` when reviewing an old sale. Each line item retains the price at time of purchase.

### Price Override Policy
- Normal staff: sell at configured price.
- Discount within threshold: permitted staff capability.
- Larger discount: manager/admin approval.
- Manual override: reason required, audit logged.
- Authorization via capability predicates, not UI-level hiding.

---

## Payments as First-Class Entities

Separate what was purchased from how it was paid:

```text
Payment 1: PHP 2,000 — Cash — Sept 10
Payment 2: PHP 3,000 — GCash — Sept 15
Payment 3: PHP 5,000 — Card — Sept 22

purchase total     = PHP 10,000
payments received  = PHP 10,000
balance            = PHP 0
payment_status     = paid
```

Walk-in: single payment record, balance = 0 immediately.
Reserved: potentially multiple partial payments over time.

Same subsystem, different lifecycle.

---

## Refunds & Voids

First-class atomic operations. Never delete the original sale.

**Void:** Transaction cancelled before finalization/settlement.
**Refund:** Finalized transaction subsequently reversed (whole or partial).
**Return:** Merchandise physically returned, potentially restoring inventory.

```text
Original Sale
TX-10491 — PHP 8,500 — Completed

Refund
RF-00127 — -PHP 3,000 — 1 item restored
Authorized by Admin X
Reason: defective
```

Database enforces: cannot refund more quantity or money than originally sold.

Inventory restoration via compensating `stock_movements` entry, not by editing the original ledger row.

---

## Idempotency

**Mandatory before production POS use.**

Client generates `transaction_id` / `idempotency_key` before Confirm Sale. Database enforces unique constraint. If network times out and UI retries, the second request returns the original result instead of creating a duplicate sale.

---

## Multi-Item Basket Architecture (Target)

### Conceptual RPC Signature

```text
record_boutique_sale(
  transaction_id   -- idempotency
  items[]          -- [{inventory_id, quantity, unit_price}]
  payment          -- {method, amount_tendered, reference}
  discount?        -- {amount, reason}
  customer_id?     -- optional
  customer_name?   -- optional
)
```

### Atomic Transaction Flow

```text
authorize cashier
  -> validate all variants
  -> lock all inventory rows (consistent order by UUID to prevent deadlocks)
  -> validate quantities/prices
  -> create transaction header
  -> create line items (reservation_items)
  -> deduct inventory
  -> write stock_movements
  -> record payment
  -> write audit event
  -> commit
```

If anything fails, everything rolls back.

---

## Receipt & Transaction Numbers

Every finalized sale gets a human-friendly immutable identifier:

```text
JSY-MNL-20260910-00421
```

UUID remains the technical primary key. The receipt number is what staff and customers use for refunds, exchanges, support, reconciliation, and accounting.

---

## Staff / Location / Terminal Attribution

Even with one boutique, the schema should retain:

```text
staff_id
location_id
register_id / terminal_id
sold_at (timestamp)
```

Prevents painful historical ambiguity if a second location opens.

---

## Analytics: Unified Reporting

Analytics combines both purchase modes intentionally:

```text
Total sales
+-- Reserved purchases completed
+-- Walk-in purchases

Gross purchase revenue
Walk-in revenue
Reserved-purchase revenue
Outstanding reservation balances
Collected payments
Average reservation-to-payment time
Reservation conversion rate
Expired/cancelled reservations
Average transaction value
Items per transaction
Top products / variants
Sales by staff
Sales by location
```

---

## Evolution Stages

### POS v1 — Harden What Exists
- Add idempotency key with unique constraint
- Clarify unit price vs total price semantics in RPC
- Add `purchase_mode` discriminator column
- Add `sales_channel` column
- Create `reservation_items` rows for walk-in sales
- Add `payment_method` field (cash/card/ewallet)
- Stronger price-override audit logging
- Human-readable receipt/transaction number

### POS v2 — Basket Architecture
- Multi-item atomic checkout RPC
- Separate `payments` table
- Clean unified analytics views/RPCs
- Consistent inventory row locking order for deadlock prevention
- Stop creating walk-in sales as single-item synthetic reservations

### POS v3 — Operational Maturity
- Returns / refunds / voids as first-class RPCs
- Discount approvals and capability-based authorization
- Receipt generation
- Optional customer association without forced registration
- Staff / location / register attribution
- Reservation expiry / release automation
- Payment reconciliation

---

## Architectural Conclusion

> **JezSy reservations are deferred-completion purchases. Walk-in POS is immediate-completion purchase. Both share the same commerce domain.**

The unified transaction model is valid. The current atomic RPC foundation is strong. The main evolution path is:

1. Formalize the domain distinctions (purchase mode, payment status, sales channel)
2. Ensure line items exist for all purchase types
3. Separate payment tracking from purchase status
4. Add idempotency and refund/void capabilities
5. Evolve toward basket-level checkout

*Document status: Architecture review record. Implementation should follow the staged evolution plan after explicit approval.*
