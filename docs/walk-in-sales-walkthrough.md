# Walk-in Sales (Boutique POS) Walkthrough

This document outlines the architecture, user interface flow, and database operations for JezSy's **Walk-in Sales** feature (sometimes referred to as the Boutique POS system).

This walkthrough is designed to provide a comprehensive understanding of how walk-in transactions bypass the standard digital reservation lifecycle while sharing the same underlying data models for analytics and inventory tracking.

---

## 1. The Core Philosophy

JezSy handles two primary types of transactions:
1. **Digital Reservations:** Multi-day lifecycles (`Approved`, `Preparing`, `To Pickup`, `Active`, `Returned`). Tied to a specific customer account, triggering inventory holds (`reserved` stock) and notifications.
2. **Walk-in Sales:** Instantaneous, over-the-counter purchases. No customer account required, no multi-day lifecycle. Stock is permanently deducted immediately.

To prevent fragmenting revenue reporting and catalog metrics, **Walk-in Sales do not use a separate `sales` table**. Instead, they are recorded directly into the `reservations` table as instantly `Completed` transactions.

---

## 2. User Interface Flow (Admin Dashboard)

The walk-in sale process is executed entirely by Staff or Admins via the Admin Dashboard's Inventory interface.

### Step 1: Locating the Item
1. The staff member navigates to the **Inventory Panel** (`AdminInventoryPanel.jsx` / `Inventory.jsx`).
2. They locate the specific product and variant (Size, Color, Pattern) the walk-in customer wishes to purchase.

### Step 2: Initiating the Sale
1. The staff member clicks the **"Sell"** button on the specific variant's row.
2. A **Sell Modal** opens, prompting for:
   - **Quantity** (Defaults to 1, cannot exceed the currently `available` stock).
   - **Sale Price** (Pre-filled with the item's default price, but staff can override it for discounts).

### Step 3: Confirmation
1. The staff member clicks **"Confirm Sale"**.
2. The UI enters a loading state and calls `recordBoutiqueSale(inventoryItem, quantity, user, salePrice)`.
3. If successful, the modal closes, a success toast appears, and the UI immediately reflects the deducted available stock.

---

## 3. The Backend Architecture (Command Boundary)

Prior to the Phase B3-b architecture, the React client orchestrated the sale by making 4-5 independent database calls (deduct stock, write ledger, write reservation, log). This caused partial failures (e.g., stock was deducted, but the reservation failed to write, causing lost revenue tracking).

**Current Architecture:** The sale is now executed atomically via a single Postgres RPC: `public.record_boutique_sale`.

### RPC Signature
```sql
public.record_boutique_sale(
  p_inventory_id uuid,
  p_quantity integer,
  p_sale_price numeric
)
```

### The Transactional Steps
When the UI calls this RPC, Postgres executes the following steps within a single, atomic transaction (if any step fails, the entire transaction rolls back):

#### 1. Row-Level Locking & Validation
The database locks the specific variant row to prevent concurrent checkout race conditions:
```sql
SELECT * INTO v_inv FROM public.inventory WHERE id = p_inventory_id FOR UPDATE;
```
It verifies that `v_inv.available >= p_quantity`. If a concurrent online reservation just took the last item, this RPC strictly aborts and returns an error rather than silently clamping the stock to 0.

#### 2. Stock Deduction
The `total` and `available` columns on the `inventory` table are decremented by `p_quantity`. (The `reserved` column is untouched since walk-in sales don't require holds).

#### 3. Stock Movement Ledger
A structured row is inserted into the `stock_movements` table to maintain a permanent accounting ledger:
- `change_type`: `'sale'`
- `delta`: `-p_quantity`
- `inventory_id`: Linked to the exact variant.
- `note`: e.g., `"Walk-in sale: 1x Evening Gown (size M)"`

#### 4. The Reservation Record (Revenue Tracking)
A row is inserted into the `reservations` table to record the revenue and catalog metrics. It is hardcoded with specific attributes to bypass standard reservation mechanics:
- `status`: `'Completed'`
- `customer_name`: `'Walk-in Customer'`
- `customer_id`: `NULL`
- `rental_price`: `p_sale_price`
- *Note:* It does not insert into the `reservation_items` table.

#### 5. Audit Logging
An action is written to the `logs` table (`Recorded In-Store Sale`) with a JSON payload capturing the staff member who executed the sale, the exact timestamp, and the pricing details.

---

## 4. Subsystem Interactions

### Analytics & Dashboard
Because the walk-in sale is recorded as a `Completed` reservation, the existing revenue graphs in `Analytics.jsx` naturally include walk-in sales without requiring complex `UNION` queries between a sales table and a reservations table.

### Notifications
Standard reservations trigger notifications to admins (e.g., "Customer X placed a new reservation"). Walk-in sales bypass this because the status is immediately `'Completed'`. (Furthermore, a specific null-guard on the notification trigger `trg_notify_admin_on_reservation` ensures that if a walk-in sale *did* somehow trigger it, the `customer_id = NULL` wouldn't crash the database).

### Product Stock Synchronization
When the RPC decrements the variant stock, a Postgres database trigger (`trg_sync_product_stock_from_inventory`) automatically fires. This trigger sums up all available variants for the parent product and updates the `products.stock` aggregate column, ensuring the mobile app catalog instantly reflects the new availability without relying on the React client to make a redundant update.

---

## 5. Security & Authorization

- **SECURITY DEFINER:** The `record_boutique_sale` RPC runs as `SECURITY DEFINER`. This is critical because under Row Level Security (RLS), store `staff` are typically denied direct `UPDATE` privileges on the `inventory` table (which is restricted to admins/owners). The RPC allows staff to execute the sale securely.
- **Capability Predicate:** Inside the RPC, access is verified via `IF NOT public.can_operate_inventory() THEN RAISE EXCEPTION...`.
- **Identity Derivation:** The identity of the staff member is derived directly from `auth.uid()` on the server side, ensuring a malicious client cannot spoof the audit logs by passing a fake `p_staff_id`.
