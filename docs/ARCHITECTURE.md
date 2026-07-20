# Jezsy Mobile App — System Architecture

Audit date: 2026-07-19. Stack: Expo SDK 54, React Native 0.81.5, Expo Router 6, Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions).

This document describes the system as implemented in the repository and verified against the live Supabase project (table list and RLS policies were queried directly). Parts 1-3 are descriptive and suitable for adaptation into a thesis System Design chapter. The final section, Recommendations, is a technical audit for development use.

---

## Part 1: High-Level Architecture Overview

### 1.1 Architecture Pattern

The system is a **client-server architecture using a Backend-as-a-Service (BaaS) model**, with a **layered client**. There is no custom application server: the mobile client communicates directly with Supabase, which provides authentication, a PostgreSQL database, file storage, realtime subscriptions, and one serverless Edge Function. Server-side business rules are enforced inside the database itself through Row Level Security (RLS) policies and a SECURITY DEFINER stored procedure (`create_order`), rather than in a middle-tier API.

Within the client, the code is organized in layers:

1. **Presentation** — Expo Router file-based screens (`app/`) and reusable components (`src/components/`, `components/`).
2. **State management** — React Context providers (`src/context/`) for cross-screen state (auth session, cart, wishlist, conversations).
3. **Business logic / utilities** — pure TypeScript modules (`src/utils/`) for size recommendation, color harmony, measurement math, date formatting, and push-notification registration.
4. **Data access** — a single configured Supabase client (`src/lib/supabase.ts`) with generated database types (`src/types/database.types.ts`).
5. **Native/device integration** — Expo modules (camera, sensors, speech, secure storage, notifications) plus an on-device ML library for background removal.

A design constraint documented in `docs/FREE_TIER_AUDIT.md` shapes the whole architecture: the project runs on a strict zero-cost budget, so all ML/AR processing happens **on-device** and all backend services stay within Supabase's free tier.

### 1.2 Architecture Diagram (description)

The diagram has four horizontal zones:

**Zone 1 — Mobile Client (Expo / React Native, Android and iOS)**
- UI layer: Expo Router screens (tab navigator + stacked detail screens + modals)
- State layer: `AuthProvider → WishlistProvider → CartProvider → MessagesProvider` (nested in that order)
- Utility layer: `sizeRecommender`, `colorMatcher`, `measurementCalculator`, `pushNotifications`, etc.
- Data access: single `supabase` client instance (PostgREST + Auth + Storage + Realtime channels over WebSocket)
- Local persistence: SecureStore (session tokens, PIN) and AsyncStorage (cart, session user object)

**Zone 2 — On-Device ML / Native Capabilities (inside the phone, no network)**
- Background removal: `@six33/react-native-bg-removal` (Google MLKit subject segmentation)
- Pose/measurement pipeline (scaffolded): `react-native-fast-tflite` + BlazePose Lite parsing utilities (see 2.6 — declared but not yet wired to a screen)
- Device capabilities: expo-camera (body scan, QR scanner, AR 2D overlay), expo-sensors accelerometer (tilt guidance), expo-speech (voice-guided scan), expo-secure-store, expo-notifications, expo-haptics, WebView hosting Google `model-viewer` for 3D try-on

**Zone 3 — Supabase (BaaS, free tier)**
- Auth: email/password, email OTP, Google OAuth (via expo-auth-session / signInWithOAuth)
- PostgreSQL: 31 tables, all with RLS enabled; `create_order` RPC for atomic order creation
- Storage buckets: `payment_receipts` (private), `wardrobe-images`, `products`
- Realtime: `supabase_realtime` publication on `messages` and `conversations`
- Edge Function: `notify-status` (Deno), triggered by database webhooks on `reservations`/`orders` UPDATE

**Zone 4 — External services**
- Expo Push Notification service (`exp.host/--/api/v2/push/send`) — called by the Edge Function; free
- Google OAuth — identity provider; free
- Expo EAS Build — development/production builds (`eas.json`); free tier

Arrows: Client ↔ Supabase (HTTPS REST + WebSocket); Edge Function → Expo Push → device; on-device ML zone has no outbound arrows (privacy: images never leave the phone for processing).

### 1.3 Third-Party Services

| Service | Purpose | Tier |
|---|---|---|
| Supabase | Auth, DB, Storage, Realtime, Edge Functions | Free tier (500MB DB, 1GB storage, 50k MAU) |
| Expo EAS | Cloud builds (`eas.json`) | Free tier |
| Expo Push Service | Push notification delivery | Free |
| Google OAuth | Social sign-in | Free |
| Google MLKit (bundled on-device) | Background removal | Free, on-device |
| Google `model-viewer` (WebView) | 3D/AR model rendering | Free, open source |

No paid services are integrated. There is no payment gateway: payment is handled out-of-band (user uploads a proof-of-downpayment receipt image; staff verify manually).

---

## Part 2: Layered Breakdown

### 2.1 Presentation Layer (UI)

Navigation uses **Expo Router file-based routing** with a root Stack, two route groups, and stacked detail screens.

**Root:** [app/_layout.tsx](../app/_layout.tsx) — wraps the app in the four context providers, then `InitialLayout` performs **route guarding**: unauthenticated users are redirected to `(auth)`, users without a profile to `profile-setup`, without a PIN to `pin-setup`, and with a PIN but not yet PIN-verified to `pin-entry`. React Navigation light/dark theme is applied here.

**Route groups and screens:**

| Route | Purpose |
|---|---|
| `(auth)/index`, `welcome` | Entry / welcome, Google OAuth |
| `(auth)/auth` | Email/password and email OTP sign-in |
| `(auth)/profile-setup` | First-time profile completion (writes `profiles`) |
| `(auth)/pin-setup`, `pin-entry` | Local PIN creation / verification (SecureStore) |
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
| `orders/[id]`, `reservations` | Order detail, reservation list |
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
| `AuthContext` | `user`, `session`, `profile`, loading flags, PIN flags (`hasPinSetup`, `isPinAuthenticated`, `requireFullLogin`) | `refreshProfile`, `signOut`, PIN flag setters; internally syncs (`upsert`) the `profiles` row on every auth state change and registers the push token | Supabase session in SecureStore/AsyncStorage; PIN in SecureStore |
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

**Tables in use** (verified against the live project — 31 tables, RLS enabled on all):

| Feature area | Tables |
|---|---|
| Auth / Users | `profiles`, `user_measurements`, `devices`, `settings`, `logs`, `staff_status_history` |
| Catalog | `products`, `categories`, `inventory`, `stock_movements`, `color_options`, `color_list`, `pattern_list` |
| Commerce | `orders`, `order_items`, `reservations`, `wishlists`, `reviews` |
| Wardrobe / Styling | `wardrobe_items`, `saved_outfits`, `suggested_outfits`, `capsules`, `capsule_items`, `user_streaks` |
| Messaging / Notifications | `conversations`, `messages`, `notifications`, `feedback` |
| AR / Scan | `ar_assets`, `ar_sessions`, `pose_guides` |

**RLS policy summary** (one line each; all tables have RLS enabled):

- `profiles` — public read; users update their own row; insert for authenticated; admin full access. *(Note: read is open to all users — see Recommendations.)*
- `products`, `categories`, `inventory`, `color_options`, `color_list`, `pattern_list`, `pose_guides`, `suggested_outfits`, `ar_assets`, `settings` — public/all-user read, admin-only write.
- `stock_movements` — public read, admin insert, updates/deletes explicitly denied (append-only ledger).
- `orders`, `order_items`, `reservations` — owner (customer_id/user_id) read/insert/update, admin full access; reservation delete is admin-only.
- `wishlists`, `capsules`, `capsule_items`, `user_streaks`, `notifications` — strict owner-only CRUD.
- `user_measurements` — owner-only read/write (plus admin); 9 overlapping policies from successive migrations.
- `wardrobe_items`, `saved_outfits` — owner-or-admin policies, but also a broader "all authenticated users" policy coexists (see Recommendations).
- `conversations`, `messages` — participant (customer) or admin/staff read/insert/update.
- `reviews` — public read, owner-managed write.
- `devices`, `feedback`, `logs`, `ar_sessions` — authenticated insert, admin read/manage.
- `staff_status_history` — staff/admin read only.

**Storage buckets:** `payment_receipts` (private; per-user folder paths; used by `reserve/[id]`), `wardrobe-images` (used by `wardrobe/add-item`), `products` (product imagery; also currently used for chat image uploads — see Recommendations).

**RPC:** `create_order(_shipping_address, _items)` — SECURITY DEFINER function (grant to `authenticated` only) that creates the order and its items atomically server-side; the client sends only product IDs and quantities, never prices.

**Edge Function:** `supabase/functions/notify-status/index.ts` — invoked by database webhooks on `reservations`/`orders` UPDATE; when `status` changes it inserts an in-app `notifications` row and sends an Expo push to the user's stored `expo_push_token` using the service-role key.

### 2.5 Native / Device Integration Layer

| Module | Used by | Expo Go? |
|---|---|---|
| `expo-camera` (`CameraView`) | `profile/body-scan` (front camera capture), `(tabs)/scanner` (QR), `ar-tryon/[id]` (2D overlay mode) | Yes |
| `expo-sensors` (Accelerometer) | `TiltGuide` in body scan (vertical-phone gating) | Yes |
| `expo-speech` | Body scan voice guidance ("tilt phone down", countdown) | Yes |
| `expo-secure-store` | Supabase session tokens, local PIN, last-login timestamp | Yes |
| `expo-notifications` + `expo-device` | Push registration (`pushNotifications.ts`), reservation reminders; explicitly skipped in Expo Go via `Constants.appOwnership` guard and lazy imports | **Dev build only** |
| `expo-image-picker` | Receipt upload (`reserve`), wardrobe photos (`add-item`), chat images | Yes |
| `expo-haptics` | Tab bar feedback (`HapticTab`) | Yes |
| `react-native-webview` | `ar-tryon` 3D mode (Google `model-viewer` rendering .glb/.usdz) | Yes |
| `@six33/react-native-bg-removal` (MLKit) | `wardrobe/add-item`, `outfit-builder` background removal | **Dev build only** (native MLKit; `plugins/withMlkitManifestFix.js` patches the Android manifest) |
| `expo-auth-session` / `expo-web-browser` | Google OAuth flow (`welcome.tsx`) | Yes |
| `react-native-vision-camera`, `react-native-fast-tflite`, `react-native-worklets(-core)` | **Declared in package.json but not imported by any screen** — reserved for the live pose-estimation pipeline | Dev build only (unused) |

Because of MLKit and push notifications, the app is effectively a **development-build app** (EAS builds configured in `eas.json`); Expo Go can run most of it but with wardrobe background removal and push disabled.

### 2.6 ML / AI Layer

Two on-device pipelines exist; one is fully live, one is partially implemented.

**Background removal (live).** In `wardrobe/add-item` (and `outfit-builder`), the user picks/takes a photo → `removeBackground()` runs MLKit subject segmentation locally → the cut-out PNG is uploaded to the `wardrobe-images` bucket → a `wardrobe_items` row stores the public URL and color tags. No image leaves the device for processing.

**Body measurement (hybrid, TFLite path scaffolded).** The intended pipeline is: Vision Camera frame → BlazePose Lite TFLite model (`react-native-fast-tflite`) → `parseLandmarks` (33 landmarks) → body ratios (`poseDetector.ts`) → anthropometric regression (`measurementCalculator.ts`) → burst averaging (`burstAverager.ts`) → sanitized storage (`measurementPrivacy.ts`) in `user_measurements` with per-field confidence. The supporting math modules, the confidence schema (migration `20260629083800`), and the `PoseLandmarkOverlay` component are all in place.

**As currently shipped**, however, the body-scan screen uses a simpler sensor-guided capture: `ConsentModal` (biometric consent) → `expo-camera` preview with `TiltGuide` (accelerometer keeps the phone vertical) and a silhouette overlay → voice countdown → single photo capture → navigation to the measurements form. The TFLite inference step is not yet wired in — the measurements screen accepts `scanData` params but the scan screen currently passes only a `photoUri`, so measurements are entered/adjusted manually and saved with `measurement_source` metadata. The downstream consumer is `sizeRecommender`, which combines stored measurements with each product's size chart on the product detail screen.

---

## Part 3: Data Flow — Three Core User Flows

### 3.1 Browse → Reserve (rental with downpayment)

1. `(tabs)/index` or `(tabs)/explore` reads `products` (and `categories`) and renders the catalog.
2. Tapping a card opens `product/[id]`, which reads `products` + `inventory` (stock per size/color) and, if signed in, `profiles` + `user_measurements` to show a size recommendation via `recommendSize()`.
3. "Reserve" opens `reserve/[id]`: it re-reads the product, and `TimeSlotPicker` queries `reservations` for the chosen date to compute slot availability.
4. The user picks a receipt image (`expo-image-picker`); on submit, the image is uploaded to the private `payment_receipts` bucket under `userId/timestamp.ext`.
5. The screen inserts a `reservations` row (status `Pending`, 50% deposit, generated `display_id`); RLS ensures `customer_id = auth.uid()`. A local reminder notification is scheduled.
6. Later, when staff change the reservation status (admin side), a database webhook fires the `notify-status` Edge Function, which inserts a `notifications` row (shown in the Inbox tab) and sends an Expo push. The user sees the reservation in `reservations.tsx`.

*The purchase variant:* `product/[id]` → `CartContext.addToCart` (AsyncStorage) → `cart.tsx` → `checkout.tsx`, which validates address/date and calls the `create_order` RPC; the database creates `orders` + `order_items` atomically with server-computed prices; the client clears the cart and routes to `orders/[id]`.

### 3.2 Body Scan → Measurements → Size Recommendation

1. `profile/measurements` (opened from Profile) loads existing data from `profiles` (fit preference, gender) and `user_measurements`.
2. "Scan" navigates to `profile/body-scan` with height/weight params. A `ConsentModal` collects explicit biometric-processing consent before the camera activates.
3. `expo-camera` shows the front camera; `TiltGuide` (accelerometer) and a silhouette overlay gate the capture; `expo-speech` gives spoken guidance and a countdown; a photo is captured.
4. Control returns to `profile/measurements`, where values are confirmed/edited manually. On save: `profiles.fit_preference` is updated and a sanitized payload (via `sanitizeForStorage`) is upserted into `user_measurements` (JSON `measurements`, `scan_confidence`, `per_field_confidence`, `measurement_source`), keyed on `user_id`.
5. On any `product/[id]` visit thereafter, `recommendSize(userMeasurements, product.measurements, fitPreference)` runs locally and displays the recommended size badge, closing the loop.

### 3.3 Message the Boutique (realtime chat)

1. `(tabs)/messages` (Inbox) lists `notifications` and the user's conversations from `MessagesContext`.
2. Starting a chat calls `getOrCreateConversation()`, which finds or inserts the user's `conversations` row (one conversation per customer, RLS-scoped).
3. `messages/[conversationId]` loads the thread from `messages` and subscribes to a Realtime channel filtered to that conversation; `MessagesContext` separately subscribes to `conversations` changes to keep the list and unread badge fresh (both tables are in the `supabase_realtime` publication).
4. `sendMessage()` inserts a `messages` row, then updates the parent conversation's `last_message` / `last_message_time`. Image attachments are uploaded to storage first and sent as a URL.
5. Opening a thread triggers `markAsRead()`: resets `conversations.unread_count` and stamps `read_at` on unread incoming messages. The staff side (a separate admin app) sees the same rows via its admin RLS policies; the tab badge updates live via the subscription.

---

## Part 4: Recommendations (Technical Audit)

For development use — ordered roughly by impact.

### 4.1 Correctness / integrity

1. **Body-scan ML pipeline is not wired end-to-end.** `body-scan.tsx` captures a photo and navigates with `photoUri`, but `measurements.tsx` only consumes `scanData` when `scanned === 'true'` — which nothing sets. The photo is never processed; `poseDetector`, `bodyEstimator`, `burstAverager`, and `PoseLandmarkOverlay` are dead code paths, and `react-native-vision-camera` / `react-native-fast-tflite` / worklets are unused native dependencies inflating the build. Either complete the TFLite integration or remove the unused deps and document the scan as guided-manual-entry.
2. **Chat images upload to the public `products` bucket** (`messages/[conversationId].tsx:141`). Private conversation attachments land in a bucket meant for catalog imagery with public URLs. Create a `chat-images` bucket with participant-scoped RLS.
3. **Two inconsistent write paths for commerce.** Checkout correctly goes through the server-side `create_order` RPC (prices computed in-DB), but reservations are a **direct client insert** with client-computed `deposit`, `rental_price`, and a `Date.now()`-based `display_id`. A tampered client could write arbitrary prices. Move reservation creation to an RPC or add DB-side checks/triggers mirroring the order hardening.
4. **Non-atomic messaging writes.** `sendMessage` inserts the message, then separately updates the conversation; a failure between the two leaves a stale `last_message`. `unread_count` is also maintained client-side (the code itself notes a DB trigger should own this). A trigger on `messages` insert would fix both.
5. **`profiles` is world-readable** ("Enable read access for all users"), exposing emails and push tokens of all users to any authenticated (or anonymous) client. Restrict to owner + admin, or a limited public view. Also, one update policy matches "based on email" while the app updates by `id` — verify it actually permits the intended writes.

### 4.2 Coupling and consistency

6. **Screens call Supabase directly (~30 call sites).** Only auth, wishlist, and messaging are mediated by contexts; products, reservations, orders, wardrobe, reviews, and measurements queries are embedded in screen components. This duplicates query logic (e.g. `products` fetched in 8+ files) and makes schema changes ripple through the UI. Introduce a thin `src/services/` layer (or React Query) per feature area.
7. **Persistence pattern is inconsistent across sibling features.** Wishlist is server-persisted with optimistic updates; Cart is AsyncStorage-only (lost on device change, no cross-device sync, no stock validation until checkout). Acceptable for a capstone, but document it as a deliberate trade-off.
8. **Redundant RLS policies from stacked migrations** — e.g. `user_measurements` has 9 overlapping policies, `orders`/`order_items` 6, and `wardrobe_items`/`saved_outfits` pair a broad "all authenticated users" policy with a stricter owner-only one (the broad one wins, since RLS policies are OR-ed — this currently makes wardrobe data readable by any authenticated user). Consolidate to one policy per operation.
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

*Sources: repository at commit `74795f7` (branch `main`); live Supabase schema and `pg_policy` catalog queried 2026-07-19; `docs/FREE_TIER_AUDIT.md` for cost-constraint rationale.*
