# PayMongo & Sandbox Payment Gateway Integration Guide (Test Mode)

This guide documents how the **JezSy Mobile App** and **Owner Dashboard** interact with the **PayMongo Test Sandbox** for processing GCash and card payments during development.

---

## 🔑 Environment Configuration & Test Keys

PayMongo test mode keys use the prefix `pk_test_` (Public Key) and `sk_test_` (Secret Key).

### 1. Supabase Secrets (Edge Functions)
Set the secret key in your Supabase project for the `payments-create` and `payments-webhook` Edge Functions:

```bash
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_your_paymongo_secret_key
supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsec_your_webhook_signing_secret
```

### 2. Client Side Configuration
In `jezsy-mobile-app/src/lib/payments.ts`, test payments invoke `supabase.functions.invoke('payments-create', ...)`.

---

## 🧪 Test Payment Credentials

### GCash Sandbox Testing
- **GCash Number**: `09170000000` or `09180000000`
- **OTP**: `123456`
- **MPIN**: `1234`
- Select **Success** on the PayMongo test checkout screen to simulate a completed payment.

### Card Sandbox Testing
- **Test Card Number**: `4343 4343 4343 4343` (Visa) or `5555 5555 5555 5555` (MasterCard)
- **Expiry Date**: Any future date (e.g., `12/28`)
- **CVV**: `123` or any 3 digits

---

## 🔄 End-to-End Test Workflow

1. **Create Reservation (Mobile)**:
   - User creates a rental request in JezSy app.
   - Initial status is `Pending` / `To Pay`.

2. **Staff Approval (Owner Dashboard)**:
   - Staff approves request in Owner Dashboard.
   - Status changes to `Confirmed` / `To Pay`, setting payment deadline `payment_due_at`.

3. **Pay Now (Mobile)**:
   - Customer taps **Pay Now** on `/reservations/[id]`.
   - App calls `startReservationPayment(id)` which triggers the `payments-create` Edge Function.
   - Returns PayMongo Checkout URL (`https://checkout.paymongo.com/...`).
   - App launches checkout in WebBrowser modal.

4. **Webhook & Realtime Sync**:
   - On completion, PayMongo sends `checkout_session.payment.paid` event to `payments-webhook` Edge Function.
   - Edge Function updates `payments.status = 'paid'` and `reservations.payment_status = 'Paid'`.
   - Owner Dashboard real-time subscription reflects `Paid ✓` instantly.
