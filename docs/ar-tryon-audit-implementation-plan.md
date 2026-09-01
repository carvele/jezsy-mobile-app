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
| Fixed and merged to `main` today | 6 |
| Still open | 21 |
| Critical (open) | 1 |
| High (open) | 10 |
| Medium (open) | 8 |
| Low (open) | 2 |

None of today's fixes have been verified on a physical device yet — the branch
they shipped on (`feat/phase3-real-camera-calibration`) was merged specifically so
a co-dev's device could pick it up from `main` and verify, since the device this
session had access to dropped its USB connection. **Do not treat anything below as
"working" — only as "reasoned through and merged."** Device verification is the
next real gate, independent of this plan.

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

## Open — Critical

### 1. `unprojectToZ0` assumes viewport-normalized landmarks; camera preview uses `cover` cropping
**`src/components/AR/GarmentRenderer.tsx:498`**

Landmarks are normalized to the *camera frame*, but the preview renders that frame
with `cover` cropping (web `<video>` `objectFit: 'cover'`, native vision-camera's
default `resizeMode: 'cover'`) — center-cropping whichever axis doesn't match the
container's aspect ratio. `unprojectToZ0` maps landmark `[0,1]` coordinates
straight to viewport NDC, i.e. a "stretch to fill" mapping, against a preview that
actually does "crop to fill." Whenever the container aspect ratio differs from the
video's own aspect ratio, on-screen garment position is offset from where the
tracked body actually is. When calibrated, this is also internally inconsistent:
`camera.fov` is the frame's real vertical FOV, but the *horizontal* FOV comes from
the WebView's own aspect ratio rather than `videoWidthPx`/`videoHeightPx`.

**Why not fixed today:** this is foundational camera-projection math, not a
localized bug. A rushed fix without device feedback risks trading one systematic
misalignment for another — exactly the mistake this session already spent real
time recovering from once (the diagonal-vs-horizontal FOV assumption). Needs a
live device to verify any fix actually converges.

**Recommended approach:** derive the effective visible crop region from
`videoWidthPx`/`videoHeightPx` vs. the WebView's own aspect ratio, remap landmark
`nx, ny` into that visible region's own normalized space before feeding
`unprojectToZ0`, and set `camera.aspect` from the *video's* aspect ratio (not
`window.innerWidth/innerHeight`) so the calibrated horizontal FOV is actually
correct. Verify with a physical reference object at a known distance before/after.

---

## Open — High

### 2. `exactScale` double-corrects for torso yaw
**`src/components/AR/GarmentRenderer.tsx:559`**

`targetWorldWidth` is the on-screen shoulder separation unprojected onto the
`z=0` plane — it already shrinks by `cos(yaw)` when the wearer turns.
`exactScale = targetWorldWidth / garmentMetricWidth` is then applied to
`garmentGroup`, whose quaternion is the *full* torso orientation, which
foreshortens the garment's own shoulder line by `cos(yaw)` a second time. Net
effect: the garment renders progressively too narrow as the wearer turns away
from the camera, worse than either correction alone would produce.

**Recommended approach:** either normalize `targetWorldWidth` by `cos(yaw)`
before computing `exactScale` (so scale reflects the true, un-foreshortened
width), or drop the yaw component from what's applied to `garmentGroup`'s
rotation and let the projected width alone carry the foreshortening. Requires
the same live-verification caution as #1 — deferred for the same reason.

### 3. `rollRad` computed in MediaPipe Y-down space, consumed as canonical Y-up
**`src/utils/poseConstructor.ts:46`**

`poseConstructor` derives `rollRad` directly from the raw MediaPipe frame
(Y-down image coordinates), but `garmentFitter` turns that same angle into a
rotation about canonical +Z (Y-up) and feeds it to `GarmentRenderer` as
`orientation3D`. The two conventions differ by an exact sign flip — the garment
rolls the wrong direction specifically whenever the torso basis is invalid and
this fallback path is exercised (see also #10 below, same invalid-torso trigger).

**Recommended approach:** negate `rollRad` at the point it crosses from
MediaPipe's Y-down frame into canonical Y-up space, or make the sign convention
explicit with a named constant so the next person touching this code doesn't
reintroduce the same mixup. Should be a small, well-contained fix — a good
candidate for the next work session, verified against a real turned-torso pose.

### 4. Native world landmarks silently dropped by `normalizePose`'s visibility gate
**`src/utils/poseNormalizer.ts:231`**

`normalizePose` gates each joint on `p.visibility ?? 0` against
`MIN_JOINT_VISIBILITY`. The AR screen hands it native world landmarks whose
`visibility` key the native bridge omits whenever MediaPipe's internal Optional
is empty — exactly the case the *other* two call sites already defend against
with `?? presence ?? 0`. This one doesn't, so a joint MediaPipe is actually
tracking (via `presence`) can be silently treated as invisible and discarded.

**Recommended approach:** apply the same `?? presence ?? 0` fallback already
used elsewhere in this file. Small, mechanical, low-risk — good candidate to
batch with #3.

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

### 6. Roll rotation double-counted on arm bones when torso basis is invalid
**`src/utils/skeletalRetargeter.ts:109`**

When `canonicalPose.torso.valid` is false (hips out of frame or low visibility —
common at try-on framing distance), `garmentFitter` rotates the whole garment
group by the shoulder-derived roll quaternion, but `skeletalRetargeter`'s
`localDir()`/`toTorsoLocal()` silently stops removing that same rotation from
arm-direction vectors. The roll ends up baked into both the parent group and the
child bone — compounding, not just duplicating.

**Recommended approach:** the invalid-torso fallback path needs a single,
explicit decision about who owns roll correction (group or bones), not two
independent code paths that each assume the other isn't also applying it. Same
root trigger as #3 (invalid torso basis) — worth investigating together.

### 7. AR try-on size recommendation runs category-blind
**`app/ar-tryon/[id].tsx:357`**

`recommendSize(sizingMeasurements, product.measurements as any, fitPreference)`
omits the 4th `category` argument that the sibling call site in
`app/product/[id].tsx` passes. Every AR try-on size recommendation silently runs
with `category=''`, disabling whatever shoulder/inseam matching logic branches
on garment category.

**Recommended approach:** pass `product.category` (or whatever field the
`product/[id].tsx` call site uses) through. Small, mechanical, should be one of
the first things fixed next session — real user-facing correctness bug with an
obvious, low-risk fix.

### 8. GLB load failure has no user-visible signal
**`src/components/AR/GarmentRenderer.tsx:410`**

`GLTFLoader`'s error callback only logs to the WebView's own console (relayed to
Metro via the temporary debug channel) — no prop, message type, or any other
channel back to React Native. A garment that fails to load leaves the user
staring at a bare camera feed with zero indication anything went wrong.

**Recommended approach:** add a `SET_LOAD_ERROR`-style message (mirroring the
`SET_CAMERA_CALIBRATION`/`SET_FIT_MODIFIER` pattern already in place) and surface
a real error state in the React screen — a toast or inline banner, not silence.

### 9. 3D Studio mode's error banner is unstyled and effectively invisible
**`app/ar-tryon/[id].tsx:846`**

The 3D Studio WebView's `<style>` block defines no rules for `#error-state`,
`.visible`, `#controls-bar`, or `#hint`. When `model-viewer`'s error handler
fires and adds the `visible` class, nothing makes the fallback message legible —
default-black text with no background/positioning against a near-black page.

**Recommended approach:** add the missing CSS rules. Cosmetic but real — a user
hitting this path currently sees nothing at all.

### 10. `modelUrl` escaped for an HTML attribute, consumed inside a JS string literal
**`src/components/AR/GarmentRenderer.tsx:285`**

`[id].tsx` applies `escapeAttr` to `modelUrl` for its own `model-viewer`
`src="..."` attribute use, and passes that *same escaped string* to
`GarmentRenderer`, which drops it into a single-quoted JS string inside
`<script>` — a context where HTML character references (`&amp;`, `&#39;`, etc.)
are not decoded. If `modelUrl` contains a character `escapeAttr` encodes, the
literal encoded text (not the real character) ends up in the GLB fetch URL.

**Recommended approach:** `GarmentRenderer` should receive the raw URL and apply
its own JS-string-literal-safe escaping (or `safeStringify()`, already added
today for the `boneMap`/`anchorOffset` fix), independent of whatever escaping the
caller applied for its own, different context.

---

## Open — Medium

### 11. Scene failures never reach React
**`src/components/AR/GarmentRenderer.tsx:865`**

The WebView→React channel exists but currently only `console.log`s. GLB load
failure, CDN failure, and uncaught `init()` errors all leave the user on a live
camera feed with no garment and no error UI — the "AI Body Tracking Active" pill
still shows green. Same underlying gap as #8/#9 above; worth fixing together as
one pass on error surfacing.

### 12. Total pose-tracking loss never clears tracking state
**`app/ar-tryon/[id].tsx:554`**

When the pose detector returns zero landmarks (person leaves frame, camera
covered, poor lighting), `handlePoseResults` is never invoked on either
platform, so `isTrackerActive` and the garment's position/scale/rotation
`SharedValue`s freeze at their last value indefinitely instead of reflecting
that tracking has actually stopped.

### 13. Camera/GPU inference not stopped when the app backgrounds
**`app/ar-tryon/[id].tsx:1028`**

`isActive` is gated only on navigation focus (`useFocusEffect`), never on app
foreground state. `react-native-vision-camera` drives its capture session purely
from the `isActive` prop, not the host Activity lifecycle — backgrounding the
app while this screen is focused likely keeps the camera and GPU pose inference
running. Battery and (given this reads camera frames) privacy-relevant; worth
prioritizing above other medium items for that reason.

### 14. Pose-match state (`isMatched`, `matchScore`, `matchFeedback`) never written
**`app/ar-tryon/[id].tsx:239`**

`setIsMatched`, `setMatchScore`, `setMatchFeedback` are declared but never
called anywhere in the file. `isMatched` is permanently `false`,
`matchFeedback` permanently stuck at its initial value — every UI path and
effect gated on them is dead code. Either this is a real, unfinished feature
(finish it) or genuinely dead (remove the state and whatever renders off it).
Needs a decision, not just a fix.

### 15. `usePoseDetection`'s return identity churns every render
**`app/ar-tryon/[id].tsx:641`**

`onResults`/`onError` are inline literals recreated every render; the library
chains them through several layers of `useMemo`/`useCallback` that all
transitively depend on that fresh identity, so `poseDetection` (and therefore
the `[device, poseDetection]` effect dependency) never stabilizes. Same class of
issue an earlier, narrower review already flagged as a low-severity nit for the
`cameraDeviceChangeHandler` effect specifically — this is the same root cause,
described at the source. Bounded impact (extra calls to idempotent setters), but
worth fixing at the root (memoize the callbacks object) rather than patching
each downstream symptom separately.

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

### 18. `ingestionStatus` captured but never checked before treating a garment as ready
**`app/ar-tryon/[id].tsx:296`**

The AR screen branches only on `if (product.garment_metadata)` truthiness and
never inspects the mapped `ingestionStatus` field before using
`boneMap`/`anchorOffset`/`restPoseMetricWidth` for a real render — including
whatever `'NEEDS_CALIBRATION'` status this session's earlier admin-dashboard work
added specifically to flag incomplete ingestion.

---

## Open — Low

### 19. `useSizingProfile`'s cancellation flag is set but never read
**`src/hooks/useSizingProfile.ts:76`**

The effect's cleanup sets `cancelled = true`, but `load()` never checks it
before calling its setters — an in-flight Supabase load always commits its
result, including after unmount or after a newer load has already superseded it.

### 20. Wasted per-frame `Matrix4` allocation for an occlusion uniform that's never rendered
**`src/components/AR/GarmentRenderer.tsx:428`**

The render loop clones two `THREE.Matrix4` objects every frame to feed
`occlusionMaterial.uniforms.uViewProj`, but `occlusionMesh` (the only consumer)
is never added to the scene (`scene.add(occlusionMesh)` is commented out) — this
allocation and matrix multiply runs for the component's entire lifetime with no
rendering effect. Trivial to delete once occlusion (Phase 4) is either
implemented for real or the dead scaffolding is removed.

### 21. `garment_metadata` migration has no matching rollback file
**`supabase/migrations/20260827081008_add_garment_metadata_to_products.sql`**

Every sibling migration in the same window ships a matching `.rollback.sql`;
this one doesn't — a direct gap against this repo's own documented migration
convention. Cheapest fix in this entire list; should be done first regardless of
anything else in this plan.

---

## Recommended sequencing

This is a lot of surface area for one pass. Suggested phasing for whoever picks
this up next:

**Phase A — cheap, safe, mechanical (no device needed, do anytime):**
#21 (missing rollback file), #7 (missing category arg), #4 (visibility fallback),
#9 (unstyled error banner), #19 (unused cancellation flag), #20 (dead occlusion
allocation).

**Phase B — device-verification-gated correctness (the actual next session):**
#1 and #2 first (the two deepest geometry bugs — they compound with each other
and with everything already shipped today, so verifying them together against a
real device is more efficient than one at a time), then #3 and #6 (the two
roll/yaw sign-and-double-count bugs, same invalid-torso trigger, worth
investigating as one pair).

**Phase C — error surfacing (one coherent pass, not device-dependent to build,
device-dependent to verify):**
#8, #10 (this plan's #10), #11 — all "failure happens silently" gaps in the same
WebView→React channel; naturally one PR.

**Phase D — lifecycle/resource hygiene:**
#12, #13 (privacy/battery — do this one specifically before any wider rollout),
#15.

**Phase E — needs a product/measurement-science decision, not just code:**
#5 (body-ratio scale convention), #14 (finish or remove pose-match feature).

**Deferred, not in this plan:** removing the temporary debug instrumentation
(`[CAL-DEBUG]`, `[WEBVIEW-RELAY]` console relay, `showDebug()` calls) — still
needed until Phase B is actually verified on a device. Remove only after that.
