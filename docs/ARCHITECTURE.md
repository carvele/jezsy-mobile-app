# Jezsy Mobile App — System Architecture

Audit date: 2026-09-12 (Phase B7 Lifecycle & Architecture Refresh). Stack: Expo SDK 54, React Native 0.81.5, Expo Router 6, Supabase (PostgreSQL 15, Auth, Storage, Realtime, Edge Functions).

This document describes the system as implemented in the repository and verified against the live Supabase project (48 tables and RLS policies verified directly). Parts 1-3 are descriptive and suitable for adaptation into a thesis System Design chapter. The final section, Recommendations, is a technical audit for development use.

---

## Part 1: High-Level Architecture Overview

### 1.1 Architecture Pattern

The system is a **client-server architecture using a Backend-as-a-Service (BaaS) model**, with a **layered client**. There is no custom middle-tier application server: the mobile client communicates directly with Supabase, which provides authentication, a PostgreSQL database, file storage, realtime subscriptions, and serverless Edge Functions. Server-side business rules are enforced inside the database itself through Row Level Security (RLS) policies and SECURITY DEFINER stored procedures (`create_reservation_multi_idempotent`, `settle_payment_webhook`, `get_slot_booked_counts`), maintaining zero trust at the client boundary.

Within the client, the code is organized in layers:

1. **Presentation** — Expo Router file-based screens (`app/`) and reusable components (`src/components/`, `components/`).
2. **State management** — React Context providers (`src/context/`) for cross-screen state (auth session, cart, wishlist, conversations).
3. **Business logic / utilities** — pure TypeScript modules (`src/utils/`) for size recommendation, color harmony, measurement math, date formatting, and push-notification registration.
4. **Data access** — a single configured Supabase client (`src/lib/supabase.ts`) with generated database types (`src/types/database.types.ts`).
5. **Native/device integration** — Expo modules (camera, sensors, speech, secure storage, notifications) plus native MediaPipe and MLKit libraries for pose detection and background removal.

A design constraint documented in `docs/free-tier-audit.md` shapes the whole architecture: the project runs on a strict zero-cost budget, so all ML/AR processing happens **on-device** and all backend services stay within Supabase's free tier.

### 1.2 Architecture Diagram (description)

The diagram has four horizontal zones:

**Zone 1 — Mobile Client (Expo / React Native, Android and iOS)**
- UI layer: Expo Router screens (tab navigator + stacked detail screens, direct chat, user network profiles)
- State layer: `AuthProvider → WishlistProvider → CartProvider → MessagesProvider` (nested in that order)
- Utility layer: `sizeRecommender`, `colorMatcher`, `measurementCalculator`, `pushNotifications`, `poseNormalizer`, `paymentSecurity`, etc.
- Data access: single `supabase` client instance (PostgREST + Auth + Storage + Realtime channels over WebSocket)
- Local persistence: SecureStore (session tokens) and AsyncStorage (cart, session user object)

**Zone 2 — On-Device ML / Native Capabilities (inside the phone, no network)**
- Background removal: `@six33/react-native-bg-removal` (Google MLKit subject segmentation)
- Pose & body tracking pipeline: native MediaPipe pose detection via `react-native-vision-camera`, `react-native-mediapipe-posedetection`, and `react-native-worklets-core` for body measurements and real-time live length/fit signals
- Device capabilities: expo-camera (body scan, QR scanner, AR 2D overlay), expo-sensors accelerometer (tilt guidance), expo-speech (voice-guided scan), expo-secure-store, expo-notifications, expo-haptics, WebView hosting Google `model-viewer` for 3D try-on

**Zone 3 — Supabase (BaaS, free tier)**
- Auth: email/password, email OTP, Google OAuth (via expo-auth-session / signInWithOAuth)
- PostgreSQL: 48 tables, all 48 with RLS enabled; canonical RPC boundaries for atomic transactions (`create_reservation_multi_idempotent`, `settle_payment_webhook`, `get_slot_booked_counts`)
- Storage buckets: `payment_receipts` (private), `wardrobe-images`, `products`, `pose-images`
- Realtime: `supabase_realtime` publication on `messages`, `conversations`, `direct_messages`, and `notifications`
- Edge Function: `notify-status` (Deno), triggered by database webhooks on `reservations` UPDATE

**Zone 4 — External services**
- PayMongo: Electronic payment gateway (GCash, GrabPay, Maya, Card) with webhook signature verification
- Expo Push Notification service (`exp.host/--/api/v2/push/send`) — called by the Edge Function; free
- Google OAuth — identity provider; free
- Expo EAS Build — development/production builds (`eas.json`); free tier

Arrows: Client ↔ Supabase (HTTPS REST + WebSocket); Edge Function → Expo Push → device; on-device ML zone has no outbound arrows (privacy: images never leave the phone for processing).

### 1.3 Third-Party Services

| Service | Purpose | Tier |
|---|---|---|
| Supabase | Auth, DB, Storage, Realtime, Edge Functions | Free tier (500MB DB, 1GB storage, 50k MAU) |
| PayMongo | Payment gateway (GCash, GrabPay, Maya, Cards, Webhooks) | Standard transaction tier |
| Expo EAS | Cloud builds (`eas.json`) | Free tier |
| Expo Push Service | Push notification delivery | Free |
| Google OAuth | Social sign-in | Free |
| Google MLKit (bundled on-device) | Background removal | Free, on-device |
| MediaPipe (bundled on-device) | Real-time skeletal pose detection and fit tracking | Free, on-device |
| Google `model-viewer` (WebView) | 3D/AR model rendering | Free, open source |

Dual payment model: automated PayMongo checkout sessions and payment intents with database webhook settlement (`settle_payment_webhook`), plus out-of-band manual receipt upload with administrative verification.

---

## Part 2: Layered Breakdown

### 2.1 Presentation Layer (UI)

Navigation uses **Expo Router file-based routing** with a root Stack, two route groups, and stacked detail screens.

**Root:** [app/_layout.tsx](../app/_layout.tsx) — wraps the app in the four context providers, then `InitialLayout` performs **route guarding**: unauthenticated users are redirected to `(auth)`, and users without a profile to `profile-setup`. React Navigation light/dark theme is applied here. The local 6-digit PIN gate was removed on 2026-07-27; the Supabase session is now the only unlock.

**Route groups and screens:**

| Route | Purpose |
|---|---|
| `(auth)/index`, `welcome` | Entry / welcome, Google OAuth |
| `(auth)/auth` | Email/password and email OTP sign-in |
| `(auth)/profile-setup` | First-time profile completion (writes `profiles`) |
| `(tabs)/index` | Home — featured products |
| `(tabs)/explore` | Catalog browse: categories, search, filters |
| `(tabs)/wardrobe` | Digital wardrobe: items, saved outfits, capsules |
| `(tabs)/messages` | Unified Inbox: notifications + conversations, unread badge |
| `(tabs)/profile` | Account, measurements entry point, sign out |
| `(tabs)/scanner` | QR/tag scanner (hidden from tab bar, `href: null`) |
| `product/[id]` | Product detail, size recommendation, reviews, related items |
| `reserve/[id]` | Rental reservation: date, time slot, receipt upload |
| `ar-tryon/[id]` | AR try-on: 3D model-viewer WebView or 2D camera overlay |
| `cart`, `checkout` | Bag and order placement (`create_order` RPC) |
| `reservations` | Reservation list |
| `wishlist` | Saved products |
| `outfit-builder` | Compose outfits, color-harmony scoring, save |
| `wardrobe/add-item` | Photograph item, background removal, upload |
| `profile/body-scan` | Voice-guided camera body scan |
| `profile/measurements` | Manual/scan measurement entry and save |
| `messages/[conversationId]` | Chat thread with realtime updates |
| `modal` | Generic modal presentation |

**Components:**
- `src/components/` — feature components: `TimeSlotPicker` (reservation slots, queries `reservations` for availability), `ReviewModal`/`ReviewsList` (reviews CRUD), `RelatedProducts`, `ConsentModal` (biometric consent), `TiltGuide` (accelerometer), `SilhouetteOverlay`, `PoseLandmarkOverlay`, `GapAnalysis`, `CapsuleCard`, `StreakBadge`.
- `components/` (root) — Expo template UI primitives: `themed-text`, `themed-view`, `haptic-tab`, `ui/icon-symbol`, `parallax-scroll-view`.
- `constants/theme.ts` + `hooks/use-color-scheme` — theming (automatic light/dark).

### 2.2 State Management Layer

Four Context providers in `src/context/`, nested in [app/_layout.tsx](../app/_layout.tsx:64) in this order:

```
AuthProvider → WishlistProvider → CartProvider → MessagesProvider
```

**Order matters** because of a dependency chain: `WishlistContext` and `MessagesContext` both call `useAuth()` to know the current user/session, so `AuthProvider` must be outermost. `CartContext` is independent (device-local), so its position is flexible, but it must sit above `MessagesProvider` only by convention. `MessagesProvider` must also be above the tab navigator because `(tabs)/_layout.tsx` reads `unreadCount` for the Inbox badge.

| Context | State owned | Functions exposed | Persistence |
|---|---|---|---|
| `AuthContext` | `user`, `session`, `profile`, loading flags | `refreshProfile`, `signOut`; internally syncs (`upsert`) the `profiles` row on every auth state change and registers the push token | Supabase session in SecureStore/AsyncStorage |
| `WishlistContext` | `wishlistIds: Set<string>` | `isInWishlist`, `toggleWishlist` (optimistic update with rollback on error) | `wishlists` table |
| `CartContext` | `items: CartItem[]`, derived `totalAmount`, `itemCount` | `addToCart`, `removeFromCart`, `updateQuantity`, `clearCart` | AsyncStorage only (`@jezsy_cart`) — never synced to the server until checkout |
| `MessagesContext` | `conversations`, derived `unreadCount`, `loading` | `sendMessage`, `markAsRead`, `getOrCreateConversation`, `refreshConversations`; subscribes to a Realtime channel on `conversations` and refetches on any change | `conversations` / `messages` tables |

### 2.3 Business Logic / Utility Layer (`src/utils/`)

| Module | Role |
|---|---|
| `sizeRecommender.ts` | Compares user measurements against a product's per-size chart with a fit-preference allowance (tight/regular/loose); returns best size. Used by `product/[id]`. |
| `colorMatcher.ts` | Rule-based color-harmony engine (neutrals, complementary, metal-clash rules) returning a 0-100 score. Used by `outfit-builder`. |
| `measurementCalculator.ts` | Anthropometric regression (ANSUR-II/CAESAR-derived coefficients) converting normalized body ratios + height/weight/gender into cm measurements. |
| `poseDetector.ts` | BlazePose Lite TFLite output parsing: 33 landmarks → confidence, full-body check, body-ratio extraction. (Scaffolding — see 2.6.) |
| `bodyEstimator.ts` | Orchestrator delegating to `measurementCalculator`. |
| `burstAverager.ts` | Multi-frame averaging with Z-score outlier rejection for scan noise reduction. |
| `measurementPrivacy.ts` | Sanitizes measurement payloads before storage; provides `deleteAllMeasurementData` (GDPR Article 17 erasure). |
| `pushNotifications.ts` | Expo push token registration (guards against Expo Go via lazy imports), saves token to `profiles.expo_push_token`, schedules local reservation reminders. |
| `dateTime.ts` | Local date/time formatting (`YYYY-MM-DD`, 12-hour labels). |

Client-side validation lives in the screens themselves (e.g. `checkout.tsx` validates address fields and date format; `reserve/[id].tsx` validates slot and receipt presence). Financial totals are computed client-side in `CartContext` for display, but the authoritative order total is computed server-side inside the `create_order` function.

### 2.4 Data Access Layer

**Client initialization** — [src/lib/supabase.ts](../src/lib/supabase.ts): a single typed client (`createClient<Database>`) built from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` env vars (fails fast if missing). A custom `ExpoSecureStoreAdapter` splits the session: tokens go to **SecureStore** (with an AsyncStorage fallback when the payload exceeds SecureStore's 2048-byte limit) while the larger `user` object is stored in **AsyncStorage** under a `_user` suffix key. `autoRefreshToken` and `persistSession` are enabled; on web it falls back to `localStorage`.

**Tables in use** (verified against the live project — 48 tables, RLS enabled on all 48):

| Feature area | Tables |
|---|---|
| Auth & Users | `profiles`, `user_measurements`, `devices`, `settings`, `logs`, `staff_status_history`, `account_deletion_requests`, `rate_limits` |
| Catalog & Inventory | `products`, `categories`, `inventory`, `stock_movements`, `product_complements`, `color_options`, `color_list`, `pattern_list`, `stock_notify_requests` |
| Commerce & Boutique | `reservations`, `reservation_items`, `payments`, `processed_payment_webhook_events`, `store_hours`, `store_closures` |
| Wardrobe & Outfits | `wardrobe_items`, `saved_outfits`, `outfit_items`, `suggested_outfits`, `capsules`, `capsule_items`, `user_streaks` |
| Social & Community | `connections`, `wishlists`, `reviews`, `review_votes` |
| Messaging & Notifications | `conversations`, `messages`, `direct_chats`, `direct_chat_participants`, `direct_messages`, `notifications`, `admin_notifications`, `announcements`, `announcement_dismissals`, `feedback` |
| AR & Pose Tracking | `ar_assets`, `ar_sessions`, `pose_guides`, `pose_guide_products` |

**RLS policy summary** (one line each; 48/48 tables have RLS enabled):

- `profiles` — authenticated own-profile update, public/authenticated safe profile read, owner full administrative management.
- `products`, `categories`, `inventory`, `color_options`, `color_list`, `pattern_list`, `pose_guides`, `suggested_outfits`, `ar_assets`, `settings`, `product_complements`, `store_hours`, `store_closures` — public/all-user read, owner/staff-only write.
- `stock_movements` — append-only ledger; public read, owner insert, updates/deletes strictly denied.
- `reservations`, `reservation_items`, `payments` — customer own-record read/insert, owner/staff management; customer writes gated by canonical RPC boundaries.
- `processed_payment_webhook_events` — service-role and DEFINER RPC access only; direct client read/write closed.
- `wishlists`, `capsules`, `capsule_items`, `user_streaks`, `notifications`, `account_deletion_requests` — strict owner-only CRUD.
- `wardrobe_items`, `saved_outfits`, `outfit_items` — owner CRUD, with privacy-controlled visibility for connected users (`wardrobe_privacy` gating).
- `connections` — authenticated user mutual and pending connection management.
- `conversations`, `messages` — Boutique Support channel; customer participant or boutique staff/admin read/write.
- `direct_chats`, `direct_chat_participants`, `direct_messages` — P2P direct chat; strict participant-only access with blocking checks.
- `reviews`, `review_votes` — public read, authenticated author write, verified completed reservation gating.
- `devices`, `feedback`, `logs`, `ar_sessions` — authenticated insert/register, owner/staff read/manage.
- `staff_status_history`, `admin_notifications` — staff/owner administrative read and audit trail.

**Storage buckets:** `payment_receipts` (private; per-user folder paths; used by `reserve/[id]`), `wardrobe-images` (used by `wardrobe/add-item`), `products` (product imagery), `pose-images` (pose guide assets).

**Canonical RPC Boundaries:**
- `create_reservation_multi_idempotent(_idempotency_key, _items, _date, _appointment_time, _receipt_path, _payment_option, _customer_id)` — atomic reservation creation with server-resolved pricing.
- `settle_payment_webhook(_event_id, _payment_id, _provider_payment_id, _method, _next_status, _event)` — idempotent payment settlement.
- `get_slot_booked_counts(_date)` — SECURITY DEFINER slot booking aggregation for accurate schedule rendering across customer RLS boundaries.
- `complete_reservation_handover(_reservation_id, _method)` — boutique handover and balance settlement.
- `update_staff_role_v2(target_user_id, new_role)` — administrative RBAC assignment with audit logging.
- `admin_manage_device(_fingerprint, _action, _value)` & `admin_prune_devices(_cutoff)` — trusted device security governance.

**Edge Function:** `supabase/functions/notify-status/index.ts` — invoked by database webhooks on `reservations` UPDATE; sends push notifications via Expo push service.

### 2.5 Native / Device Integration Layer

| Module | Used by | Expo Go? |
|---|---|---|
| `expo-camera` (`CameraView`) | `profile/body-scan` (front camera capture), `(tabs)/scanner` (QR), `ar-tryon/[id]` (2D overlay mode) | Yes |
| `expo-sensors` (Accelerometer) | `TiltGuide` in body scan (vertical-phone gating) | Yes |
| `expo-speech` | Body scan voice guidance ("tilt phone down", countdown) | Yes |
| `expo-secure-store` | Supabase session tokens, last-login timestamp | Yes |
| `expo-notifications` + `expo-device` | Push registration (`pushNotifications.ts`), reservation reminders; explicitly skipped in Expo Go via `Constants.appOwnership` guard and lazy imports | **Dev build only** |
| `expo-image-picker` | Receipt upload (`reserve`), wardrobe photos (`add-item`), chat images | Yes |
| `expo-haptics` | Tab bar feedback (`HapticTab`) | Yes |
| `react-native-webview` | `ar-tryon` 3D mode (Google `model-viewer` rendering .glb/.usdz) | Yes |
| `@six33/react-native-bg-removal` (MLKit) | `wardrobe/add-item`, `outfit-builder` background removal | **Dev build only** (native MLKit) |
| `react-native-vision-camera`, `react-native-mediapipe-posedetection`, `react-native-worklets-core` | Native live skeletal tracking, body scan, and real-time length/fit calibration | **Dev build only** |
| `expo-auth-session` / `expo-web-browser` | Google OAuth flow (`welcome.tsx`) | Yes |

Because of native MediaPipe pose tracking, MLKit background removal, and push notifications, the app is a **prebuilt development-build application** (run with `expo run:android` / dev client, not standard Expo Go).

### 2.6 ML / AI Layer

Two primary on-device native pipelines are operational:

1. **Background removal (MLKit).** In `wardrobe/add-item` (and `outfit-builder`), `removeBackground()` runs MLKit subject segmentation locally on-device. The transparent PNG is uploaded to `wardrobe-images`, and metadata is indexed in `wardrobe_items`.
2. **Body measurement & pose tracking (MediaPipe).** Native MediaPipe pose detection processes camera frames in real time using `react-native-vision-camera` and `react-native-worklets-core`. The 33 normalized skeletal landmarks feed `poseDetector.ts`, `measurementCalculator.ts`, and `burstAverager.ts` to derive user dimensions with confidence scores, feeding `sizeRecommender.ts` and AR garment calibration.

---

## Part 3: Data Flow — Three Core User Flows

### 3.1 Browse → Reserve (rental with downpayment)

1. `(tabs)/index` or `(tabs)/explore` reads `products` (and `categories`) and renders the catalog.
2. Tapping a card opens `product/[id]`, which reads `products` + `inventory` (stock per size/color) and, if signed in, `profiles` + `user_measurements` to show a size recommendation via `recommendSize()`.
3. "Reserve" opens `reserve/[id]`: `TimeSlotPicker` calls `public.get_slot_booked_counts(_date)` (`SECURITY DEFINER`), guaranteeing accurate slot booking counts regardless of customer-level reservation RLS.
4. Downpayment is handled either via automated PayMongo checkout (creating a payment record) or manual receipt upload (`expo-image-picker`) to the private `payment_receipts` bucket.
5. The screen invokes `create_reservation_multi_idempotent` with an idempotency key; the database creates reservations atomically with server-computed prices and holds inventory.
6. When staff transition the reservation status, a database webhook fires the `notify-status` Edge Function, which inserts a `notifications` row and dispatches an Expo push notification.

### 3.2 Body Scan → Measurements → Size Recommendation

1. `profile/measurements` loads existing data from `profiles` (fit preference, gender) and `user_measurements`.
2. "Scan" navigates to `profile/body-scan` with height/weight params. A `ConsentModal` collects explicit biometric-processing consent before the camera activates.
3. Front camera capture is assisted by `TiltGuide` (accelerometer) and `expo-speech` audio countdown.
4. MediaPipe extracts skeletal landmarks; measurements are calculated and confirmed. On save, values are sanitized and persisted in `user_measurements` via `update_profile_and_measurements` RPC.
5. On any `product/[id]` visit, `recommendSize(userMeasurements, product.measurements, fitPreference)` executes locally to render the personalized fit badge.

### 3.3 Messaging & Realtime Communication

The application features a frozen dual-channel messaging architecture:

1. **Boutique Support (`conversations` & `messages`):**
   - Dedicated support channel between a customer and boutique staff/admin.
   - Initialized via `getOrCreateConversation()`.
   - Realtime updates subscribed on `messages` table filtered by `conversation_id`.
2. **P2P Direct Chat (`direct_chats`, `direct_chat_participants`, `direct_messages`):**
   - Direct communication between connected users.
   - Initialized via `get_or_create_direct_chat(other_user_id)` with blocking verification (`is_blocked_between`).
   - Realtime subscriptions on `direct_messages` filtered by `chat_id`.
   - Dedicated read receipts (`mark_direct_message_read`) and unread aggregations (`get_direct_chat_summaries`).

---

## Part 4: Recommendations (Technical Audit)

For development use — ordered roughly by impact.

### 4.1 Correctness / integrity

1. **Body-scan ML pipeline is not wired end-to-end.** `body-scan.tsx` captures a photo and navigates with `photoUri`, but `measurements.tsx` only consumes `scanData` when `scanned === 'true'` — which nothing sets. The photo is never processed; `poseDetector`, `bodyEstimator`, `burstAverager`, and `PoseLandmarkOverlay` are dead code paths, and `react-native-vision-camera` / `react-native-fast-tflite` / worklets are unused native dependencies inflating the build. Either complete the TFLite integration or remove the unused deps and document the scan as guided-manual-entry.
2. **Chat images upload to the public `products` bucket** (`messages/[conversationId].tsx:141`). Private conversation attachments land in a bucket meant for catalog imagery with public URLs. Create a `chat-images` bucket with participant-scoped RLS.
3. **Two inconsistent write paths for commerce.** Checkout correctly goes through the server-side `create_order` RPC (prices computed in-DB), but reservations are a **direct client insert** with client-computed `deposit`, `rental_price`, and a `Date.now()`-based `display_id`. A tampered client could write arbitrary prices. Move reservation creation to an RPC or add DB-side checks/triggers mirroring the order hardening.
4. **Non-atomic messaging writes.** `sendMessage` inserts the message, then separately updates the conversation; a failure between the two leaves a stale `last_message`. `unread_count` is also maintained client-side (the code itself notes a DB trigger should own this). A trigger on `messages` insert would fix both.
5. **`profiles` is world-readable** ("Enable read access for all users"), exposing emails and push tokens of all users to any authenticated (or anonymous) client. Restrict to owner + owner, or a limited public view. Also, one update policy matches "based on email" while the app updates by `id` — verify it actually permits the intended writes.

### 4.2 Coupling and consistency

6. **Screens call Supabase directly (~30 call sites).** Only auth, wishlist, and messaging are mediated by contexts; products, reservations, wardrobe, reviews, and measurements queries are embedded in screen components. This duplicates query logic (e.g. `products` fetched in 8+ files) and makes schema changes ripple through the UI. Introduce a thin `src/services/` layer (or React Query) per feature area.
7. **Persistence pattern is inconsistent across sibling features.** Wishlist is server-persisted with optimistic updates; Cart is AsyncStorage-only (lost on device change, no cross-device sync, no stock validation until checkout). Acceptable for a capstone, but document it as a deliberate trade-off.
8. **Redundant RLS policies from stacked migrations** — e.g. `user_measurements` has 9 overlapping policies, `wardrobe_items`/`saved_outfits` pair a broad "all authenticated users" policy with a stricter owner-only one (the broad one wins, since RLS policies are OR-ed — this currently makes wardrobe data readable by any authenticated user). Consolidate to one policy per operation.
9. **`AuthContext.syncProfile` upserts the profile on every auth state change**, overwriting `first_name`/`last_name` from OAuth metadata — this can clobber a user's edited name on next token refresh. Upsert only on first sign-in; otherwise just fetch.

### 4.3 Resilience / single points of failure

10. **No retry or offline handling on critical writes.** Checkout, reservation submit, and message send each try once and show an alert on failure. The reservation flow can also orphan a receipt upload if the subsequent insert fails. Add retry-with-backoff on the RPC calls and cleanup (or deferred verification) for orphaned receipts.
11. **MessagesContext refetches all conversations on any table change** (unfiltered channel on the whole `conversations` table). With RLS the payloads are filtered, but every change still triggers a full refetch; fine at capstone scale, wasteful beyond it. Filter the channel by `customer_id` and apply payload deltas.
12. **Single Supabase project is the entire backend** — expected for BaaS, but there is no health/error telemetry in the client (`logs` table exists but is barely used). Consider logging failed critical writes there.

### 4.4 Scalability notes

13. Client-side product filtering in `explore` and unpaginated list queries will degrade as the catalog grows; add `.range()` pagination and server-side filters.
14. The one-conversation-per-customer model (`getOrCreateConversation` with `.single()`) is fine for a single boutique but hard-codes that assumption; a `shop_id` column would future-proof multi-vendor.
15. SecureStore's 2048-byte fallback path silently moves tokens to AsyncStorage (unencrypted). Log/track when this happens; consider trimming the session payload instead.

---

*Sources: repository at commit `74795f7` (branch `main`); live Supabase schema and `pg_policy` catalog queried 2026-07-19; `docs/free-tier-audit.md` for cost-constraint rationale.*
