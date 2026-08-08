# Token sweep: the remaining four areas

## Context

The design system is now real but barely adopted: **7 of 51** files import anything beyond
`Colors`. The app still runs on **19** distinct `fontSize` values and **27** border radii against
scales of 8 and 5, with **9** files carrying hand-rolled shadow blocks.

Two enablers already landed, which is what makes the rest safe:

- `src/utils/layout.ts` — grid geometry derives from `GRID_GUTTER`/`GRID_COLUMN_GAP`, so changing
  a screen's padding resizes the cards instead of collapsing a column.
- `onTint` — the correct text colour on a gold fill, per scheme.

The remaining `#0D0D0D` count is the honest measure of how far the contrast bug spread: **27
files**. Every one is a potential AA failure in light mode, and each was invisible until the app
was actually run in light mode on a device.

## Ordering

Value per unit of risk, as agreed:

1. **Auth + home + explore** — highest traffic, first impressions
2. **Wardrobe sub-screens** — closes the seam inside the flow already redesigned
3. **Profile cluster** — 6 screens, repetitive, low risk
4. **Reservations + payment** — the money screens, extra care
5. **Inbox, notifications, messages** — added later; missing from the original list
6. **Product detail, cart, wishlist** — added later; missing from the original list
7. **Strays** — screens belonging to no area at all

Each area is one branch off `main`, merged before the next starts, so a regression is bisectable
to one area rather than one enormous commit.

### What this list got wrong

Two blind spots, both found only when someone asked a direct question rather than read the plan.

**The list was not exhaustive.** It was written by walking the areas that felt like areas, not by
walking the route table. Stages 5, 6 and 7 (strays) below are the screens that fell through -- **6,771
lines**, including `product/[id]` (808 lines), `cart.tsx` (394 lines), `wishlist.tsx` (224 lines),
`outfit-builder.tsx` (791 lines), `profile/body-scan.tsx` (530 lines), and `ar-tryon/[id].tsx` (447 lines).
Any future audit should start from the file listing and subtract, never from memory and add.

**"Largely done" was not done.** Stage 1 was described as mostly finished because its enablers
(`PrimaryButton`, `onTint`, grid constants) had landed. The mechanical sweep never ran: as of this
writing every file in Stage 1 still carries zero tokens. Landing the groundwork for an area is not
the same as converting it, and the plan should not have implied otherwise.

---

## Stage 1 — Auth, Home, Explore

`app/(auth)` (6 files, 2180 lines), `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`.

**Status: not started.** The enablers landed here -- `PrimaryButton`, `onTint`, grid constants and
the collapsed header -- and that is all. Every file in this stage still carries zero token
references against roughly 4,100 lines, `explore.tsx` alone holding 28 raw `fontSize` values. The
mechanical part is the stage, and it is outstanding.

- `fontSize`/`fontWeight` → `Type.*` on leaf `Text` nodes.
- `padding`/`margin`/`gap` → `Spacing.*`, **except** the values feeding `gridCardWidth` and
  `auth.tsx`'s `otpBox` arithmetic.
- `borderRadius` → `Radius.*`.
- Hand-rolled shadows → `Elevation.*`, **except** the gold glows (`shadowColor: tint`), which
  Elevation cannot express because it casts black.

`Type` has no 13pt or 22pt slot. Snap to the nearest and accept a 1–2pt shift, or add a slot if a
value proves load-bearing — do not invent per-screen sizes.

## Stage 2 — Wardrobe sub-screens

`app/wardrobe/*` (5 files, 1667 lines): `add-item`, `create-capsule`, `item/[id]`, `capsule/[id]`,
`outfit/[id]`.

The wardrobe tab was rebuilt but tapping into an item drops back to the old styling, which is the
most visible inconsistency in the app right now. Same mechanical pass, plus:

- 4 files still carry `#0D0D0D` — check each against its background before converting; some may
  sit on a fixed dark surface where near-black is correct.
- Adopt `BrandEmptyState` wherever these screens hand-roll an empty state.

## Stage 3 — Profile cluster

`app/profile/*` (6 files, 2225 lines): `account-settings`, `appearance`, `edit`, `measurements`,
`notifications-settings`, plus `app/(tabs)/profile.tsx`.

The most repetitive area and the lowest risk — mostly settings rows and form fields. 4 files carry
`#0D0D0D`.

Watch for a genuine shared pattern here: if the settings row repeats across all six with the same
anatomy, extract it. If it varies, leave it — two callers is not a component.

## Stage 4 — Reservations and payment

`app/reservations.tsx`, `app/reservations/[id].tsx`, `app/reserve/[id].tsx`, `app/payment/*`
(1532 lines).

These take money and show legal/price copy, so treat them with more care than the rest:

- Convert colour and typography, but **leave any layout value alone unless its purpose is
  obvious**. A reflowed price row is a worse outcome than an unconverted one.
- Verify the deposit/total/balance breakdown still reads correctly at every font size after
  conversion — `Type.body` is 14 where some of these use 15.
- Do not touch the receipt image `contentFit` or the payment-deadline copy; both were deliberate
  fixes.

## Stage 5 — Inbox, notifications and messages

`app/(tabs)/messages.tsx` (the Inbox tab, carrying both the Messages and
Notifications lists behind a segmented control) and `app/messages/[conversationId].tsx`
(913 lines).

This area was missing from the original four stages, which is why the cross-cutting
contrast pass never reached it: that pass was scoped by grepping `#0D0D0D`, and the
defect here was a hardcoded `#ff3b30` unread badge at 3.55:1. The lesson generalises —
**scoping a sweep by one literal only finds screens that use that literal.** Any future
audit should start from the route list, not from a grep.

The chat screen carries more geometry that merely looks like spacing than anywhere else
in the app: bubble tail notches, negative margins that cancel the bubble's own padding,
and per-platform home-indicator insets. Convert colour and typography freely; leave
anything whose value is derived from a neighbour.

## Stage 6 — Product detail, cart and wishlist

`app/product/[id].tsx` (808 lines), `app/cart.tsx` (394), `app/wishlist.tsx` (224).

Missing from the original list, and the most costly omission in it: product detail is where most
browsing sessions end up, and it carries 24 raw `fontSize` values with no tokens at all.

These three are one area because they are one flow -- see an item, hold an item, come back to an
item -- and they share the price row, the size and colour chips and the stock copy. Check whether
those genuinely repeat before extracting anything; the settings row in Stage 3 looked shared and
was not.

`product/[id]` also holds the notify-me flow behind the sold-out state, so its empty and disabled
variants need checking, not just the happy path.

## Stage 7 — Strays

Screens belonging to no area, roughly 1,900 lines:

- `app/outfit-builder.tsx` (791)
- `app/profile/body-scan.tsx` (530)
- `app/ar-tryon/[id].tsx` (447)
- `app/payment-return.tsx` (126)
- `app/(tabs)/_layout.tsx` (125)

Two carry real constraints. `body-scan` and `ar-tryon` depend on
`react-native-vision-camera`, `react-native-mediapipe-posedetection` and
`react-native-worklets-core`, so neither can be verified without a dev client and both must keep
degrading safely when the native modules are absent. `_layout.tsx` contains the `barBottom`
arithmetic already listed as out of scope -- convert the colour and leave the maths.

---

## Cross-cutting: finish the contrast sweep properly

Rather than chasing `#0D0D0D` per area, do one pass first that audits all 27 files and classifies
each occurrence:

- on `colors.tint` → `colors.onTint`
- on a fixed dark surface (image scrim, dark-locked screen) → leave, add a one-line comment
- on `colors.notification` → separate decision; `#fff` on `#F72585` is 3.78:1 and also fails

This is a defect sweep, not a restyle, so it ships independently of the token work and should go
first.

---

## Explicitly out of scope

| Value | Why |
|---|---|
| `explore.tsx` `pricePresetCard.width: '48%'` in a `gap: 8` row | Same 96%+gap overflow that previously broke `categoriesGrid` |
| `auth.tsx` `otpBox.width: (width-48-48-40)/6` | Encodes three ancestor paddings |
| `index.tsx` `secondaryFeature.marginTop: 80` | Intentional editorial stagger, not spacing |
| `(tabs)/_layout.tsx` `barBottom` arithmetic | Home's tab clearance depends on it |
| Gold glow shadows | `shadowColor: tint`, not black — not an Elevation token |

Rule of thumb: **if a number appears in an arithmetic expression anywhere in the repo, it is an
API, not a style.**

---

## Verification

Per stage: `npx tsc --noEmit` clean, `npx eslint` at or below the 9-problem baseline (4 are
pre-existing Deno false positives), and `git diff --stat` matching the stage description.

On device, per stage, in **both themes** — the contrast class of bug is invisible in dark, and the
`glass`/`hairline` tokens are invisible in light:

- Stage 1: walk onboarding → welcome → auth, then Home and Explore including the filter sheet.
- Stage 2: open an item, a capsule and a saved outfit from the wardrobe tab.
- Stage 3: every settings screen, plus the appearance toggle itself.
- Stage 4: the reserve flow as far as the payment screen without submitting, checking the price
  breakdown reads correctly.
- Stage 5: both Inbox tabs, then open a conversation — check the bubble tails, the reaction
  pills and the growing input.
- Stage 6: a product in stock and one sold out, the bag with and without items, the wishlist
  empty and populated.
- Stage 7: outfit builder end to end; `body-scan` and `ar-tryon` need a dev-client build, so
  say so rather than claiming a pass.

Any row that reflows means a value came off the out-of-scope list.

## Known unverifiable

OTP verification, `profile-setup` and `reset-password` need a real signup or a recovery email.
`profile-setup` is the one screen made genuinely theme-aware, so its light mode has still never
rendered — the highest-risk item carried into this work.
