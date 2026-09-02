# AR Try-On — Physical Device Verification Checklist (Next Session)

Written 2026-09-02, after session 4 (landmark-rotation fix confirmed live,
A/B calibration confirmation, #24 root cause identified but not fixed, #27
distance/yaw bug found). See `docs/CURRENT_AR_STATE.md` for the current
authoritative state and `docs/ar-tryon-audit-implementation-plan.md` for
the full findings history — this file is a controlled, ordered test plan,
not a findings log.

## The actual goal

Not "make the pose tracker work" — that's an implementation detail. The
actual goal: **a person stands in front of their phone camera, selects a
garment, and sees that garment convincingly fitted to their body in real
time — staying attached to their body as they move, turn, and tilt,
without obvious jumping, drifting, scaling errors, or wrong orientation.**

Five things that goal requires:
1. **Correct spatial tracking** — detect the body, know where the torso
   is, keep the garment anchored to it as the person moves.
2. **Correct 3D behavior** — garment scales with apparent distance;
   turning sideways looks like turning a garment, not moving farther away;
   body roll produces correct garment rotation; no sudden jump/stretch/flip.
3. **Correct garment fitting** — a correctly calibrated garment looks
   appropriately sized; bad product calibration is treated as bad product
   data, not "fixed" by compensating in the AR math (see #25/#26 — this
   principle is why those were left as content bugs, not patched in code).
4. **Robust real-world behavior** — tracking can disappear, the user can
   move/turn/raise arms, the app can background and resume; the system
   recovers rather than getting stuck in a broken transform.
5. **On an actual phone** — Android native camera → MediaPipe → pose math
   → Three.js renderer. Not merely correct-looking in a browser or mock.

**Where we are:** the pipeline is proven to work end-to-end (camera → pose
detection → landmarks → fitting math → Three.js garment → live transform).
What's left is proving the *geometry is actually correct*, not merely
approximately right in one favorable pose. The biggest open question is
the native orientation problem (#24) and the yaw/distance coupling (#27) —
e.g. the same person at the same 1m distance reads as ~0.9m facing the
camera but ~1.7m after turning 50° sideways, which is obviously wrong and
would silently mis-scale the garment on nothing more than a turn. This is
what the current work is actually for: **turning the prototype into a
geometrically trustworthy AR system**, not "keep adding fixes until the
shirt looks okay."

**The fundamental acceptance test, everything else is in service of:** if
the human moves in the real world, does the virtual garment behave as
though it is actually attached to their body?

## Definition of Done — 8 tests

Reduce the whole effort to these 8 objective tests, in this order — native
orientation must be trusted *before* tests 2-5 mean anything, since a wrong
orientation silently invalidates every distance/scale/roll reading built on
top of it:

**Order: native orientation → yaw/distance → scale → translation → roll →
tracking loss → stress → lifecycle.**

1. **Front-facing baseline** — user ~1m from camera. Garment centered,
   upright, correctly sized. No visible drift or jitter.
2. **Move toward/away** — user moves ~0.6m → 1.2m. Garment follows
   continuously, doesn't suddenly grow/shrink incorrectly. Returning to the
   original distance reproduces approximately the original fit.
3. **Turn left/right** — same physical distance, rotate 0°→60°. Estimated
   camera distance must NOT falsely increase just because of yaw. Garment
   stays attached to the torso. **This is #27 — currently blocking
   trustworthy yaw/scale verification; nothing past this test can be
   trusted until it passes.**
4. **Body roll** — tilt shoulders left and right. Garment follows the
   body's roll in the correct direction. No unexplained 180°/sign inversion.
5. **Move around** — translate left/right and up/down. Garment follows the
   body, not the screen.
6. **Temporarily lose tracking** — leave frame or occlude enough to break
   tracking. Garment disappears/fades rather than freezing at a wrong
   position. Recovers cleanly on return.
7. **Stress the pose** — raise arms, partially occlude torso, turn. No
   catastrophic garment rotation/jump; skeletal fallback doesn't introduce
   double transforms (this is #6).
8. **Restart/lifecycle** — AR → leave → return; background → foreground.
   Camera/detector/renderer recover without stale transforms or duplicate
   processing.

Once all 8 pass on a real device: the garment is actually tracking the
user's body, not merely looking right in one test pose. That's the finish
line — not the sprawling checklist below, which exists to give each of
these 8 tests concrete step-by-step mechanics, not to replace them as the
goalpost.

---

**Core principle for the detailed steps below: this is not a "does AR
work?" smoke test.** It's a controlled verification pass that deliberately
separates five things that are currently tangled together in the working
tree:
1. the native orientation fix (#24)
2. the remaining geometry fixes (#1, #2, #6 from session 2)
3. yaw/distance behavior (#27)
4. asset/data problems (#25, #26 — already resolved, don't re-litigate)
5. lifecycle/error behavior (#12, #13, GLB error path)

**Do not run these randomly. Do them in the exact order in "Recommended
order" at the bottom** — several steps are blocked or confounded by earlier
ones (most importantly: #27 must be fixed before #2 can be meaningfully
re-tested, since they affect different stages that currently compound).

## 0. Test setup

- **Black tee only** as the calibration reference. Tailored Blazer and
  Cotton T-Shirt are confirmed-broken content, not geometry references —
  don't use them for math verification.
- A **charged** physical Android device (session 4 was cut short by a dead
  battery mid-test).
- Ideally **two people**: one poses, one operates/logs/screenshots — solo
  testing caused real screenshot/log timing drift tonight (see the
  provisional, not-visually-confirmed #3 roll-direction result).
- A fresh dev-client build only if native code changes; Metro/JS reload is
  sufficient for JS-only changes (everything this session has been so far).
- Keep `[CAL-DEBUG]`, `[AR-DEBUG-TORSO]`, `[AR-DEBUG-FRAME]`, and
  `[WEBVIEW-RELAY]` instrumentation active for this pass.

Record for every test: device/model, app commit, product, approximate
camera distance, yaw, roll, pitch, `cameraDistanceM`, `exactScale`,
`targetScale`, `targetRotation`, whether the compensation guard fired, and
the visual result.

---

## A. First priority: #24 real native orientation fix

The first physical-device experiment. Make the one-line change:

```ts
forceCameraOrientation: device?.sensorOrientation,
```

alongside the existing `forceOutputOrientation: device?.sensorOrientation,`
in `[id].tsx`'s `usePoseDetection` options (see
`ar-tryon-audit-implementation-plan.md` #24 for exactly why this is the
fix candidate). **Tried once already at 9% battery and hit an unrelated
crash before a clean test — reverted, net no diff. Retry this first, on a
charged device.**

**Verify, before correction reaches the app:**
- Does `BaseViewCoordinator.sensorOrientation` now report `landscape-right`?
- Does it remain stable across an app restart?
- Does raw native landmark data arrive correctly oriented — shoulders
  should show large X separation / small Y separation, not the "stacked
  vertically" pattern (tiny X, large Y) confirmed present tonight.

**Most important success criterion:** `shouldCorrectNativeLandmarkRotation`
should **stop triggering**. If all of these hold —
`BaseViewCoordinator.sensorOrientation = landscape-right`, raw landmarks
correctly oriented, compensation guard false, upright roll near 0°, camera
triangulation activates normally, garment stays upright/centered — then #24
is genuinely fixed, not merely compensated.

**Then remove the workaround.** Only after the above is proven: remove the
JS rotation compensation (`shouldCorrectNativeLandmarkRotation`,
`correctWorldLandmarkRotation`, `correctNormalized2DLandmarkRotation`, and
their call site) and its debug logging, then re-run the same tests. That
gives a clean A/B: native fix → correct landmarks → correct downstream
pipeline, instead of broken native orientation → JS compensates →
downstream happens to work.

---

## B. Verify #1 — `unprojectToZ0` / cover-crop geometry

Black tee + a physical reference. The key question: does the Three.js
projection agree with the actual camera image after the cover crop.

**Test:** stand at ~0.8m, ~1.0m, ~1.2m in turn. Keep phone orientation
unchanged. Move the wearer horizontally across the frame at roughly
constant distance, then test vertical movement too.

**Pass:** the garment's horizontal/vertical placement stays visually
attached to the body as it moves through the frame — no systematic offset
from the camera's cover crop. This specifically tests the screen-space →
visible-crop → Three.js-projection chain.

---

## C. Verify #2 — `exactScale` (frontal only, not yet yaw)

**Do not start with yaw.** Establish a frontal baseline first: Black tee,
square to camera, ~0.9-1.0m, neutral upright pose, several seconds. Known
reference from tonight: `exactScale ≈ 1.19-1.22` — match that *behavior*,
not a specific magic number. Then move closer and farther.

**Expected:** `cameraDistanceM` changes realistically with real distance;
projected garment width stays physically consistent with the wearer; no
progressive incorrect growth/shrinkage. Distance changes → projection
compensates → apparent fit stays stable.

---

## D. Fix/verify #27 before any serious yaw verification of #2

**This is currently the biggest blocker to a clean #2 test.** Tonight's
data: frontal ~0.9m; yaw ~-49° → distance read 1.09-1.22m; yaw -50 to -68°
→ 1.67-1.72m. Because the upstream distance estimate is itself wrong at
yaw, **you cannot currently conclude anything about `exactScale`'s
correctness during a turn** — don't spend more physical-testing time on #2
at 30-45° until #27 has a real fix or mitigation.

**Yaw sweep** (after implementing a #27 fix): same wearer, same physical
distance, angles ≈ 0°/15°/30°/45°/60°, phone/wearer distance held constant
at each. Record yaw, `cameraDistanceM`, `exactScale`.

**Desired:** `cameraDistanceM` stays approximately stable across yaw (noise
is fine; monotonic inflation like tonight's is not). Only once distance is
yaw-stable does it make sense to judge `exactScale`.

---

## E. Verify #2 after #27 is fixed

Compare 0°/15°/30°/45° at the same physical distance. The garment should
maintain approximately the same physical width relative to the shoulders —
validates that projected shoulder width isn't being yaw-corrected twice.
Look for: no sudden shrinking, no progressive oversizing, no systematic
scale drift attributable to yaw. Only then can #2 be legitimately closed.

---

## F. Verify #3 — roll sign (two-person test)

Tonight's evidence is numerical only (roll flipped -9.8°→+9.3° for a
requested right-shoulder-down tilt, correct predicted sign) but NOT
independently visually confirmed — screenshot/log timing drifted during
solo testing. This needs two people: one poses, one captures.

**Baseline:** subject upright, facing camera, arms relaxed → roll ≈ 0°.
Then deliberately lower the right shoulder, capture the exact frame; then
lower the left shoulder, capture the exact frame.

**Verify both sign and visual behavior** — don't just read the number:
right-shoulder-down → roll sign → garment visibly rotates the same
physical direction, and vice versa for the left. This closes the gap left
by tonight's provisional-only result.

---

## G. Verify #6 — skeletal retargeter fallback

Deliberately create the invalid-torso-fallback condition: partial torso
occlusion, one shoulder temporarily obscured, an extreme pose where torso
landmarks go invalid, or arm movement while torso confidence drops.

**Watch for the specific previous failure mode**: group-level roll + arm-
level roll compounding into a double rotation. When torso validity drops,
the garment group shouldn't suddenly rotate one way while arms acquire a
second roll: arm bones should stay visually coherent with the garment.

**Pass:** when torso validity recovers, no sudden rotational jump, no
doubled arm tilt, no discontinuity between torso and sleeves/arms.

**2026-09-02**: physically attempted hand-occlusion of one shoulder and a
true ~81° profile turn on the Black tee — `pose.torso.valid` stayed `true`
through both; MediaPipe's world-landmark estimation is more robust than
expected and never actually dropped into the invalid-torso path during
normal in-frame posing. No visual glitch either way (profile turn just
shrank the garment gracefully via the yaw floor). Since the fallback path
targets hips-out-of-frame (common at typical try-on distance, not
occlusion) and couldn't be forced physically, verified deterministically
instead with 4 new unit tests in `skeletalRetargeter.test.ts` (see
`0e39aea`): confirms the fixture produces `torso.valid=false`, confirms
omitting `fallbackRollRad` preserves the old double-counting behavior,
confirms passing it produces the exact analytically-predicted
roll-cancelling quaternion, confirms a valid torso ignores the parameter
entirely. #6 is considered verified via this route.

---

## H. Test the #23 compensation's guard itself — second device

Do this even if #24 gets fixed — the guard needs validating before it's
trusted to safely no-op elsewhere, or before deciding to remove it.

**On a second Android device:**
- Upright subject, verify `shouldCorrectNativeLandmarkRotation = false` if
  that device's native landmarks are already correctly oriented.
- If the second device has the same native bug, verify the guard fires
  (`= true`) and the resulting pose is corrected.

**Critically**, test that the heuristic doesn't mistake a legitimate pose
for the "stacked vertically" signature: upright, moderate yaw, moderate
roll, arms raised, one shoulder occluded. This matters because the guard
is currently the only safety net for a real native-library defect.

---

## I. Black tee asset-proportion investigation (after math/tracking tests)

Width is already established as approximately sane (A/B-confirmed). Now
isolate whether the vertical elongation observed tonight comes from the
GLB itself.

**Simple test:** inspect the Black tee in 3D Studio mode (no AR tracking
involved at all). If it's already extremely tall relative to its width
there, the AR math isn't responsible — it's the asset. If it looks normal
in Studio but elongated in AR, investigate model-space bounding box,
`rest_pose_metric_width`, anchor offset, group scale, skeletal retargeting,
and camera projection, in that order. Treat this separately from the
already-confirmed width calibration result (#26) — don't conflate them.

---

## J. Bad-data gating (verify the gate, not the bad products)

#25/#26 are proven content problems already — don't re-litigate the data
itself. Instead verify the *gating behavior* around them:

- **Tailored Blazer**: confirm it's not usable as a geometry reference —
  check that its metadata/`ingestion_status` produces the intended
  ingestion-gate behavior (falls back to demo-rig metadata, per the #18
  fix) rather than silently rendering broken.
- **Cotton T-Shirt**: same — its `rest_pose_metric_width = 0.22` is known
  bad; don't use it as a baseline; just confirm the app doesn't treat it
  as sane.
- **Black tee**: the canonical AR verification asset for everything above.

---

## K. Lifecycle verification

Session-2 fixes (#12, #13, #15) haven't had the same physical validation
as tonight's rotation/scale work.

**Background test:** start camera/AR, confirm tracking, background the
app, wait several seconds, return. Verify: camera stopped while
backgrounded, no crash, no runaway processing, camera resumes correctly,
pose tracking resumes, garment state recovers.

**Navigate-away test:** AR → another screen → AR. Verify: camera
re-initializes, detector works, renderer works, no duplicate processing,
no stale garment transform left over from the previous mount.

---

## L. Tracking-loss recovery

Deliberately remove the body from view: visible → step completely out of
frame → wait → return. Verify: garment doesn't freeze indefinitely,
tracking-active indicator clears, garment opacity/transform decays as
intended (the #12 hysteresis fix), garment reacquires when tracking
resumes. Repeat with partial occlusion instead of leaving the frame
entirely.

---

## M. GLB failure/error path

Test the #8/#11 error-surfacing fix with an intentionally invalid or
unavailable GLB URL on a controlled test product record. Expected chain:
GLB failure → WebView error → `postMessage` → React handler → visible AR
error banner. The app must not silently show a dead/blank renderer.

---

## N. Camera calibration sanity (after #27 is fixed)

One clean calibration sequence at ~0.6m / ~0.8m / ~1.0m / ~1.2m, frontal,
shoulders visible, stable pose each time. Record actual approximate
distance vs. `cameraDistanceM`. No laboratory precision needed — just
confirm `cameraDistanceM` monotonically tracks real distance and returns
toward the same value when returning to the original position. Then repeat
at yaw, to cleanly separate distance correctness from yaw correctness.

---

## Physical verification complete — exit criteria

| Area | Required result |
|---|---|
| Native orientation #24 | Library outputs correctly oriented landmarks; JS compensation unnecessary |
| Compensation guard | Correctly no-ops on a normal device |
| Distance | Tracks real movement |
| Distance + yaw #27 | Doesn't inflate systematically with yaw |
| `unprojectToZ0` #1 | Body/garment alignment survives screen/crop movement |
| `exactScale` #2 | Stable physical fit across distance and yaw |
| Roll #3 | Numerically **and visually** correct sign |
| Skeletal fallback #6 | No double-roll/jump during torso-confidence loss |
| Tracking loss | State clears and recovers |
| Background/foreground | Camera/detector/renderer recover cleanly |
| GLB error | User-visible failure |
| Black tee | Width sane; vertical proportions understood |
| Second device | Orientation workaround/guard behaves correctly |

## Recommended order for the next session

1. #24 one-line native fix
2. Verify raw landmarks + `BaseViewCoordinator` orientation
3. Remove JS compensation temporarily, confirm the native fix survives
4. #27 yaw-aware distance fix
5. Frontal distance regression test
6. Yaw sweep
7. Re-verify #1 + #2 together
8. Two-person roll test (#3)
9. Deliberate torso-loss test (#6)
10. Lifecycle + tracking-loss tests
11. Second-device verification
12. Black tee asset-proportion investigation
13. Remove temporary debug instrumentation
14. Re-run TypeScript/lint/unit tests
15. Only then push the (currently 14, growing) local commits

**Two hard boundaries:** don't mix #25/#26 into the geometry verification —
they're already sufficiently isolated as database/content defects, and
Black tee should remain the controlled test garment until its
vertical-proportion question (item I) is resolved. And don't spend more
time validating #2's yaw behavior until #27 is fixed — otherwise two
coupled errors are being measured at once, which is exactly how tonight's
first yaw-test attempt reached an inconclusive result.
