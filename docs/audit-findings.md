# Audit findings

Baseline: `f4ce1be` on `feat/reservation-payment-resume`, 2026-07-31.

**Scope.** All 94 tracked `.ts`/`.tsx` files and all 3 edge functions were audited. The
database was audited against the **live Supabase project** — every function body, RLS policy,
grant, trigger, foreign key, storage bucket, and column type was queried directly. Migration
*files* were not read exhaustively (about 7 of 87 forward migrations, 0 of 50 rollbacks); the
live schema they produce was verified instead. Reading the rest would add history and intent,
and would catch forward/rollback mismatches — a separate exercise, not covered here.

**Read this before acting.** This repository has six worktrees under
`jezsy-mobile-app.worktrees/` plus divergent branches worked concurrently, and the live DB is
shared with the admin-dashboard repo. `git merge-base --is-ancestor` confirms the branch this
was audited on is not a simple ancestor line — file state differs between branches and moves
between commits. During this audit HEAD moved three times and **24 findings were fixed by
concurrent sessions**, four of them after this document was first written. Re-verify every
item against current HEAD before changing it.

---

## P0

### 1. Every JPEG upload is rejected

Migration `20260730140311_storage_limits_and_receipt_staff_read.sql` set
`allowed_mime_types = ["image/jpeg","image/png","image/webp","image/heic"]` on all four
buckets. All four upload sites build the content type by interpolating the file extension,
defaulting to `jpg`:

| File | ext derived | upload |
| --- | --- | --- |
| `app/messages/[conversationId].tsx` | L314 `asset.uri.split('.').pop() \|\| 'jpg'` | L327 |
| `app/reserve/[id].tsx` | L114 ternary, defaults `'jpg'` | L121 |
| `app/wardrobe/add-item.tsx` | L184 ternary, defaults `'jpg'` | L208 |
| `src/components/ReviewModal.tsx` | L44 `asset.uri.split('.').pop() \|\| 'jpg'` | L66 |

A `.jpg` file yields `contentType: "image/jpg"`, which is not a registered MIME type and is
not in the allowlist. Confirmed live: `'image/jpg' = any(allowed_mime_types)` is `false` on
all four buckets; `'image/jpeg'` is `true`. Since `.jpg` is what `expo-image-picker` returns
on both platforms, this rejects chat images, wardrobe photos, review photos, and reservation
receipts. Receipts are mandatory to create a reservation, so this blocks the core flow.

**Fix:** one shared extension-to-MIME map, not interpolation. `jpg|jpeg -> image/jpeg`,
`png -> image/png`, `webp -> image/webp`, `heic|heif -> image/heic`; reject anything else
before uploading. The extension also builds the object path, so normalise both.

---

## P1

### 2. "Email not confirmed" shows an OTP screen for a code that was never sent

`app/(auth)/auth.tsx` L193: when `signInWithPassword` fails with `Email not confirmed`, the
screen switches to `otp_verify` and arms a 60-second timer, but nothing dispatches a code — a
failed `signInWithPassword` does not send an OTP. The user waits for an email that never
arrives.

The companion resend bug was fixed while this audit was in progress (`handleResendCode` now
calls `supabase.auth.resend`), so the user is no longer fully locked out — they can resend
after 60s. This branch should do the same thing up front.

**Fix:** call `supabase.auth.resend({ type: 'signup', email: trimmedEmail })` before
`transitionMode('otp_verify')`.

### 3. Every review by another customer displays as "Anonymous"

`src/components/ReviewsList.tsx` L40 embeds the reviewer profile:

```js
.select(`*, user:user_id(first_name, last_name)`)
```

The live `profiles` SELECT policy is `((auth.uid() = id) OR is_staff_or_admin())`, so a
customer resolves only their own row; every other reviewer's embed is null. L187 renders
`{review.user?.first_name || 'Anonymous'}`. On every product page, all reviews except your
own show as "Anonymous". It degrades silently rather than erroring.

Same RLS-blindness class as the `TimeSlotPicker` bug fixed in `bf6522c`.

**Fix:** denormalise a `reviewer_name` column onto `reviews` at insert time (what
`reservations.customer_name` already does), or a SECURITY DEFINER RPC returning reviews with
a display name (mirrors `get_slot_booked_counts`). The former is simpler.

### 4. Deleting a reservation destroys its payment records

Confirmed live:

```
payments_reservation_id_fkey   reservations -> payments   ON DELETE CASCADE
payments_user_id_fkey          profiles     -> payments   ON DELETE CASCADE
```

`reservations` has `Enable delete for admin and owner`, so an admin hard-deleting a
reservation silently destroys the `payments` rows for money collected through PayMongo —
provider refs, amounts, and the webhook's `last_event` audit trail. Same via `profiles`,
which matters now that `account_deletion_requests` exists: a GDPR erasure would wipe
financial records that accounting likely must retain.

Note the inconsistency: `reservations_customer_id_fkey` is `NO ACTION`, so a profile cannot
be hard-deleted while reservations exist, yet payments cascade freely from both.

**Fix:** `ON DELETE RESTRICT` on both, so settled payments outlive the rows referencing them.
Migration plus rollback against the shared live DB.

### 5. Body-scan measurements are systematically inflated ~10%

`src/utils/measurementCalculator.ts` L134 states the contract and relies on it:

```js
// bodyRatios are normalized to head-to-ankle height, so 1.0 ratio = heightCm
const cmPerUnit = heightCm;
```

But `src/utils/poseDetector.ts` L103 normalises to **nose**-to-ankle:

```js
const noseY = lm[L.nose].y;
const totalHeight = Math.abs(ankleY - noseY) || 1;
```

BlazePose has no crown landmark, so `headToAnkleRatio` is a misnomer. Nose-to-ankle is
roughly 0.90 of stature. Dividing by that span then multiplying by full height inflates
every output — shoulder, arm, torso, leg, inseam, and the circumferences derived from them.

**Fix:** scale by an explicit fraction (`cmPerUnit = heightCm * NOSE_TO_ANKLE_FRACTION`) or
extrapolate a crown estimate from the nose/eye/ear landmarks; rename `headToAnkleRatio`
either way. Calibrate the constant against a real measurement — 0.90 is a literature
approximation, not measured for this pipeline.

---

## P2

### 6. `payments-create` can orphan a live checkout session

`supabase/functions/payments-create/index.ts` creates the PayMongo session (L125), cancels
the prior row (L157), then inserts into `payments` (L160). If that insert fails it returns
500, leaving a payable session no `payments` row references — and `payments-webhook` looks up
by `provider_ref` (L112) and would return "unknown session" with a 200. Money taken, never
recorded. Two concurrent calls reach the same state via the partial unique index.

**Fix:** insert the `payments` row first (status `awaiting_payment`, null `provider_ref`),
create the session, then update the row; or expire the session on insert failure.

### 7. The burst outlier filter is mathematically unreachable

For *n* samples the maximum possible absolute z-score is `(n-1)/sqrt(n)`. With
`TARGET_FRAMES = 5` (`src/utils/burstAverager.ts` L12) the ceiling is ~1.789 against the
`2.0` threshold at L90. Nothing is ever discarded; the documented outlier rejection is dead
code and only plain averaging happens.

**Fix:** lower the threshold to ~1.2 or raise `TARGET_FRAMES` to 7+, and correct the comment.

### 8. Two of three circumferences carry no independent signal

`src/utils/poseDetector.ts` L150 sets `bustWidth = shoulderWidth * 1.05`, and
`src/utils/measurementCalculator.ts` L131 sets waist from `hipWidth * WAIST_RATIO`. So bust is
a fixed multiple of shoulder span and waist a fixed multiple of hip span; hips is the only
circumference derived from its own landmark pair. Two of the three numbers driving size
recommendation carry no shape information beyond the BMI term.

Also: the `DEPTH_MULTIPLIERS` comment calls them "depth / width ratios"; at 2.4-2.7 they only
make sense as width-to-circumference factors. The constants are used correctly, the comment
is wrong.

**Fix:** a product decision — either improve the model or state the limitation in the UI.

### 9. Reservation reminders are never cancelled

`app/reserve/[id].tsx` L183 schedules a local notification at creation. A repo-wide grep for
`cancelScheduledNotificationAsync` / `cancelAllScheduledNotificationsAsync` returns nothing.
After a reschedule the reminder still fires at the old time, and a cancelled or
already-collected reservation still pushes "your reservation is in 1 hour".

**Fix:** store the returned notification id on the reservation (or AsyncStorage keyed by
reservation id) and cancel or re-schedule it in the reschedule and cancel paths.

### 10. `wardrobe-images` is a public bucket holding private content

Confirmed live: `public: true`, while `chat-images` and `payment_receipts` were deliberately
privatized. Object paths are user-scoped and listing is blocked, so this is obscurity rather
than exposure.

Deliberately deferred by `f4ce1be`, which notes a proper fix needs a new RLS policy plus
signed-URL resolution wired into the wardrobe screens. Recorded here so it is not lost.

### 11. `src/types/database.types.ts` is stale

Still declares the dropped `create_reservations_from_cart` (L1643), despite `bf6522c` stating
"types regenerated". Also behind on the six `20260730*` migrations and `20260731030036`.

**Fix:** regenerate, then re-run `npx tsc --noEmit`.

### 12. `src/utils/bodyEstimator.ts` is dead code

Nothing imports it. It wraps `computeMeasurements` in a pointless async passthrough and
exports a deprecated stub that only throws. Related: `getPoseConfidence` is imported at
`app/profile/body-scan.tsx` L26 but never used — the standing eslint warning.

**Fix:** delete the file and the unused import.

### 13. Dead branch in `isPoseValid`

`src/utils/poseDetector.ts` L64-72 checks every required joint is `>= 0.85`, then checks the
mean is `>= 0.85`. If all nine pass the first check the mean is necessarily `>= 0.85`, so the
second can never fail.

**Fix:** drop it, or make it a stricter independent gate as the docstring implies.

### 14. The dark-first default is silently overridden to light

`hooks/use-color-scheme.ts` L7-11 returns a non-nullable `'light' | 'dark'`, ending in
`?? 'light'`. Two consequences:

1. Every `useColorScheme() ?? 'dark'` in the codebase is dead code — 24 files write it and the
   `??` can never fire. TypeScript permits `??` on a non-nullable type, so nothing flagged it.
2. 18 of those 24 sites write `?? 'dark'` and only 6 write `?? 'light'`, but the real fallback
   lives in the hook and in `src/context/ThemeContext.tsx` L41 (`systemScheme ?? 'light'`), so
   with no provider and no OS value the app renders light everywhere — the opposite of intent.

**Fix:** pick one default (`'dark'`, judging by the call sites and `Colors.dark` usage), set
it in both places, and strip the 24 dead expressions in one pass.

### 15. Theme preference flashes the wrong scheme on cold start

`src/context/ThemeContext.tsx` L22 initialises `preference` to `'system'` and loads the stored
value in an effect. `app/_layout.tsx` gates rendering on `hasBootstrapped`, which covers auth
and onboarding but not the theme read. A user whose OS is dark but who chose Light sees a dark
placeholder then a light app.

**Fix:** expose a `loaded` flag from `AppThemeProvider` and add it to the `flagsReady` gate.

### 16. The accelerometer resubscribes ~60x/second during the body scan

`src/components/TiltGuide.tsx` L14-49 keys its `Accelerometer.addListener` effect on
`[onTiltValid, onGuideState]`. At `app/profile/body-scan.tsx` L306, `setIsTiltValid` is stable
but `handleTiltGuideState` (L209) is a plain `const` in the component body — a new reference
every render. And `TiltGuide` re-renders on every accelerometer sample because L29 puts
`pitch` in state at a 16 ms interval. The subscription is torn down and re-added ~60 times a
second, on the one screen already running a live camera plus MediaPipe pose detection.

**Fix:** `useCallback` on `handleTiltGuideState`, and keep `pitch` in a ref — the rendered
message only needs the three-state value, which is already change-gated in the listener.

### 17. Three different filter combinations across five product queries

| Query | `deleted` | `visibility` |
| --- | --- | --- |
| `app/(tabs)/index.tsx` L46 | yes | yes |
| `app/(tabs)/explore.tsx` | yes | yes |
| `app/wishlist.tsx` L53 | yes | no |
| `src/components/RecentlyViewed.tsx` L29 | no | no |
| `src/components/RelatedProducts.tsx` | no | no |

Deleted or unpublished products appear in the "Recently Viewed" and "You May Also Like" rails
and link to dead product pages; the wishlist shows unpublished ones.

**Fix:** `.eq('deleted', false).eq('visibility', 'public')` on all five.

### 18. Dark-only surfaces vanish in light mode

Unconditional white overlays inside themed components, now that the light/dark toggle ships:

- `src/components/GapAnalysis.tsx` L153 — `rgba(255,255,255,0.05)` stat-chip background on
  `colors.card`. Invisible in light mode.
- `src/components/GapAnalysis.tsx` L170 — `rgba(255,255,255,0.1)` Suggestions divider.
- `app/outfit-builder.tsx` L595, L597 — same pattern on a slot background and border.

`app/(tabs)/_layout.tsx` L39/63/67 is the correct model — it branches on `isDark` for all
three values.

Three more need a visual check rather than a blind fix, since they may sit on image overlays
where white is intended: `src/components/CategoryCard.tsx` L64, `app/product/[id].tsx` L662,
`app/wardrobe/add-item.tsx` L474.

---

## P3

- `app/(auth)/reset-password.tsx` L46 — `updateUser({ password })` does not revoke sessions on
  other devices. Follow with `supabase.auth.signOut({ scope: 'others' })`.
- `app/(auth)/auth.tsx` L63-70 — the OTP countdown effect depends on `timer`, so it recreates
  the interval every tick. Works, but drifts; use one interval with a functional guard.
- `app/wardrobe/item/[id].tsx` L67 — `wear_count: item.wear_count + 1` is a read-modify-write
  from local state. `setLogging(true)` covers double-taps; the cross-device case needs a small
  `increment_wear_count` RPC.
- `hooks/use-color-scheme.web.ts` — returns `'light'` until hydration, so web's first paint is
  always light. Documented static-rendering tradeoff; web is not a target here.
- `app/ar-tryon/[id].tsx` L105 — `(i + 1) % poseGuides.length` is `NaN` when `poseGuides` is
  empty, so shuffle silently no-ops. Guard on length.
- `app/ar-tryon/[id].tsx` L148 — `iosModelUrl` guesses `.glb -> .usdz`; if no USDZ exists iOS
  AR fails silently.
- `src/utils/pushNotifications.ts` L79-83 — comment says `expo.extra.eas.projectId` is missing.
  `46f73ba` added it; the `not-configured` branch no longer fires.
- `src/utils/pushNotifications.ts` L166 — `new Date(appointmentDate)` parses `"2026-08-05"` as
  UTC midnight, then `.setHours()` applies local time. Correct at UTC+8; a device in a
  negative-offset timezone lands a day early. Construct from parts.
- `src/components/GapAnalysis.tsx` L45-54 — `hasTopHalf`/`hasBottomHalf` contain a redundant
  `|| counts['Dress'] > 0` term cancelled by the `Dress === 0` conjunct. Behaviour is correct.
- `src/components/GapAnalysis.tsx` L107 — "Shop Bottoms" pushes to Explore without a category
  filter, so the suggestion is not actionable as implied.

---

## Verified clean

Checked and found correct. Listed so they are not re-derived or "fixed" into breakage.

**`supabase/functions/payments-webhook/index.ts`** — HMAC verified before any parsing, 300s
replay window, length-checked constant-time compare, idempotency via `last_event_id`, no
backwards transition off `paid`, 200 on unknown session to stop infinite redelivery, and it
moves only `payment_status` rather than auto-confirming. No defect found.

**`app/(auth)/auth.tsx` account-enumeration handling** — no pre-flight existence checks
anywhere, duplicate signup detected via the empty `identities` array and routed down an
identical UI path, `already registered` and `Invalid login credentials` both normalised, and
the forgot-password success message stays generic. Do not reintroduce an existence check.

**`src/lib/supabase.ts`** — rewritten mid-audit and now correct: values over SecureStore's
~2048-byte cap are chunked across `_c<n>` keys rather than falling back to plaintext, the
`_user` companion lives in SecureStore, and only `{id, email, user_metadata}` is persisted
rather than the full user object.

**Storage path scoping** — all five upload sites correctly scope to `{user_id}/`.

**The `(auth)` group's 58 white-rgba values** are correct: `auth.tsx`, `profile-setup.tsx`,
`welcome.tsx`, `(auth)/index.tsx` are deliberately dark-only, using a `GLASS_BG`/`GLASS_BORDER`
design over a dark backdrop, and never call `useColorScheme`.

**`ImageViewerModal` and `PoseLandmarkOverlay`** do not call `useColorScheme` either — they
render over a black backdrop and a camera feed. Correct as-is.

**`reviews` has no `deleted` column**, so `ReviewsList`'s missing soft-delete filter is not a
bug. **`reviews.rating` is `NOT NULL integer`**, so `sum += r.rating` cannot produce a `NaN`
average.

**`capsules` has no `deleted` column**, so the missing filter at `app/(tabs)/wardrobe.tsx` L57
is correct, and the hard delete at `app/wardrobe/capsule/[id].tsx` L131 is right —
`capsule_items` cascades from both parents, so no orphans.

**`wardrobe_items.wear_count` is `NOT NULL DEFAULT 0`**, so the `wear_count === 0` ternary
cannot render "Worn null times".

**`TiltGuide`'s naming** looks inverted but is not: `isTiltingUp` maps to `'tilt_down'` as the
*instruction*, and the on-screen text agrees with the spoken state. Do not flip the polarity.

**`app/(tabs)/messages.tsx` L34's `.or()`** with an interpolated ISO timestamp parses correctly
under PostgREST (no commas in the value) and the timestamp is server-side, not user input —
unlike the `explore.tsx` search case that was fixed.

**Hardcoded hex literals** are mostly legitimate: `'#0D0D0D'` is the fixed foreground for text
on `colors.tint` buttons — a deliberate contrast pair correct in both themes; `shadowColor:
'#000'` is standard; `'#767577'`/`'#f4f3f4'` are RN `Switch` defaults. Only
`app/wardrobe/add-item.tsx` L381 and `app/(tabs)/messages.tsx` L349/L413 are worth touching.

**RLS policies and `enforce_message_edit_scope`** fail closed on the role helpers (only `TRUE`
passes a `USING` clause), which is why the NULL-role bypass was scoped to `verify_pickup`
alone.

**`useSizingProfile`**, **`src/utils/recommendations.ts`**, **`ToastContext`**, **`Skeleton`**,
the root provider order in `app/_layout.tsx`, and the data queries in `wishlist`,
`reservations`, `(tabs)/index` and `(tabs)/profile` — all correct.

---

## Resolved during the audit

Fixed by concurrent sessions while this audit was in progress. Recorded so the same ground is
not re-covered.

| Finding | Fixed by |
| --- | --- |
| `TimeSlotPicker` slot capacity blind to other customers' bookings (RLS) | `bf6522c` — `get_slot_booked_counts` RPC |
| `sync_product_stock` callable without an auth check | `bf6522c` + `20260730154208` |
| `explore.tsx` search broke on a comma; `%`/`_` leaked as wildcards | `bf6522c` |
| Cart and recently-viewed used global AsyncStorage keys | `bf6522c` |
| `MessagesContext` realtime handler stacking on token refresh | `bf6522c` |
| `reschedule_reservation` was SECURITY INVOKER — silent no-op with a fabricated success | `dc62a5c` + `20260730155158` |
| `merge_message_reaction` keyed reactions on a client-supplied user id | `dc62a5c` + `20260730155201` |
| `recoveryLink.ts` accepted recovery tokens from the query string | `dc62a5c` |
| Password change had no reauthentication | `dc62a5c` |
| `recommendSize` could recommend a sold-out size | `dc62a5c` |
| GDPR export/erasure functions were unreachable | `dc62a5c` — wired to account-settings |
| `is_admin_or_owner`/`is_staff_or_admin` returned NULL, bypassing `verify_pickup`'s guard | `c064732` + `20260731030036` |
| Body scan crashed for every user on the gender key mismatch | `c064732` |
| Payment WebView had no origin allowlist | `c064732` |
| Cart quantity was collected but reservations always booked one unit | `f4ce1be` |
| Message thread tore down realtime with `unsubscribe()` | `f4ce1be` |
| Failed chat-image resolves were cached permanently as `''` | `f4ce1be` |
| CLAUDE.md undercounted the native modules | `f4ce1be` |
| Signup "Resend code" re-called `signUp` with a password `transitionMode` had cleared | fixed mid-audit — now uses `auth.resend` |
| Session `getItem` dropped the user object on the >2048-byte path | fixed mid-audit — `supabase.ts` rewritten |
| Session tokens fell back to plaintext AsyncStorage above 2048 bytes | fixed mid-audit — now chunked in SecureStore |
| The full Supabase user object was persisted unencrypted | fixed mid-audit — only `{id, email, user_metadata}` |
| PayMongo edge functions were not deployed | deployed; `payments-create` jwt:true, `payments-webhook` jwt:false |

Also withdrawn: findings against `app/checkout.tsx`, `create_order` stock handling, and the
orders flow — those files were retired by `d87f6a1` on the branch they were audited against —
and an `appointment_time` timezone concern that did not hold up, since the live function
bodies already apply `AT TIME ZONE 'Asia/Manila'` explicitly.

**Branch caveat:** `supabase/functions/notify-status/` was deleted by `dc62a5c` but is present
on this branch, which does not descend from that commit. If it is still deployed nowhere it is
harmless, but its header falsely claims it is wired to DB webhooks that would duplicate the
`notify_*_status_change` triggers, and it has no auth check on a request whose `user_id` comes
from the raw body. Delete it here too, or wire it up properly.

---

## Suggested order

1. **Finding 1** — the MIME map. One small change, unblocks four broken flows including the
   mandatory reservation receipt.
2. **Finding 2** — the unconfirmed-email OTP branch. One line, same call the resend path now uses.
3. **Finding 4** — the `payments` FK cascade. Shared live DB: needs sign-off and a heads-up to
   the admin-dashboard owner.
4. **Finding 3** — reviewer names.
5. **Finding 5** — the body-scan calibration constant, once someone can measure against it.

Any DB change touches the shared live database. Per `CLAUDE.md`, write idempotent SQL with a
matching `.rollback.sql`, confirm before applying, then re-sync the migration ledger and
regenerate `src/types/database.types.ts`.
