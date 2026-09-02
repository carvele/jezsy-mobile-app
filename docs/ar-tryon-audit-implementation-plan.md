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
| Confirmed findings (original audit) | 27 |
| Fixed and merged to `main` (2026-09-01, PR #179 batch) | 6 |
| Fixed, local commits on `main`, not yet pushed (2026-09-01, session 2) | 17 |
| Still open from original audit | 4 |
| New findings from device verification (2026-09-01/02, sessions 3-4) | 6 (#22-#27) |
| Fixed via JS-side compensation, confirmed live (2026-09-02, session 4) | 2 |
| Still open | 4 |
| Medium (open) | 2 |
| High (open) | 3 |
| Low (open) | 1 |

**Session 4 update: the two critical device-verification findings are fixed
and confirmed live** on the Infinix X6880 test device — see "Fixed (session
4...)" below. `roll` dropped from a pinned ~-90° to ~0-9°, camera distance
triangulation now varies realistically instead of being stuck at its
bootstrap seed, and the garment renders upright and centered instead of
edge-on/off-screen. This is a JS-side compensating rotation in
`app/ar-tryon/[id].tsx`, not a fix to the actual native library bug (#24,
downgraded to Medium) — `poseNormalizer.ts` remains fully correct and
untouched. **Do not treat this as "the AR feature now works" broadly** — it
is confirmed working on exactly one physical device (Infinix X6880); the
compensation's guard is designed to no-op on a device that doesn't have this
bug, but that has not itself been verified on a second device.

**Follow-up A/B confirmation, same night:** re-tested with the Black tee
(sane calibration data) immediately after the Cotton T-Shirt (broken
calibration, #25's sibling finding #26) — `exactScale` dropped from ~2.1-2.3
to ~1.19-1.22 with identical code, confirming the remaining oversizing was
entirely a data problem, not a residual math bug. Also fixed a related root
cause in the **separate `admin-dashboard` repo** (commit `a3eef9c`, not
pushed): its ingestion modal was silently marking anchor calibration as
merchant-confirmed on edits to fields unrelated to the anchor.

See `docs/CURRENT_AR_STATE.md` for the current authoritative state — this
file is the historical audit record.

**Methodology note:** tonight's device test used the pre-existing installed
dev-client APK (last built 2026-08-31 20:02) via Metro/JS-only reload, not a
fresh `expo run:android` native rebuild. Checked and ruled out as a
confound: `git log` shows no changes to `package.json` or `android/` between
that build and now, so the native binary is unaffected by dependency drift
— tonight's findings reflect genuine behavior of the current codebase, not
a stale-native-binary artifact.

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

## Fixed (session 4, 2026-09-02 — JS-side compensation, root cause still open in the native library)

Discovered testing the session-2 fixes on a physical Infinix X6880 (Android,
MediaTek) via wireless ADB + the Metro dev-client, on two products (Tailored
Blazer, Cotton T-Shirt). Raw debug logs (`[AR-DEBUG-TORSO]`, `[AR-DEBUG-FRAME]`,
`[CAL-DEBUG]`) were captured for both. Not caused by any session-2 fix — this
was the first physical-device data this feature has had.

### 22 (was Critical). Camera distance triangulation never activated on this device
**`src/components/AR/GarmentRenderer.tsx`** (the `SET_CAMERA_CALIBRATION`/`UPDATE_TRANSFORM` handler's triangulation block) — fixed as a side effect of #23's compensation

`cameraDistanceM` was logged as exactly `0.600` (the hardcoded bootstrap seed)
across all 352+ frames captured in session 3, on both products, despite the
wearer moving, turning, and changing distance from the camera. Real
triangulation's frontality guard (`Math.abs(dxPx) > Math.abs(dyPx)` between
the two shoulder landmarks) never passed on this device, because the
landmarks it read were rotated (see #23). Direct, confirmed consequence at
the time: the Cotton T-Shirt (whose `garment_metadata` is otherwise sane —
see finding #25's table) rendered 1.7-3.0x oversized (`exactScale` observed
ranging 1.35-3.0 across logged frames).

**Fixed, confirmed live**: after #23's landmark-rotation compensation was
applied, `cameraDistanceM` immediately began varying realistically with
actual distance (`0.867` to `1.015` across a live sequence, tracking real
movement) instead of being stuck at the bootstrap seed. No changes needed to
this file directly — the guard was correct all along, it was being fed bad
input.

### 23 (was Critical). Torso `roll` read approximately -90° regardless of actual body tilt
**Fixed with a JS-side compensating rotation in `app/ar-tryon/[id].tsx`, gated to only apply when needed — root cause remains in the native library, unfixed.**

Reproducible across dozens of frames, both products, multiple app restarts:
`[AR-DEBUG-TORSO]` logged `roll` in the -76° to -93° range continuously,
including while the wearer stood upright and square to the camera with
`pitch` and `yaw` both reading plausible, expected values. This is the exact
symptom the original `forceOutputOrientation` fix (PR #179) was written to
solve, reappearing on a different device.

**`poseNormalizer.ts`'s math verified correct by hand, then confirmed innocent
empirically.** Traced `quaternionFromBasis`/`torsoEulerDegrees` algebraically
for an ideal upright, camera-facing subject and confirmed the formula
correctly yields `roll=0°` for correctly-oriented input. Then instrumented
the raw landmarks at the exact point they leave the native pose-detection
callback (`onNativePoseResults`), before any processing in this repo touches
them:

```
world  l11={x:0.34-0.41, y:0.16-0.18}  l12={x:0.35-0.44, y:-0.14 to -0.16}
       dx ~ 0.005-0.032 (tiny)          dy ~ -0.32 (large, consistent)
normalized2D  l11={x:0.38, y:0.84}  l12={x:0.39, y:0.21}
              dx ~ 0.01-0.02 (tiny)  dy ~ -0.62 (large)
```

Both the 3D world landmarks and the 2D normalized landmarks were already
"stacked vertically" (near-zero dx, large dy) at the raw native-callback
boundary — before `poseNormalizer.ts`, before any TS in this repo ran. This
conclusively placed the bug inside MediaPipe / the native frame-processor
plugin, not in this repo's code.

**Confirmed NOT simply the `forceOutputOrientation` string value**:
live-swapping it from `device?.sensorOrientation` (`"landscape-right"` on
this device) to a hardcoded `'portrait'` changed the *visual* rendering
dramatically (garment went from oversized-but-upright to nearly edge-on) but
left the logged `roll` number statistically unchanged (-86.6° vs the
original -85° to -93° range) — so a single swapped enum value from this
repo's JS isn't the fix; the real defect is inside the native
plugin/MediaPipe's own orientation-resolution logic (see #24).

**Fix applied — a JS-side rotation compensation, not a native patch.**
Derived a proper 90° rotation `(x,y) -> (y,-x)` for world landmarks (and
`(x,y) -> (y, 1-x)`, i.e. the same rotation about the image center, for
normalized 2D landmarks) algebraically from ~30 captured live samples,
verified it reproduces the expected "left shoulder has larger X,
near-level Y" pattern against every one, then applied it directly in
`onNativePoseResults` (`app/ar-tryon/[id].tsx`), gated behind
`shouldCorrectNativeLandmarkRotation` — a runtime check that only applies
the correction when the shoulder landmarks show the "stacked vertically"
signature (`dy > 0.15 && dy > dx*2`), so a device that doesn't have this bug
is left untouched.

**Confirmed live, all three symptoms fixed simultaneously**, re-tested
on-device immediately after applying:
- `roll` dropped from a pinned ~-90° to ~0-9° (upright subject)
- `cameraDistanceM` started varying realistically (see #22)
- The garment rendered upright and centered on the wearer's shoulders
  instead of edge-on or off-screen (screenshot-verified, front-facing and
  turned-away poses both tested)

**What's still open:** this is a compensating workaround, not the real fix.
The actual defect is still inside `react-native-mediapipe-posedetection`'s
native code (see #24) and is unconfirmed on any device other than this one
Infinix X6880 — the runtime guard is deliberately conservative to avoid
misfiring on a device that doesn't have this bug, but that guard's
correctness on *other* devices is itself unverified. Whoever picks this up
next should not re-investigate `poseNormalizer.ts`, `garmentFitter.ts`, or
`skeletalRetargeter.ts` for this specific symptom — both are confirmed
correct. The remaining ~2.1-2.3x oversizing seen after this fix is a
separate, secondary scale-calibration question (real wearer shoulder width
vs. this garment's `rest_pose_metric_width`), not part of this finding.

---

## Open — Medium (native library root cause + product data)

### 24. Two disagreeing sensor-orientation values from the pose-detection library
**`react-native-mediapipe-posedetection`'s internals (third-party), surfaced via `[id].tsx`'s `usePoseDetection` config** — lower urgency now that #23's symptom is worked around, but the real fix belongs here

**Downgraded from the original session-3 priority**: #22/#23's symptoms are
now compensated for in `app/ar-tryon/[id].tsx` (see #23), so this is no
longer blocking AR try-on from working on the test device. Still worth
fixing properly, since the compensation is a workaround with an unverified
guard on other devices, not a real fix.

On this device, `device.sensorOrientation` (from vision-camera, what
`forceOutputOrientation` is set to) reports `"landscape-right"` consistently.
But the library's own internal `BaseViewCoordinator` independently computes
its `sensorOrientation` field as `"portrait"` or `"landscape-left"` for the
*same physical sensor* — logged at runtime, never once agreeing with
`"landscape-right"`. Leading root-cause candidate for #23 (see that finding
for the proof that the rotation happens before landmarks reach this repo's
own code, i.e. inside MediaPipe/the native plugin) and for #22. The #23
experiment shows a single swapped enum value isn't sufficient to fix it on
its own — the fix likely needs to address whichever of these two
orientation sources the native plugin actually consults, not just change
what value this repo passes in.

**Precise root cause found by reading the library's own source**
(`node_modules/react-native-mediapipe-posedetection/src/index.tsx` and
`src/shared/convert.ts`), not just inferred from logs. `BaseViewCoordinator`
is instantiated (`index.tsx:235-241`) with its `sensorOrientation`
constructor argument set to `forceCameraOrientation.value ?? frameOrientation.value`
— **not** `forceOutputOrientation`, which only ever reaches the *separate*
`outputOrientation` constructor argument (4th param). This app's
`usePoseDetection` call only ever sets `forceOutputOrientation`; it never
sets `forceCameraOrientation`. So `BaseViewCoordinator` falls back to
`frameOrientation` — a live, worklet-updated shared value defaulting to
`'portrait'` that this app never controls — for the exact orientation math
`convert.ts`'s `rotateNormalizedPoint()` uses. That function's `rotation:
90` branch (`{x: point.y, y: 1 - point.x}`) is the **identical formula**
`shouldCorrectNativeLandmarkRotation`/`correctNormalized2DLandmarkRotation`
independently derived and hand-verified in finding #23. The library already
has the correct rotation-correction logic built in; it's being fed the
wrong orientation value because of a missing option.

**Fix candidate, NOT verified — do not treat as done:** also set
`forceCameraOrientation: device?.sensorOrientation` (same value already
passed to `forceOutputOrientation`) in `[id].tsx`'s `usePoseDetection`
options. Attempted live tonight; the app hit an unrelated-looking crash
(`[runtime not ready]: TypeError: Cannot read property 'EventEmitter' of
undefined`) on the test device before a clean before/after comparison could
be captured, at 9% battery — inconclusive whether the crash was caused by
this change or by battery/power-saving throttling. **Reverted immediately
without keeping the change**, net no diff in the working tree. Needs a
clean re-attempt on a charged device: apply the change, confirm the app
still launches normally, then check whether `BaseViewCoordinator`'s logged
`sensorOrientation` now reads `"landscape-right"` consistently and whether
`shouldCorrectNativeLandmarkRotation`'s guard stops triggering (i.e. this
session's JS-side compensation becomes a no-op because the library's own
rotation logic is now doing the job correctly).

**RE-ATTEMPTED 2026-09-02 on a charged device (`ce5daef`)**: added
`forceCameraOrientation: device?.sensorOrientation`. App launches normally.
`BaseViewCoordinator` now logs `sensorOrientation="landscape-right"`
correctly and consistently — but `shouldCorrectNativeLandmarkRotation`'s
guard does **not** stop triggering; the rotated-landmark bug still occurs.
Whatever `BaseViewCoordinator` does downstream with the corrected config
doesn't reliably prevent the rotated landmarks reaching this app. Verdict:
`forceCameraOrientation` is correct to set but confirmed insufficient on
its own — the JS-side compensation remains the actual, load-bearing fix,
not a removable workaround pending a native-level resolution. Re-confirmed
the compensation's own reliability with throttled `[COMP-GUARD]`
instrumentation after a full app restart: 39/39 sampled frames triggered
correctly, clean roll (~0-5°), correct shoulder-side signs. (An earlier
same-session bad reading, roll pinned ~-105°, traced to a long-lived app
instance that hadn't been restarted since before this config change landed
— stale native-camera-pipeline state, not a guard logic bug. Always do a
full app restart before any live orientation test.) This finding is now
considered closed at the JS-compensation level; only a genuine upstream
library fix would change that.

### 25. Tailored Blazer: broken calibration data, isolated to this one product
**`garment_metadata.anatomical_anchor_offset`, product id `b0000008-0000-4000-8000-000000000002`**

Confirmed via direct DB query. Comparison across all AR-ready products:

| Product | `rest_pose_metric_width` | `anchor_offset.y` |
|---|---|---|
| Black tee | 0.40 | 0.105 |
| Cotton T-Shirt | 0.22 | 0.225 |
| **Tailored Blazer** | 0.357 | **1.304** |

The Blazer's `anchor_offset.y` is 6-12x larger than either other product's,
while `x`/`z` are near-zero noise across all three (confirms the anchor is
meant to be a pure Y-offset, and this one value is simply wrong). Applied
directly as `garmentModel.position.set(-anchorOffset.x, -anchorOffset.y, -anchorOffset.z)`,
this shifts the mesh 1.3 meters off its intended position. Compounding: the
Blazer's own GLB rest-pose bounding box measures only ~0.01 units across (a
further ~30-60x scale defect in the asset's own geometry, independent of the
anchor bug). `auto_rigged: false` for this product — it was manually
calibrated, not run through the Testing1 auto-rig pipeline, so this is not
evidence of a pipeline-wide bug.

**Recommended approach:** this is a content/calibration data bug, not a code
bug. Needs re-calibration in admin-dashboard for this specific product, not
a code fix — do not guess a replacement number.

### 26. Cotton T-Shirt: broken `rest_pose_metric_width`, confirmed by A/B test against a sibling product sharing the identical GLB

**`garment_metadata.rest_pose_metric_width`, product id `b0000009-0000-4000-8000-000000000002`** — same class of bug as #25, different field, different product

The Cotton T-Shirt (`exactScale` observed 1.35-3.0x oversized in session 3)
and Black tee use the **exact same GLB file**
(`1787936209625_Untitled.glb`), confirmed via `model_3d_url`. That mesh's
own rest-pose bounding box measures `x: 0.5917` (a normal, real-world
garment width) — but the two products' `rest_pose_metric_width` values
disagree by nearly 2x for the identical mesh:

| Product | Same GLB? | `rest_pose_metric_width` | ratio to mesh's real width (0.59) |
|---|---|---|---|
| Black tee | yes | 0.40 | 0.68 (plausible) |
| **Cotton T-Shirt** | yes (same file) | **0.22** | 0.37 (implausible) |

Both are marked `anchor_confidence: "merchant_confirmed"` in the DB.

**Confirmed live, A/B, same device same session:** re-tested AR try-on on
the Black tee (sane calibration) immediately after the Cotton T-Shirt
(broken calibration), same wearer, same distance, same code:
- Cotton T-Shirt: `exactScale` ~2.1-2.3
- Black tee: `exactScale` ~1.19-1.22

This conclusively confirms the remaining oversizing after fixing #22/#23
was **entirely due to this one product's calibration data**, not a residual
bug in `exactScale`, cover-crop remapping, or anything else touched this
session. `garmentFitter.ts`/`GarmentRenderer.tsx`'s scale math is correct.

**New observation, not yet investigated:** with sane calibration, the Black
tee rendered notably elongated vertically (like a dress reaching well past
the frame) despite width now being plausible. Likely this shared GLB's own
real proportions (0.702m tall vs 0.59m wide rest-pose bbox — an unusually
elongated ratio for a T-shirt), not a scale/anchor bug, but not confirmed.

**Root cause of the merchant-confirmed data being wrong, found in
admin-dashboard**: `GarmentIngestionModal.jsx`'s Rest Pose and Anchor Type
dropdowns both stamped `anchorConfidence: 'merchant_confirmed'` on change,
despite this modal having no editable field for `anatomicalAnchorOffset` at
all (display-only). So a merchant picking a rest pose or anchor type
silently marked calibration data as human-reviewed that nobody had actually
looked at. Fixed in `admin-dashboard` commit `a3eef9c` (only the Shoulder
Width field's own edit now sets the flag) — separate repo, not pushed.

**Recommended approach:** same as #25 — this is a content/calibration data
bug, not a code bug. Flag for re-calibration in admin-dashboard. Use the
Black tee for further AR scale/positioning testing in the meantime, since
its calibration is at least approximately sane.

### 27. Camera distance triangulation has no yaw correction — scale inflates as the wearer turns
**`src/components/AR/GarmentRenderer.tsx`** (the `UPDATE_TRANSFORM` handler's triangulation block) — found verifying #2's yaw fix, on the Black tee (sane calibration)

Attempting to verify #2's `exactScale` yaw double-correction fix by turning
30-45° surfaced a new, distinct, reproducible bug: `cameraDistanceM` grows
substantially with yaw even though the wearer's true distance from the
camera did not change enough to explain it. Two independent live trials,
same session:

| Trial | `yaw` (torso) | `cameraDistanceM` | baseline (frontal) |
|---|---|---|---|
| 1 | -49° | 1.09-1.22m | ~0.9m |
| 2 | -50° to -68° | 1.67-1.72m | ~0.9m |

Distance grows monotonically with yaw magnitude across both trials — not
noise. Consequence: `exactScale` (which depends on distance via
`targetWorldWidth`'s unprojection) grew to 1.8-1.9 at large yaw, up from the
~1.2 frontal baseline confirmed correct in finding #26 — the garment
visibly grows larger as the wearer turns, an artifact independent of #2's
fix (which corrects a *different* stage: the projected width's own
foreshortening, not the distance estimate feeding that projection).

**Likely mechanism:** the triangulation's frontality guard
(`Math.abs(dxPx) > Math.abs(dyPx)`) only rejects frames past ~45°; frames
that pass but are still meaningfully turned have a foreshortened
shoulder-to-shoulder pixel width, which the similar-triangles distance
formula (`distance = (wearerShoulderWidthM * focalLengthPx) / measuredPixelWidth`)
interprets as "farther away" rather than "turned" — there is no yaw term in
that formula at all. This is upstream of, and independent from, #2's own
yaw correction on the projected width.

**Not fixed** — needs either a stricter/yaw-aware frontality guard, or a
cos(yaw) term in the distance formula itself (yaw would need to be known
before distance is computed, which it currently isn't at that point in the
per-frame sequence — the ordering may need to change). Flagging as a new
finding rather than attempting a live fix tonight; same "no arbitrary
constants, verify on device" caution as #1/#2 applies.

**FIXED 2026-09-02 (`02fbfb7`)**: hoisted the `yawCosCorrection` computation
(previously local to the `exactScale` block) earlier in the frame handler
and multiplied the raw triangulated distance by it — the same cos(yaw)
foreshortening correction #2 already applied to the projected width, now
also applied to the distance estimate feeding it. Live-verified: frontal
baseline ~0.94-1.12m held steady; ~15-19° yaw held ~1.14-1.17m (no
runaway); ~54-59° yaw rose to only 1.37-1.54m (vs. the pre-fix 1.67-1.72m
at a similar angle in trial 2 above). The residual rise past ~49° yaw is
the pre-existing 0.65 floor on `yawCosCorrection` saturating (see #17) —
a separate already-known item, not reintroduced by this fix.

---

### 28. `mapCoverCrop`/`unprojectToZ0` mis-project when a landmark exceeds the [0,1] normalized range
**`src/components/AR/GarmentRenderer.tsx`** (`mapCoverCrop`, called from the `UPDATE_TRANSFORM` handler) — found live during Step B of the physical verification checklist, re-testing #1 now that #27 no longer confounds movement tests

While testing horizontal movement across the frame (checklist Step B), the
wearer moved far enough left that the raw shoulder landmark exceeded the
normalized frame: `l11.x = 1.0045` (>1.0, meaning that shoulder tracked
past the edge of the camera's actual sensor frame). At that exact frame,
the garment rendered badly offset — covering roughly the left third of the
visible torso instead of the actual shoulder span. Re-tested immediately
after at a more moderate left position with both shoulders fully in frame
(`l11.x = 0.907`, within range) and alignment was correct — confirmed this
is specifically triggered by the out-of-range landmark, not a general
horizontal-tracking regression (Step B's core "move across frame at
constant distance" scenario otherwise passes cleanly, including a full
distance sweep at ~0.69m/~0.88m/~1.36m with `targetWorldWidth`/`exactScale`
staying stable throughout, as expected).

**Likely mechanism:** neither `mapCoverCrop` nor `unprojectToZ0` clamp
their input to [0,1] before mapping; an already-out-of-range input
propagates through unclamped, and depending on the cover-crop scale factor
(`visW`/`visH`, often well under 1 for this device's video/container
aspect mismatch) a small overshoot in the raw landmark can amplify into a
much larger NDC-space overshoot after the crop remap.

**Not fixed** — narrow edge case (only triggers when a landmark tracks
partially out of the camera's actual field of view, an unusual pose for
garment try-on), not a blocker for the core verification pass. Candidate
fix: clamp `nx`/`ny` to [0,1] either at the top of `mapCoverCrop` or right
after extracting `l11`/`l12`, before any distance/width/position math
uses them.

**FIXED 2026-09-02 (`63512ba`)**: clamped `nx`/`ny` to [0,1] at the top of
`mapCoverCrop`, the single entry point all three call sites (midpoint,
left shoulder, right shoulder) go through. Type-checked and unit tests
still pass; smoke-tested live (fresh app restart, camera/detector init
cleanly, no errors) but did not specifically re-reproduce the original
out-of-frame trigger to visually confirm the fix on-device.

---

### 29. `<Camera>`'s `onError` has no user-visible recovery path — silent stuck black feed on a real OS-level camera restriction
**`app/ar-tryon/[id].tsx:1202-1204`** (the `<Camera onError={...}>` handler) — found live during checklist Step K (background/foreground lifecycle test)

Backgrounded the app during Live Camera AR (Tailored Blazer), waited, then
foregrounded it again. The #13 background-pause fix worked correctly (zero
`onResults` events while backgrounded, confirmed via log). On return to
foreground, the detector/`BaseViewCoordinator` re-initialized cleanly (no
crash, correct `sensorOrientation` logged) -- but the camera feed itself
stayed permanently black, with the "AI Body Tracking Active" pill still
showing (a stale/incorrect state, since tracking was not actually active).
Metro's log showed the real cause: `WARN Camera Error:
[system/camera-is-restricted: Camera functionality is not available
because it has been restricted by the operating system, possibly due to a
device policy.]` -- an OS-level restriction (likely this device's
background-camera-access policy or a battery-saver interaction, not
something this app's code caused or can prevent outright).

**The gap this exposes**: `<Camera>`'s own `onError` handler
(`app/ar-tryon/[id].tsx:1202-1204`) only does `console.warn(...)` --
no state update, no user-visible banner, no retry action. A real device
restriction (or any other camera-level error) leaves the user staring at
a permanently black screen with a misleading "tracking active" indicator
and no in-app way to recover except force-restarting the app. Confirmed
by reading the source, not just inferring from the stuck screen.

**Not fixed** -- needs an error banner similar to the GLB-load-failure
banner already added for #8/#11 (state + UI wired to `onError`, ideally
with a retry action that re-mounts `<Camera>`), plus probably clearing
`isTrackerActive`/the "AI Body Tracking Active" pill when this fires so
the UI doesn't lie about tracking state. A full app restart recovered the
camera cleanly on this device, confirming the OS restriction itself was
transient and not a persistent lock -- so a retry-without-full-restart is
plausible, not just a cosmetic ask.

**FIXED 2026-09-02 (`486d90c`)**: added `cameraError` state driving a
banner (same visual style as the GLB-error banner) with a Retry button;
Retry bumps a `cameraRetryKey` used as `<Camera>`'s `key` prop, forcing a
real remount rather than relying on state alone. `onError` also clears
`isTrackerActive`/`hasTrackedRef` so the pill stops claiming tracking is
active. A real pose-detection frame arriving also clears `cameraError` as
a safety net, in case the same `<Camera>` instance self-recovers without
the user tapping Retry. Type-checked and unit tests still pass;
smoke-tested live (fresh restart, camera initialized cleanly, no errors)
but did not specifically re-reproduce the original `camera-is-restricted`
condition to confirm the banner/retry flow itself on-device.

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

**PROVISIONALLY ADDRESSED 2026-09-02 (`9ed64ec`)**: per that day's explicit
decision ("apply a rough correction now"), added `STATURE_CORRECTION = 0.114`
based on commonly-cited body-segment proportions (ankle height ~3.9% of
stature, nose-to-crown ~7.5%) rather than leaving the inflation uncorrected.
Clearly commented as a generic population average, not measured on this
app's actual users -- still needs real anthropometric reference data (e.g.
a calibration study against known-height subjects) to replace this
approximation. Type-checked, existing test suite unaffected (no test covers
`extractBodyRatios` directly).

---

## Open — Medium (unfinished features)

### 14. Pose-match state (`isMatched`, `matchScore`, `matchFeedback`) never written
**`app/ar-tryon/[id].tsx:239`**

`setIsMatched`, `setMatchScore`, `setMatchFeedback` are declared but never
called anywhere in the file. `isMatched` is permanently `false`,
`matchFeedback` permanently stuck at its initial value — every UI path and
effect gated on them is dead code. Either this is a real, unfinished feature
(finish it) or genuinely dead (remove the state and whatever renders off it).
Needs a decision, not just a fix.

**RESOLVED 2026-09-02 (`e2f8504`)**: decided "remove it". Deleted the dead
state, the speech-feedback effect and its now-unused refs, and simplified
the tracking pill to its only reachable branch ("AI Body Tracking Active").
`poseMatcher.ts` itself untouched -- `[id].tsx` still imports
`getForegroundOcclusionSegments` from it for an unrelated purpose.

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

**FIXED 2026-09-02 (`d7a3140`), scoped to the 3D path only**: per that day's
decision to invest in a real fix, added `lastReliableCosYaw` cross-frame state
in `GarmentRenderer.tsx` (same pattern as its existing `smoothedCameraDistance`)
-- updated only while `|cos(yaw)|` is above the floor, held unchanged otherwise,
so the correction genuinely plateaus past ~49° instead of continuing to shrink.
`garmentFitter.ts:58`'s identical floor (the legacy 2D overlay path) was
deliberately left as-is -- adding cross-frame state to its stateless exported
function is a larger API change for a lower-value, superseded path. Type-checked,
test suite unaffected, smoke-tested live for crashes/regressions only -- the
actual yaw-saturation behavior itself was NOT re-verified on-device (needs a
live yaw sweep past ~49°, deferred on low battery).

---

## Remaining sequencing

**Superseded by `docs/ar-tryon-physical-verification-checklist.md`** — a
precisely-ordered, controlled physical-device test plan written after this
session specifically to avoid conflating #2 and #27 (which is exactly how
this session's own first yaw-test attempt reached an inconclusive result).
Use that file for the next device session; the summary below is kept for
narrative continuity with the findings above.

Physical device verification happened (session 3) and found the pipeline
runs end-to-end without crashing, but didn't render correctly. Session 4
fixed the two critical findings via a JS-side compensation, confirmed live.
What's left, in priority order:

**Phase G — re-verify the session-2 geometry fixes now that orientation/distance are sane:**
1. Re-test the four session-2 geometry fixes (#1 `unprojectToZ0`, #2
   `exactScale`, #3 `rollRad`, #6 `skeletalRetargeter` fallback) now that
   #22/#23's compensation gives them correctly-oriented input with working
   distance triangulation — session 3 found them impossible to evaluate
   meaningfully while the upstream data was wrong; that blocker is gone.
   **Partially done**: attempting to verify #2 (turning 30-45°) surfaced a
   NEW bug (#27, distance triangulation has no yaw correction) that
   confounds this specific test — distance itself drifts with yaw, so
   `exactScale` growing during a turn can't yet be cleanly attributed to #2
   specifically vs. #27. Fix #27 first, then re-attempt #2's verification.

   **#3 (`rollRad` sign) provisionally confirmed, not visually verified**:
   captured a clean neutral baseline (yaw≈-6°, roll≈-9.8°) then asked the
   wearer to tilt their right shoulder down — `roll` flipped to +9.3°, the
   sign `torsoEulerDegrees`'s formula predicts for that exact tilt direction
   (`xAxis.y` becomes positive when the left shoulder is relatively higher
   than the right). This is a real, meaningful numeric result. However, the
   corresponding screenshot captured a different, later moment (the wearer
   had moved to scratching their head) due to screenshot/log timing drift
   when one person is both posing and operating the phone solo — so this
   is NOT independently visually confirmed against the exact numeric
   sample. Worth a clean two-person re-test (one person poses, one drives
   the capture) before fully closing out #3's live verification.

   **CLOSED 2026-09-02** — clean two-person-style re-test (wearer posing,
   agent driving capture immediately after each hold, no solo timing
   drift): baseline roll=3.3°; right-shoulder-down → roll=+11.2°, garment
   visibly tilts with its screen-right side lower; left-shoulder-down →
   roll=-9.0°, garment visibly tilts the opposite way (screen-left lower).
   Both sign and visual direction correct and consistent, matching the
   prediction. #3 is now fully closed, numerically and visually.
2. ~~Investigate the remaining ~2.1-2.3x oversizing~~ — **done, confirmed
   data-only (#26)**: A/B tested Black tee (sane calibration) against Cotton
   T-Shirt (broken calibration) same session, `exactScale` dropped to
   ~1.19-1.22. No code investigation needed here; use the Black tee as the
   sane baseline for further testing.
3. **#25/#26** (Tailored Blazer + Cotton T-Shirt calibration data) —
   separate track, not code: flag to whoever owns admin-dashboard product
   calibration for re-ingestion. Both confirmed isolated to these two
   products. **Use the Black tee for further AR testing** — its calibration
   is the only one of the three confirmed approximately sane.
4. New, not yet investigated: the Black tee rendered notably elongated
   vertically even with correct width (see #26) — likely this shared
   placeholder GLB's own real proportions, not a scale bug, but unconfirmed.

**Phase H — the real native-library fix (lower urgency, #23 is worked around):**
4. **#24** (disagreeing sensor-orientation values) — exact root cause now
   identified by reading the library's own source (not just inferred from
   logs): `BaseViewCoordinator`'s `sensorOrientation` constructor arg is
   `forceCameraOrientation.value ?? frameOrientation.value`, and this app
   never sets `forceCameraOrientation`. **Fix candidate ready to test**: add
   `forceCameraOrientation: device?.sensorOrientation` alongside the
   existing `forceOutputOrientation` in `[id].tsx`. Attempted tonight at 9%
   battery, hit an unrelated-looking crash before a clean test could run —
   reverted, net no diff. **Start here next session**, on a charged device:
   apply the one-line change, confirm the app launches, check
   `BaseViewCoordinator`'s logged `sensorOrientation` matches
   `"landscape-right"`, and check whether `shouldCorrectNativeLandmarkRotation`
   stops triggering. If confirmed, this session's JS-side compensation
   becomes redundant and should be removed rather than left stacked.
5. **Verify the session-4 compensation's guard on a second device** — it's
   confirmed correct and necessary on the Infinix X6880, but its
   never-misfires-on-a-working-device behavior is unverified elsewhere.

**Then, needs a product/measurement/numerical decision, not just code:**
- **#5** (body-ratio scale convention) — needs real anthropometric reasoning;
  flag for whoever owns the body-scan measurement math.
- **#14** (finish or remove pose-match feature) — needs a product decision.
- **#17** (`cosYaw` saturation) — the literal "hold steady" fix needs either
  cross-frame state or a different numerical model; not attempted.
- **#16** (web smoothing parity) — deliberately deferred, native-only scope
  decision stands.

See `docs/CURRENT_AR_STATE.md` for the full current-state summary and exact
next steps.

**Deferred, not in this plan:** removing the temporary debug instrumentation
(`[CAL-DEBUG]`, `[WEBVIEW-RELAY]` console relay, `showDebug()` calls) — still
needed until Phase F is actually fixed and re-verified on a device. Remove
only after that.
