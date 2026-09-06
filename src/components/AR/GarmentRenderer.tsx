import React, { useRef, useImperativeHandle, forwardRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

import type { SegmentationFrame } from '../../types/pose';

// Safe to interpolate a JSON.stringify() result directly into an inline <script> tag
// except for one case: a string value containing "</script" closes the tag early and
// whatever follows in the DB-controlled JSONB (garment_metadata.boneMap etc.) is then
// parsed as page markup, not script -- a real </script>-breakout XSS surface, not just
// a theoretical one, since this data lives in a shared DB the admin dashboard writes
// to. < is JSON-legal and decodes back to '<' when parsed, so this only affects
// the raw source text the browser scans for a closing tag, never the resulting value.
function safeStringify(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export interface GarmentRendererRef {
  updateTransform: (
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number },
    scale: number,
    boneRotations?: Record<string, { x: number; y: number; z: number; w: number }>,
    segmentation?: SegmentationFrame,
    normalizedLandmarks?: any[],
    worldLandmarks?: any[]
  ) => void;
}

export interface GarmentRendererProps {
  modelUrl: string;
  visible?: boolean;
  metadata?: import('@/src/types/garment').GarmentMetadata;
  /**
   * Phase B2: real-measurement fit modifier, computed once from the wearer's saved
   * body measurements and the selected/recommended size's real chart width (see
   * ar-tryon/[id].tsx). Multiplies the live silhouette-matched base scale so
   * different sizes actually render at different tightness instead of all shrink-
   * wrapping identically to the wearer -- position/orientation tracking is untouched.
   * Defaults to 1 (today's silhouette-match-only behavior) when measurement data is
   * unavailable.
   */
  fitModifier?: number;
  /**
   * Phase 3: real camera calibration, computed once in ar-tryon/[id].tsx from
   * vision-camera's format.fieldOfView (native only -- see the AR Implementation
   * Plan) and the wearer's own saved shoulder measurement. When present, the
   * scene's virtual camera uses the real vertical FOV and its distance from the
   * subject is re-derived from real triangulation every frame, instead of the
   * previous fixed 45deg/z=5 setup that only ever measured a self-consistent,
   * not real-world-accurate, width. Undefined (native without a saved
   * measurement, or web) preserves that exact prior behavior unchanged.
   */
  cameraCalibration?: {
    focalLengthPx: number;
    verticalFovDeg: number;
    videoWidthPx: number;
    videoHeightPx: number;
    wearerShoulderWidthM: number;
  };
  /**
   * Fired when the scene fails to load or render -- a GLB fetch/parse failure,
   * or an uncaught error/rejection inside the WebView/iframe's own JS. Previously
   * these only reached the WebView's own console (relayed to Metro via the
   * temporary debug channel), leaving the user on a bare camera feed with zero
   * indication anything went wrong.
   */
  onLoadError?: (message: string) => void;
}

export const GarmentRenderer = forwardRef<GarmentRendererRef, GarmentRendererProps>(
  ({ modelUrl, visible = true, metadata, fitModifier = 1, cameraCalibration, onLoadError }, ref) => {
    const safeFitModifier = Number.isFinite(fitModifier) && fitModifier > 0 ? fitModifier : 1;
    // metadata.restPoseMetricWidth used to be spliced into the injected script as a bare
    // JS expression with no validation at all -- a malformed DB value (string, object,
    // NaN) wouldn't just compute a wrong scale, it would produce invalid JS in that
    // <script> tag (e.g. an unquoted string becomes a bare, undefined identifier) and
    // crash the WHOLE renderer, not just mis-scale one product. Validated the same way
    // safeFitModifier already is, so an interpolated numeric literal is always safe.
    const safeRestPoseMetricWidth = metadata && Number.isFinite(metadata.restPoseMetricWidth) && metadata.restPoseMetricWidth > 0
      ? metadata.restPoseMetricWidth
      : undefined;
    const safeCameraCalibration = cameraCalibration
      && Number.isFinite(cameraCalibration.focalLengthPx) && cameraCalibration.focalLengthPx > 0
      && Number.isFinite(cameraCalibration.verticalFovDeg) && cameraCalibration.verticalFovDeg > 0
      && Number.isFinite(cameraCalibration.videoWidthPx) && cameraCalibration.videoWidthPx > 0
      && Number.isFinite(cameraCalibration.videoHeightPx) && cameraCalibration.videoHeightPx > 0
      && Number.isFinite(cameraCalibration.wearerShoulderWidthM) && cameraCalibration.wearerShoulderWidthM > 0
      ? cameraCalibration
      : undefined;
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const webviewRef = useRef<WebView | null>(null);

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body, html {
            width: 100%; height: 100%;
            background: transparent !important;
            overflow: hidden;
          }
          #canvas-container {
            width: 100%; height: 100%;
          }
        </style>
        <!-- Three.js + GLTFLoader via CDN -->
        <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
      </head>
      <body>
        <div id="canvas-container"></div>
        <script>
          // TEMP DEBUG: relay this WebView's own console into the outer RN console
          // (visible in Metro) via postMessage -- native only, since window.ReactNativeWebView
          // doesn't exist in the web iframe. Direct remote-debugging of the WebView hit a
          // real DevTools protocol version mismatch on this device, so this is the reliable
          // channel while Phase 3 calibration is being verified live. Remove once done.
          if (window.ReactNativeWebView) {
            var __origConsoleLog = console.log;
            var __origConsoleWarn = console.warn;
            console.log = function() {
              __origConsoleLog.apply(console, arguments);
              try { window.ReactNativeWebView.postMessage('[LOG] ' + Array.prototype.slice.call(arguments).join(' ')); } catch (e) {}
            };
            console.warn = function() {
              __origConsoleWarn.apply(console, arguments);
              try { window.ReactNativeWebView.postMessage('[WARN] ' + Array.prototype.slice.call(arguments).join(' ')); } catch (e) {}
            };
          }

          // Load status and per-frame transform, console-only -- the visible on-screen
          // banner this used to render did its job (confirmed load status, got real scale
          // telemetry off-device) and is removed now that it's just blocking the view.
          function showDebug(msg) {
            console.log('[AR-STATUS] ' + msg);
          }
          // Surfaces a scene failure to the outer React screen instead of leaving it
          // console-only -- see GarmentRendererProps.onLoadError.
          function notifyLoadError(message) {
            var payload = { type: 'AR_LOAD_ERROR', message: message };
            if (window.ReactNativeWebView) {
              try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
            } else if (window.parent && window.parent !== window) {
              try { window.parent.postMessage(payload, '*'); } catch (e) {}
            }
          }
          window.addEventListener('error', function(e) {
            showDebug('window.onerror: ' + e.message);
            notifyLoadError(e.message);
          });
          window.addEventListener('unhandledrejection', function(e) {
            var msg = e.reason && e.reason.message ? e.reason.message : e.reason;
            showDebug('unhandledrejection: ' + msg);
            notifyLoadError(String(msg));
          });

          let scene, camera, renderer, garmentModel, garmentGroup;
          let measuredMeshWidth = 0.4;
          let skeletonBones = {};
          let boneCorrection = {};
          let debugFrameCount = 0;
          // TEMP DEBUG: resolved once at load time (see resolveBindBoneName below), used
          // per-frame to log the actual anchor bone's live world position vs. targetPos --
          // NOT the same as garmentModel's own coordinate origin (a prior diagnostic here
          // measured that by mistake and reported a misleading ~1.6m "delta" that wasn't a
          // real bug). Remove once the vertical-anchor-placement investigation concludes.
          let anchorDebugBone = null;
          // Phase 1 instrumentation (ar-tryon-implementation-roadmap.md): the native side
          // counts calls INTO the transport (see transportRateCountRef in [id].tsx); this
          // counts UPDATE_TRANSFORM messages actually PROCESSED here, on the other side of
          // JSON.stringify + injectJavaScript. The two rates can differ -- that gap is
          // itself the measurement the roadmap's Tier 2 occlusion gate and the contract's
          // "unmeasured prototype transport" note are waiting on.
          let transportRateCount = 0;
          let transportRateWindowStart = 0;
          // Phase 1 instrumentation: the roadmap asks for "frames rendered per second
          // inside the WebView" as its OWN measurement, distinct from
          // transportRateCount above (which counts UPDATE_TRANSFORM messages processed,
          // not actual draw calls). requestAnimationFrame keeps calling renderer.render()
          // every compositor tick regardless of whether fresh transform data has arrived
          // -- so this number can legitimately sit near the display's native refresh rate
          // even while transportRateCount is much lower, and a low reading here (not just
          // a low transportRateCount) is what would actually indicate the WebView's own
          // GPU/compositor is the bottleneck rather than the native-to-WebView transport.
          let renderFrameCount = 0;
          let renderRateWindowStart = 0;
          let loggedPosedBBox = false;
          let smoothedPos = null, smoothedScale = null, smoothedQuat = null;
          let smoothedCameraDistance = null;
          // Fix for #17 in the AR audit plan: cross-frame state, per 2026-09-02's
          // decision to invest in a real fix rather than leave the floor as-is. See
          // the yawCosCorrection computation below for the full explanation. Starts
          // at the old floor value (not 1/frontal) so a session that starts already
          // turned, before any frontal frame ever arrives, degrades to the same
          // worst-case behavior the floor previously guaranteed rather than to no
          // correction at all.
          let lastReliableCosYaw = 0.65;
          // Deep-turn instability (Phase 1 garment-reality report, finding #1): the
          // raw per-frame quaternion's YXZ Euler extraction below is a genuine
          // sequential decomposition, unstable whenever the underlying rotation isn't
          // a clean single-axis yaw -- which real human turning never is, and worse
          // near-profile where MediaPipe's own landmark accuracy degrades. Unlike
          // smoothedQuat (which slerps the rotation actually applied to the garment),
          // this value used to be recomputed fresh from the raw, unsmoothed quaternion
          // every single frame, so one noisy frame's Euler extraction could swing
          // yawCosCorrection (and therefore exactScale) independently of the smoothed
          // rotation -- plausible cause of the report's "invisible one capture, twisted
          // blob the next, same held pose" pattern. Smoothed the same way
          // smoothedCameraDistance already is, before the #17 floor logic applies.
          let smoothedCosYaw = null;
          let occlusionMesh, occlusionMaterial;
          let maskTexture;

          // Phase 3: real camera calibration, present only on native with a saved
          // wearer measurement (see GarmentRendererProps.cameraCalibration).
          // Null preserves the original fixed 45deg/z=5 uncalibrated camera.
          //
          // Delivered by message rather than interpolated into this HTML string on
          // purpose: the string IS the WebView's source, so baking a value in makes
          // every change to it a full page reload -- GLB refetch, bind poses
          // re-captured, all smoothing state reset. Calibration depends on two async
          // inputs (camera format and the Supabase-backed sizing profile) that land
          // after this component has already mounted, so interpolating it guaranteed
          // exactly one such reload mid-session, right as calibration became available.
          let CAMERA_CALIBRATION = null;

          // Same reasoning and same fix as CAMERA_CALIBRATION above, for the same root
          // cause: fitModifier is ALSO computed from the async Supabase sizing profile
          // (see the fitModifier useMemo in ar-tryon/[id].tsx), so baking it into this
          // HTML string caused the exact same mid-session reload the calibration fix
          // above was written to eliminate -- it just hadn't been noticed yet, since
          // the calibration reload masked it (both async values tend to resolve close
          // together). 1 matches this file's own default silhouette-match behavior.
          let FIT_MODIFIER = 1;

          // Fix for open item #1 in the AR audit plan: landmarks are normalized to the
          // camera FRAME, but the preview renders that frame with 'cover' cropping (web
          // <video> objectFit:'cover', native vision-camera's default resizeMode:'cover')
          // -- center-cropping whichever axis doesn't match the container's aspect ratio.
          // unprojectToZ0 used to map landmark [0,1] coords straight to viewport NDC (a
          // "stretch to fill" mapping) against a preview that actually does "crop to
          // fill", so on-screen garment position drifted from the tracked body whenever
          // container and video aspect ratios differed. Also sets camera.aspect from the
          // real video aspect (not window.innerWidth/innerHeight) so the calibrated
          // horizontal FOV derived from verticalFovDeg is actually correct.
          // NOT verified on a physical device -- see docs/ar-tryon-audit-implementation-plan.md.
          function getCameraAspect() {
            if (CAMERA_CALIBRATION && CAMERA_CALIBRATION.videoWidthPx && CAMERA_CALIBRATION.videoHeightPx) {
              return CAMERA_CALIBRATION.videoWidthPx / CAMERA_CALIBRATION.videoHeightPx;
            }
            return window.innerWidth / window.innerHeight;
          }

          // Remaps a landmark normalized against the FULL video frame into normalized
          // coordinates within the visible 'cover'-cropped region, so it lines up with
          // what 'stretch to fill' NDC mapping (unprojectToZ0) assumes.
          //
          // Fix for #28 in the AR audit plan: neither this remap nor unprojectToZ0 used
          // to clamp their input, so a landmark MediaPipe reports slightly outside [0,1]
          // (the wearer partially out of the camera's actual sensor frame -- confirmed
          // live, l11.x=1.0045) passed straight through. Because visW/visH are often well
          // under 1 on this device (video/container aspect mismatch), that small overshoot
          // amplified into a much larger NDC-space overshoot after the crop remap,
          // producing a garment badly offset from the visible body instead of just
          // clipping gracefully at the frame edge like a normal in-range landmark would.
          // Clamping the input here (not the output) keeps every downstream consumer --
          // distance triangulation, position, scale -- working from the same
          // frame-truncated coordinate a landmark at the real edge would have produced.
          function mapCoverCrop(nx, ny) {
            const cx = Math.max(0, Math.min(1, nx));
            const cy = Math.max(0, Math.min(1, ny));
            if (!CAMERA_CALIBRATION || !CAMERA_CALIBRATION.videoWidthPx || !CAMERA_CALIBRATION.videoHeightPx) {
              return { nx: cx, ny: cy };
            }
            const videoAspect = CAMERA_CALIBRATION.videoWidthPx / CAMERA_CALIBRATION.videoHeightPx;
            const containerAspect = window.innerWidth / window.innerHeight;
            const visW = Math.min(1, containerAspect / videoAspect);
            const visH = Math.min(1, videoAspect / containerAspect);
            return {
              nx: (cx - (1 - visW) / 2) / visW,
              ny: (cy - (1 - visH) / 2) / visH,
            };
          }

          function init() {
            const container = document.getElementById('canvas-container');
            scene = new THREE.Scene();

            camera = new THREE.PerspectiveCamera(
              CAMERA_CALIBRATION ? CAMERA_CALIBRATION.verticalFovDeg : 45,
              getCameraAspect(),
              0.1, 1000
            );
            camera.position.z = 5; // real distance is computed and set every frame once CAMERA_CALIBRATION is present

            // TEMP DEBUG: init-time confirmation of the default FOV setup -- remove once
            // Phase 3 is verified live. Real calibration arrives later by message (see
            // SET_CAMERA_CALIBRATION), which logs its own confirmation on arrival.
            showDebug('camera init: fov=' + camera.fov.toFixed(2) + ' (awaiting calibration)');

            renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setClearColor(0x000000, 0); // fully transparent so the camera feed shows through
            container.appendChild(renderer.domElement);

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
            dirLight.position.set(0, 10, 10);
            scene.add(dirLight);

            // Phase 4C: Occlusion Compositor Shader
            // Maps 3D world joints to camera depth for segmented pixels
            // TEMP DEBUG (Phase 2 Tier 1 tuning): when true, the occluder draws its
            // capsule regions in visible colour instead of writing depth only, so the
            // capsule placement and radius can actually be seen and tuned on-device.
            // Silhouette-guessing from ordinary screenshots could not distinguish
            // "occluder working" from "arm happened to fall outside the garment", which
            // is what motivated this. Set back to false once the radius is tuned.
            const OCCLUSION_DEBUG_VISIBLE = false;

            occlusionMaterial = new THREE.ShaderMaterial({
              transparent: false,
              colorWrite: OCCLUSION_DEBUG_VISIBLE, // false = depth pass only (real mode)
              depthWrite: true,
              depthTest: true,
              // Required for gl_FragDepthEXT below -- without this, Three.js never
              // injects the "#extension GL_EXT_frag_depth : enable" pragma the shader
              // needs, and the fragment shader fails to compile. Since this mesh was
              // never added to the scene, Three.js never actually compiled this
              // program to find that out -- this was a second, independent reason
              // Tier 1 occlusion could not have worked even before the coordinate-
              // space issue below was found.
              extensions: { fragDepth: true },
              uniforms: {
                uMask: { value: null },
                uViewProj: { value: new THREE.Matrix4() },
                uJoints2D: { value: new Array(33).fill(null).map(()=>new THREE.Vector2()) },
                uJoints3D: { value: new Array(33).fill(null).map(()=>new THREE.Vector3()) },
                // Phase 2 Tier 1: capsule proximity radius in normalized [0,1]
                // landmark-space units (same space as uJoints2D/vUv), i.e. half the
                // width of an arm capsule. Tuned on-device against the debug colour
                // pass: 0.06 drew an arm band roughly double the wearer's actual arm
                // width, which for a depth occluder is actively harmful -- it carves
                // away garment pixels that should stay visible. 0.035 tracks the real
                // limb closely. An occluder that is slightly too NARROW just misses a
                // sliver of a real occlusion; one that is too WIDE eats the garment.
                uCapsuleRadius: { value: 0.035 },
              },
              vertexShader: \`
                varying vec2 vUv;
                void main() {
                  vUv = uv;
                  // Render as a full-screen NDC quad
                  gl_Position = vec4(position.xy, 0.99, 1.0);
                }
              \`,
              fragmentShader: \`
                uniform sampler2D uMask;
                uniform mat4 uViewProj;
                uniform vec2 uJoints2D[33];
                uniform vec3 uJoints3D[33];
                uniform float uCapsuleRadius;
                varying vec2 vUv;

                // Distance to line segment
                float lineDist(vec2 p, vec2 a, vec2 b, out float t) {
                  vec2 pa = p - a, ba = b - a;
                  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                  t = h;
                  return length(pa - ba * h);
                }

                // Signed area of the triangle abc; its sign says which side of ab c is on.
                float crossZ(vec2 a, vec2 b, vec2 c) {
                  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
                }

                // The torso is a filled quad (shoulders + hips), not a wireframe. Measuring
                // only distance-to-the-four-edges left the whole chest interior outside the
                // capsule radius -- visible in the debug colour pass as two vertical bands
                // down the sides with an uncovered gap between them, exactly where a
                // forearm crossing the chest most needs to occlude. A point inside the quad
                // is distance 0; outside, it falls back to the nearest edge.
                bool insideQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
                  float s1 = crossZ(a, b, p);
                  float s2 = crossZ(b, c, p);
                  float s3 = crossZ(c, d, p);
                  float s4 = crossZ(d, a, p);
                  bool allPos = (s1 >= 0.0 && s2 >= 0.0 && s3 >= 0.0 && s4 >= 0.0);
                  bool allNeg = (s1 <= 0.0 && s2 <= 0.0 && s3 <= 0.0 && s4 <= 0.0);
                  return allPos || allNeg;
                }

                void main() {
                  // vUv is Three.js UV space (origin BOTTOM-left); uJoints2D are image-
                  // space normalized landmarks (origin TOP-left). Comparing them directly
                  // put every capsule in the wrong place -- confirmed on-device with the
                  // debug colour pass: the left-arm region rendered in the bottom-right
                  // corner of the screen, nowhere near the wearer. The original code's own
                  // mask sampling already flipped Y for exactly this reason; the capsule
                  // distance tests never did.
                  vec2 pt = vec2(vUv.x, 1.0 - vUv.y);

                  // 1. Left Arm Region
                  float tLUpper, tLLower;
                  float dLUpper = lineDist(pt, uJoints2D[11], uJoints2D[13], tLUpper);
                  float dLLower = lineDist(pt, uJoints2D[13], uJoints2D[15], tLLower);
                  float dLeftArm = min(dLUpper, dLLower);
                  vec3 posLUpper = mix(uJoints3D[11], uJoints3D[13], tLUpper);
                  vec3 posLLower = mix(uJoints3D[13], uJoints3D[15], tLLower);
                  vec3 posLeftArm = (dLUpper < dLLower) ? posLUpper : posLLower;

                  // 2. Right Arm Region
                  float tRUpper, tRLower;
                  float dRUpper = lineDist(pt, uJoints2D[12], uJoints2D[14], tRUpper);
                  float dRLower = lineDist(pt, uJoints2D[14], uJoints2D[16], tRLower);
                  float dRightArm = min(dRUpper, dRLower);
                  vec3 posRUpper = mix(uJoints3D[12], uJoints3D[14], tRUpper);
                  vec3 posRLower = mix(uJoints3D[14], uJoints3D[16], tRLower);
                  vec3 posRightArm = (dRUpper < dRLower) ? posRUpper : posRLower;

                  // 3. Torso Region
                  float tTorsoTop, tTorsoBot, tTorsoLeft, tTorsoRight;
                  float dTorsoTop = lineDist(pt, uJoints2D[11], uJoints2D[12], tTorsoTop);
                  float dTorsoBot = lineDist(pt, uJoints2D[23], uJoints2D[24], tTorsoBot);
                  float dTorsoLeft = lineDist(pt, uJoints2D[11], uJoints2D[23], tTorsoLeft);
                  float dTorsoRight = lineDist(pt, uJoints2D[12], uJoints2D[24], tTorsoRight);
                  float dTorso = min(min(dTorsoTop, dTorsoBot), min(dTorsoLeft, dTorsoRight));
                  // Fill the quad interior (see insideQuad above): shoulders then hips,
                  // in ring order, so the chest is covered rather than just its outline.
                  if (insideQuad(pt, uJoints2D[11], uJoints2D[12], uJoints2D[24], uJoints2D[23])) {
                    dTorso = 0.0;
                  }

                  vec3 posTorsoTop = mix(uJoints3D[11], uJoints3D[12], tTorsoTop);
                  vec3 posTorsoBot = mix(uJoints3D[23], uJoints3D[24], tTorsoBot);
                  vec3 posTorsoLeft = mix(uJoints3D[11], uJoints3D[23], tTorsoLeft);
                  vec3 posTorsoRight = mix(uJoints3D[12], uJoints3D[24], tTorsoRight);

                  vec3 posTorso = posTorsoTop;
                  if (dTorsoBot < dTorsoTop && dTorsoBot < dTorsoLeft && dTorsoBot < dTorsoRight) posTorso = posTorsoBot;
                  else if (dTorsoLeft < dTorsoTop && dTorsoLeft < dTorsoBot && dTorsoLeft < dTorsoRight) posTorso = posTorsoLeft;
                  else if (dTorsoRight < dTorsoTop && dTorsoRight < dTorsoBot && dTorsoRight < dTorsoLeft) posTorso = posTorsoRight;

                  // 4. Which body parts does this pixel actually belong to?
                  // Phase 2 Tier 1: no real segmentation mask exists yet (that's Tier 2,
                  // gated on measured frame rate per the roadmap), so coverage is decided
                  // purely by proximity to the capsule skeleton. Without a radius cutoff
                  // every pixel on screen resolves to whichever body part is nearest --
                  // including pixels nowhere near the wearer -- which would occlude the
                  // whole frame. The torso needs only a small margin beyond its quad now
                  // that the quad interior is filled (see insideQuad above).
                  float armRadius = uCapsuleRadius;
                  // The torso quad is filled, so this is only a margin around it. It is
                  // deliberately small but non-zero: MediaPipe's shoulder/hip landmarks
                  // sit at the joints, inside the body's real silhouette, so the quad
                  // alone under-covers the deltoids and flanks. 1.2x (before the quad
                  // was filled) pushed the region well past the wearer's outline.
                  float torsoRadius = uCapsuleRadius * 0.6;
                  bool inLeftArm = dLeftArm <= armRadius;
                  bool inRightArm = dRightArm <= armRadius;
                  bool inTorso = dTorso <= torsoRadius;

                  // TEMP DEBUG: joint markers must survive the discard below, otherwise
                  // they can only ever appear inside a region that is already being
                  // drawn -- which tells us nothing about where the joints actually are
                  // when the capsules land in the wrong place.
                  bool isJointMarker = false;
                  for (int ji = 0; ji < 33; ji++) {
                    if (ji == 11 || ji == 12 || ji == 13 || ji == 14 || ji == 15 || ji == 16 || ji == 23 || ji == 24) {
                      if (distance(pt, uJoints2D[ji]) < 0.015) isJointMarker = true;
                    }
                  }

                  if (!inLeftArm && !inRightArm && !inTorso && !isJointMarker) {
                    discard;
                  }

                  // 5. Of the parts covering this pixel, the one NEAREST THE CAMERA is
                  // what the viewer actually sees, so its depth is what belongs in the
                  // buffer. Picking by smallest 2D distance instead (the previous rule)
                  // gets the crossed-arms case backwards: once the torso quad is filled,
                  // a forearm lying across the chest is at distance 0 from the torso too,
                  // so the torso would always win and the arm would never occlude the
                  // garment -- the exact case Test D exists to check.
                  float bestNdcZ = 1.0e9;
                  int winner = 2; // 0 = left arm, 1 = right arm, 2 = torso
                  if (inLeftArm) {
                    vec4 cs = uViewProj * vec4(posLeftArm, 1.0);
                    float z = cs.z / cs.w;
                    if (z < bestNdcZ) { bestNdcZ = z; winner = 0; }
                  }
                  if (inRightArm) {
                    vec4 cs = uViewProj * vec4(posRightArm, 1.0);
                    float z = cs.z / cs.w;
                    if (z < bestNdcZ) { bestNdcZ = z; winner = 1; }
                  }
                  if (inTorso) {
                    vec4 cs = uViewProj * vec4(posTorso, 1.0);
                    float z = cs.z / cs.w;
                    if (z < bestNdcZ) { bestNdcZ = z; winner = 2; }
                  }

                  // A joint marker outside every capsule has no real depth to write;
                  // park it behind everything so it stays a pure debug overlay.
                  if (bestNdcZ > 1.0e8) bestNdcZ = 1.0;

                  // WebGL expects gl_FragDepth to be [0, 1]
                  gl_FragDepthEXT = (bestNdcZ + 1.0) * 0.5;

                  // TEMP DEBUG: only visible when the material has colorWrite enabled
                  // (OCCLUSION_DEBUG_VISIBLE). Colour-codes which capsule region won,
                  // so misplacement is obvious rather than inferred: red = left arm,
                  // green = right arm, blue = torso.
                  vec3 dbg = vec3(0.0, 0.0, 1.0);
                  if (winner == 0) dbg = vec3(1.0, 0.0, 0.0);
                  else if (winner == 1) dbg = vec3(0.0, 1.0, 0.0);
                  // White dots mark exactly where the shader believes each tracked
                  // joint is. If these don't land on the wearer's real joints, the
                  // 2D coordinate mapping is wrong -- which is faster to see than to
                  // reason about from region colours alone.
                  if (isJointMarker) dbg = vec3(1.0, 1.0, 1.0);
                  gl_FragColor = vec4(dbg, 1.0);
                }
              \`
            });

            // Quad from -1 to 1
            const quadGeo = new THREE.PlaneGeometry(2, 2);
            occlusionMesh = new THREE.Mesh(quadGeo, occlusionMaterial);
            occlusionMesh.frustumCulled = false;
            // Render occlusion BEFORE garment
            occlusionMesh.renderOrder = -1;
            // Phase 2 Tier 1 (was disabled): the coordinate-space mismatch that kept
            // this out of the scene is fixed in the uJoints3D population above (see
            // its own comment) -- worldLandmarks are canonicalized and anchored into
            // scene space via targetPos before being written into the shader uniform,
            // and uViewProj is now actually set every frame (it never was before).
            // This is a skeletal-capsule approximation, not per-pixel depth-aware
            // occlusion (no real segmentation mask; that's Tier 2) -- capsule radius
            // (uCapsuleRadius) needs live tuning against Test D screenshots.
            scene.add(occlusionMesh);
            garmentGroup = new THREE.Group();
            scene.add(garmentGroup);
            const loader = new THREE.GLTFLoader();
            showDebug('Loading GLB: ' + ${safeStringify(modelUrl)});
            loader.load(${safeStringify(modelUrl)}, (gltf) => {
              showDebug('GLB loaded OK');
              garmentModel = gltf.scene;

              // Measured BEFORE garmentModel is parented under garmentGroup, and this
              // matters: Box3.setFromObject() walks the object's own matrixWorld, which
              // for a freshly-parented child is parent.matrixWorld * localMatrix. Pose
              // frames start arriving (and animate()/render() keeps garmentGroup's
              // matrixWorld current) well before this async GLB load resolves, so
              // measuring AFTER garmentGroup.add(garmentModel) picked up whatever live
              // tracked position/rotation/scale garmentGroup already had -- confirmed by
              // reading r128's Box3/Object3D source, this silently measured in world
              // space and used the result as if it were the model's own rest-pose size.
              // garmentModel has no parent yet here, so its matrixWorld is its own
              // identity-relative local matrix: a true model-local measurement.
              //
              // Always measure the mesh's own real bounding-box width, regardless of which
              // anchor branch runs below. The "fail-safe" scale check further down compares
              // the calibrated rest_pose_metric_width against this value -- confirmed live
              // that leaving it at its hardcoded 0.4 default (only ever updated in the
              // no-calibrated-anchor branch) made the fail-safe silently reject a correct,
              // much smaller calibrated width (0.119) as "too different from 0.4" and
              // override it to 0.4*0.7=0.28 on every single frame.
              const box = new THREE.Box3().setFromObject(garmentModel);
              measuredMeshWidth = box.getSize(new THREE.Vector3()).x;
              // TEMP DEBUG: ground truth for calibrating rest_pose_metric_width -- this is
              // known unreliable for a SkinnedMesh in this Three.js version (r128) per the
              // master plan's own history, but seeing the actual number beats guessing blind.
              const boxSize = box.getSize(new THREE.Vector3());
              console.log('[AR-DEBUG-BBOX] Box3.setFromObject (rest pose, load time): size=' + JSON.stringify({x:+boxSize.x.toFixed(4), y:+boxSize.y.toFixed(4), z:+boxSize.z.toFixed(4)})
                + ' min=' + JSON.stringify({x:+box.min.x.toFixed(4), y:+box.min.y.toFixed(4), z:+box.min.z.toFixed(4)})
                + ' max=' + JSON.stringify({x:+box.max.x.toFixed(4), y:+box.max.y.toFixed(4), z:+box.max.z.toFixed(4)}));

              // Phase 5: Anatomical Anchoring
              const anchorOffset = ${metadata && metadata.anatomicalAnchorOffset ? safeStringify(metadata.anatomicalAnchorOffset) : 'null'};
              if (anchorOffset) {
                // Shift the model inversely by its anatomical anchor
                garmentModel.position.set(-anchorOffset.x, -anchorOffset.y, -anchorOffset.z);
              } else {
                // Fallback: no calibrated anchor for this garment, so approximate one from
                // geometry. Anchoring at the box's horizontal center but its TOP edge (not
                // its vertical center) puts the collar/shoulder line near the origin instead
                // of the mid-torso -- since the group's position is later set to the wearer's
                // shoulder midpoint every frame, anchoring at center made the garment hang
                // roughly half its own height too high, and the visible remainder sit too low.
                const center = box.getCenter(new THREE.Vector3());
                const topCenter = new THREE.Vector3(center.x, box.max.y, center.z);
                garmentModel.position.sub(topCenter);
              }

              // Parented only now, after the model-local Box3 measurement and anchor
              // positioning above are both done -- see the comment at garmentModel =
              // gltf.scene for why parenting earlier corrupted that measurement.
              garmentGroup.add(garmentModel);

              // r128's SkinnedMesh never recomputes geometry.boundingSphere for the posed
              // shape -- skinning is GPU-only in this version, so the CPU position attribute
              // (what computeBoundingSphere reads) always reflects the bind pose, never the
              // live retargeted pose. WebGLRenderer.projectObject() frustum-culls per object
              // using that stale sphere transformed by the live (correct) matrixWorld, so a
              // provably-correct transform can still be silently skipped for the draw call --
              // confirmed live: the anchorDebugBone diagnostic logged delta=0.000 against
              // targetPos on frames where the garment still failed to render. Same root cause
              // this file's own author already worked around for occlusionMesh (frustumCulled
              // = false, above) but never applied to the actual garment mesh. Recomputing the
              // bounding sphere per frame would not help -- it would just reproduce the same
              // wrong bind-pose sphere -- so disable culling on it entirely instead.
              garmentModel.traverse((child) => {
                if (child.isMesh) child.frustumCulled = false;
              });

              // Extract skeleton bones for Phase 4B Skinning
              garmentModel.traverse((child) => {
                if (child.isBone) {
                  skeletonBones[child.name] = child;
                }
              });

              // Capture each Shoulder/Arm/ForeArm bone's REAL bind-pose local quaternion
              // before any frame ever writes to them. skeletalRetargeter.ts computes each
              // bone's rotation as a DELTA relative to that bone's own bind orientation, in
              // world space -- applying that delta correctly as a LOCAL quaternion requires
              // "sandwiching" it between the bind rotations of everything from Shoulder down
              // to (and including) the bone itself: corrected = invert(parentBindPrefix) *
              // delta * ownBindPrefix. A first attempt here (invert(shoulderBind) * delta
              // alone, no ownBindPrefix) passed a mental check but failed a real one: fed a
              // literal identity delta (confirmed live, Cotton T-Shirt test), it returned a
              // ~150deg rotation instead of the bone's own unchanged bind pose. This version
              // is verified to return exactly the bind pose when the delta is identity.
              // The prefix is walked up the REAL parent chain rather than assumed to start
              // at the Shoulder. The old hardcoded Shoulder->Arm->ForeArm version silently
              // assumed every bind rotation above the shoulder was identity -- true only
              // while skeletalRetargeter was overwriting the Spine bone every frame. It no
              // longer does (the torso orientation moved to the garment group, P0-D), so
              // Spine/Spine1/Spine2 now sit at their own bind rotations.
              //
              // CRITICAL: the walk must NOT stop at the first non-Bone ancestor. Measured
              // on this rig, the Mixamo skeleton hangs under an "Armature" node holding
              // +90deg about X, and its child "Hips" bone holds -90deg about X -- they
              // cancel exactly. Armature is an Object3D, not a Bone. A bones-only walk
              // therefore picks up the Hips -90deg without the +90deg that cancels it and
              // rotates every sleeve 90deg about X: "arm down" gets drawn pointing straight
              // backward, while "arm out sideways" (along the rotation axis) looks fine --
              // confirmed against the GLB, and confirmed live as the blazer sleeve going
              // backward. Walk up to (excluding) garmentGroup, whose own quaternion is the
              // live torso orientation and must never enter a bind prefix.
              const boneMapForBind = ${metadata ? safeStringify(metadata.boneMap) : 'null'};
              const bindQuats = {};
              garmentModel.traverse((child) => { // traverse includes garmentModel itself
                bindQuats[child.uuid] = child.quaternion.clone();
              });
              const resolveBindBoneName = (canonical) => {
                if (skeletonBones[canonical]) return canonical;
                if (boneMapForBind && boneMapForBind[canonical]) return boneMapForBind[canonical];
                return 'mixamorig' + canonical;
              };
              // TEMP DEBUG: resolve the actual anchor bone (Spine2, the DB's current
              // anatomicalAnchorOffset source) once, for per-frame world-position logging.
              anchorDebugBone = skeletonBones[resolveBindBoneName('Spine2')] || null;
              if (__DEV__) {
                console.log('[AR-DEBUG-ANCHOR-SETUP] anchorDebugBone resolved=' + (anchorDebugBone ? anchorDebugBone.name : 'NOT FOUND'));
              }
              // Product of every bind rotation from garmentGroup down to and including this
              // node -- i.e. the node bind orientation in the same space the retargeter
              // deltas are expressed in. Includes non-Bone ancestors (see above).
              const bindPrefix = (node) => {
                const chain = [];
                for (let n = node; n && n !== garmentGroup; n = n.parent) chain.unshift(n);
                const q = new THREE.Quaternion();
                for (const n of chain) q.multiply(bindQuats[n.uuid] || n.quaternion);
                return q;
              };
              const registerCorrection = (canonical) => {
                const bone = skeletonBones[resolveBindBoneName(canonical)];
                if (!bone) return;
                boneCorrection[canonical] = {
                  parentPrefix: bindPrefix(bone.parent),
                  ownPrefix: bindPrefix(bone),
                };
              };
              ['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'].forEach(registerCorrection);

              // One-shot: log the ancestor chain the prefix actually walked, and where the
              // LeftArm points at bind once that prefix is applied. That direction must come
              // out close to +X for a T-pose rig (measured 6.4deg off on the blazer, its own
              // rest droop). If it comes out near -Z or +Z, the prefix is missing a
              // canceling ancestor rotation again -- exactly the Armature/Hips bug above.
              const armForBind = skeletonBones[resolveBindBoneName('LeftArm')];
              if (armForBind) {
                const chainNames = [];
                for (let n = armForBind; n && n !== garmentGroup; n = n.parent) chainNames.unshift(n.name || n.type);
                const foreForBind = skeletonBones[resolveBindBoneName('LeftForeArm')];
                const limbAxis = foreForBind ? foreForBind.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
                const bindDir = limbAxis.applyQuaternion(bindPrefix(armForBind));
                console.log('[AR-DEBUG-BIND] prefix chain: ' + chainNames.join(' -> ')
                  + ' | LeftArm bind direction: ' + JSON.stringify({ x: +bindDir.x.toFixed(3), y: +bindDir.y.toFixed(3), z: +bindDir.z.toFixed(3) })
                  + ' | expected close to +X');
              }

              console.log('[AR-DEBUG] actual GLB bone names: ' + JSON.stringify(Object.keys(skeletonBones))
                + ' | boneMap in use: ' + JSON.stringify(${metadata && metadata.boneMap ? safeStringify(metadata.boneMap) : 'null'}));

            }, undefined, (error) => {
              var msg = error && error.message ? error.message : JSON.stringify(error);
              console.error('[AR] GLB load failed', error);
              showDebug('GLB load FAILED: ' + msg);
              notifyLoadError('GLB load failed: ' + msg);
            });

            window.addEventListener('resize', onWindowResize);
            animate();
          }

          function onWindowResize() {
            camera.aspect = getCameraAspect();
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
          }

          function animate() {
            requestAnimationFrame(animate);
            // Phase 2 Tier 1: occlusionMesh is in the scene now (see its declaration
            // above); uViewProj/uJoints2D/uJoints3D are set per-frame in the
            // UPDATE_TRANSFORM handler, not here -- this just renders the result.
            renderer.render(scene, camera);

            // Phase 1 instrumentation: real render-loop FPS, same rolling-1s-window
            // pattern as transportRateCount below -- see its declaration for why this is
            // a genuinely different number, not a duplicate.
            const renderRateNow = performance.now();
            if (renderRateWindowStart === 0) renderRateWindowStart = renderRateNow;
            renderFrameCount++;
            const renderRateElapsedMs = renderRateNow - renderRateWindowStart;
            if (renderRateElapsedMs >= 1000) {
              if (__DEV__) {
                const renderFps = (renderFrameCount / renderRateElapsedMs) * 1000;
                console.log('[AR-RENDER-FPS] fps=' + renderFps.toFixed(1));
              }
              renderFrameCount = 0;
              renderRateWindowStart = renderRateNow;
            }
          }

          window.addEventListener('message', (event) => {
            try {
              const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
              if (data && data.type === 'SET_CAMERA_CALIBRATION') {
                CAMERA_CALIBRATION = data.calibration || null;
                if (camera && CAMERA_CALIBRATION) {
                  camera.fov = CAMERA_CALIBRATION.verticalFovDeg;
                  camera.aspect = getCameraAspect();
                  // camera.position.z stays at its init-time bootstrap value (5, the old
                  // uncalibrated scene-unit convention) until a triangulation frame passes
                  // the frontality/plausible-range guards in the UPDATE_TRANSFORM handler
                  // below -- with no fallback, a wearer who never satisfies those guards
                  // (e.g. only ever seen at an angle) renders with a real, calibrated FOV
                  // paired with a fictitious 5-metre distance for the entire session. Not a
                  // full fix -- real triangulation is still the only accurate source -- but
                  // this seeds a plausible handheld-selfie distance as soon as calibration
                  // itself arrives, so the worst case is "roughly right" instead of "5m off".
                  if (smoothedCameraDistance == null) {
                    smoothedCameraDistance = 0.6;
                    camera.position.z = smoothedCameraDistance;
                  }
                  camera.updateProjectionMatrix();
                }
                showDebug('camera calibration applied: calibrated=' + !!CAMERA_CALIBRATION
                  + (CAMERA_CALIBRATION ? ' fov=' + CAMERA_CALIBRATION.verticalFovDeg.toFixed(2)
                    + ' focalLengthPx=' + CAMERA_CALIBRATION.focalLengthPx.toFixed(2)
                    + ' wearerShoulderWidthM=' + CAMERA_CALIBRATION.wearerShoulderWidthM : ''));
                return;
              }
              if (data && data.type === 'SET_FIT_MODIFIER') {
                FIT_MODIFIER = (typeof data.fitModifier === 'number' && isFinite(data.fitModifier) && data.fitModifier > 0)
                  ? data.fitModifier : 1;
                showDebug('fit modifier applied: ' + FIT_MODIFIER.toFixed(3));
                return;
              }
              if (data && data.type === 'UPDATE_TRANSFORM' && garmentGroup) {
                const { pos, rot, scl, boneRotations, normalizedLandmarks, worldLandmarks } = data;
                debugFrameCount++;
                const shouldLog = (debugFrameCount % 20 === 0);

                // Phase 1 instrumentation: real processed-frame rate, rolling 1s window
                // for the same reason as the native-side counter -- a frame-count modulus
                // would stretch or compress silently if the true rate drifted.
                const rateNow = performance.now();
                if (transportRateWindowStart === 0) transportRateWindowStart = rateNow;
                transportRateCount++;
                const rateElapsedMs = rateNow - transportRateWindowStart;
                if (rateElapsedMs >= 1000) {
                  if (__DEV__) {
                    const ratePerSec = (transportRateCount / rateElapsedMs) * 1000;
                    console.log('[AR-TRANSPORT-RATE-WEBVIEW] processed/sec=' + ratePerSec.toFixed(1));
                  }
                  transportRateCount = 0;
                  transportRateWindowStart = rateNow;
                }

                // Pure Metric Camera Projection (Fixing P0/P1 Alignment)
                if (normalizedLandmarks && normalizedLandmarks[11] && normalizedLandmarks[12] && camera.projectionMatrix) {
                  try {
                    // Superseded by mirroring the whole rendered View with CSS scaleX(-1)
                    // (see the wrapping <View> style below) -- the SAME mechanism the <video>
                    // itself already uses. That mirrors position AND the mesh's own left/right
                    // geometry together, consistently, as a single flat 2D flip after Three.js
                    // has already rendered normally -- no 3D winding/lighting risk. Flipping
                    // only these two landmark points (the previous fix here) mirrored position
                    // alone and left the mesh's internal left/right arrangement unmirrored,
                    // which is why the wrong-side sleeve still visibly responded even after
                    // that fix -- confirmed live via bone-level logs showing the ROTATION math
                    // was already correct throughout (RightArm's own quaternion clearly changed
                    // when the real right arm was raised); only which screen side it rendered
                    // on was ever wrong.
                    const l11 = normalizedLandmarks[11];
                    const l12 = normalizedLandmarks[12];

                    // Fix for #27 in the AR audit plan: this block's similar-triangles
                    // distance formula assumed the measured shoulder pixel width is always
                    // the frontal width, but it foreshortens by cos(yaw) exactly like
                    // targetWorldWidth below -- so turning away made a constant real distance
                    // read as progressively farther (confirmed live: yaw -49deg -> 1.1-1.2m,
                    // yaw -50 to -68deg -> 1.67-1.72m, frontal baseline ~0.9m, no actual
                    // movement). Hoisted from its original spot next to targetWorldWidth further
                    // down so both foreshortening corrections share one yaw read per frame.
                    //
                    // Fix for #17 in the AR audit plan (2026-09-02, per that day's decision to
                    // invest in a real fix): simply clamping cos(yaw) to a 0.65 floor doesn't
                    // saturate -- once true |cos(yaw)| drops below the floor, dividing by a now-
                    // FIXED 0.65 while the numerator (apparent width) keeps shrinking with real
                    // foreshortening means the corrected result keeps shrinking too, just no
                    // longer compensated for. A single frame at steep yaw can't recover true
                    // frontal width anyway (near 90 deg the shoulders' projection genuinely
                    // collapses toward zero) -- the only way to actually hold steady is to freeze
                    // the correction at the last value computed while yaw was still in the
                    // reliable range, which needs state carried across frames. lastReliableCosYaw
                    // (declared at module scope above) is that state: updated only while
                    // |cos(yaw)| is above the floor, held unchanged otherwise, so the corrected
                    // width genuinely plateaus past ~49deg instead of continuing to shrink.
                    let yawCosCorrection = 1;
                    const rotValidForYaw = Number.isFinite(rot.x) && Number.isFinite(rot.y) && Number.isFinite(rot.z) && Number.isFinite(rot.w);
                    if (rotValidForYaw) {
                      const yawEuler = new THREE.Euler().setFromQuaternion(
                        new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w), 'YXZ'
                      );
                      const rawCosYaw = Math.abs(Math.cos(yawEuler.y));
                      // Smooth the extracted cos(yaw) itself, before the #17 floor logic
                      // below sees it -- see the smoothedCosYaw declaration above for why.
                      // Same blend factor as smoothedPos/smoothedScale/smoothedQuat use.
                      smoothedCosYaw = smoothedCosYaw == null ? rawCosYaw : smoothedCosYaw + (rawCosYaw - smoothedCosYaw) * 0.25;
                      if (smoothedCosYaw >= 0.65) {
                        lastReliableCosYaw = smoothedCosYaw;
                        yawCosCorrection = smoothedCosYaw;
                      } else {
                        yawCosCorrection = lastReliableCosYaw;
                      }
                    }

                    // Phase 3: real distance triangulation. Real focal length (px) and the
                    // wearer's own real shoulder width give real distance from this frame's
                    // measured pixel separation -- the standard similar-triangles formula,
                    // meaningful now that CAMERA_CALIBRATION.verticalFovDeg (set at init) is
                    // the real physical FOV rather than the arbitrary 45deg default. Smoothed
                    // the same way position/scale/rotation already are elsewhere in this
                    // handler, since single-frame landmark jitter would otherwise make the
                    // camera (and therefore the whole scene) visibly judder in depth.
                    if (CAMERA_CALIBRATION) {
                      // True 2D pixel separation (not just the X component). Using only
                      // Math.abs(l12.x - l11.x) collapsed toward zero whenever the wearer
                      // was turned or had an arm raised near the shoulder line -- confirmed
                      // live: a frame with l11.y=0.672/l12.y=0.114 (near-vertical shoulder
                      // line) produced a near-zero horizontal width and a bogus ~7m distance.
                      const dxPx = (l12.x - l11.x) * CAMERA_CALIBRATION.videoWidthPx;
                      const dyPx = (l12.y - l11.y) * CAMERA_CALIBRATION.videoHeightPx;
                      const measuredPixelWidth = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
                      // Reject frames where the shoulder line is more vertical than
                      // horizontal -- not a genuine frontal shoulder-width read (occlusion,
                      // profile turn, raised arm), so triangulating from it is meaningless.
                      const isRoughlyFrontal = Math.abs(dxPx) > Math.abs(dyPx);
                      if (measuredPixelWidth > 1 && isRoughlyFrontal) {
                        // measuredPixelWidth foreshortens by cos(yaw) at a fixed real distance,
                        // which the naive formula misreads as farther away the more the wearer
                        // turns -- correct back out by the same yawCosCorrection used for
                        // targetWorldWidth below, so a real distance change is what moves this,
                        // not yaw alone.
                        const rawDistance = ((CAMERA_CALIBRATION.wearerShoulderWidthM * CAMERA_CALIBRATION.focalLengthPx) / measuredPixelWidth) * yawCosCorrection;
                        // Realistic handheld-phone try-on range, not the theoretical camera
                        // range -- the old [0.05, 20]m bound let a bad bootstrap frame (e.g.
                        // 19m) seed smoothedCameraDistance, and the per-frame clamp below then
                        // trapped it near that bad anchor since it can only move +/-40%/frame.
                        if (Number.isFinite(rawDistance) && rawDistance > 0.2 && rawDistance < 2.5) {
                          // Clamp how far a single frame can pull the smoothed distance so one
                          // noisy/occluded frame that still passed the checks above can't yank
                          // the camera around; a genuine distance change still converges over
                          // a handful of frames.
                          const clampedRawDistance = smoothedCameraDistance == null
                            ? rawDistance
                            : Math.max(smoothedCameraDistance * 0.6, Math.min(smoothedCameraDistance * 1.4, rawDistance));
                          smoothedCameraDistance = smoothedCameraDistance == null
                            ? clampedRawDistance
                            : smoothedCameraDistance + (clampedRawDistance - smoothedCameraDistance) * 0.15;
                          camera.position.z = smoothedCameraDistance;
                          camera.updateMatrixWorld(true);
                        }
                      }
                    }

                    // Helper: Unproject 2D normalized landmark to 3D world at Z=0
                    const unprojectToZ0 = (nx, ny) => {
                      if (isNaN(nx) || isNaN(ny)) return null;
                      const ndcX = (nx * 2) - 1;
                      const ndcY = -(ny * 2) + 1;
                      const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
                      vec.unproject(camera);
                      vec.sub(camera.position).normalize();
                      
                      // Protect against zero division (e.g., if matrix is NaN)
                      if (vec.z === 0 || isNaN(vec.z)) return null;
                      
                      const dist = (0 - camera.position.z) / vec.z;
                      return new THREE.Vector3().copy(camera.position).add(vec.multiplyScalar(dist));
                    };

                    // 1. Position at midpoint of shoulders
                    const midX = (l11.x + l12.x) / 2;
                    const midY = (l11.y + l12.y) / 2;
                    const midCrop = mapCoverCrop(midX, midY);
                    const targetPos = unprojectToZ0(midCrop.nx, midCrop.ny);

                    // 2. Exact scale based on Three.js world distance
                    const lCrop = mapCoverCrop(l11.x, l11.y);
                    const rCrop = mapCoverCrop(l12.x, l12.y);
                    const targetL = unprojectToZ0(lCrop.nx, lCrop.ny);
                    const targetR = unprojectToZ0(rCrop.nx, rCrop.ny);
                    
                    if (targetPos && targetL && targetR) {
                      // Phase B, reverted: tried using MediaPipe's worldLandmarks (real
                      // metres) here to make width distance/yaw-invariant. Confirmed live via
                      // model-viewer's independently-computed real dimensions (mesh height
                      // genuinely ~0.60m, not a broken/tiny mesh) that the resulting math was
                      // internally consistent yet still rendered too small on screen -- because
                      // this scene's virtual camera (45deg FOV, fixed z=5) was never calibrated
                      // to convert real metres into correct on-screen pixels; it only ever
                      // worked *self-consistently* with a 2D screen-projected width, since both
                      // measuring and rendering went through the same uncalibrated camera.
                      // Swapping only the measurement side broke that self-consistency.
                      //
                      // Phase 3: real camera intrinsics (the actual fix this comment used to
                      // call out as still-needed) now exist above whenever CAMERA_CALIBRATION is
                      // present -- both the FOV and camera.position.z (distance) are real, so
                      // this unprojection is measuring real metres correctly rather than only
                      // self-consistently. Without calibration data (web, or no saved wearer
                      // measurement), FOV=45/z=5 and this remains exactly the prior
                      // self-consistent-but-arbitrary behavior. Phase B2's fit modifier is
                      // unaffected either way -- it never depended on this.
                      // Fix for open item #2 in the AR audit plan: targetWorldWidth (the
                      // on-screen shoulder separation unprojected onto z=0) already shrinks
                      // by cos(yaw) as the wearer turns. exactScale was then applied to
                      // garmentGroup, whose quaternion (rot, the full torso orientation)
                      // foreshortens the garment's own shoulder line by cos(yaw) a SECOND
                      // time -- the garment rendered progressively too narrow while turning,
                      // worse than either correction alone. Normalize the measured width back
                      // out by the same cos(yaw) so the foreshortening is applied exactly
                      // once, via the 3D rotation itself. Same 0.65 floor convention as
                      // garmentFitter's 2D-path correctedShoulderWidthPx, for consistency.
                      // yawCosCorrection itself is now computed once, earlier in this handler,
                      // and shared with the #27 distance-triangulation fix above.
                      const targetWorldWidth = targetL.distanceTo(targetR) / yawCosCorrection;

                      // Trust an admin-calibrated width outright; fall back to this mesh's own
                      // measured bounding-box width only when no calibration exists at all.
                      // A "fail-safe" here used to cross-check a calibrated value against
                      // measuredMeshWidth and override it if too different -- removed after
                      // confirming live that THREE.Box3.setFromObject() does not account for
                      // a SkinnedMesh's actual skeleton-driven scale in this Three.js version
                      // (r128), so measuredMeshWidth can be wildly wrong (measured 0.0068 on
                      // this rig, vs. a correct calibrated 0.119) -- the fail-safe was using a
                      // broken measurement to override a correct one, producing an ~88x
                      // oversized, effectively invisible/off-frustum render.
                      const garmentMetricWidth = ${safeRestPoseMetricWidth !== undefined ? safeRestPoseMetricWidth : 'measuredMeshWidth'};
                      // Phase B2: real-measurement fit modifier, delivered by message (see
                      // FIT_MODIFIER above) since it depends on the same async sizing profile
                      // as CAMERA_CALIBRATION. 1 = today's pure silhouette-match behavior
                      // (default/fallback, and this const's own name is now local shadowing
                      // for clarity -- FIT_MODIFIER itself is reassigned by the message
                      // handler, this just snapshots its current value for this frame).
                      const fitModifier = FIT_MODIFIER;
                      const exactScale = (targetWorldWidth / garmentMetricWidth) * fitModifier;

                      // NaN Protection: Don't update transform if values are corrupted (e.g. before WebView layout)
                      const transformValid = !isNaN(exactScale) && isFinite(exactScale) && exactScale > 0 && !isNaN(targetPos.x);
                      // rot NaN protection, added separately from transformValid on purpose: a
                      // NaN quaternion (from poseNormalizer's quaternionFromBasis under a large
                      // bend -- see its own hardening comment) must never reach smoothedQuat.slerp
                      // below. slerp always mixes in its OWN current value, so one bad frame
                      // poisons every future frame permanently -- confirmed live as "vanishes on
                      // a bend and never comes back without a reload". Skip only the rotation
                      // update for a bad frame; position/scale still update normally, and the
                      // garment holds its last good orientation instead of going NaN forever.
                      const rotValid = Number.isFinite(rot.x) && Number.isFinite(rot.y) && Number.isFinite(rot.z) && Number.isFinite(rot.w);
                      if (!rotValid && shouldLog) {
                        console.warn('[AR-DEBUG-BONE] non-finite orientation3D this frame, holding last good rotation: ' + JSON.stringify(rot));
                      }

                      // A scale/position plausibility guard (reject a frame whose exactScale
                      // jumped implausibly far from the current smoothed value) was tried here and
                      // reverted. It was calibrated against one captured bad episode and verified to
                      // suppress that exact sequence, but it coupled position, scale, AND rotation
                      // to a single scale-ratio check -- so a LEGITIMATE fast width change (turning
                      // to face the camera goes from profile-narrow to frontal-wide; raising the
                      // arms makes MediaPipe's own shoulder-landmark estimate noisier from
                      // self-occlusion) could exceed the same ratio bound a glitch would, freezing
                      // the entire transform mid-motion. Confirmed live as a real regression: turning
                      // and raising both arms, both previously working, started disappearing.
                      if (transformValid) {
                        // Smooth position/scale across frames (simple exponential moving
                        // average) instead of snapping straight to this frame's raw value.
                        // Confirmed live: exactScale swung wildly frame to frame (observed
                        // 1.7x to 8.9x within a handful of logged samples, from ordinary
                        // MediaPipe landmark jitter -- there was no temporal filtering on
                        // this code path at all), causing the garment to flash visible for
                        // an instant then jump off-frame/to an absurd size the very next
                        // frame -- reads as "appears then disappears" even though tracking
                        // itself never actually dropped out.
                        const smoothing = 0.25; // higher = follows new frames faster
                        const targetQuat = rotValid ? new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w) : null;
                        if (!smoothedPos) {
                          smoothedPos = targetPos.clone();
                          smoothedScale = exactScale;
                          if (targetQuat) smoothedQuat = targetQuat.clone();
                        } else {
                          smoothedPos.lerp(targetPos, smoothing);
                          smoothedScale = smoothedScale + (exactScale - smoothedScale) * smoothing;
                          // rot now carries the FULL torso orientation (pitch and yaw as
                          // well as roll -- see poseNormalizer), so it needs the same
                          // temporal filtering position and scale already get. Pitch in
                          // particular comes from MediaPipe depth, its noisiest channel;
                          // slerping keeps that noise off the garment. targetQuat is null
                          // on a bad frame (rotValid=false) -- skip only this frame's
                          // rotation update rather than feeding NaN into slerp.
                          if (targetQuat) smoothedQuat.slerp(targetQuat, smoothing);
                        }
                        garmentGroup.position.copy(smoothedPos);
                        garmentGroup.scale.set(smoothedScale, smoothedScale, smoothedScale);
                        if (smoothedQuat) garmentGroup.quaternion.copy(smoothedQuat);
                      }

                      // Occlusion Compositor Uniforms (Phase 2 Tier 1).
                      // MUST live inside this block: targetPos is scoped to the try
                      // above, and an earlier version of this code sat after that
                      // scope closed -- referencing targetPos there threw a
                      // ReferenceError that the outer empty catch(e){} swallowed
                      // silently, so the uniforms were never written and every capsule
                      // stayed at (0,0). Confirmed live via uJ2D11={"x":0,"y":0} in the
                      // frame log while the cover-cropped landmark was a valid
                      // in-range value.
                      //
                      // uJoints3D was previously fed raw MediaPipe worldLandmarks
                      // (hip-origin-relative, Y-down, Z-away) while uViewProj treated
                      // them as this scene's own coordinates -- the documented reason
                      // this mesh was never added to the scene. Canonicalize the axes
                      // the same single way poseNormalizer.ts does on the RN side
                      // ((x,-y,-z), reproduced here because this WebView JS context
                      // can't import that module), then anchor the skeleton into scene
                      // space with one per-frame translation derived from targetPos --
                      // the shoulder midpoint unprojectToZ0 has already placed
                      // correctly. Every other joint inherits that offset, preserving
                      // MediaPipe's real relative proportions.
                      if (occlusionMaterial && normalizedLandmarks && worldLandmarks) {
                        const wl11 = worldLandmarks[11];
                        const wl12 = worldLandmarks[12];
                        if (wl11 && wl12) {
                          const offsetX = targetPos.x - (wl11.x + wl12.x) / 2;
                          const offsetY = targetPos.y - (-(wl11.y + wl12.y) / 2);
                          const offsetZ = targetPos.z - (-(wl11.z + wl12.z) / 2);
                          for (let ji = 0; ji < 33; ji++) {
                            const nrm = normalizedLandmarks[ji];
                            if (nrm) {
                              // Same cover-crop remap the rest of the pipeline uses, so
                              // the 2D capsule test lines up with what is actually
                              // visible when video and viewport aspect ratios differ.
                              const cr = mapCoverCrop(nrm.x, nrm.y);
                              occlusionMaterial.uniforms.uJoints2D.value[ji].set(cr.nx, cr.ny);
                            }
                            const wld = worldLandmarks[ji];
                            if (wld) {
                              occlusionMaterial.uniforms.uJoints3D.value[ji].set(
                                wld.x + offsetX,
                                -wld.y + offsetY,
                                -wld.z + offsetZ
                              );
                            }
                          }
                          occlusionMaterial.uniforms.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
                        }
                      }

                      // TEMP DEBUG: throttled diagnostic dump -- remove once the wrong-arm /
                      // disappearing-garment issues are root-caused. Logs every ~20 frames.
                      if (shouldLog) {
                        if (__DEV__) {
                          console.log('[AR-DEBUG-FRAME] transformValid=' + transformValid
                            + ' targetWorldWidth=' + targetWorldWidth.toFixed(4)
                            + ' garmentMetricWidth=' + garmentMetricWidth.toFixed(4)
                            + ' exactScale=' + exactScale.toFixed(4)
                            + ' yawCosCorrection=' + yawCosCorrection.toFixed(4)
                            + ' smoothedCosYaw=' + (smoothedCosYaw != null ? smoothedCosYaw.toFixed(4) : 'n/a')
                            + ' calibrated=' + !!CAMERA_CALIBRATION
                            + ' cameraDistanceM=' + (smoothedCameraDistance != null ? smoothedCameraDistance.toFixed(3) : 'n/a')
                            + ' verticalFovDeg=' + camera.fov.toFixed(1)
                            + ' l11(raw)=' + JSON.stringify(l11)
                            + ' l12(raw)=' + JSON.stringify(l12)
                            // Phase 2 Tier 1: confirms the occluder's capsule uniforms are
                            // actually being written (they silently were not before the
                            // scope fix -- see the occlusion uniform block above).
                            + ' uJ2D11=' + (occlusionMaterial ? JSON.stringify(occlusionMaterial.uniforms.uJoints2D.value[11]) : 'n/a')
                            + ' boneRotations=' + JSON.stringify(boneRotations));
                        }
                        // TEMP DEBUG: remove once blazer visibility is root-caused.
                        showDebug('valid=' + transformValid + ' width=' + targetWorldWidth.toFixed(3)
                          + ' metricW=' + garmentMetricWidth.toFixed(3) + ' scale=' + exactScale.toFixed(3)
                          + ' groupScale=' + garmentGroup.scale.x.toFixed(3)
                          + ' groupPos=(' + garmentGroup.position.x.toFixed(2) + ',' + garmentGroup.position.y.toFixed(2) + ',' + garmentGroup.position.z.toFixed(2) + ')'
                          + ' bones=' + Object.keys(skeletonBones).length);
                        // TEMP DEBUG: the REAL anchor-bone check (corrected version -- the
                        // earlier attempt measured garmentModel's own coordinate origin, not
                        // the anchor bone itself, and reported a misleading number). Spine2
                        // is never retargeted per-frame (only the 4 arm bones are), so it
                        // should sit at its exact bind-pose position; this should land very
                        // close to targetPos/groupPos if the anchor math is correct.
                        if (anchorDebugBone && __DEV__) {
                          const anchorBoneWorldPos = new THREE.Vector3();
                          anchorDebugBone.getWorldPosition(anchorBoneWorldPos);
                          const anchorDelta = anchorBoneWorldPos.clone().sub(garmentGroup.position);
                          console.log('[AR-DEBUG-ANCHOR-BONE] name=' + anchorDebugBone.name
                            + ' worldPos=(' + anchorBoneWorldPos.x.toFixed(3) + ',' + anchorBoneWorldPos.y.toFixed(3) + ',' + anchorBoneWorldPos.z.toFixed(3) + ')'
                            + ' targetPos=(' + garmentGroup.position.x.toFixed(3) + ',' + garmentGroup.position.y.toFixed(3) + ',' + garmentGroup.position.z.toFixed(3) + ')'
                            + ' delta=(' + anchorDelta.x.toFixed(3) + ',' + anchorDelta.y.toFixed(3) + ',' + anchorDelta.z.toFixed(3) + ')');
                        }
                      }
                    } else if (shouldLog) {
                      if (__DEV__) {
                        console.log('[AR-DEBUG-FRAME] SKIPPED: targetPos/targetL/targetR unprojection failed (likely NaN camera/vector math)');
                      }
                      showDebug('unprojection FAILED (likely NaN camera/vector math)');
                    }
                  } catch(e) { console.error('Projection Math Error', e); showDebug('Projection Math Error: ' + e.message); }
                } else {
                  // Fallback
                  if (__DEV__ && shouldLog) {
                    console.log('[AR-DEBUG-FRAME] FALLBACK PATH: normalizedLandmarks[11]/[12] missing or camera not ready');
                  }
                  if (shouldLog) showDebug('FALLBACK PATH: no shoulder landmarks / camera not ready, pos=' + JSON.stringify(pos) + ' scl=' + scl);
                  garmentGroup.position.set(pos.x, pos.y, pos.z);
                  // Same NaN guard as the main path above -- see its comment.
                  if (Number.isFinite(rot.x) && Number.isFinite(rot.y) && Number.isFinite(rot.z) && Number.isFinite(rot.w)) {
                    garmentGroup.quaternion.set(rot.x, rot.y, rot.z, rot.w);
                  }
                  garmentGroup.scale.set(scl, scl, scl);
                }

                // 2. Mesh Skinning / Rig Retargeting
                // P0-A: re-enabled. Gated on the garment actually having a calibrated
                // boneMap AND the loaded GLTF actually exposing bones -- a garment with
                // neither stays on the rigid-only path above rather than silently no-op'ing
                // per-bone (which is what happened while this block was hardcoded off).
                const boneMap = ${metadata ? safeStringify(metadata.boneMap) : 'null'};
                const hasCalibratedRig = boneMap && Object.keys(boneMap).length > 0;
                const hasLoadedSkeleton = Object.keys(skeletonBones).length > 0;
                if (hasCalibratedRig && hasLoadedSkeleton && boneRotations) {
                  for (const [boneName, quat] of Object.entries(boneRotations)) {
                    // Try the canonical name directly against the loaded skeleton first --
                    // confirmed live that this specific GLB's bones are already named
                    // exactly the canonical names (LeftArm, RightForeArm, ...), while the
                    // stored boneMap's values (e.g. "_left_arm") don't match any bone in
                    // the file at all. Only fall back to boneMap / the mixamorig heuristic
                    // when the direct name isn't found, so a wrong-but-truthy boneMap entry
                    // can't override a name that already resolves correctly.
                    const targetBoneName = skeletonBones[boneName] ? boneName : (boneMap[boneName] || ('mixamorig' + boneName));
                    const bone = skeletonBones[targetBoneName];
                    if (bone && quat && !isNaN(quat.x) && !isNaN(quat.y) && !isNaN(quat.z) && !isNaN(quat.w)) {
                      const bc = boneCorrection[boneName]; // set for LeftArm/RightArm/LeftForeArm/RightForeArm
                      if (bc) {
                        // corrected = invert(parentBindPrefix) * delta * ownBindPrefix -- see
                        // the capture comment above for the full derivation. Verified: an
                        // identity delta correctly returns this bone to its own bind pose,
                        // unlike the earlier one-sided version.
                        const corrected = bc.parentPrefix.clone().invert()
                          .multiply(new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w))
                          .multiply(bc.ownPrefix);
                        bone.quaternion.copy(corrected);
                      } else {
                        bone.quaternion.set(quat.x, quat.y, quat.z, quat.w);
                      }
                      if (shouldLog && (boneName === 'LeftArm' || boneName === 'RightArm')) {
                        console.log('[AR-DEBUG-BONE] ' + boneName + ' -> ' + targetBoneName
                          + ' inputQuat=' + JSON.stringify(quat)
                          + ' finalLocalQuat=' + JSON.stringify({ x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w })
                          + ' hadBindCorrection=' + !!bc);
                      }
                    } else if (shouldLog && (boneName === 'LeftArm' || boneName === 'RightArm')) {
                      console.log('[AR-DEBUG-BONE] ' + boneName + ' -> ' + targetBoneName + ' SKIPPED: bone=' + !!bone + ' quat=' + JSON.stringify(quat));
                    }
                  }
                } else if (shouldLog) {
                  console.log('[AR-DEBUG-BONE] retargeting block skipped entirely: hasCalibratedRig=' + hasCalibratedRig + ' hasLoadedSkeleton=' + hasLoadedSkeleton + ' hasBoneRotations=' + !!boneRotations);
                }

                // TEMP DEBUG: one-shot ground truth, taken AFTER real skinning has been
                // applied at least once -- compare against the load-time [AR-DEBUG-BBOX] log.
                // scale.set(1,1,1) temporarily so this reads the mesh's own local size, not
                // the current frame's already-applied garmentGroup scale.
                if (!loggedPosedBBox && hasCalibratedRig && hasLoadedSkeleton) {
                  loggedPosedBBox = true;
                  const savedScale = garmentGroup.scale.clone();
                  garmentGroup.scale.set(1, 1, 1);
                  garmentGroup.updateMatrixWorld(true);
                  const posedBox = new THREE.Box3().setFromObject(garmentModel);
                  const posedSize = posedBox.getSize(new THREE.Vector3());
                  console.log('[AR-DEBUG-BBOX] Box3.setFromObject (POSED, skinning applied): size=' + JSON.stringify({x:+posedSize.x.toFixed(4), y:+posedSize.y.toFixed(4), z:+posedSize.z.toFixed(4)})
                    + ' min=' + JSON.stringify({x:+posedBox.min.x.toFixed(4), y:+posedBox.min.y.toFixed(4), z:+posedBox.min.z.toFixed(4)})
                    + ' max=' + JSON.stringify({x:+posedBox.max.x.toFixed(4), y:+posedBox.max.y.toFixed(4), z:+posedBox.max.z.toFixed(4)}));
                  garmentGroup.scale.copy(savedScale);
                  garmentGroup.updateMatrixWorld(true);
                }

              }
            } catch(e) {}
          });

          // Initialize Three.js
          init();
        </script>
      </body>
      </html>
    `;

    // Pushes calibration into the scene without rebuilding it (see CAMERA_CALIBRATION
    // above). Sent both when the value changes and when the WebView/iframe finishes
    // loading, since whichever happens second is the one that actually delivers it --
    // a message posted before the document is ready has no listener and is dropped.
    const sendCameraCalibration = useCallback(() => {
      if (!safeCameraCalibration) return;
      const payload = { type: 'SET_CAMERA_CALIBRATION', calibration: safeCameraCalibration };
      if (Platform.OS === 'web') {
        iframeRef.current?.contentWindow?.postMessage(payload, '*');
      } else if (webviewRef.current) {
        webviewRef.current.injectJavaScript(
          "window.postMessage(" + JSON.stringify(payload) + ", '*'); true;"
        );
      }
    }, [safeCameraCalibration]);

    useEffect(() => {
      sendCameraCalibration();
    }, [sendCameraCalibration]);

    // Same fix, same reason, for FIT_MODIFIER (see its declaration above) -- fitModifier
    // depends on the same async sizing profile as cameraCalibration, so it needs the
    // same message-based delivery to avoid rebuilding the WebView mid-session.
    const sendFitModifier = useCallback(() => {
      const payload = { type: 'SET_FIT_MODIFIER', fitModifier: safeFitModifier };
      if (Platform.OS === 'web') {
        iframeRef.current?.contentWindow?.postMessage(payload, '*');
      } else if (webviewRef.current) {
        webviewRef.current.injectJavaScript(
          "window.postMessage(" + JSON.stringify(payload) + ", '*'); true;"
        );
      }
    }, [safeFitModifier]);

    useEffect(() => {
      sendFitModifier();
    }, [sendFitModifier]);

    const sendRuntimeConfig = useCallback(() => {
      sendCameraCalibration();
      sendFitModifier();
    }, [sendCameraCalibration, sendFitModifier]);

    // Web has no ReactNativeWebView bridge -- the iframe posts AR_LOAD_ERROR to
    // window.parent directly (see notifyLoadError in the injected script).
    useEffect(() => {
      if (Platform.OS !== 'web' || !onLoadError) return;
      const handler = (event: MessageEvent) => {
        if (event.source !== iframeRef.current?.contentWindow) return;
        const data = event.data;
        if (data && data.type === 'AR_LOAD_ERROR') onLoadError(String(data.message));
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    }, [onLoadError]);

    useImperativeHandle(ref, () => ({
      updateTransform: (position, rotation, scale, boneRotations, segmentation, normalizedLandmarks, worldLandmarks) => {
        const payload = {
          type: 'UPDATE_TRANSFORM',
          pos: { x: position.x / 100, y: -position.y / 100, z: position.z },
          rot: rotation,
          scl: scale,
          boneRotations,
          normalizedLandmarks,
          worldLandmarks
        };

        if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
          // On web, we can pass ImageBitmap or MPMask via postMessage directly!
          if (segmentation && segmentation.data) {
            (payload as any).hasMask = true;
          }
          iframeRef.current.contentWindow.postMessage(payload, '*');
        } else if (webviewRef.current) {
          // Native WebView: we must avoid Base64 in the frame loop.
          // The proper architecture requires a shared WebGL context (e.g. expo-gl), 
          // but for this prototype, we send the transform and let the native side handle occlusion.
          const script = "window.postMessage(" + JSON.stringify(payload) + ", '*'); true;";
          webviewRef.current.injectJavaScript(script);
        }
      }
    }));

    return (
      <View style={[StyleSheet.absoluteFill, {
        pointerEvents: 'none',
        zIndex: 10,
        opacity: visible ? 1 : 0,
        // Force this layer into its own GPU compositing layer. Without this, Chromium
        // sometimes promotes the sibling <video> camera feed to a hardware-decode
        // compositing layer that ignores normal DOM/z-index stacking order and renders
        // on top regardless -- this was making the whole garment overlay invisible
        // (confirmed via a solid-color WebGL clear-color test that flashed once, then
        // got covered by the video the moment it started actively decoding frames).
        // scaleX(-1) mirrors this ENTIRE rendered layer the same simple way the <video>
        // itself is already mirrored (see WebCameraFeed's own scaleX(-1)) -- confirmed
        // live via bone-level logs that the retargeting math was already correct
        // (RightArm's quaternion genuinely changed when the real right arm moved); the
        // 3D scene itself was just never mirrored to match the video, so a character's
        // own right side rendered on the viewer's left, same as anyone's right hand
        // appears on the left in an ordinary unmirrored photo of them. A flat 2D flip
        // after Three.js has already rendered normally avoids any 3D winding-order/
        // lighting risk a negative Three.js scene scale would carry.
        // perspective+translateZ is the Chromium compositing-layer forcing hack described
        // above -- web-only, both by intent (native has no such stacking bug) and by
        // necessity: React Native's own processTransform.js has no `translateZ` case at
        // all and throws "Invalid transform translateZ" on native, confirmed live on a
        // real device this session. scaleX(-1) alone still does the actual mirror there.
        // Cast to any: RN's ViewStyle transform type has no perspective/translateZ
        // members at all -- it doesn't model RN-Web's extended CSS transform support,
        // not a real type mismatch in what actually runs on either platform.
        transform: (Platform.OS === 'web'
          ? [{ perspective: 1000 }, { translateZ: 1 }, { scaleX: -1 }]
          : [{ scaleX: -1 }]) as any,
      }]}>
        {Platform.OS === 'web' ? (
          // @ts-ignore
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            onLoad={sendRuntimeConfig}
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
          />
        ) : (
          <WebView
            ref={webviewRef}
            originWhitelist={['*']}
            source={{ html: htmlContent }}
            onLoadEnd={sendRuntimeConfig}
            style={{ backgroundColor: 'transparent' }}
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            // TEMP DEBUG: relays the WebView's [AR-DEBUG-*] logs into the outer RN
            // console (visible in Metro) -- remote-debugging the WebView's own
            // console directly hit a real DevTools protocol version mismatch
            // ("Remote browser is newer than client browser"), so this is the
            // reliable channel while Phase 3 calibration is being verified live.
            // Remove once that verification is done.
            onMessage={(event) => {
              const raw = event.nativeEvent.data;
              try {
                const data = JSON.parse(raw);
                if (data && data.type === 'AR_LOAD_ERROR') {
                  onLoadError?.(String(data.message));
                  return;
                }
              } catch {
                // Not JSON -- a plain [LOG]/[WARN] console relay line, fall through.
              }
              console.log('[WEBVIEW-RELAY] ' + raw);
            }}
          />
        )}
      </View>
    );
  }
);

GarmentRenderer.displayName = 'GarmentRenderer';
