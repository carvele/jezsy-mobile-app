# AR Try-On — Garment Reality Report

Phase 1 exit deliverable for `docs/ar-tryon-implementation-roadmap.md`. Test
protocol run 2026-09-04, solo (device propped on a stand, poser doubled as
capturer via remote ADB screenshot — see note on methodology below), on the
primary device (Infinix X6880). Two garments: Black tee (Cotton T-Shirt,
pullover, already-calibrated baseline) and Tailored Blazer (button-front,
re-ingested and calibrated 2026-09-04, see roadmap's Blazer update).

Each test scored 0-2 on: anchor stability, deformation plausibility,
intersection (garment-body clipping), occlusion (where applicable), and
frame rate. Screenshots for every test are in
`docs/ar-tryon-garment-reality-report-assets/`.

## Methodology note

The roadmap specifies two people (one poses, one captures) so capture
doesn't disturb the pose. Run solo instead: phone mounted on a stand, poser
stepped into frame, and screenshots were triggered remotely over ADB
(`adb exec-out screencap`) without touching the device — functionally
equivalent to a second capturer, since the device itself is never touched
mid-pose. `[AR-RENDER-FPS]` / `[AR-TRANSPORT-RATE]` / `[AR-DEBUG-TORSO]`
logcat lines were pulled from the same time window as each screenshot.

## Summary scoreboard

### Black tee

| Test | Anchor | Deform | Intersect | Occlusion | FPS | Screenshot |
|---|---|---|---|---|---|---|
| A — bend forward | 0 | 0 | 1 | n/a | 2 | `tee-A-bend.png` |
| B — right arm raise | 0 | 0 | 1 | n/a | 2 | `tee-B-right-arm.png` |
| B — left arm raise | 1 | 0 | 1 | n/a | 2 | `tee-B-left-arm.png` |
| C — both arms raised | 1 | 0 | 1 | n/a | 2 | `tee-C-both-arms.png` |
| D — crossed arms | 1 | 1 | 1 | 0 | 2 | `tee-D-crossed-arms.png` |
| E — 30° turn | 1 | 2 | 1 | n/a | 2 | `tee-E-30deg.png` |
| E — 45° turn | 0 | 0 | 1 | n/a | 2 | `tee-E-45deg.png` |
| E — 60° turn | 0 | 0 | 1 | n/a | 2 | `tee-E-60deg.png` |

### Tailored Blazer

| Test | Anchor | Deform | Intersect | Occlusion | FPS | Screenshot |
|---|---|---|---|---|---|---|
| A — bend forward | 1 | 1 | 1 | n/a | 2 | `blazer-A-bend.png` |
| B — right arm raise | 2 | 2 | 1 | n/a | 2 | `blazer-B-right-arm.png` |
| B — left arm raise | 0 | 0 | 1 | n/a | 2 | `blazer-B-left-arm.png` |
| C — both arms (1st) | 0 | 0 | 1 | n/a | 2 | `blazer-C-both-arms-1.png` |
| C — both arms (retest) | 2 | 2 | 1 | n/a | 2 | `blazer-C-both-arms-2-retest.png` |
| D — crossed arms | 2 | 1 | 1 | 0 | 2 | `blazer-D-crossed-arms.png` |
| E — 30° turn | 2 | 2 | 1 | n/a | 2 | `blazer-E-30deg.png` |
| E — 45° turn | 0 | 0 | 1 | n/a | 2 | `blazer-E-45deg.png` |
| E — 60° turn (1st) | 0 | 0 | 1 | n/a | 2 | `blazer-E-60deg-1.png` |
| E — 60° turn (retest) | 0 | 0 | 1 | n/a | 2 | `blazer-E-60deg-2-retest.png` |

Frame rate scored 2/2 on every single test, no exceptions — the WebView
render loop held 53-60.8fps throughout, and native transport ranged
1.7-32.7 calls/sec depending on how much the tracked pose was changing
frame to frame. **Frame rate is not the bottleneck anywhere in this
protocol.**

## Findings, ranked by severity

### 1. Deep-turn pose breakdown past ~45° yaw (severe, both garments, reproducible)

Every test at 45° and 60° turn, on both garments, collapsed the garment
into an unrecognizable crumpled shape or made it vanish entirely. The
`[AR-DEBUG-TORSO]` logs explain why — the computed orientation is
nonsensical at these angles:

- Tee 45°: `pitch=-73.0 yaw=9.6 roll=-52.6`
- Tee 60°: `pitch=4.0 yaw=106.1 roll=142.3`
- Blazer 45°: `pitch=-67.2 yaw=15.2 roll=-48.1`
- Blazer 60° (1st): `pitch=10.1 yaw=129.4 roll=168.1`
- Blazer 60° (retest): `pitch=-81.3 yaw=145.0 roll=24.5`, then
  `pitch=-66.1 yaw=154.9 roll=67.7`

None of these are physically plausible for someone standing and turning
their torso — `yaw` should track the actual turn angle (30-60°) and
`pitch`/`roll` should stay near zero. Instead pitch and roll dominate and
yaw reads either far too low or wildly too high. This is the exact
mechanism the audit's finding #17 warned about ("unreliable Euler yaw near
profile"), but the effect here is worse than #17's original report
described: not drift, but outright breakdown that makes the garment
unusable. Reproduced twice on the Blazer's 60° test with consistent
symptoms both times — not a fluke.

**This is the single highest-priority item to come out of Phase 1.** It
also directly affects Phase 0's #17 verification gap, which was marked
"reasonably confirmed" on narrower evidence; this report's data suggests
that confirmation understated the problem.

### 2. Sleeves don't track raised arms — except when they do (severe, inconsistent)

Across both garments, whether a raised-arm sleeve deforms plausibly was
inconsistent in a way that doesn't cleanly map to "garment X is good/bad
at this":

- Tee: right-arm raise rotated the whole garment ~90° sideways (worst
  single-garment result outside the deep-turn cases); left-arm raise kept
  the garment upright but the sleeve stayed static, not following the arm.
- Blazer: right-arm raise produced the *best* deformation result of the
  entire session — sleeve genuinely followed the raised arm. Left-arm
  raise collapsed the garment into a small blob near the waistband.

**The garment that failed on the right arm succeeded on the left, and the
garment that succeeded on the right failed on the left.** That symmetry is
more informative than either result alone: it points to a left/right
asymmetry in the bone-mapping or the native rotation-compensation
heuristic (`[COMP-GUARD]`, flagged in the roadmap as still only proven on
one device) rather than two unrelated per-garment bugs. Worth investigating
whether the compensation gate or bone-rotation math treats
`LeftShoulder`/`RightShoulder` (or their forearm equivalents) asymmetrically.

### 3. Anchor sits too high across most tests (moderate, mostly the tee)

The tee's collar consistently sat near the chin/jaw rather than the
shoulder line in every non-collapsed test (A, B-left, C, D, E-30). The
Blazer did not show this pattern nearly as strongly — its anchor tests
scored 1-2 across the board except where the pose itself broke tracking.
This may mean the Blazer's re-ingestion (fixed 2026-09-04, see roadmap) is
also incidentally better-calibrated on vertical anchor than the tee's
original calibration, which predates that fix.

### 4. Pose-estimation instability under identical, held poses (moderate)

Test C (both arms raised) on the Blazer produced a total collapse on the
first capture and a clean, well-deformed result seconds later on retest,
same held pose. This is different from finding #1 — it's not a systematic
angle-dependent breakdown, it's frame-to-frame noise in the pose signal
occasionally producing a bad transform even in a pose that mostly works.
Not blocking, but worth keeping in mind when reading any single screenshot
in this report as ground truth — a couple of the "0" scores elsewhere in
this table might also be transient rather than deterministic; only Test C
and the 60° tests were actually retested to check.

### 5. False `TURN_TOO_FAR` on crossed arms and single-arm raises (minor, confirmed multiple times)

The tracking pill flipped to `TURN_TOO_FAR` (amber, "Turn to Face the
Camera") during the tee's crossed-arms test, and during the Blazer's
left-arm-raise test, despite the wearer facing the camera the whole time.
`poseConstructor.ts` derives `isFacingForward` from shoulder landmarks,
and both poses disturb shoulder-landmark geometry (crossing occludes one
shoulder partially; a raised arm changes the visible shoulder silhouette).
This is a false positive in the yaw/facing heuristic, not a display bug —
the pill is accurately reporting the wrong upstream signal.

### 6. Occlusion fails exactly as documented (expected, not a new finding)

Test D (crossed arms) on both garments confirmed the known gap: the
garment draws fully in front of the crossed arms instead of the arms
occluding it. This is Phase 2's whole reason for existing and is not a
surprise — recorded here only to close out the test protocol's explicit
ask ("expect it to fail today and record exactly how").

## What did NOT reproduce as a problem

- **Both-arms-raised scale glitch** (flagged in the roadmap as a prior
  false-positive from the scale-plausibility guard): did not reproduce.
  The tee's Test C stayed a stable, correctly-sized garment. Confirmed
  fixed.
- **Frame rate**: never dropped below 53fps on the render side even during
  the worst pose-breakdown tests. Whatever is causing findings #1 and #2,
  it isn't a performance problem.

## Recommendation for re-ordering Phases 2-4

This is evidence for Phase 2-4 sequencing, not a decision — see the
roadmap's own exit rule ("Phases 2-4 are re-ordered from its findings, not
from this document's guesses"):

1. **Finding #1 (deep-turn breakdown) is more urgent than Phase 2's
   occlusion work.** A garment that vanishes or crumples past 45° yaw is a
   worse demo failure than missing occlusion, which at least degrades
   gracefully (garment stays visible, just not depth-correct). This
   arguably belongs before Phase 2, not after — it may even be a Phase 0
   regression re-open candidate given it directly touches #17's territory,
   though the roadmap's own rule says closed findings reopen only on
   demonstrated regression, and this may be new evidence rather than
   regression.
2. **Finding #2 (asymmetric arm deformation) should be scoped before**
   Phase 4's "adjust bone rest vectors, add clavicle, or accept the limit"
   decision — right now it's not clear if this is a rest-vector problem
   Phase 4 would fix, or a `[COMP-GUARD]`/compat-layer problem Phase 3's
   `nativePoseCompatibility.ts` extraction would surface once isolated
   with tests.
3. **Finding #3 (anchor height) is comparatively low-cost**: given the
   Blazer's cleaner result post-re-ingestion, this may already be improved
   by whatever the 2026-09-04 re-ingestion fixed for anchor offset — worth
   checking whether re-running the tee through the same admin-dashboard
   pipeline improves it before writing new mobile-side code.
