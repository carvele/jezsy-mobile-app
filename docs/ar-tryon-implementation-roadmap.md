# AR Try-On — Implementation Roadmap to a Complete System

Written 2026-09-02 against `main @ e35479d`. Supersedes the "Remaining
sequencing" section of `ar-tryon-audit-implementation-plan.md` for
forward-looking work. The audit plan stays the historical record; this file
is the plan of record from here.

## Where the project actually is

The geometry foundation is done and device-verified (Infinix X6880): pose
detection, canonical coordinate space, camera calibration, yaw-corrected
distance, roll sign, arm retargeting, tracking-loss decay, background pause,
camera and GLB error surfacing. All of it is committed and pushed.

What it is not yet: a credible virtual try-on. Independent review of the
source at `e35479d` (verified claim by claim, not taken on faith) found:

- Occlusion is a skeletal-capsule approximation, not depth-aware. The
  MediaPipe segmentation mask is requested every frame but never leaves the
  native side: the frame is built with `width: 0, height: 0`
  (`app/ar-tryon/[id].tsx:715`), and `updateTransform` only ever sends a
  `hasMask` boolean, never the mask (`GarmentRenderer.tsx:1023-1046`). The
  occlusion shader and quad exist but `scene.add(occlusionMesh)` is
  commented out (`GarmentRenderer.tsx:387`). Net: the per-frame
  `worldLandmarks` payload feeds a mesh that is never drawn.
- Fit is "calibrated shoulder width scaled to tracked shoulder width", not
  "this garment on this body". Length and depth are not fitted at all.
- The demo-rig fallback writes `ingestionStatus: 'AR_READY'` into synthetic
  metadata (`[id].tsx:327`); only React state (`isDemoRig`) knows the
  difference. Two meanings share one value.
- The native rotation compensation is a heuristic device-compat layer with
  a plausibility gate; it is permanent, not a temporary workaround, and it
  is still only proven on one device.
- Native to WebView transport is `JSON.stringify` + `injectJavaScript` per
  frame. Fine for a prototype; a likely ceiling once occlusion, more bones,
  or more garments are added. No GLB load timeout exists.
- `[id].tsx` is 1,534 lines and owns camera, permissions, lifecycle, pose,
  sizing, fitting, renderer transport, metadata adaptation, UI, and errors.
- Only one GLB has verified-sane calibration (Black tee; Cotton T-Shirt now
  copies it). Tailored Blazer is gated at `NEEDS_CALIBRATION`. The garment
  library is too thin to validate deformation across constructions.
  **UPDATE 2026-09-04**: Tailored Blazer's underlying GLB bug (a Blender
  skin-bind-before-scale-apply defect, not a calibration-number problem --
  see audit doc finding #25's 2026-09-04 update) is fixed and re-ingested;
  `ingestion_status` is genuinely `AR_READY` now with admin-pipeline-computed
  values, and the garment renders at correct scale on-device.
  **UPDATE 2026-09-04, later same session**: the remaining gap closed. Three
  more bugs found and fixed, all live-verified: (1) intermittent invisibility
  -- Three.js r128 frustum-culls against a `SkinnedMesh`'s stale, never-
  updated bind-pose bounding sphere, so a correct transform could still
  silently fail to draw; fixed by disabling frustum culling on the garment
  mesh (`92cce3d`); (2) sleeves stuck in a T-pose regardless of real arm
  position -- `garment_metadata.rest_pose` stored `"A_POSE"` but the GLB's
  real bind pose is T-pose, so every arm rotation delta was computed against
  the wrong 35°-drooped reference; fixed in the DB; (3) the "sits low"
  vertical anchor -- `anatomical_anchor_offset.y` pinned to `Spine2` (chest
  height) instead of the shoulder line; bisected live to `y=1.35`, fixed in
  the DB. Full writeup: audit doc finding #25. **The Tailored Blazer is now
  a second fully-validated construction** -- Phase 1's two-garment minimum
  (Black tee + one long-sleeve) is satisfied.

## Milestones

- **M1 — Geometry frozen.** Done at `e35479d`. Not reopened unless a new
  regression is demonstrated on device.
- **M2 — Credible single-garment try-on (capstone demo cut line).** One
  T-shirt and one long-sleeve garment, both properly calibrated, pass the
  garment-reality rubric (Phase 1) on the primary device; occlusion at
  Tier 2; honest tracking UI; effective update rate at or above ~15 Hz;
  every failure state has a visible recovery path.
- **M3 — Production-ready.** Post-capstone. Native renderer transport,
  multi-device evidence, real fitting model, full failure matrix.

Everything below is sequenced to reach M2 first. M3 items are named so
nobody mistakes them for done, but they are not scheduled.

## Operating rules for every phase

- Closed audit findings are closed. Reopen only with a demonstrated
  regression on device, never because old documentation mentions them.
- No architectural change without evidence from Phase 1. Premature cleanup
  is the main way to lose the working baseline.
- Protect the canonical coordinate seam: no ad-hoc coordinate conversions
  inside individual modules. `poseNormalizer.ts` owns the conversion.
- Native module additions are a real cost (rebuild, dev-client
  redistribution). Any option that needs one is flagged and confirmed first.
- Verification is `npx tsc --noEmit`, the existing Jest suite in
  `src/utils/__tests__/`, and the physical device. Nothing is "verified"
  because it compiles.
- If it is unclear whether something is still open, stop and ask rather
  than writing another fix.

## Phase 0 — Freeze, contract, and close the verification gaps

Goal: lock M1 and make the system's assumptions explicit before new work
depends on them.

Tasks:
1. **Done** — `docs/ar-system-contract.md` written 2026-09-02. Original
   scope: inputs (33 landmarks, world
   landmarks, optional segmentation, user measurements, garment
   calibration), normalization (canonical-v1), body model (torso basis,
   yaw/pitch/roll, joints), garment fit (anchor, world scale, camera
   distance, size modifier), deformation (torso group orientation, arm and
   forearm deltas, Spine at bind), occlusion (current skeletal
   approximation, future pixel/depth), renderer (Three.js in
   WebView/iframe, postMessage transport), data contract
   (`products.garment_metadata`, `AR_READY` semantics), failure states.
   One page. It exists so "fit", "pose", "depth", and "ready" mean one
   thing each.
2. Close the device-dependent verification gaps, on a charged phone, one
   session: #28 (push a landmark past the frame edge, confirm the clamp
   holds alignment), #29 (background/foreground until the OS restriction
   recurs, confirm banner + Retry remounts the camera), #17 (yaw sweep past
   ~49°, confirm `lastReliableCosYaw` plateaus rather than shrinking).
   Record numbers in the checklist doc. Any of these failing is a real
   regression and is the only thing that reopens M1.
3. Step H (second-device guard): stays open until a second Android device
   exists. Do not fake it.
4. Housekeeping outside this repo: push `admin-dashboard@a3eef9c`
   manually (**done** — confirmed on `origin/main`); re-ingest Tailored
   Blazer in admin-dashboard against the Mixamo source and only then
   return it to `AR_READY`. Never guess the anchor offset.

Exit: contract doc merged; #28/#29/#17 recorded as pass or as a demonstrated
regression; Step H status honest.

**Phase 0 status as of 2026-09-03**: contract doc done. #28, #29, and #17
all live-verified. #17's first attempt was inconclusive (compound
bend+twist+roll, unreliable Euler yaw near profile) but a same-session
retest -- standing against a wall/doorframe as a vertical reference to
isolate pure yaw -- got clean pitch/roll-near-zero data at 54° and 59.5°,
both past the ~49° saturation threshold, with `exactScale` staying bounded
(1.075-1.222) rather than continuing to shrink. Reasonably confirmed, not
laboratory-precision; see the audit doc's `#17` entry for the exact
numbers and what a denser instrumented sweep would still add. Step H
remains open (no second device -- techniques don't fix a hardware gap).
The admin-dashboard push is still outstanding and outside this repo.
Blazer re-ingestion is **done** (2026-09-04) -- see the update above and
audit doc finding #25.

**Phase 0 is now substantively closed** on everything reachable from this
repo and this hardware.

**Unplanned but necessary detour this session**: the app was fundamentally
broken on-device before any of the above could even be attempted --
unrelated to this session's own AR work. A pre-existing, uncommitted local
edit to `package.json` (bumping `react-native-reanimated` 3.19.5 -> 4.5.1,
adding `react-native-worklets`, and separately dropping the `@sentry/react-native`
dependency entirely) had never been followed by a native rebuild, so the
installed APK's native code didn't match the JS bundle -- a silent hang
with zero console output. Fixed with `expo run:android` (rebuilds native
against the current `package.json`) followed by `npm install` (reconciles
`node_modules`, which pruned the now-undeclared Sentry package cleanly).
**The native build now genuinely depends on that reanimated 4.5.1 state.**
If a future session sees `package.json` reverted to 3.19.5 without a
matching rebuild, expect the same hang, for the same reason, in reverse.

## Phase 1 — Garment reality validation (evidence before design)

Goal: find out where the frozen geometry stops looking like clothing.
This phase decides the priorities of Phases 2 to 4. No architectural code
changes; instrumentation only.

Instrumentation (small, low risk, ship first):
- **Done** (`b51e479`) — Make the tracking pill honest. `TrackingState`
  *declares* seven members but `poseConstructor.ts` only ever produces
  three — `GOOD_FIT`, `TURN_TOO_FAR` (at `abs(yaw) >= 25°`), and
  `TRACKING_LOST` (shoulder visibility `< 0.35`). The pill now hides on
  `TRACKING_LOST`, shows an amber "Turn to Face the Camera" on
  `TURN_TOO_FAR`, and cyan "AI Body Tracking Active" on `GOOD_FIT`
  (`app/ar-tryon/[id].tsx:1233-1242`). `INITIALIZING`, `STEP_BACK`,
  `FULL_BODY_REQUIRED` and `LOW_LIGHT` are still declared and never
  assigned; that part needs detection written first (see Phase 5).
- **Done** (`3c8f626`) — Client-side calibration sanity guard in the
  metadata path: if `anatomical_anchor_offset` magnitude or
  `rest_pose_metric_width` fall outside plausible garment bounds, the
  record is treated as `NEEDS_CALIBRATION` regardless of what the DB
  says. Defense in depth against the Blazer class of data; logs loudly.
- **Done** (`3a46127`, extended same day) — effective update rate: native
  side counts `updateTransform` calls/sec, and the WebView's own render
  loop now separately counts frames rendered/sec (`[AR-RENDER-FPS]`,
  `GarmentRenderer.tsx`) — a genuinely different number from the
  transport-call count, since `requestAnimationFrame` keeps drawing every
  compositor tick regardless of whether fresh transform data arrived.
  Both live-verified on-device (Tailored Blazer, Live Camera AR,
  ~55-60fps render / variable transport rate).

Test protocol, two calibrated garments minimum (Black tee plus one
long-sleeve; the Blazer once re-ingested), two people (one poses, one
captures), screenshot plus log per hold:
- A. Torso bend forward: shoulder anchor stays, hem behaviour, Spine at
  bind, no garment-body intersection.
- B. Single arm raise, each side: sleeve and shoulder deformation, opposite
  shoulder untouched, no arm-garment intersection.
- C. Both arms raised: the scale plausibility guard was previously shown to
  misread this as a glitch; confirm it no longer does.
- D. Crossed arms: the occlusion stress case; expect it to fail today and
  record exactly how.
- E. Deep turn 30/45/60°: silhouette and deformation plausibility, not
  distance.

Score each test 0-2 on: anchor stability, deformation plausibility,
intersection, occlusion, frame rate. Write
`docs/ar-tryon-garment-reality-report.md` with the scores and screenshots.

Exit: report exists with scores for both garments; Phases 2-4 are re-ordered
from its findings, not from this document's guesses.

**Phase 1 status as of 2026-09-04**: all three instrumentation items are
done. The Test protocol (A-E) has now also been run, solo (device on a
stand, remote-ADB screenshot capture standing in for a second capturer),
on both garments, with two poses retested for reproducibility. Full
results, scored screenshots, and re-ordering recommendations are in
`docs/ar-tryon-garment-reality-report.md`. Headline finding: a severe,
reproducible pose-orientation breakdown past ~45° yaw on both garments,
plus an asymmetric left/right arm-deformation bug — both rank above
Phase 2's occlusion gap in the report's own recommended re-ordering.
**Phase 1 is exited.** Phase 2-4 sequencing should be revisited against
the report before resuming that work, per the ordering rule below.

## Phase 2 — Occlusion (the biggest gap)

Goal: the wearer's arms and hands read as in front of the garment when they
are. Tiered so the capstone can stop at a defensible level.

- **Tier 1 — DONE 2026-09-04** (`04656a2`, `97da54c`), live-verified: a bare
  forearm crossing the chest now cuts through the garment instead of the
  garment drawing over it (the Phase 1 report's Test D failure), at
  54-57fps — above the Phase 1 floor, so the exit criterion below is met.
  This was **not** "uncomment `scene.add(occlusionMesh)`". Five independent
  defects each individually prevented it from working, none of which had
  ever surfaced because the mesh was never in the scene, so Three.js never
  compiled the shader: missing `extensions.fragDepth` (program could not
  compile at all); `uViewProj` declared and never assigned (depth projected
  through an identity matrix); raw MediaPipe `worldLandmarks` fed to a
  matrix expecting scene coordinates (the documented reason it was
  disabled); `vUv` (origin bottom-left) compared against `uJoints2D`
  (origin top-left); and the uniform-population block sitting outside
  `targetPos`'s scope, throwing a `ReferenceError` that an empty
  `catch(e){}` swallowed every frame so the uniforms stayed at (0,0)
  forever. Then three quality fixes found by driving a temporary debug
  colour pass on-device (retained behind `OCCLUSION_DEBUG_VISIBLE`, off):
  the torso was a wireframe of four edge lines rather than a filled quad,
  leaving the chest interior uncovered; region selection by smallest 2D
  distance made the torso always beat an arm lying across it once the quad
  was filled (now picks whichever covering part is nearest the camera); and
  the radii were roughly double life-size, which for a depth occluder
  carves away garment pixels that should stay visible.
  Remaining Tier 1 limits, accepted by design: straight capsule bands
  rather than a real limb silhouette, and one radius for the whole arm
  rather than tapering upper arm to wrist. `worldLandmarks` are no longer
  dead payload — the occluder consumes them.
- Tier 2, no new dependencies: carry the real segmentation mask, bounded.
  Populate the frame's `width`/`height` from the active camera format,
  downsample the mask on the native side to a small single-channel grid
  (for example 96x96), and send it through the existing transport at a
  throttled rate (10-15 Hz) as base64. This is the exact base64-in-the-loop
  the code comment warns against, so it must be measured: keep it only if
  the Phase 1 frame-rate numbers hold. In the WebView, sample it as an
  alpha or depth test on the garment material.
- Tier 3, production (M3): render natively (shared GL context, for example
  `expo-gl`) so the mask never crosses a JS bridge. This is a new native
  module and a renderer rewrite. Flagged, not scheduled.

Exit for M2: Test D scores at least 1 on occlusion with Tier 1 or 2, and
frame rate stays above the Phase 1 floor.

**Met 2026-09-04 with Tier 1.** Test D's occlusion score moves 0 -> 2 (the
forearm reads as genuinely in front of the garment, not merely partially),
at 54-57fps against a Phase 1 floor of ~53fps. Tier 2 is therefore not
required for M2 and stays unscheduled; it remains the route to per-pixel
accuracy if the capsule approximation's straight-band edges prove
insufficient in the recorded Phase 6 run. Scores for the rest of the A-E
protocol have NOT been re-run since these fixes -- the Phase 1 report's
table still reflects pre-fix behaviour for every other test.

## Phase 3 — Fit semantics and data-contract hardening

Goal: "fit" means one thing, and bad data cannot masquerade as calibrated.

Tasks:
- **DONE 2026-09-04** — Added `DEMO_RIG` to `IngestionStatus`
  (`src/types/garment.ts`); the fallback marks itself with it instead of
  stamping `AR_READY`, so downstream checks for `AR_READY` now mean
  calibrated only. Also derived `isDemoRig` from the metadata rather than
  keeping it as separate React state -- a second source of truth for the
  same fact could only drift, and that drift was the original defect.
  `DEMO_RIG` is client-only and never written to the DB. Retires the
  standing rule in `ar-system-contract.md` section 9.
- **DONE 2026-09-04** (`364171d`) — Extracted
  `src/utils/garmentMetadataAdapter.ts`: snake_case to camelCase, bone-map
  inversion, and the Phase 1 sanity guard, with 13 unit tests pinning each
  of the three silent live bugs this logic has shipped from being inline.
  Also pins that `isDemoRig` can never disagree with the metadata's own
  `ingestionStatus`.
- **DONE 2026-09-04** (`364171d`) — Extracted
  `src/utils/nativePoseCompatibility.ts`: the rotation compensation and its
  plausibility gate, with 15 unit tests covering the gate on synthetic
  frontal, near-profile-yawed, leaning, sub-noise-floor and stacked
  landmark sets. Worth noting what this buys: the gate is the only safety
  net for a real native-library defect and its no-op behaviour on hardware
  *without* that defect is unverifiable here (Step H, blocked on a second
  device) — these tests are the closest deterministic substitute, pinning
  that it must NOT fire on legitimate poses that superficially resemble the
  bug. `[COMP-GUARD]` telemetry stays at the call site, since it logs raw
  pre-correction values the module never sees.
  Screen drops 1534 -> 1463 lines across both extractions.
- **DONE 2026-09-05** (`59b3aed`) — Length fit signal:
  `computeLengthFitSignal()` in `sizeRecommender.ts` compares the selected
  size's chart length to the tracked torso length (shoulder midpoint to hip
  midpoint, live from world landmarks). Mesh scale stays uniform -- this is
  feedback only, not deformation. 14 tests, notably pinning that a naive
  zero-centered comparison would misclassify nearly every real garment as
  "runs_long" (garments are supposed to hang past the hip) -- bucketed
  around an explicit, named "expected hip drop" baseline instead, same
  provisional-constant honesty as `STATURE_CORRECTION`. **Not yet
  physically verified on-device.**
- **Already satisfied, doc-only correction** — `STATURE_CORRECTION`'s
  provisionality note already existed in `ar-system-contract.md` section 10
  and invariant #8 before this roadmap line was written; this task was
  stale from the start, not something that needed doing. No code or doc
  change required beyond noting it here.

Exit: `AR_READY` is unambiguous; adapter and compat layer have tests;
sizing feedback reflects length, not just width.

**Phase 3 status as of 2026-09-05**: all three exit conditions are
code-complete. `AR_READY` is unambiguous (`DEMO_RIG` exists, `b37f90c`);
the adapter and compat layer have tests (`364171d`); sizing feedback
reflects length via the signal above (`59b3aed`). Per this project's own
verification rule (nothing is verified because it compiles), Phase 3 is
**not yet exited** until the length signal gets a real on-device pass --
tsc/tests passing is not the same claim as a physical device pass.

## Phase 4 — Deformation quality and the garment library

Goal: bones rotating correctly becomes garments deforming believably, on
more than one construction.

Tasks:
- Garment library to at least four calibrated, licence-verified assets
  across constructions: T-shirt (have), long-sleeve, jacket/outerwear,
  dress. Sourcing and licensing is content work; three of the five current
  GLBs have unverified licences and must be resolved or replaced.
- Ingestion hardening in admin-dashboard: measure `rest_pose_metric_width`
  from the GLB geometry at ingestion instead of trusting a typed number, and
  reject anchor offsets outside plausible bounds at the source. The mobile
  guard from Phase 1 is the last line, not the first.
- From Test A/B/C findings, decide per finding: adjust bone rest vectors,
  add clavicle (`LeftShoulder`/`RightShoulder` are mapped but unused),
  or accept the limit. Rigid skeletal deformation will not model fabric
  stretch, loose sleeves, or hem behaviour; document where it stops rather
  than chasing it.

Exit: two constructions beyond the T-shirt pass the Phase 1 rubric at or
above the T-shirt's scores.

## Phase 5 — Guidance UX, performance, cross-device

Goal: a first-time user gets to a good frame without coaching, and the
system behaves on hardware other than the one it was tuned on.

Tasks:
- Framing guidance, in two parts. Free: map the three states that actually
  exist (`GOOD_FIT`, `TURN_TOO_FAR`, `TRACKING_LOST`) to one short
  instruction each — copy plus the Phase 1 pill, no new detection. Costed:
  `STEP_BACK` and `LOW_LIGHT` are declared but never assigned, so they need
  real detection written — distance is already available from
  `cameraDistanceM` on calibrated native, and a frame-luma estimate covers
  lighting. `FULL_BODY_REQUIRED` needs a decision first: at try-on framing
  the hips are routinely out of view and the pipeline tolerates it, so the
  state may not be wanted at all. Decide before implementing.
- Transport diet: drop `worldLandmarks` from the payload when the occluder
  is off; throttle `updateTransform` to the WebView's measured render rate
  instead of the detector rate; measure before and after.
- Thermal throttling / adaptive performance: currently zero handling.
  Three concrete strategies from the industry-research comparison below:
  inference decoupling (skip frames, interpolate the skeleton between),
  hardware delegation (already done — GPU delegate), dynamic resolution
  scaling via VisionCamera's Constraints API on rising temperature. Only
  the first and third are unimplemented. Not yet observed on-device but
  not instrumented for either — Phase 1 Test A-E ran short holds, not
  sustained load, so this is unverified either way, not confirmed absent.
- Second device (Step H) plus one more if available: orientation guard,
  calibration, frame rate. Record per-device results in the checklist.

Exit: Phase 1 floor held on a second device; guidance visible in the demo.

## Phase 6 — Failure and recovery, then final validation

Goal: nothing fails silently, and the M2 claim is backed by a recorded run.

Tasks:
- GLB load timeout with the existing banner; retry.
- Permission-denied and camera-not-available paths reviewed on device.
- Low-light and no-person states reuse the guidance from Phase 5.
- Run the full Phase 1 protocol again on the M2 garment set and record it.
  This recording is the capstone demo evidence; the report is the
  written defence.

Exit: M2 declared, with the report and recording as proof.

## Industry-research context (2026-09-04)

A general industry survey of real-time AR-on-mobile approaches
(`docs/research/ar-industry-survey-2026-09-04.md`, saved verbatim as
received — external source, author/publisher unknown) was reviewed against
this project's own architecture and this session's bug history. The
comparison is worth recording because it explains, rather than merely
coincides with, findings already in this document:

- **Stack choice validated.** `react-native-vision-camera` +
  `react-native-worklets-core` + MediaPipe pose detection matches the
  "Nitro Modules / Frame Processor" pattern the survey describes as the
  standard approach for real-time camera ML in React Native. Not a
  coincidence worth re-litigating — this is confirmation, not a signal to
  change course.
- **The WebView-hosted renderer is the architecturally fragile part, and
  this is a known industry pattern, not something this project got wrong
  in isolation.** Direct quote from the source: "rendering inside a
  web-view context often introduces unacceptable latency for live AR."
  `react-native-filament` — a React Native wrapper around Google's
  Filament, exposing its C++ rendering core so `.glb` loading, PBR
  materials, and skeletal animation run on the native UI thread in sync
  with VisionCamera's frame delivery — is the named real-time-grade
  alternative. Two of this session's worst bugs trace directly to the
  WebView/Three.js r128 choice:
  - The frustum-culling bug (§1 of `ar-tryon-audit-implementation-plan.md`
    finding #25) — a stale bind-pose bounding sphere never updated for a
    posed `SkinnedMesh` — is specific to that Three.js version and the
    GPU-only-skinning constraint it operates under.
  - The WebView/`<video>` z-order compositing risk this project's own audit
    already flagged (finding #25's "lower-confidence candidates" list) is
    exactly the latency/synchronization failure class the survey warns
    about.
  Citable in the thesis defense as a documented, known limitation of the
  WebView-rendering approach generally, not evidence of an implementation
  mistake specific to this codebase. `expo-gl`/native renderer transport
  (already scoped to M3 below) is the industry-recommended fix; not
  attempted before M3 for the reasons already stated in this document.
- **The GLB rest-pose mismatch bug has a named professional-pipeline
  analogue.** The survey's CLO3D section (rest-pose grading, blend shapes,
  standardized avatar rigging) describes, at production scale, the same
  consistency problem this project root-caused by hand: DB
  `rest_pose = "A_POSE"` disagreeing with a GLB's actual T-pose bind. A
  real pipeline enforces that consistency at ingestion; this project
  currently relies on per-garment manual calibration, which is exactly why
  it drifted. Ties directly to Phase 4's ingestion-hardening task above
  (measure `rest_pose_metric_width` from GLB geometry instead of trusting a
  typed number) — that task is this project's version of what the survey
  describes as standard practice, not a novel idea.
- **MediaPipe-vs-SMPL tradeoff, now precisely citable.** The survey names
  SMPL (Skinned Multi-Person Linear model, 6,890-vertex mesh, shape + pose
  parameters) as the academic/industry-standard full body representation,
  but explicitly frames it as computationally prohibitive for real-time
  mobile and names MediaPipe's 33-landmark BlazePose 3D as the practical
  substitute, supplying "sufficient anchor points and rotational vectors to
  align a pre-rigged 3D digital garment to the user's skeleton" — this
  project's exact approach, described almost verbatim. Useful thesis
  citation for *why* MediaPipe over a full mesh model, not just that this
  project chose it.
- **The "loose clothing" failure mode has a name, and it explains more than
  just occlusion.** The survey's own framing: baggy/loose garments obscure
  the visible body contours that pose/segmentation algorithms rely on,
  causing "misaligned digital garments, severe Z-fighting... and a total
  breakdown of the AR illusion" — cites `ClothHMR`'s two-stage fix
  (clothing-tailoring silhouette trim, then mesh recovery on the trimmed
  result) and `MuNet`'s joint body/clothing optimization loop as the
  research-stage answers. Relevant beyond Test D's already-expected
  occlusion failure: the Tailored Blazer (a looser-fitting garment than the
  Black tee) showing worse instability in several of this session's tests
  may be this same failure class, not purely the pose-orientation bug
  tracked as finding #1 above — worth re-examining findings #1/#2 with this
  lens before assuming pure Euler-math causation. Neither `ClothHMR` nor
  `MuNet` are implementable at capstone scope; cite as context for why the
  problem is hard, not as a fix to attempt.
- **Environmental lighting adaptation — a gap this roadmap didn't previously
  track.** The survey describes ARKit/ARCore ambient light estimation
  (colour temperature, intensity, light vector) feeding a PBR renderer's
  directional/ambient lights, so digital garments visually match the room.
  This project's renderer uses fixed lighting (`GarmentRenderer.tsx`, plus
  the Light +/- manual controls in 3D Studio mode) — no camera-derived
  light estimation exists. Not scoped into any phase above; flagging here
  as a known, real gap rather than silently absent. Low priority relative
  to findings #1/#2 above, but cheap to name in the thesis as a recognized
  limitation.
- **Thermal throttling / adaptive performance — now with concrete
  mitigation strategies, not just a named risk.** The survey lists three:
  (1) inference decoupling — run pose detection every Nth frame,
  interpolate the skeleton on the frames between; (2) hardware delegation —
  keep all inference on the GPU delegate, never fall back to CPU (this
  project already does this — MediaPipe's `usePoseDetection` runs a GPU
  delegate per `ar-system-contract.md`); (3) dynamic resolution scaling via
  VisionCamera's Constraints API when the OS reports rising temperature.
  (1) and (3) are genuinely unimplemented here and are the concrete Phase 5
  task, not just "add thermal handling" in the abstract.
- **Not actionable for this project, cite only:** enterprise AR SDKs
  (ZERO10, Snap Camera Kit, DeepAR) and 3D Gaussian Splatting are real
  approaches the survey covers, but licensing cost and infrastructure rule
  them out for a capstone. Worth a one-line "known industry alternatives"
  mention in the thesis, not a scoping candidate.

## What is deliberately not in scope before M3

- Native renderer transport (`expo-gl` or `react-native-filament` — the
  latter is the industry-survey-named alternative, see above).
- A physically-based fitting model (body model + garment construction +
  pose deformation). The current scale model is its foundation, not its
  replacement.
- Cloth simulation of any kind.
- Multiple simultaneous garments or accessories.
- Play Store distribution (not a project goal).

## Order of work, restated as a state machine

Phase 0 verify and freeze -> Phase 1 measure -> re-order Phases 2-4 from
the measurements -> Phase 5 harden -> Phase 6 prove -> M2. Not: read old
audit, find something interesting, modify architecture, discover another
problem, repeat.
