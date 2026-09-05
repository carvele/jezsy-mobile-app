# AR Try-On — Current State

Last updated: 2026-09-04, late night (frustum-culling bug root-caused and fixed; Tailored Blazer's T-pose sleeves and low anchor root-caused, fixed, and committed live to Supabase). Repo: `jezsy-mobile-app`, branch `main`. Frustum-culling fix is committed (`92cce3d`, **not pushed**). The T-pose/anchor fix was a DB-only correction (no code diff — temp overrides used to verify it were added and then fully removed from `[id].tsx`, `git diff` on that file is clean). Paste this whole file into a new conversation for full context; no other history is needed.

## 2026-09-04 session — read this before anything below (which is from 2026-09-02 and partly stale)

Three real bugs found and fixed on the Tailored Blazer, all device-verified:

1. **Intermittent invisibility (root cause of the "#25 anchor retry failed twice" mystery below).** Three.js r128 computes a `SkinnedMesh`'s `boundingSphere` once from raw bind-pose data and never updates it for the posed/retargeted shape. `WebGLRenderer` frustum-culls against that stale sphere, so a provably-correct transform could still be silently skipped — explains why identical, correct numbers sometimes rendered and sometimes didn't. Fixed with one line in `GarmentRenderer.tsx`, right after `garmentGroup.add(garmentModel)`: `garmentModel.traverse(child => { if (child.isMesh) child.frustumCulled = false })`. Committed `92cce3d`. Full writeup: `ar-tryon-audit-implementation-plan.md` item #25.
2. **T-pose sleeves** (only visible once #1 stopped masking it). DB had `garment_metadata.rest_pose = "A_POSE"` for this product, but the GLB's actual bind pose is T-pose. `calculateBoneRotationsFromCanonical` computed every arm rotation delta relative to the wrong 35°-drooped reference, systematically under-rotating (~47-49° instead of the ~90° a lowered arm needs). Fixed in the DB: `rest_pose` → `"T_POSE"`. Live-verified: arm rotation now ~85°, sleeves hang down naturally.
3. **Anchor too low** ("sits low" symptom noted below, that session couldn't resolve because #1 made every retry look like a fresh failure). DB's `anatomical_anchor_offset.y = 1.304` pins the garment to `Spine2` (chest height) instead of the shoulder line. Bisected live between that and the shoulder-midpoint value (`1.4367`, which overshot to the jawline): `y = 1.35` puts the collar right at the neck/shoulder line. Fixed in the DB.

**Not re-tested this session, carry forward:**
- Arms raised / bent poses (only the fully-arms-down case was verified for the T-pose fix — should generalize since the fix is just correcting a reference angle, but not confirmed).
- The pre-existing "scale/position instability while turning" item (below, and in the audit plan) — unrelated to tonight's three fixes, still open.
- A fresh cold-launch re-check of the Blazer end-to-end, now that both DB fields are live (tonight's live verification was via local-only overrides that matched what's now actually in the DB, but a from-scratch confirmation costs little and rules out any transcription slip in the manual SQL edit).

**Below this point is the 2026-09-02 state** — still accurate for everything it covers except the Blazer-specific items just listed, which the above supersedes.

## Read these first

Three documents, in order of authority for forward work:

1. **`docs/ar-tryon-implementation-roadmap.md`** — the plan of record. Phases 0-6, M2 (capstone cut line) vs M3 (post-capstone). Supersedes the audit plan's "Remaining sequencing".
2. **`docs/ar-system-contract.md`** — Phase 0 deliverable. Pins one meaning each for pose, fit, depth, ready. Marks declared-but-unproduced shapes ASPIRATIONAL so nobody builds against them.
3. **`docs/ar-tryon-audit-implementation-plan.md`** and **`docs/ar-tryon-physical-verification-checklist.md`** — historical evidence base. Findings there are closed unless a regression is demonstrated on device.

**Discipline that matters more than any single finding:** Phase 0 verify and freeze -> Phase 1 measure -> let evidence re-order Phases 2-4 -> Phase 5 harden -> Phase 6 prove. Not: read old audit, find something interesting, change architecture, discover another problem, repeat. M1 geometry is frozen; do not reopen #24/#27/#3/#6 etc. without a demonstrated regression.

## Baseline moved 2026-09-02 evening — teammate work landed

Ten commits arrived on `origin/main` from the teammate (BoutiqueAR authoring, Bautista-10 merging PRs #184-#188) while the planning docs were being written:

- `6ee23ee` stop Welcome flash on session state blips
- `c8c8799`, `827f2a6` temp debug instrumentation (both **since removed** — verified zero `console.log` remaining in either layout file)
- `37f79b0` stop root redirect effect double-firing `router.replace('/(tabs)')`
- `7e0037a` eliminate the `/` route collision between `(auth)` and `(tabs)`; renames `app/(auth)/index.tsx` -> `app/(auth)/onboarding.tsx`

Footprint: `app/(auth)/`, `app/(tabs)/_layout.tsx`, `app/_layout.tsx`. **Zero overlap with any AR file**, so the docs commit rebased cleanly.

**Carry this into the next device session:** root routing and the auth route names just changed. Confirm navigation into AR try-on still works *before* running the #28/#29/#17 checks, or a routing regression could masquerade as an AR failure and send the next agent hunting in the wrong pipeline.

## Session recap (2026-09-02, full day)

Started from the prior night's exact next step (#24 re-verification), worked all the way through `docs/ar-tryon-physical-verification-checklist.md`, then addressed every remaining open item from `docs/ar-tryon-audit-implementation-plan.md` per explicit user decisions, including two live production-DB corrections.

**Fixed and live-verified:**
- **#24** — native orientation. `forceCameraOrientation` added, confirmed correct-but-insufficient alone; JS-side compensation (`shouldCorrectNativeLandmarkRotation`) reliability re-confirmed with `[COMP-GUARD]` instrumentation (39/39 frames correct after a fresh app restart). `ce5daef`.
- **#27** — camera distance triangulation had no yaw correction. Fixed by sharing `yawCosCorrection` between `exactScale` and the distance formula. Live-verified across near/mid/far distance and 0°→59° yaw. `02fbfb7`.
- **#1/#2 (Steps B/C/E)** — `unprojectToZ0`/`exactScale`. Full distance sweep (0.69m/0.88m/1.36m) confirms `cameraDistanceM` tracks real movement while `targetWorldWidth`/`exactScale` correctly stay distance-invariant; yaw sweep shows no drift. Passed.
- **#3 (Step F)** — roll sign. Now visually *and* numerically confirmed (right/left shoulder-down produce correctly-signed, correctly-tilting roll). `3cfe99c`.
- **#6 (Step G)** — invalid-torso fallback. Couldn't force `torso.valid=false` physically (MediaPipe stayed valid through hand-occlusion and a true ~81° profile turn) — verified deterministically instead with 4 new unit tests in `skeletalRetargeter.test.ts`. `0e39aea`.

**Checklist Steps I–N:**
- **I** — Black tee's 3D Studio proportions look reasonable, no fix needed.
- **J** — confirmed the ingestion-gate CODE is correct; Blazer's live-broken render was a DB-side gap (now fixed, see below).
- **K** — background-pause confirmed working; found a real gap on foreground-resume (see #29 below). `fd11113`.
- **L** — tracking-loss recovery confirmed: garment degrades gracefully (shrinks, doesn't freeze/jump) and reacquires cleanly.
- **M** — no live GLB-failure trigger available (no DB write access at the time); verified the error-to-banner wiring statically instead — complete end-to-end, no gap found.
- **N** — effectively covered by #27's distance/yaw verification data.
- **Entire checklist addressed except Step H** (second-device guard test) — **left open**, no second device available. Not faked.

**New findings from re-testing, both fixed:**
- **#28** — `mapCoverCrop`/`unprojectToZ0` mis-projected when a landmark exceeded [0,1] (wearer partially out of frame). Fixed by clamping input at `mapCoverCrop`'s single entry point. `63512ba`.
- **#29** — `<Camera>`'s `onError` only did `console.warn`, leaving a permanently black feed with a stale "tracking active" pill after a real OS-level `camera-is-restricted` error. Fixed: error banner + Retry button (remounts `<Camera>` via a key), clears `isTrackerActive`, auto-clears if a real frame arrives. `486d90c`.
- Both #28/#29 are type-checked, unit-tested, smoke-tested live for regressions (30+ tracking frames, no crash) — **not** deeply re-verified against their *exact* original trigger conditions (battery-limited that session).

**Three "needs a decision" items — all resolved per explicit user decisions:**
- **#14 (`isMatched`/`matchScore`/`matchFeedback`)** — decided "remove it". Dead state (never had a setter called) deleted; tracking pill simplified to its only reachable branch. `e2f8504`.
- **#5 (body-ratio ~14% inflation)** — decided "apply a rough correction now". Added `STATURE_CORRECTION = 0.114` based on commonly-cited body-segment proportions, clearly flagged as provisional/not-measured-on-real-users. `9ed64ec`.
- **#17 (`cosYaw` floor doesn't saturate past ~49°)** — decided "invest in a better model". Added `lastReliableCosYaw` cross-frame state (same pattern as `smoothedCameraDistance`) so the correction genuinely plateaus instead of continuing to shrink past the threshold. Scoped to `GarmentRenderer.tsx`'s live 3D path only; `garmentFitter.ts`'s legacy 2D-overlay floor deliberately left untouched (lower value, bigger API change). `d7a3140`. **Saturation behavior itself not re-verified live** (needs a yaw sweep past ~49°, deferred on low battery).

**Live production DB corrections (Supabase, `wufcmtndotfvxvvxkamv`), done with explicit user approval:**
- **Cotton T-Shirt** (`b0000009-...002`) — `rest_pose_metric_width` corrected `0.22` → `0.4`, `anatomical_anchor_offset` copied from Black tee (identical GLB file, live A/B-confirmed correct), `anchor_confidence` set to `inferred`. **Fully fixed, back to `AR_READY` with sane data.**
- **Tailored Blazer** (`b0000008-...002`) — no verified-correct replacement value exists (Mixamo-sourced GLB, no known-good sibling, confirmed with the product owner). Instead of guessing, `ingestion_status` flipped `AR_READY` → `NEEDS_CALIBRATION`, engaging the existing #18 demo-rig fallback so it no longer renders the broken 1.3m-offset data live. **Still needs real re-calibration in admin-dashboard before going back to `AR_READY`.**

**Housekeeping:**
- 16 untracked scratch Python files removed from `jezsy-mobile-app` (one-off regex patch scripts, all superseded by properly-committed fixes).
- 3 more removed from the sibling `admin-dashboard` repo, same pattern.
- `admin-dashboard`'s `a3eef9c` (ingestion-modal fix, from the prior night) — push was blocked by the permission classifier; **user needs to push that one manually**: `cd C:\Users\carlv\admin-dashboard && git push origin main`.

**Planning artifacts written after the engineering work:**
- `55e9f7f` — `docs/ar-tryon-implementation-roadmap.md`, the forward plan.
- `4148355` — `docs/ar-system-contract.md`, plus a correction to the roadmap (see below).

**Correction captured while writing the contract.** An earlier draft of the roadmap claimed `TrackingState` "already computes seven states", making guidance look nearly free. The source contradicts that: `poseConstructor.ts` assigns exactly three — `GOOD_FIT`, `TURN_TOO_FAR` (`abs(yaw) >= 25°`), `TRACKING_LOST` (shoulder visibility `< 0.35`). `INITIALIZING`, `STEP_BACK`, `FULL_BODY_REQUIRED`, `LOW_LIGHT` are declared and never assigned. The error came from reading the type and inferring behaviour instead of checking the producer. Both docs now state the real figure. **Do not let an agent conclude that distance, lighting, or full-body guidance already exists because the enum member does.**

**Everything above is committed and pushed to `origin/main`** (`4148355`). Nothing is stashed, nothing uncommitted, nothing unpushed in `jezsy-mobile-app`.

## Architecture

- Expo dev-client (CNG/prebuild), not Expo Go. Native modules: `react-native-vision-camera`, `react-native-mediapipe-posedetection`, `react-native-worklets-core`. Cannot be verified in Expo Go or a browser preview.
- Native pipeline: `<Camera>` (vision-camera) → MediaPipe pose landmarker (`usePoseDetection`, GPU delegate) → runtime-gated landmark-rotation compensation in `onNativePoseResults` → `poseConstructor.ts` builds a `BodyPose` → `poseNormalizer.ts` builds a `CanonicalPose` (Y-up torso basis) → `garmentFitter.ts` computes 2D anchor/scale + `orientation3D` → `skeletalRetargeter.ts` computes per-bone rotation deltas → pushed via `GarmentRendererRef.updateTransform()`.
- Web pipeline: `WebCameraFeed` runs MediaPipe directly into the same `handlePoseResults`. The rotation compensation is native-only — untouched.
- 3D render: `GarmentRenderer.tsx` renders a Three.js scene inside a `WebView` (native) or `iframe` (web), built from a string-injected HTML/JS bundle. Async config crosses via `postMessage`.
- Camera calibration (native only): real vertical FOV + similar-triangles distance triangulation, now yaw-corrected (#27) with genuine saturation past ~49° (#17).
- 3D Studio mode (`model-viewer`) is a separate, simpler preview path — no pose tracking.

## Database contract

Table `public.products`: `model_3d_url`, `garment_metadata` (snake_case, `ingestion_status ∈ {AR_READY, NEEDS_MERCHANT_MAPPING, NOT_AR_COMPATIBLE, NEEDS_CALIBRATION}`, gates real rendering vs. demo-rig fallback), `ar_data` (owner-dashboard tracking, non-blocking). `user_measurements` feeds `useSizingProfile()`.

Confirmed live: Black tee and Cotton T-Shirt share the *identical* GLB file (`1787936209625_Untitled.glb`) — the DB is not the single source of truth for "what does this GLB actually look like," merchant-entered numbers can silently disagree with the file itself. This is exactly why Cotton T-Shirt could be fixed with confidence (copy the sibling) while the Blazer could not (no sibling, no verified reference).

## Proven functionality (device-verified, Infinix X6880)

- App builds, signs in, navigates, loads AR try-on with no crashes across the entire session. Camera/MediaPipe/worklets init cleanly, including after backgrounding and app restarts.
- `roll` reads ~0-9° for an upright subject via the JS compensation (39/39 sampled frames after a fresh restart).
- `cameraDistanceM` tracks real physical distance correctly and stays yaw-stable (no runaway) within the corrected model's range.
- `exactScale`/`targetWorldWidth` stay distance-invariant as designed, confirmed across a 0.69m–1.36m sweep.
- Roll sign confirmed both numerically and visually for both shoulder-tilt directions.
- Tracking-loss and reacquisition both confirmed clean (graceful degrade, no stale artifact on return).
- `npx tsc --noEmit`: 0 errors, repo-wide. Full Jest suite (`src/utils/__tests__/`): 34/34 passing, including 4 new tests for #6.

## Known remaining gaps

1. **Step H not run** — second-device guard test for `shouldCorrectNativeLandmarkRotation` needs a second Android device to confirm it correctly no-ops on hardware without the native bug (or correctly fires on hardware that has it). None available. Left open, not faked.
2. **#28/#29 not deeply re-verified live** — both fixes are implemented, type-checked, unit-tested, and smoke-tested for regressions, but their *exact* original trigger conditions (a landmark past [0,1]; a real `camera-is-restricted` OS error) weren't specifically re-reproduced to confirm the fix on-device.
3. **#17's saturation behavior not re-verified live** — implemented and reasoned through, but needs an actual yaw sweep past ~49° on-device to confirm the plateau behaves as designed.
4. ~~Tailored Blazer still needs real re-calibration~~ — **fixed 2026-09-04**, see the session note at the top of this file. `rest_pose` and `anatomical_anchor_offset.y` corrected live in Supabase; product is `AR_READY` with real (not demo-rig) data.
5. **Debug instrumentation left in place**: `[CAL-DEBUG]`, `[WEBVIEW-RELAY]`, `[COMP-GUARD]` console logging. Deliberately kept — the JS-side rotation compensation is a permanent load-bearing fix, not a removable workaround pending a native-library fix, so there's no clear trigger to remove the instrumentation either.
6. `poseNormalizer.test.ts` exists and passes but wasn't specifically re-run against every change this session beyond the standard full-suite runs already done.
7. **Occlusion is inactive**, not merely approximate. The capsule shader, full-screen quad and per-frame joint uniforms all exist, but `scene.add(occlusionMesh)` is commented out (`GarmentRenderer.tsx:387`). Consequence: `worldLandmarks` are serialised into every transport frame to feed a mesh that is never drawn. Roadmap Phase 2 Tier 1 is reconnection, not new construction.
8. ~~**`AR_READY` is not proof of calibration.**~~ **Closed 2026-09-04** (roadmap Phase 3): the demo-rig fallback now marks itself `DEMO_RIG` rather than stamping `AR_READY`, and `isDemoRig` is derived from the metadata instead of being tracked as separate React state, so the two cannot disagree. `AR_READY` means calibrated. See `ar-system-contract.md` section 9.
9. **Fit means uniform shoulder-width matching**, not body/garment fitting. Length, chest depth and construction are unmodelled. `LeftShoulder`/`RightShoulder` are in the bone map but never driven — a concrete deformation-quality lever for Phase 4.
10. **Native transport is prototype-grade and unmeasured**: `JSON.stringify` + `injectJavaScript` per frame. No GLB load timeout exists. Measuring the ceiling is Phase 1 instrumentation.

## Exact next steps — Phase 0 of the roadmap, nothing else

Work the roadmap's Phase 0 to completion before starting anything from Phases 1-6. Do not begin occlusion, deformation, renderer changes, fitting-model work, or refactoring during Phase 0.

**Needs the phone** (charged, reachable, wireless debugging on — it was last seen at 23%):
1. Confirm navigation into AR try-on still works after the teammate's routing changes. Do this first, so a routing regression cannot be mistaken for an AR failure.
2. #28 — turn far enough to push a shoulder landmark past the `[0,1]` frame edge; confirm the `mapCoverCrop` clamp holds alignment.
3. #29 — background/foreground until the OS `camera-is-restricted` error recurs; confirm the banner appears and Retry remounts the camera.
4. #17 — yaw sweep past ~49°; confirm `lastReliableCosYaw` plateaus rather than continuing to shrink.
   Record real numbers in the checklist doc. Any failure here is a genuine regression and is the only thing that reopens M1.

**Needs a second device** (none available):
5. Step H — the compensation guard on hardware other than the Infinix X6880. Leave open. Do not simulate it.

**Needs no device, can be done any time:**
6. Push `admin-dashboard`'s `a3eef9c` manually: `cd C:\Users\carlv\admin-dashboard && git push origin main`. The permission classifier blocks the agent from doing it.
7. ~~Re-calibrate the Tailored Blazer GLB~~ — done 2026-09-04, see the session note at the top of this file.
8. Push this repo's `92cce3d` (frustum-culling fix) — committed, not yet pushed.

**Then, and only then:** Phase 1 — instrumentation (effective update rate, honest tracking pill, client-side calibration sanity guard) followed by the A-E garment-reality tests on two calibrated garments with two people. That report re-orders Phases 2-4. The next substantive question is no longer "what else is wrong with the AR math" but "how well does this behave as clothing".

**Deliberately not scheduled** (M3, post-capstone): native renderer transport, physically meaningful fitting model, cloth simulation, multi-garment. Naming them here so nobody mistakes them for backlog.
