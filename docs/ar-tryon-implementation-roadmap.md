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
1. Write `docs/ar-system-contract.md`: inputs (33 landmarks, world
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
   manually; re-ingest Tailored Blazer in admin-dashboard against the
   Mixamo source and only then return it to `AR_READY`. Never guess the
   anchor offset.

Exit: contract doc merged; #28/#29/#17 recorded as pass or as a demonstrated
regression; Step H status honest.

## Phase 1 — Garment reality validation (evidence before design)

Goal: find out where the frozen geometry stops looking like clothing.
This phase decides the priorities of Phases 2 to 4. No architectural code
changes; instrumentation only.

Instrumentation (small, low risk, ship first):
- Effective update rate: count `updateTransform` calls per second on the
  native side and frames rendered per second inside the WebView; log both.
- Make the tracking pill honest. It latches true on the first frame and
  never reflects `pose.trackingState`. `TrackingState` already computes
  seven states (`INITIALIZING`, `GOOD_FIT`, `TURN_TOO_FAR`, `STEP_BACK`,
  `FULL_BODY_REQUIRED`, `LOW_LIGHT`, `TRACKING_LOST`) and the screen
  currently collapses all of them into one boolean. Surfacing them is
  wiring, not new detection, and it is most of Phase 5's guidance for free.
- Client-side calibration sanity guard in the metadata path: if
  `anatomical_anchor_offset` magnitude or `rest_pose_metric_width` fall
  outside plausible garment bounds, treat the record as
  `NEEDS_CALIBRATION` regardless of what the DB says. Defense in depth
  against the Blazer class of data; log loudly.

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

## Phase 2 — Occlusion (the biggest gap)

Goal: the wearer's arms and hands read as in front of the garment when they
are. Tiered so the capstone can stop at a defensible level.

- Tier 1, no new dependencies: finish what exists. Add the occlusion quad to
  the scene with depth-write on and colour-write off, feed it the joint
  uniforms already being updated, and tune capsule radii against Test D
  screenshots. Accept that it is skeletal approximation and say so in the
  contract doc. Also stop sending `worldLandmarks` when the occluder is
  disabled; it is dead payload today.
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

## Phase 3 — Fit semantics and data-contract hardening

Goal: "fit" means one thing, and bad data cannot masquerade as calibrated.

Tasks:
- Add `DEMO_RIG` to `IngestionStatus` (`src/types/garment.ts`) and have
  the fallback use it; downstream checks for `AR_READY` then mean
  calibrated only. Small, safe, do early.
- Extract `src/utils/garmentMetadataAdapter.ts`: snake_case to camelCase,
  bone-map inversion, and the Phase 1 sanity guard, with unit tests. The
  screen becomes orchestration for this path.
- Extract `src/utils/nativePoseCompatibility.ts`: the rotation
  compensation, its plausibility gate, and the `[COMP-GUARD]` telemetry,
  with unit tests for the gate on synthetic frontal, yawed, and stacked
  landmark sets. This is the permanent device-compat layer; isolate it.
- Length fit signal: compare the selected size's chart length to the
  tracked torso length (shoulder midpoint to hip midpoint, already
  available in world landmarks) and surface "runs long/short" as fit
  feedback. Keep the mesh scale uniform; do not stretch geometry until
  Phase 1 evidence says non-uniform scaling helps more than it distorts.
- Keep `STATURE_CORRECTION` explicitly provisional: name it as such in the
  contract, and add a single owner note that sizing must not grow to
  depend on it. Replace only with real calibration data or actual user
  measurements.

Exit: `AR_READY` is unambiguous; adapter and compat layer have tests;
sizing feedback reflects length, not just width.

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
- Framing guidance: map each of the seven `TrackingState` values to one
  short instruction (step back, get your whole body in frame, face the
  camera, more light, hold still). The states are already computed; this
  is copy plus the pill from Phase 1, no new detection and no new assets.
- Transport diet: drop `worldLandmarks` from the payload when the occluder
  is off; throttle `updateTransform` to the WebView's measured render rate
  instead of the detector rate; measure before and after.
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

## What is deliberately not in scope before M3

- Native renderer transport (`expo-gl` or similar).
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
