# Isolated Filament renderer experiment

Date: 2026-09-07

## Status and scope

Experimental implementation, not a renderer migration or a performance result.
Branch: `codex/ar-filament-experiment`.
Worktree: `C:/Users/carlv/jezsy-ar-filament-experiment`.
Base: `codex/ar-fit-tracking-reliability` at `8231e1b` (which is based on main at `e5f0dcd`).
The shared checkout and its concurrent changes were not modified.

The user approved adding Filament and rebuilding the development client for this isolated experiment.
Phase 6 remains separately gated. No Three.js version, shader, or existing renderer math was changed.

## Implemented

- Pin `react-native-filament` to `1.11.0`; retain the installed VisionCamera 4.7.3,
  MediaPipe pose wrapper, Reanimated, and both existing worklet packages unchanged.
  The lockfile adds only Filament; no dependency upgrades are bundled into this experiment.
- Enable nested worklet processing for the existing worklets-core Babel plugin.
- Developer-only opt-in controls in the existing AR screen, defaulting to Three.js.
- One selected product's same GLB URL and metadata passed to either renderer; only one renderer
  is mounted at a time. Switching the experimental renderer resets its scene and tracking session.
- Keep the existing native camera, compatibility compensation, pose construction, canonical pose,
  garment fitter, retargeter, consent, and freshness gates.
- Filament accepts the existing imperative transform contract. Host-side projection builds a
  latest-value packet; the native render callback applies each packet once and refreshes skinning
  after committing the transform transaction. Inference is not forced to run at render frequency.
- Preserve anatomical anchor offset, calibrated camera conventions, shoulder-based uniform scale,
  fit modifier, bind-relative four-arm-bone correction, and a single host-view mirror.
- Require all four mapped arm bones and reject degenerate, reflected, or sheared bind transforms
  instead of presenting a silent rigid-only success.
- Synthetic six-second, 20 Hz replay through the existing pose/retargeting pipeline. It restarts
  on renderer switches, pauses camera capture, ignores late native input, and hides the fit panel.
  No personal pose recording or persistence was added.
- Missing-native-module fallback and a React error boundary; a separate web stub keeps the native
  Filament implementation out of the web renderer path.

## Important limits

This is a projection/skinning/compositing prototype. Filament body occlusion has NOT been ported.
The UI states this explicitly. Lighting is not matched to the Three.js scene. Culling behavior,
TextureView compositing/mirroring, GPU performance, thermal behavior, and live bone alignment are
unverified. Do not compare raw frame rates and conclude Filament wins while these workloads differ.

The projection helper is an experimental port of the existing camera formulas, including the
current calibrated aspect/crop convention and smoothing constants. It is not an independently
validated camera calibration model. Full numerical replay parity against the actual Three.js
runtime is still needed, especially for simultaneous pitch/yaw and near-profile motion.

The fixture is synthetic, not a recorded real-device pose trace. It exercises arm movement and
translation, not realistic ML jitter, depth ambiguity, body masking, or fabric dynamics.
There is no live cloth simulation and no accuracy or 60 FPS guarantee.

The installed library's asset-loading hook logs fetch failures without surfacing an error state to
its model hook. A failed request can therefore remain on the prototype's loading label; switching
back to Three.js remains available. No model timeout/retry subsystem was added under this experiment.

## Verification

- Existing and new Jest tests: 25 suites, 223 tests passed (11 added).
- TypeScript passed with `node --max-old-space-size=1536 node_modules/typescript/bin/tsc --noEmit`.
- Changed-file ESLint passed without errors or warnings.
- Babel transformed the AR screen, web fallback, and native scene; the native scene's render
  callback contains the generated worklet marker.
- Android prebuild passed after referencing the existing local Google Services configuration
  through `GOOGLE_SERVICES_JSON`; its contents were not displayed or committed.
- Initial native build attempts failed from host memory exhaustion, before Filament compilation.
  This is not evidence of Filament compatibility or incompatibility.
- No device is connected. No APK installation, physical comparison, GPU measurement, or Phase 6
  final-validation protocol has been performed.

## Run locally after resolving the build prerequisite

Use this worktree and the existing local Android configuration. Do not use Expo Go or overwrite
another session's running development server. From PowerShell:

```powershell
Set-Location C:/Users/carlv/jezsy-ar-filament-experiment
$env:EXPO_PUBLIC_AR_FILAMENT_EXPERIMENT='1'
$env:GOOGLE_SERVICES_JSON='C:/Users/carlv/jezsy-mobile-app/google-services.json'
npm ci
npx expo prebuild --platform android --no-install
npx expo run:android --port 8082
```

The configuration path is local to this machine; provide your own existing file on another host.
Do not add credentials to Git. Android is generated and ignored. This worktree has its own
node_modules installation, not a junction to the shared checkout.

Open a calibrated, four-arm-bone garment in AR, select Live Camera AR, and use the experiment
controls. Start with synthetic replay, then switch to live camera after visual sanity checks.
Three.js remains the default when the flag is absent and in non-development builds.
Changing back to Three.js does not uninstall the native dependency; release adoption is not approved.

## Decision gates still open

1. Complete an arm64 native build and run on the actual target phone. Verify cold launch, older-client
   fallback, repeated renderer switching, pause/resume, and resource cleanup without native crashes.
2. Confirm identical GLB bytes/hash, calibration, chart size, viewport, fixture start, and warmed asset state.
   Check shoulder-anchor displacement, sleeve response, mirroring, and clipping at every fixture phase.
3. Establish numerical camera/root/bone parity with the reference and port or explicitly control
   occlusion and lighting before drawing comparative performance conclusions.
4. Use platform profiling for frame-time distribution, dropped frames, memory, heat, and sustained
   behavior; callback cadence alone is not GPU FPS or camera-to-display latency. Repeat on a second phone.
5. Record results and decide whether the measured benefit warrants a migration. No automatic adoption.

## Sources checked

- [Filament installation guide](https://margelo.github.io/react-native-filament/docs/guides)
- [Transform guide](https://margelo.github.io/react-native-filament/docs/guides/transformation)
- [Upstream repository](https://github.com/margelo/react-native-filament)
- Installed 1.11.0 TypeScript and C++ sources: `TransformManager`, `Animator`, `FilamentView`,
  `CameraWrapper`, and `CameraFovEnum`. In this version the native `setProjection` requires a fifth
  `vertical`/`horizontal` argument missing from its four-argument TypeScript declaration. The
  prototype supplies `vertical` explicitly; mocked integration coverage pins that call.

Documentation and the activity log are left uncommitted per repository convention. No push or merge.
