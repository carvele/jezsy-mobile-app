# Activity Log

## 2026-07-30 - Reservation submit failed (42804 + receipt upload)

Two separate bugs blocked every customer reservation.

**1. `appointment_time` type mismatch (42804).**
`reservations.appointment_time` is `timestamptz` on the shared DB - the
admin-dashboard repo owns that shape (`src/services/reservationService.js`
packs `date` + `"HH:MM"` into a timestamptz at `+08:00` and unpacks it on
read). Our RPCs cast the client's wall-clock string with `::time`, which has
no implicit cast to timestamptz, so `create_reservation` errored at INSERT.

A second, latent instance of the same bug sat in `validate_reservation_time`:
the session timezone is UTC, so `NEW.appointment_time::time` rendered a 10:30
Manila appointment as 02:30 and would have failed the `10:00-20:00` operating
hours check even after the INSERT was fixed.

Fixed by anchoring both directions to `Asia/Manila` (fixed +08, no DST) rather
than altering the column - an `ALTER ... TYPE time` would break the admin
dashboard's read and write paths. Migration
`20260730002045_appointment_time_timestamptz.sql` replaces
`create_reservation`, `reschedule_reservation` and
`validate_reservation_time`. Applied; ledger version drifted from the local
filename as usual and the files were renamed to match.

Client side, `toStoreTimeValue()` in `src/utils/dateTime.ts` normalises the
stored timestamptz back to `HH:MM:SS`. `formatTimeLabel` was returning the raw
ISO string, and `TimeSlotPicker` was keying its booked-slot counts by that ISO
string, so slot capacity never matched and was silently never enforced in the
UI.

**2. Receipt upload - `StorageUnknownError: Network request failed`.**
`app/reserve/[id].tsx` uploaded a `FormData` wrapper around a `file://` uri,
which fails on Android. Switched to the decoded-base64 upload the rest of the
app already uses (`ReviewModal`, `messages/[conversationId]`).

`app/wardrobe/add-item.tsx` still uses the FormData pattern and is likely
broken the same way - not touched here.

Verified: `npx tsc --noEmit` and `eslint` clean; rolled-back smoke INSERT
confirms the trigger accepts a 10:30 Manila slot and stores `02:30+00`;
regenerated `database.types.ts` is byte-identical (no signature change).
