# Feature-Richness Implementation Plan

Scope: product-page gaps and the admin-announcement/notification gap identified
2026-07-29. Not started yet — pending scope confirmation. Written to `/docs`
per CLAUDE.md convention; not auto-committed.

## Phase 0 — prerequisite (blocks everything below)

Device/manual test of the branches merged this session (reservation RLS fix,
PIN removal, auth hardening, store_hours restoration, AR fit map, contextual
messaging, reschedule, pickup pass). Nothing in this plan should start on top
of an unverified base. Owner: you, on a physical device or emulator with the
dev client.

## Phase 1 — Announcements (admin broadcast notifications)

Answers the question from this session: today `public.notifications` requires
a `user_id` per row and is only ever written by two SECURITY DEFINER triggers
scoped to a single customer's reservation/order status change. There is no
path for an admin-authored message to reach every inbox, and nothing reaches
a user who signs up after the announcement was made. The Inbox screen already
anticipates this — `getIconForType` in
[app/(tabs)/messages.tsx:63](app/(tabs)/messages.tsx:63) has icons for `promo`
and `system` types that nothing has ever written.

**Schema (new migration + rollback):**
- `announcements` (id, title, body, type default 'promo', `created_by`,
  `expires_at` nullable, `created_at`) — one row per announcement, not per
  recipient. SECURITY DEFINER admin-only insert via RPC (`is_staff_or_admin()`
  gate, matching the project's established pattern) or a direct RLS
  INSERT policy restricted to staff/admin — direct policy is fine here since
  there's no price/ownership vector to protect, unlike `create_reservation`.
- `announcement_dismissals` (user_id, announcement_id, dismissed_at) —
  presence of a row hides that announcement for that user. RLS: a user can
  insert/select only their own rows.

**Client:**
- Inbox notifications tab: query becomes active (`expires_at IS NULL OR
  expires_at > now()`) announcements NOT IN the user's dismissals, unioned
  client-side with the existing per-user `notifications` rows, sorted by
  `created_at`.
- Swipe-to-dismiss or a dismiss button inserts into `announcement_dismissals`.
- No admin-side compose UI in this repo — that's the admin-dashboard's job
  (separate repo). This repo only needs to read/dismiss.

**Why this shape, not a fan-out-on-insert trigger:** a fan-out trigger has to
also fire on profile creation to backfill new signups, and needs a cleanup
job for expired rows across every user. The read-time filter needs neither —
a brand-new account has zero dismissal rows, so every still-active
announcement shows up for free.

**Effort:** ~1 migration, 1 RPC or policy, ~60 lines of client changes to an
existing screen. Small.

## Phase 2 — Cheap, high-value product-page wins

- **Review photos.** `reviews.images` already exists as a `text[]` column;
  `ReviewModal.tsx` explicitly skips it (`images: [] // omitted for brevity`).
  Wire `expo-image-picker` + upload to a `review-images` storage bucket
  (mirror the `chat-images` bucket pattern already in
  `20260719123000_chat_images_bucket.sql`), display thumbnails in
  `ReviewsList`.
- **Quantity selector.** Add-to-Bag currently hardcodes qty 1
  ([app/product/[id].tsx:423](app/product/[id].tsx:423)). Add a stepper,
  clamp to available stock.
- **Stock-back notification.** Per-size stock is already tracked in
  `inventory`. Add a `stock_notify_requests` table (user_id, product_id,
  size) and a trigger on `inventory` UPDATE that fires when `available` goes
  0 → >0, inserting a `notifications` row for each matching request.
- **Share product.** Native `Share.share()` with a deep link — no schema
  change, UI-only.
- **Recently viewed.** Local (AsyncStorage) ring buffer of product IDs on
  product-detail mount; render as a strip on Explore/Home. No schema change.

## Phase 3 — Medium effort

- **Size chart modal.** `product.measurements` already holds per-size garment
  measurements; today it only feeds the recommender, never rendered as a
  table. Add a modal triggered from the Size section showing all sizes at
  once.
- **Image zoom/pinch** on the product gallery (`react-native-gesture-handler`
  is likely already a transitive Expo dependency — confirm before adding
  anything new per the native-module cost rule in CLAUDE.md).
- **Review sort/filter** (recent / highest / lowest / with photos) — client-
  side sort on already-fetched `reviews`, no schema change unless filtering
  by photos needs an index.
- **Verified-purchase badge** on reviews — join `reviews.user_id` +
  `product_id` against `order_items`/`reservations` at query time.

## Phase 4 — Larger / defer

- Video in the product media gallery.
- Compare products.
- Personalized "you may also like" beyond same-category `RelatedProducts`.
- Loyalty/rewards, promo codes at checkout.

These need product-decision input (data model for compare state, a
recommendation source, a rewards ledger) that's out of scope until Phases
1-3 are shipped and tested.

## Sequencing note

Phase 1 and Phase 2's stock-back item both add triggers writing to
`public.notifications`/new tables on the shared live DB — same coordination
rule as every other migration this session: confirm with you before applying,
notify the admin-dashboard developer since announcements will likely need a
compose surface there eventually (out of scope for this repo, but they should
know the schema is coming).
