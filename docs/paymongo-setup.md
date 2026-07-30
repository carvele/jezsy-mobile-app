# PayMongo Setup

Everything in the repo is built. It stays inert until the four steps below are
done, because none of them can be done for you: they need a merchant account and
secrets.

## 1. Merchant account

Sign up at [PayMongo](https://www.paymongo.com) and complete business
verification. You need DTI or SEC registration and a settlement bank account.
Approval usually takes a few days.

Then activate **GCash** under Payment Methods. GrabPay and cards are already
listed in `payments-create`; PayMongo only offers what your account has enabled,
so nothing breaks if you leave them off.

## 2. Apply the migration

```bash
supabase db push
```

Or apply `supabase/migrations/20260730093000_payments.sql` through the dashboard.
Re-sync the migration ledger afterwards and regenerate types:

```bash
npx supabase gen types typescript --linked > src/types/database.types.ts
```

Once the types include `payments`, the `as any` cast in `src/lib/payments.ts` can
go.

## 3. Set the secrets

These are **secrets**. They live in Supabase, never in `app.json`, `.env`, or
anything the app bundles. Anything shipped in the bundle is readable by anyone
who installs the app.

```bash
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_xxx
```

```bash
supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_xxx
```

`PAYMONGO_RETURN_URL` is optional and defaults to `jezsymobileapp://payment-return`.

Use the `sk_test_` key first. Switch to `sk_live_` only after a sandbox payment
has gone end to end.

## 4. Deploy the functions

The webhook flag matters. PayMongo does not send a Supabase JWT, so with
`verify_jwt` left on, every delivery is rejected before your code runs:

```bash
supabase functions deploy payments-create
```

```bash
supabase functions deploy payments-webhook --no-verify-jwt
```

Then register the webhook in the PayMongo dashboard against
`https://<project-ref>.supabase.co/functions/v1/payments-webhook`, subscribed to
`checkout_session.payment.paid` and `payment.failed`.

## How it fits together

1. Customer picks **Pay with GCash** in the reserve flow.
2. `create_reservation` runs with a null receipt path, which marks the row
   `payment_type = 'Gateway'`, `payment_status = 'Pending'`.
3. `payments-create` reads the deposit **from the reservation row**, opens a
   Checkout Session, and writes a `payments` row as `awaiting_payment`.
4. The app opens the hosted checkout in a WebView.
5. PayMongo calls `payments-webhook`, which verifies the signature and sets the
   payment to `paid` and the reservation's `payment_status` to `Paid`.
6. The app polls the `payments` row and reports the outcome.

## Security properties worth preserving

- **Customers cannot write to `payments`.** There is no INSERT, UPDATE or DELETE
  policy for them. Every write goes through the Edge Functions on the
  service_role key. Adding a customer write policy would let a client mark its
  own payment paid.
- **The amount is never taken from the client.** It is read from
  `reservations.deposit`, the same reason `create_reservation` resolves price
  server-side.
- **Returning from the checkout page is not proof of payment.** The app treats it
  only as a cue to start checking the `payments` row. Only the webhook settles a
  payment.
- **The webhook verifies HMAC-SHA256 over the raw body** and rejects signatures
  older than 5 minutes, so a captured payload cannot be replayed.
- **The webhook is idempotent on event id.** PayMongo retries, and a repeat
  delivery must not apply twice.

## Deliberately not done

`payments-webhook` sets `payment_status` only. It does not flip a reservation to
Confirmed, because confirming also commits stock and an appointment slot — that
stays a staff decision in the admin dashboard.

Refunds are not implemented. The `refunded` status exists in the check
constraint, and staff can set it by hand, but nothing calls PayMongo's refund
API yet.
