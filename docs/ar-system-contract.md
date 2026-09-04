# AR Try-On — System Contract

Phase 0 deliverable of `ar-tryon-implementation-roadmap.md`. Written
2026-09-02 against `main @ 55e9f7f`, verified stage by stage against the
source rather than against prior documentation.

This file exists so that "pose", "fit", "depth", and "ready" mean exactly
one thing each across the pipeline. Where the code currently means something
narrower than the name suggests, that is stated here rather than smoothed
over. Anything marked ASPIRATIONAL is a declared shape that nothing
currently produces or consumes; do not build against it without checking.

Pipeline, one stage per section:

    Camera -> MediaPipe -> device compat -> poseConstructor -> poseNormalizer
    -> garmentFitter -> skeletalRetargeter -> renderer transport -> Three.js

---

## 1. Input

| Input | Shape | Source | Optional |
|---|---|---|---|
| Normalized landmarks | 33 x `{x, y, z, visibility}`, `[0,1]` image space | MediaPipe | no |
| World landmarks | 33 x `{x, y, z}`, metres, hip-origin | MediaPipe | no |
| Segmentation mask | `SegmentationFrame` | MediaPipe, native only | yes |
| User measurements | `UserMeasurements` (shoulder width is the only field the AR path reads) | `user_measurements` via `useSizingProfile` | yes |
| Garment calibration | `GarmentMetadata` | `products.garment_metadata` | no |
| Camera intrinsics | `focalLengthPx`, `verticalFovDeg`, `videoWidthPx`, `videoHeightPx`, `wearerShoulderWidthM` | vision-camera format + saved measurement | native only |

Landmark indices the AR path depends on (`poseNormalizer.LM`): shoulders
11/12, elbows 13/14, wrists 15/16, hips 23/24.

**Segmentation is requested but not transported.** `usePoseDetection` runs
with `shouldOutputSegmentationMasks: true`, and the native frame is built
with `width: 0, height: 0, source: 'native-buffer'`
(`app/ar-tryon/[id].tsx:715`). Nothing downstream consumes the mask. Treat
`SegmentationFrame.width`/`height` as unpopulated on native until Phase 2
Tier 2 fills them from the active camera format.

**`BodyDepthField` is ASPIRATIONAL.** Declared in `src/types/pose.ts`,
produced by nothing, consumed by nothing.

---

## 2. Device compatibility layer (native only)

Between the MediaPipe callback and `poseConstructor`, native landmarks pass
through a rotation compensation in `onNativePoseResults`. This is a
**permanent layer**, not a workaround awaiting removal.

- Gate: `shouldCorrectNativeLandmarkRotation` fires when
  `dy > 0.15 && dy > dx * 2` on the shoulder pair, i.e. the shoulder line
  reads more vertical than horizontal.
- Transform when fired: 2D `(x, y) -> (y, 1 - x)`, world `(x, y) -> (y, -x)`.
- `forceCameraOrientation` and `forceOutputOrientation` are both set to the
  device sensor orientation. Live testing established this is correct but
  **not sufficient**; the JS compensation is what actually fixes the bug.
- The gate is a heuristic. It is verified on one device (Infinix X6880) and
  its behaviour on hardware without the underlying bug is **unproven**
  (roadmap Step H).
- Web path does not use this layer at all.

Contract: no module downstream of this point may assume raw MediaPipe
orientation. Everything downstream sees compensated landmarks.

---

## 3. Body pose — `BodyPose` (`poseConstructor.ts`)

Produces `coordinateFrame` (origin/right/up/forward), `orientation`
(`yawRad`, `pitchRad`, `rollRad`, `isFacingForward`, `isBackFacing`),
`trackingState`, and `confidence` (mean shoulder visibility).

### `trackingState` — three values, not seven

`TrackingState` declares seven members. `poseConstructor.ts` assigns
exactly three:

| Value | Condition | Produced |
|---|---|---|
| `TRACKING_LOST` | a shoulder missing, or either visibility `< 0.35` | yes |
| `TURN_TOO_FAR` | `!isFacingForward`, i.e. `abs(yaw) >= 25°` or `forward.z <= 0` | yes |
| `GOOD_FIT` | otherwise | yes |
| `INITIALIZING` | — | **never** |
| `STEP_BACK` | — | **never** |
| `FULL_BODY_REQUIRED` | — | **never** |
| `LOW_LIGHT` | — | **never** |

The four unproduced members are ASPIRATIONAL. Distance and lighting are not
assessed anywhere in the pose path. Guidance UX that needs them must
implement the detection first.

Note `TURN_TOO_FAR` triggers at only 25° of yaw, well inside the range the
geometry handles correctly; it means "past the confident-facing cone", not
"tracking is failing".

---

## 4. Canonical space — `CanonicalPose` (`poseNormalizer.ts`)

**The single seam.** No other module may convert out of MediaPipe space.

- Version tag: `canonical-v1` (`CANONICAL_SPACE_VERSION`).
- Space: Three.js convention. X right, Y up, Z toward viewer, right-handed,
  metres.
- Conversion from MediaPipe world space (X right, Y down, Z away):
  `(x, -y, -z)`. This negation lives here and nowhere else.
- Frame is the **raw, unmirrored camera frame**. Preview mirroring is a
  single CSS `scaleX(-1)` applied after rendering to video and garment
  together. No module applies mirroring internally.
- `joints[i]` is `null` where `visibility < MIN_JOINT_VISIBILITY` (0.3).

### `CanonicalTorso`

- `origin` — shoulder midpoint, canonical metres. This is the garment anchor.
- `xAxis`/`yAxis`/`zAxis` — orthonormal basis, Gram-Schmidt, shoulder line
  preserved exactly.
- `quaternion` — rotation from canonical rest to live torso orientation.
  **This value is the sole owner of garment global rotation.** Nothing
  downstream may add roll, pitch, or yaw on top of it.
- `valid` — false when shoulders or hips are missing/low-confidence, or the
  basis is degenerate (`sin` between shoulder axis and torso axis
  `< MIN_BASIS_SEPARATION`, 0.05).

Invariant to protect: one canonical space, one owner of torso rotation,
no ad-hoc conversions reintroduced into consumers.

---

## 5. Garment fit — `GarmentFitState` (`garmentFitter.ts`)

Returns a neutral identity state when `confidence < 0.3` or
`trackingState` is `TRACKING_LOST` / `FULL_BODY_REQUIRED`.

- `anchor` — shoulder-midpoint attachment point.
- `scale` — uniform; from the width model below.
- `rotation` — **roll only**, for the legacy 2D overlay. Not for 3D.
- `orientation3D` — the canonical torso quaternion, passed through.
  Identity when the torso is invalid.
- `dimensions`, `confidence`.

### What "fit" currently means

    exactScale = (targetWorldWidth / garmentMetricWidth) * fitModifier

- `targetWorldWidth` — on-screen shoulder separation unprojected to z=0,
  divided by `yawCosCorrection` so foreshortening is applied exactly once
  (by the 3D rotation, not twice).
- `garmentMetricWidth` — `restPoseMetricWidth` from calibration.
- `fitModifier` — wearer shoulder width vs the recommended size's chart
  shoulder width; 1 when either is missing.

**Fit is shoulder-width matching, uniformly applied.** Length, chest depth,
and garment construction are not fitted. `GarmentFitProfile.dimensions`
declares `chestWidth`, `waistWidth`, `length`, `sleeveLength`; only
`shoulderWidth` reaches the scale, and only as a fallback. The system does
not currently model "this garment worn on this body".

### Yaw correction

`yawCosCorrection = abs(cos(yaw))`, floored at 0.65 (~49°). Past that
threshold the value **holds at the last reliable reading**
(`lastReliableCosYaw`, cross-frame state in the renderer) rather than
continuing to shrink. Initial value is 0.65, so a session that begins
already turned degrades to the old floor behaviour, not to no correction.
Live plateau behaviour **reasonably confirmed 2026-09-03**: isolated-yaw
readings at 54° and 59.5° (both past the floor) showed `exactScale`
bounded at 1.075-1.222, not continuing to shrink with deeper turn. See
`ar-tryon-audit-implementation-plan.md`'s `#17` entry for the full data;
not laboratory-precision but no longer unverified.

### Camera distance (native, calibrated only)

Similar triangles: `wearerShoulderWidthM * focalLengthPx / measuredPixelWidth`,
then multiplied by `yawCosCorrection`. Accepted only when the shoulder line
reads more horizontal than vertical and the result lands in `[0.2, 2.5]` m;
smoothed, and clamped to +/-40% movement per frame. Without calibration the
scene keeps a fixed 45° FOV at z=5, which is self-consistent but not
real-world accurate.

---

## 6. Deformation — `skeletalRetargeter.ts`

- Emits exactly four bone deltas: `LeftArm`, `RightArm`, `LeftForeArm`,
  `RightForeArm`.
- `LeftShoulder` / `RightShoulder` are present in `boneMap` and resolved by
  the renderer but **never driven**. Clavicle motion is unmodelled.
- `Spine` stays at bind pose deliberately. Torso orientation belongs to the
  garment group, so driving Spine as well would double-count the bend about
  a different pivot.
- Arm directions are converted into torso-local space via `toTorsoLocal`
  before deltas are computed against the rest pose (`T_POSE` or `A_POSE`).
- Invalid torso: when `fallbackRollRad` is supplied, a roll-only quaternion
  cancels the same roll the group applies, so the two owners agree. Omitting
  it preserves the older double-counting behaviour on purpose.

Contract: skeletal deformation is rigid. Fabric stretch, sleeve drape, hem
behaviour, and cloth volume are **out of model**, not merely untuned.

---

## 7. Occlusion

**Current state: skeletal approximation, and disconnected.**

- `getForegroundOcclusionSegments` builds capsules from landmark pairs
  (elbow-wrist, wrist-index, chin/neck) with a `depthDelta` against a chest
  reference. This is a skeletal approximation, not per-pixel depth.
- The shader material, full-screen quad, and per-frame joint uniforms all
  exist in the renderer, but `scene.add(occlusionMesh)` is **commented out**
  (`GarmentRenderer.tsx:387`). Nothing occludes today.
- Consequence: `worldLandmarks` are serialised into every transport frame to
  feed uniforms on a mesh that is never drawn.

Definition in force: "occlusion" means capsule-approximate foreground
masking. It does **not** mean depth-aware human occlusion. Roadmap Phase 2
Tier 1 reconnects the existing path; Tier 2 carries a real downsampled mask
and is gated on measured frame rate; Tier 3 (native GL) is M3.

---

## 8. Renderer and transport

Three.js r128 in a `WebView` (native) or `iframe` (web), built from a
string-injected HTML bundle. Calibration is delivered by message rather
than baked into the HTML, deliberately: baking it would reload the page and
reset the GLB, bind poses, and smoothing state.

Message types, host to scene:

| Type | Payload |
|---|---|
| `SET_CAMERA_CALIBRATION` | intrinsics + wearer shoulder width |
| `SET_FIT_MODIFIER` | scalar |
| `UPDATE_TRANSFORM` | `pos`, `rot`, `scl`, `boneRotations`, `normalizedLandmarks`, `worldLandmarks` |

Scene to host: `AR_LOAD_ERROR` (GLB failure or uncaught scene error), via
`ReactNativeWebView.postMessage` on native and `window.parent.postMessage`
on web, surfaced as a banner.

Transport mechanics, per frame, native:
`JSON.stringify(payload)` -> `injectJavaScript` -> `window.postMessage`.

- `hasMask` is set on **web only** and is a boolean flag; the mask itself is
  never attached to any payload on either platform.
- No GLB load timeout exists.
- This is prototype transport. Its ceiling is unmeasured; measuring it is
  roadmap Phase 1 instrumentation.

---

## 9. Data contract — `products.garment_metadata`

Stored snake_case, consumed camelCase; the screen adapts and inverts the
bone map (`boneMap[canonical] -> glbBoneName`) inline today.

`IngestionStatus`:

| Value | Meaning |
|---|---|
| `AR_READY` | calibration trusted, real metadata path |
| `NEEDS_MERCHANT_MAPPING` | gated to demo rig |
| `NOT_AR_COMPATIBLE` | gated to demo rig |
| `NEEDS_CALIBRATION` | gated to demo rig |

**Known ambiguity.** Only `AR_READY` takes the real path, which is correct.
But the demo-rig fallback writes `ingestionStatus: 'AR_READY'` into its own
synthetic metadata (`app/ar-tryon/[id].tsx:327`), and only React state
(`isDemoRig`) distinguishes them. `AR_READY` therefore means either
"calibrated" or "invented defaults" depending on invisible context. Until
roadmap Phase 3 adds `DEMO_RIG`, **no code may treat
`ingestionStatus === 'AR_READY'` as proof of calibration.**

`anchorConfidence` is `detected` | `inferred` | `merchant_confirmed`.
`merchant_confirmed` was historically stamped by unrelated field edits and
is not evidence of anchor correctness.

Current live calibration state (updated 2026-09-04): Black tee verified
sane; Cotton T-Shirt corrected by copying it (same GLB file); Tailored
Blazer re-ingested, its frustum-culling render bug fixed, and its
`rest_pose`/`anatomical_anchor_offset.y` corrected in the DB -- genuinely
`AR_READY` with real, live-verified calibration, not the demo-rig fallback.
See `docs/ar-tryon-audit-implementation-plan.md` finding #25 for the full
history and root causes.

---

## 10. Measurement contract

`STATURE_CORRECTION = 0.114` in `poseDetector.ts` converts the nose-to-ankle
polyline toward full stature (~3.9% ankle + ~7.5% nose-to-crown of stature).

**Provisional by design.** It is a generic population average, not measured
on this app's users. Sizing must not accrete dependence on it as though it
were calibrated. Replace with real reference data, a validated
anthropometric model, or actual user measurements.

---

## 11. Failure states

| Failure | Detection | User-visible | Recovery |
|---|---|---|---|
| Tracking lost | shoulder visibility `< 0.35` | garment decays, pill state | automatic on reacquire |
| Turned too far | `abs(yaw) >= 25°` | none today | automatic |
| Camera error | `<Camera onError>` | banner + Retry | remount via `cameraRetryKey` |
| GLB load failure | loader error -> `AR_LOAD_ERROR` | banner | none — no timeout, no retry |
| Uncalibrated garment | `ingestionStatus !== 'AR_READY'` | demo-rig indicator | n/a by design |
| Bad calibration data passing the gate | **not detected** | none | none |
| Backgrounded | `AppState` + `isFocused` | n/a | camera pauses and resumes |
| Low light / too far | **not detected** | none | none |

Tracking-loss decay and background pause/resume are device-verified. The
undetected rows are roadmap Phase 1 and 6 work.

---

## 12. Invariants

1. `poseNormalizer` is the only converter out of MediaPipe space.
2. `CanonicalTorso.quaternion` is the only owner of garment global rotation.
3. Mirroring happens once, in CSS, after rendering.
4. The native rotation compensation is permanent and native-only.
5. `AR_READY` is not proof of calibration until `DEMO_RIG` exists.
6. Rigid skeletal deformation, four arm bones, Spine at bind.
7. Occlusion means capsule approximation, and is currently inactive.
8. `STATURE_CORRECTION` is provisional.
9. Verification means device or test, never compilation.
