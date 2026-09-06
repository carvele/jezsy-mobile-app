# AR fit and tracking reliability

Date: 2026-09-06

Code/test commit: `8231e1b` (`fix(ar-tryon): expire stale tracking and restore guarded length feedback`).

## Scope and checkout

Implemented in `codex/ar-fit-tracking-reliability`, in the isolated worktree
`C:/Users/carlv/jezsy-ar-reliability-20260906`, based on `main` at
`e5f0dcd4928c54fd1f03124b29adc69fab9fad78`.
The shared checkout contained other sessions' changes, including an AR route-availability gate;
those changes were not copied, overwritten, or committed here. Integration must preserve that gate.

This is a reliability increment, not completion of the full AR roadmap or a native-renderer migration.
The earlier handover does not match every file at this base: the length helper, metadata adapter,
and their tests existed, but the AR screen no longer used them.

## Implemented

- One tracking-session owner for searching, tracking, turned, lost, and paused states.
- Valid poses expire after 750 ms without another valid arrival; the host checks every 100 ms.
  Missing/invalid pose callbacks clear the garment and live length immediately.
- A stopped session rejects old callbacks before they can update filters or rendering.
- Product, recommended size, chart, model, camera, stage, mode, consent, focus, and foreground
  boundaries invalidate the relevant live session; new sessions require new pose results.
- Both web and native camera paths respect the screen's consent and lifecycle gating.
- Renderer visibility hides the entire overlay, including its occlusion geometry, without changing
  the renderer document or Three.js version, shaders, scale, yaw, or skeletal math.
- Length feedback is reconnected to the recommended size's actual chart length. It requires a
  complete metric-world pose and visible, finite shoulder/hip landmarks with confidence at least 0.65.
  Normalized-coordinate fallback used elsewhere in the pose pipeline is never used as metric input here.
- The generic hip-drop baseline applies only to shirt/jacket categories; other categories show no
  length verdict. The labels are Typical, Shorter, and Longer, explicitly described as rough estimates
  for a hip-covering top, not fit guarantees. No size recommendation or garment scale is changed.
- Demo metadata again uses `DEMO_RIG`; calibrated metadata uses the existing tested adapter and sanity check.
- Searching/loss/turn guidance remains visible, tight-fit verdicts use a warning color, and the temporary
  log containing saved body measurements is removed.

## Verification

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.
- ESLint: all ten changed/new source and test files passed with no warnings or errors.
- Jest: `node node_modules/jest/bin/jest.js --runInBand` passed, 23 suites and 212 tests (44 new).
  The existing recovery-link negative test intentionally emits its expired-token error message.
- Renderer component tests cover web and Android host visibility and unchanged renderer documents.
  They do not exercise an actual GPU, WebView, or camera.
- No Android device was connected. No physical, browser-camera, or end-to-end performance verification
  was claimed or performed. Dependencies were reused through a local node_modules junction; no dependency
  manifests or lockfiles were changed and no native rebuild was performed.

## Device checks still required

Use the existing Expo development client, not Expo Go, after integrating this branch with any concurrent changes.

1. Enter live mode: the garment remains hidden until tracking is acquired; searching guidance is visible.
2. Track a shirt or jacket with a chart length and saved sizing profile: confirm a labeled approximate
   length result. Compare against real garment/body measurements before accepting the existing baseline.
3. Cover shoulders/hips, leave the frame, and return: the estimate clears, the garment disappears,
   loss guidance appears, and a new pose restores tracking without the old filter position lingering.
4. Turn sideways: guidance changes and live length is withheld. Known near-profile depth distortion
   is not resolved by these changes.
5. Switch product/size/view, background/foreground, navigate away/back, and use existing camera Retry:
   no previous session's estimate or garment should flash before new tracking.
6. Verify unavailable metric data and non-top categories produce no length verdict. Check long guidance
   and fit-note wrapping on small screens and with larger text settings.
7. Check sustained frame rate, heat, battery behavior, and reacquisition flicker on the original device
   and a second device. The 0.65 confidence and 750 ms freshness thresholds are initial UX choices,
   not device-validated accuracy or latency guarantees.

The freshness timer measures callback arrival on the host. It does not measure camera-to-render latency,
detect every queued native frame, or hide a garment while the JavaScript thread itself is stalled.
Host visibility does not stop the underlying render loop. Style-specific length baselines, realistic
cloth deformation, asset calibration, and performance benchmarking remain separate work.

## Preserved boundaries

No Three.js r128 upgrade, Filament/VisionCamera migration, new dependencies, database changes,
asset rewrites, push, or Phase 6 work. The physical checks above concern this increment; they do
not authorize the separately gated full Phase 6 final-validation protocol.
Documentation and the activity log remain uncommitted per repository convention.
