# AR Try-On Audit — Implementation Plan

Date: 2026-09-01
Scope: `app/ar-tryon/[id].tsx`, `src/components/AR/GarmentRenderer.tsx`, the pose
pipeline (`poseDetector.ts`, `poseNormalizer.ts`, `poseConstructor.ts`,
`webPoseDetection.ts`, `nativeVision.ts`), fit/retarget math (`poseMatcher.ts`,
`garmentFitter.ts`, `skeletalRetargeter.ts`), and the data layer
(`useSizingProfile.ts`, `garment.ts`, the `garment_metadata`/`ar_data` migrations).

Produced by a 10-dimension automated review (renderer scene math, renderer↔WebView
bridge, screen lifecycle, pose pipeline, platform parity, fit/retarget math,
resource lifecycle, data layer, error degradation, security/privacy), followed by
independent two-lens adversarial verification (correctness + reachability) on every
raw finding. 39 raw findings → 27 confirmed, 4 refuted as not real or not reachable.

## Status at a glance

| | Count |
|---|---|
| Confirmed findings | 27 |
| Fixed and merged to `main` (2026-09-01, PR #179 batch) | 6 |
| Fixed, local commits on `main`, not yet pushed (2026-09-01, session 2) | 17 |
| Still open | 4 |
| Critical (open) | 0 |
| High (open) | 2 |
| Medium (open) | 1 |
| Low (open) | 1 |

**None of the fixes below have been verified on a physical device yet.** The
device this session had access to dropped its USB connection; session 2's
fixes are 5 local commits on `main`, not yet pushed. **Do not treat anything
in this document as "working" — only as "reasoned through and merged."**
Device verification is the next real gate, independent of this plan. See
`docs/CURRENT_AR_STATE.md` for the current authoritative state (commit list,
DB contract, latest test results) — this file is the historical audit record.

---

## Already fixed (merged to `main` 2026-09-01)

These shipped across four PRs today: #179 (Phase 3 camera calibration + fixes
found while verifying it), #180 (pre-existing lint failure, unrelated), #181
(measurements data-loss bug), #182 (OAuth callback route, unrelated to AR but
found and fixed the same session).

1. **Camera sensor orientation never reached MediaPipe.** `forceOutputOrientation`
   wasn't passed to `usePoseDetection`, so a landscape-mounted front sensor's
   buffer was never rotated before pose detection — landmarks came back in the
   raw sensor frame. Traced into the pose-detection library's own Kotlin source
   to confirm the exact parameter that reaches `detector.detectLiveStream()`.
2. **`format` computed but never applied to `<Camera>`.** `useCameraFormat` was
   queried but the result was never passed as the `format` prop, so the actually
   running camera format could silently differ from what calibration math assumed.
3. **Distance triangulation instability.** Was measuring only the X-component of
   shoulder-landmark separation (collapsed toward zero on a turned/occluded pose,
   inflating computed distance); now uses true 2D pixel distance, rejects
   non-frontal frames, clamps per-frame movement, and tightened the plausible
   distance range so one bad bootstrap frame can't anchor the filter far from
   reality.
4. **`videoWidthPx`/`videoHeightPx` transposed after the orientation fix.** Once
   MediaPipe correctly rotates the buffer, landmarks are normalized against the
   *rotated* frame, but calibration was still using the raw sensor's (unrotated)
   dimensions for pixel-scale math — now swaps width/height when the sensor mount
   implies a 90/270° rotation.
5. **`CAMERA_CALIBRATION` and `FIT_MODIFIER` baked into the WebView's HTML
   source string.** Both depend on the same async Supabase sizing profile, so
   every time either resolved, the whole WebView reloaded (GLB refetch, bind
   poses re-captured, all smoothing state reset) — right as calibration became
   usable. Both now arrive by `postMessage` after mount.
6. **Load-time `Box3` measured in world space, not model space.** The GLB's
   bounding-box measurement ran *after* the model was parented under
   `garmentGroup`, so it measured through `garmentGroup`'s live tracked
   position/rotation/scale instead of the model's own rest-pose size whenever
   pose tracking started before the async GLB finished downloading. Reordered to
   measure before parenting.
7. **`restPoseMetricWidth` interpolated with no validation.** A malformed DB
   value could produce invalid JS in the injected `<script>` tag and crash the
   whole renderer, not just mis-scale one product. Validated the same way
   `fitModifier` already was.
8. **`</script>` breakout via `JSON.stringify(metadata.boneMap)`.** DB-controlled
   JSONB serialized into an inline `<script>` tag without escaping `<`, so a
   value containing `</script` could break out of the script element. Added a
   shared `safeStringify()` escape helper, applied to all four interpolation
   sites that serialize `metadata` into the injected script.
9. **Bootstrap distance never had a fallback.** `camera.position.z` stayed at
   the old uncalibrated convention (5) indefinitely if no triangulation frame
   ever passed the frontality/plausible-range guards, silently pairing a real
   calibrated FOV with a fictitious 5-metre distance. Now seeds a plausible
   handheld-selfie default (0.6m) as soon as calibration itself arrives.
10. **Tracker-active pill strobing.** A per-frame `setIsTrackerActive(true)`
    (added to fix the pill never showing on native) fought a throttled ~5Hz
    setter writing real pose fitness. Latched to fire once, matching web's
    `onTrackerReady` semantics.
11. **Pre-existing `translateZ` TypeScript error** blocking CI on every PR
    regardless of content — RN's `ViewStyle` transform type has no
    `perspective`/`translateZ` members, doesn't model RN-Web's extended CSS
    transform support used here. Cast to `any` at the one call site.
12. **Measurements screen nulled saved data on every body-scan-return save.**
    Unrelated to AR directly but found investigating why a saved `shoulderWidth`
    (required for calibration) kept disappearing. `fromScan` skipped the DB read
    entirely, so any field a scan doesn't produce (armLength, torsoLength,
    legLength, inseam, shoulderWidth — a scan only ever yields bust/waist/hips)
    got written as `null` over real prior values on every single scan-return
    save. Now merges DB values into whatever the scan didn't provide.
13. **OAuth callback "Unmatched Route".** Same class of bug already fixed once
    for PayMongo returns (`payment-return.tsx`) — Android delivers the OAuth
    deep link to the OS even though `WebBrowser.openAuthSessionAsync` also
    catches it, and with no route at `auth/callback` expo-router showed its
    unmatched-route screen right after a successful sign-in.

---

## Fixed (session 2, 2026-09-01 — local commits on `main`, not yet pushed)

Findings #1–#4, #6–#13, #15, #18, #19–#21 below were fixed following this
plan's own "Recommended approach" per finding. **Not verified on a physical
device** — see the status table above. Commit references are on local `main`.

### 1 (was Critical). `unprojectToZ0` cover-crop mismatch
**`src/components/AR/GarmentRenderer.tsx`** — commit `f73034f`

Fixed via `getCameraAspect()`/`mapCoverCrop()`: derives the visible crop region
from `videoWidthPx`/`videoHeightPx` vs. window aspect, remaps landmarks into it
before `unprojectToZ0`, and sets `camera.aspect` from the real video aspect.
Exactly the approach this plan recommended. **Needs a physical reference
object at a known distance to confirm convergence** — this was the plan's
highest-risk deferred item; treat as unverified until tested.

### 2 (was High). `exactScale` double-corrects for torso yaw
**`src/components/AR/GarmentRenderer.tsx`** — commit `f73034f`

Fixed by normalizing `targetWorldWidth` back out by `cos(yaw)` (derived from
the `rot` quaternion passed into `UPDATE_TRANSFORM`, same 0.65 floor
convention as `garmentFitter`'s 2D path) before computing `exactScale`, so
foreshortening applies once (via the 3D rotation) instead of twice. Unverified
on device — recommended to test together with #1 since they compound.

### 3 (was High). `rollRad` Y-down/Y-up sign mismatch
**`src/utils/garmentFitter.ts`** — commit `5f58cb3`

Fixed by negating `rollRad` at the Y-down → Y-up handoff, named explicitly as
`CANONICAL_Y_UP_ROLL_SIGN`, applied only to the 3D fallback quaternion
(`rollQuat3D`) — the 2D legacy overlay's `rollQuat` is untouched since it wants
the original Y-down convention. Unverified against a real turned-torso pose.

### 4 (was High). Missing `presence` fallback in `normalizePose`
**`src/utils/poseNormalizer.ts`** — commit `5f58cb3`

Fixed: `p.visibility ?? (p as any).presence ?? 0`, matching the fallback the
other two call sites already used.

### 6 (was High). Roll double-counted on arm bones, invalid torso
**`src/utils/skeletalRetargeter.ts`** — commit `5f58cb3`

Fixed by giving `calculateBoneRotationsFromCanonical` an optional
`fallbackRollRad` parameter: when torso is invalid, it builds the same
roll-only fallback quaternion `garmentFitter` applies at the group level and
uses it (via `toTorsoLocal`) to cancel that roll out of arm-direction vectors,
so group and bones agree on a single owner instead of each assuming the other
isn't applying it. Call site (`[id].tsx`) passes `pose.orientation.rollRad`.
Unverified — same invalid-torso trigger as #3, recommended to test together.

### 7 (was High). AR size recommendation ran category-blind
**`app/ar-tryon/[id].tsx`** — commit `fe36506`

Fixed: `recommendSize(...)` now passes `product?.category` as the 4th arg,
matching the sibling `app/product/[id].tsx` call site.

### 8 (was High). GLB load failure had no user-visible signal
**`src/components/AR/GarmentRenderer.tsx`** — commit `f73034f`

Fixed together with #11 via a shared `notifyLoadError()` → `postMessage`
bridge (native `ReactNativeWebView.postMessage`, web `window.parent.postMessage`)
and a new `onLoadError` prop, wired to a visible banner in `[id].tsx` (commit
`fe36506`).

### 9 (was High). 3D Studio error banner unstyled
**`app/ar-tryon/[id].tsx`** — commit `fe36506`

Fixed: added the missing `#error-state`/`.visible`/`#controls-bar`/`#hint` CSS
rules to the 3D Studio WebView's `<style>` block.

### 10 (was High). `modelUrl` double-escaping mismatch
**`src/components/AR/GarmentRenderer.tsx`** / **`app/ar-tryon/[id].tsx`** — commits `f73034f`, `fe36506`

Fixed: `GarmentRenderer` now receives the raw (unescaped) URL from `[id].tsx`
and applies its own JS-string-literal-safe escaping via the existing
`safeStringify()` helper, instead of reusing the HTML-attribute-escaped string
built for the separate 3D Studio `model-viewer` `src="..."` use.

### 11 (was Medium). Scene failures never reached React
**`src/components/AR/GarmentRenderer.tsx`** — commit `f73034f`

Fixed together with #8 — see above. `window.onerror`/`unhandledrejection`
handlers now also call `notifyLoadError()`.

### 12 (was Medium). Total pose-tracking loss never cleared state
**`app/ar-tryon/[id].tsx`** — commit `fe36506`

Fixed: the native zero-landmark early-return now runs the same debounced-loss
hysteresis `handlePoseResults`' own else-branch already applies (decay
position/scale/rotation, clear `isTrackerActive`), instead of freezing state
indefinitely.

### 13 (was Medium, privacy/battery-priority). Camera/GPU not stopped on background
**`app/ar-tryon/[id].tsx`** — commit `fe36506`

Fixed: `<Camera isActive>` now also gates on `AppState` (`isAppActive`), not
just navigation focus. Not audited for whether the MediaPipe detector session
itself also needs an explicit stop/release call — flagged in
`docs/CURRENT_AR_STATE.md`.

### 15 (was Medium). `usePoseDetection` return identity churned every render
**`app/ar-tryon/[id].tsx`** — commit `fe36506`

Fixed: `onResults`/`onError` extracted to `useCallback`s
(`onNativePoseResults`/`onNativePoseError`), combined via a `useMemo`'d
`poseDetectionCallbacks` object, exactly the "memoize the callbacks object"
approach this plan recommended.

### 18 (was Medium). `ingestionStatus` never checked before rendering
**`app/ar-tryon/[id].tsx`** — commit `fe36506`

Fixed: the screen now gates real rendering on
`ingestion_status === 'AR_READY'`, falling back to demo-rig metadata for
anything else. Also added the missing `'NEEDS_CALIBRATION'` value to this
repo's `IngestionStatus` type (`src/types/garment.ts`, commit `5f58cb3`),
which admin-dashboard's ingestor already wrote but this repo's type lacked.

### 19 (was Low). `useSizingProfile` cancellation flag never read
**`src/hooks/useSizingProfile.ts`** — commit `e184025`

Fixed: cancellation tracked via a ref (`cancelledRef`) instead of a closed-over
local, checked before every state-setting point in `load()`.

### 20 (was Low). Dead per-frame `Matrix4` allocation
**`src/components/AR/GarmentRenderer.tsx`** — commit `f73034f`

Fixed: removed — `occlusionMesh` is never added to the scene, so the
`uViewProj` computation had no consumer.

### 21 (was Low). Missing migration rollback file
**`supabase/migrations/20260827081008_add_garment_metadata_to_products.rollback.sql`** — commit `b754147`

Fixed: added, drops the `garment_metadata` column.

---

## Open — High

### 5. Body-ratio measurements inflated ~14% by a scale-convention mismatch
**`src/utils/poseDetector.ts:282`**

`extractBodyRatios` normalizes by the nose-to-ankle polyline span, but
`measurementCalculator` converts those ratios to centimeters using the user's
*full height* — an implicit assumption that the visible nose-to-ankle span
equals full stature, which it structurally doesn't (stature includes the
head above the nose and the foot below the ankle). Affects every
ratio-derived measurement (this is the body-scan measurement pipeline, feeds
the same `user_measurements` table the AR calibration and sizing depend on).

**Recommended approach:** either normalize by a span that matches full stature
in the reference data used to build the ratios, or apply a correction factor
for the head+foot delta. Needs real anthropometric reasoning, not a guess —
flag for whoever owns the body-scan measurement math.

---

## Open — Medium

### 14. Pose-match state (`isMatched`, `matchScore`, `matchFeedback`) never written
**`app/ar-tryon/[id].tsx:239`**

`setIsMatched`, `setMatchScore`, `setMatchFeedback` are declared but never
called anywhere in the file. `isMatched` is permanently `false`,
`matchFeedback` permanently stuck at its initial value — every UI path and
effect gated on them is dead code. Either this is a real, unfinished feature
(finish it) or genuinely dead (remove the state and whatever renders off it).
Needs a decision, not just a fix.

### 16. Web pose path never smooths `worldLandmarks`; native does
**`app/ar-tryon/[id].tsx:132`**

`WebCameraFeed`'s `detectLoop` passes MediaPipe's raw, unfiltered
`worldLandmarks` straight into `handlePoseResults`, while the native `onResults`
handler runs the equivalent data through `PoseLandmarkFilter.filterWorldLandmarks`
first. Since 3D torso orientation and bone-rotation math is shared code fed by
`worldLandmarks`, native gets smoothed depth data and web gets raw jittery depth
data — a real platform-parity gap, though web is explicitly out of scope per this
session's "native-only" Phase 3 decision, so lower urgency than it would
otherwise be.

### 17. `cosYaw` floor causes scale to shrink past ~49° of yaw instead of saturating
**`src/utils/garmentFitter.ts:58`**

The yaw-foreshortening correction clamps `cos(yaw)` to a floor of 0.65 but keeps
*dividing* the observed apparent width by that constant floor — so once true yaw
exceeds `arccos(0.65)` (~49°), the corrected width keeps shrinking with further
yaw instead of holding steady at the clamped value. Nothing degrades the overlay
to hide this from the user.

---

## Remaining sequencing

Everything device-independent or mechanical is done (Phases A–D from the
original plan). What's left all needs a product/measurement/numerical
decision, not just a code fix:

- **#5** (body-ratio scale convention) — needs real anthropometric reasoning;
  flag for whoever owns the body-scan measurement math.
- **#14** (finish or remove pose-match feature) — needs a product decision.
- **#17** (`cosYaw` saturation) — the literal "hold steady" fix needs either
  cross-frame state or a different numerical model; not attempted.
- **#16** (web smoothing parity) — deliberately deferred, native-only scope
  decision stands.

Independent of all of the above: **get physical device access and verify**
everything in the "Fixed (session 2)" section above, starting with #1/#2
together (they compound), then #3/#6 together (same invalid-torso trigger).
This is the real next gate — see `docs/CURRENT_AR_STATE.md` for the full
current-state summary and exact next steps.

**Deferred, not in this plan:** removing the temporary debug instrumentation
(`[CAL-DEBUG]`, `[WEBVIEW-RELAY]` console relay, `showDebug()` calls) — still
needed until Phase B is actually verified on a device. Remove only after that.
