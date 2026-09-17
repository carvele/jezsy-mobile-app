# Filament experiment: first real-device verification

Date: 2026-09-13
Device: Infinix X6880, Android 15, arm64-v8a, connected via wireless adb debugging.
Branch: `main` (working tree at time of testing; Filament experiment already merged via PR #200,
implementation `b0e161e`, merge `fee2df7`).

This is the first time the isolated Filament experiment (see `docs/ar-filament-experiment.md`) has
actually run on a physical device. Decision gate #1 in that document ("verify cold launch, older-client
fallback, repeated renderer switching, pause/resume, and resource cleanup without native crashes") is
now **tested, and it fails** on two of its own criteria. This document records exactly what was tested
and the evidence for each finding, so it does not need to be re-discovered.

## Setup notes (environmental, not code findings)

- Host memory was severely constrained (as little as 0.5GB free of 7.7GB) from other concurrent
  Claude/agent sessions on the same machine. `android/gradle.properties` was tuned locally
  (`org.gradle.jvmargs` lowered, `org.gradle.parallel=false`, `org.gradle.workers.max=1`,
  `reactNativeArchitectures` narrowed to `arm64-v8a` only, matching the connected device). These are
  gitignored, local-only changes and did not touch any tracked file.
- Two `npx expo run:android` attempts were killed by session teardown (exit code -1, no real Gradle
  error) before the environment stabilized; a third attempt succeeded end to end and installed
  `com.jezsy.mobileapp` with `EXPO_PUBLIC_AR_FILAMENT_EXPERIMENT=1` baked in.
- Testing used deep links (`adb shell am start -a android.intent.action.VIEW -d
  "jezsymobileapp://ar-tryon/<product-id>"`) directly to the Cotton T-Shirt (Green) product for
  fast, repeatable navigation.

## Finding 1 (confirmed): renderer-switch teardown hangs the main thread

**Reproduction:** with live camera tracking active and the Filament renderer selected, tap the
in-app "Renderer: Filament prototype (switch)" control to switch back to Three.js.

**Result:** the app's main thread stopped responding to input. `adb shell input keyevent` timed out
after 5 seconds; Android's ActivityManager recorded a genuine ANR:

```
Subject: Input dispatching timed out (com.jezsy.mobileapp/com.jezsy.mobileapp.MainActivity
(server) is not responding. Waited 5000ms for MotionEvent).
```

captured at `/data/anr/anr_2026-09-13-00-21-53-011` on device. The app recovered by bouncing to the
Expo dev-client launcher screen (Android's ANR handling, not a deliberate close).

**Why this matters:** this is the very first renderer-switch attempt in the whole experiment's
history (no prior bundle reload, no accumulated state). `app/ar-tryon/[id].tsx` already does the
right thing on its own side -- it forces a full remount via `key={trackingSessionKey}` when
`experimentRenderer` changes, so React should run the old tree's unmount/cleanup effects. The hang is
downstream of that, most likely inside `react-native-filament`'s native `Engine::destroy()` path
(see Finding 3) blocking synchronously long enough to starve input dispatch.

## Finding 2 (confirmed, not yet root-caused to a single line): Filament garment anchor and color are wrong

**Reproduction:** switch to the Filament renderer with live camera tracking active, facing the
camera upright.

**Result (screenshot evidence, this session):**
- The garment renders roughly a head-height too high -- sitting at the neck/chin instead of the
  shoulders. The wearer's own real shirt is visible below it.
- The garment renders dark gray/near-black instead of the product's actual green.
- The static "3D Studio Mode" view (always Three.js, confirmed in code -- Filament is never used
  there regardless of which renderer is selected) renders the identical GLB correctly: sleeves and
  collar sit naturally, confirming the asset itself is fine and the bug is renderer-specific.

**What was ruled out, with numeric evidence** (via three added `TEMP DEBUG` log statements in
`src/components/AR/FilamentScene.native.tsx`, since reverted -- see below):
- The GLB does **not** carry a baked root-entity offset that Filament's importer preserves and
  Three.js's discards: `transformManager.getWorldTransform(root)` and `getTransform(root)` both
  read `(0, 0, 0)` immediately after load.
- `metadata.anatomicalAnchorOffset` (`{x:~0, y:0.105, z:~0}`) and `restPoseMetricWidth` (`0.260`)
  are the same calibrated values the working Three.js path uses -- not corrupted or missing.
- The `anchoredPosition()` formula in `src/utils/filamentExperimentMath.ts` is algebraically
  identical to the verified Three.js formula (`garmentModel.position.set(-anchorOffset...)` on a
  child of a group already positioned/scaled/rotated to the projection). Working through the actual
  logged numbers (`landmarks[11]/[12]`, `stageWidth/stageHeight`, `cameraCalibration`) by hand
  confirms the *intended* target position matches where the real shoulders are in the photographed
  frame (~47% down, matching `position.y` before the anchor subtraction).
- The magnitude of the actual visual displacement (~40-45% of frame height) is far larger than
  either of the two remaining candidate mechanisms could explain from the logged numbers alone:
  - a possible `Scale*Rotate*Translate` vs. `Translate*Rotate*Scale` matrix-order mismatch in
    `transformManager.createIdentityMatrix().scaling(s).rotate(r).translate(p)` (estimated ~2% of
    frame height given the actual logged scale/rotation, too small on its own), or
  - the native `camera.setProjection(fov, aspect, near, far, direction)` call, whose fifth
    `'vertical'`/`'horizontal'` argument is undocumented in the TypeScript types and, per
    `docs/ar-filament-experiment.md`, is only pinned by a **mocked** test -- never previously
    verified against real native behavior.

**Status:** not resolved. A `transformManager.getWorldTransform(root)` read-back *after*
`setTransform`/`commitLocalTransformTransaction` was staged (to directly confirm or rule out the
matrix-order hypothesis) but never captured -- the device hung (Finding 3) before that data point was
collected.

## Finding 3 (confirmed via ANR thread dump): JS runtime and Filament engine instances are not being cleaned up across reloads

Pulling `/data/anr/anr_2026-09-13-00-40-44-212` (a second, later ANR, this one during Filament model
loading, also with `input keyevent` timing out) and enumerating every thread in the app process
showed:

- **Three** `mqt_v_js` threads (Hermes JS VM) -- a healthy app has exactly one.
- **Six** `hades` threads (Hermes's GC) -- one JS runtime's worth would be far fewer.
- **Two** `FilamentRendere` threads, **four** `FEngine::loop` threads, **six** `JobSystem::loop`
  threads -- Filament's native engine, doubled.

This count matches exactly how many times the JS bundle was reloaded via the dev-client deep link
(`exp+jezsy-mobile-app://expo-development-client/?url=...`) during this debugging session (3 loads)
and how many times the Filament scene was mounted (2). `react-native-filament`'s own
`useDisposableResource` hook (in `node_modules/react-native-filament/src/hooks/useDisposableResource.ts`)
is written correctly -- it does call `.release()` on unmount, including the async-load-then-unmount
race. The leak is consistent with a full Metro bundle reload discarding the old JS context (and
whatever React tree it was running) without ever calling that cleanup effect, rather than with a bug
in the disposal code itself.

**This means two separate things are true at once:**
1. Finding 1 (the renderer-switch hang) happened on the very first switch, before any bundle reload
   existed -- so it is a real, user-reachable bug independent of this leak.
2. The later, more severe hang (Finding 2's investigation being cut short) happened after repeated
   bundle reloads had already stacked up extra JS/Filament instances -- so it was made worse by this
   session's own debugging workflow, not purely by end-user-reachable behavior.

## Recovery

Both hangs were resolved with `adb shell am force-stop com.jezsy.mobileapp` (a clean kill, no data
loss) rather than continuing to send input to an unresponsive screen.

## Recommendation

Decision gate #1 in `docs/ar-filament-experiment.md` ("repeated renderer switching... without native
crashes") has now been tested on real hardware and **fails**: renderer teardown can hang the main
thread badly enough to trigger Android's ANR watchdog, on the very first switch. This is a real
reliability defect, not a measurement artifact.

Per the experiment doc's own decision framework ("No automatic adoption" / "Record results and decide
whether the measured benefit warrants a migration"), this finding is reason enough to **not invest
further in tuning Filament's projection/anchor/color issues (Finding 2) until the engine-teardown hang
(Finding 1) is understood** -- a renderer that can freeze the app is a blocker independent of whether
its garment placement is ever made visually correct. The next useful step, if this experiment
continues, is isolating Finding 1 without any bundle-reload noise (a single clean cold launch, one
renderer switch, nothing else) to get an ANR trace uncontaminated by Finding 3's leak, since the two
were tested together this session.

## Follow-up attempted, not completed

After force-stopping the app to get a clean process (no leaked JS/Filament instances), a fresh cold
launch + single renderer switch was attempted specifically to reproduce Finding 1 in isolation from
Finding 3's leak. The dev client could not reconnect to either Metro instance (`:8081` or `:8090`)
across several retries -- `curl` from the host confirmed both servers were up and fast (<2ms), and
`adb devices` still showed the phone connected, so this is dev-client/Wi-Fi routing flakiness (quite
possibly triggered by plugging the phone in to charge mid-session, which can make Android reprioritize
its network path for app traffic away from Wi-Fi) rather than a new finding. The isolated re-test of
Finding 1 remains open for the next device session.

## Cleanup

The three `TEMP DEBUG` diagnostic `console.log` blocks added to
`src/components/AR/FilamentScene.native.tsx` during this investigation should be removed once this
finding is reviewed; they are non-destructive (gated to fire at most once per mount) and safe to leave
in the interim if further live debugging is expected in the same session.
