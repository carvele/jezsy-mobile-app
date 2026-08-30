import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

import type { SegmentationFrame } from '../../types/pose';

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
  metadata?: import('@/src/types/garment').GarmentMetadata;
}

export const GarmentRenderer = forwardRef<GarmentRendererRef, GarmentRendererProps>(
  ({ modelUrl, metadata }, ref) => {
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
          let scene, camera, renderer, garmentModel, garmentGroup;
          let measuredMeshWidth = 0.4;
          let skeletonBones = {};
          let boneCorrection = {};
          let debugFrameCount = 0;
          let smoothedPos = null, smoothedScale = null, smoothedQuat = null;
          let consecutiveRejectedFrames = 0;
          let occlusionMesh, occlusionMaterial;
          let maskTexture;

          function init() {
            const container = document.getElementById('canvas-container');
            scene = new THREE.Scene();
            
            camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
            camera.position.z = 5;

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
            occlusionMaterial = new THREE.ShaderMaterial({
              transparent: false,
              colorWrite: false, // Depth pass only!
              depthWrite: true,
              depthTest: true,
              uniforms: {
                uMask: { value: null },
                uViewProj: { value: new THREE.Matrix4() },
                uJoints2D: { value: new Array(33).fill(null).map(()=>new THREE.Vector2()) },
                uJoints3D: { value: new Array(33).fill(null).map(()=>new THREE.Vector3()) },
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
                varying vec2 vUv;

                // Distance to line segment
                float lineDist(vec2 p, vec2 a, vec2 b, out float t) {
                  vec2 pa = p - a, ba = b - a;
                  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                  t = h;
                  return length(pa - ba * h);
                }

                void main() {
                  // Coverage from segmentation mask (Test G & H)
                  vec4 maskColor = texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)); 
                  if (maskColor.r < 0.5 && maskColor.a < 0.5) {
                    discard;
                  }

                  // 1. Left Arm Region
                  float tLUpper, tLLower;
                  float dLUpper = lineDist(vUv, uJoints2D[11], uJoints2D[13], tLUpper);
                  float dLLower = lineDist(vUv, uJoints2D[13], uJoints2D[15], tLLower);
                  float dLeftArm = min(dLUpper, dLLower);
                  vec3 posLUpper = mix(uJoints3D[11], uJoints3D[13], tLUpper);
                  vec3 posLLower = mix(uJoints3D[13], uJoints3D[15], tLLower);
                  vec3 posLeftArm = (dLUpper < dLLower) ? posLUpper : posLLower;

                  // 2. Right Arm Region
                  float tRUpper, tRLower;
                  float dRUpper = lineDist(vUv, uJoints2D[12], uJoints2D[14], tRUpper);
                  float dRLower = lineDist(vUv, uJoints2D[14], uJoints2D[16], tRLower);
                  float dRightArm = min(dRUpper, dRLower);
                  vec3 posRUpper = mix(uJoints3D[12], uJoints3D[14], tRUpper);
                  vec3 posRLower = mix(uJoints3D[14], uJoints3D[16], tRLower);
                  vec3 posRightArm = (dRUpper < dRLower) ? posRUpper : posRLower;

                  // 3. Torso Region
                  float tTorsoTop, tTorsoBot, tTorsoLeft, tTorsoRight;
                  float dTorsoTop = lineDist(vUv, uJoints2D[11], uJoints2D[12], tTorsoTop);
                  float dTorsoBot = lineDist(vUv, uJoints2D[23], uJoints2D[24], tTorsoBot);
                  float dTorsoLeft = lineDist(vUv, uJoints2D[11], uJoints2D[23], tTorsoLeft);
                  float dTorsoRight = lineDist(vUv, uJoints2D[12], uJoints2D[24], tTorsoRight);
                  float dTorso = min(min(dTorsoTop, dTorsoBot), min(dTorsoLeft, dTorsoRight));

                  vec3 posTorsoTop = mix(uJoints3D[11], uJoints3D[12], tTorsoTop);
                  vec3 posTorsoBot = mix(uJoints3D[23], uJoints3D[24], tTorsoBot);
                  vec3 posTorsoLeft = mix(uJoints3D[11], uJoints3D[23], tTorsoLeft);
                  vec3 posTorsoRight = mix(uJoints3D[12], uJoints3D[24], tTorsoRight);

                  vec3 posTorso = posTorsoTop;
                  if (dTorsoBot < dTorsoTop && dTorsoBot < dTorsoLeft && dTorsoBot < dTorsoRight) posTorso = posTorsoBot;
                  else if (dTorsoLeft < dTorsoTop && dTorsoLeft < dTorsoBot && dTorsoLeft < dTorsoRight) posTorso = posTorsoLeft;
                  else if (dTorsoRight < dTorsoTop && dTorsoRight < dTorsoBot && dTorsoRight < dTorsoLeft) posTorso = posTorsoRight;

                  // 4. Determine authoritative body part region (Test D, I)
                  float minDist = min(dLeftArm, min(dRightArm, dTorso));
                  vec3 best3DPos = posTorso;

                  if (minDist == dLeftArm) best3DPos = posLeftArm;
                  else if (minDist == dRightArm) best3DPos = posRightArm;

                  // 5. Camera Space Projection! (Strict requirement: Never write raw world Z)
                  vec4 clipSpace = uViewProj * vec4(best3DPos, 1.0);
                  float ndcZ = clipSpace.z / clipSpace.w;

                  // WebGL expects gl_FragDepth to be [0, 1]
                  gl_FragDepthEXT = (ndcZ + 1.0) * 0.5;
                }
              \`
            });

            // Quad from -1 to 1
            const quadGeo = new THREE.PlaneGeometry(2, 2);
            occlusionMesh = new THREE.Mesh(quadGeo, occlusionMaterial);
            occlusionMesh.frustumCulled = false;
            // Render occlusion BEFORE garment
            occlusionMesh.renderOrder = -1;
            // Disabled: the depth pre-pass writes depth using raw MediaPipe body-space
            // joint coordinates run through the scene's view-projection matrix, with no
            // reconciliation between the two coordinate spaces -- accuracy unverified.
            // Re-enable once that coordinate mismatch is actually fixed (see AR plan doc,
            // P0-B / Section 05 data-flow contracts).
            // scene.add(occlusionMesh);
            garmentGroup = new THREE.Group();
            scene.add(garmentGroup);
            const loader = new THREE.GLTFLoader();
            loader.load('${modelUrl}', (gltf) => {
              garmentModel = gltf.scene;
              garmentGroup.add(garmentModel);
              
              // Always measure the mesh's own real bounding-box width, regardless of which
              // anchor branch runs below. The "fail-safe" scale check further down compares
              // the calibrated rest_pose_metric_width against this value -- confirmed live
              // that leaving it at its hardcoded 0.4 default (only ever updated in the
              // no-calibrated-anchor branch) made the fail-safe silently reject a correct,
              // much smaller calibrated width (0.119) as "too different from 0.4" and
              // override it to 0.4*0.7=0.28 on every single frame.
              const box = new THREE.Box3().setFromObject(garmentModel);
              measuredMeshWidth = box.getSize(new THREE.Vector3()).x;

              // Phase 5: Anatomical Anchoring
              const anchorOffset = ${metadata && metadata.anatomicalAnchorOffset ? JSON.stringify(metadata.anatomicalAnchorOffset) : 'null'};
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
              const boneMapForBind = ${metadata ? JSON.stringify(metadata.boneMap) : 'null'};
              const bindQuats = {};
              garmentModel.traverse((child) => { // traverse includes garmentModel itself
                bindQuats[child.uuid] = child.quaternion.clone();
              });
              const resolveBindBoneName = (canonical) => {
                if (skeletonBones[canonical]) return canonical;
                if (boneMapForBind && boneMapForBind[canonical]) return boneMapForBind[canonical];
                return 'mixamorig' + canonical;
              };
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
                + ' | boneMap in use: ' + JSON.stringify(${metadata && metadata.boneMap ? JSON.stringify(metadata.boneMap) : 'null'}));

            }, undefined, (error) => {
              console.error('[AR] GLB load failed', error);
            });

            window.addEventListener('resize', onWindowResize);
            animate();
          }

          function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
          }

          function animate() {
            requestAnimationFrame(animate);
            if (occlusionMaterial && camera) {
              const proj = camera.projectionMatrix.clone();
              const view = camera.matrixWorldInverse.clone();
              occlusionMaterial.uniforms.uViewProj.value.multiplyMatrices(proj, view);
            }
            renderer.render(scene, camera);
          }

          window.addEventListener('message', (event) => {
            try {
              const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
              if (data && data.type === 'UPDATE_TRANSFORM' && garmentGroup) {
                const { pos, rot, scl, boneRotations, normalizedLandmarks } = data;
                debugFrameCount++;
                const shouldLog = (debugFrameCount % 20 === 0);

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
                    const targetPos = unprojectToZ0(midX, midY);
                    
                    // 2. Exact scale based on Three.js world distance
                    const targetL = unprojectToZ0(l11.x, l11.y);
                    const targetR = unprojectToZ0(l12.x, l12.y);
                    
                    if (targetPos && targetL && targetR) {
                      const targetWorldWidth = targetL.distanceTo(targetR);
                      
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
                      const garmentMetricWidth = ${metadata && metadata.restPoseMetricWidth ? metadata.restPoseMetricWidth : 'measuredMeshWidth'};
                      const exactScale = targetWorldWidth / garmentMetricWidth;

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

                      // Plausibility guard against a CONFIDENTLY WRONG frame -- distinct from the
                      // NaN guard above. Confirmed live (both a laptop webcam and a phone browser):
                      // MediaPipe occasionally reports shoulder landmarks at a wildly wrong 2D
                      // position (e.g. y around 0.75 instead of the normal ~0.1, z around -0.7
                      // instead of ~-0.1) with visibility still ~0.99 -- a confident misdetection,
                      // not a low-confidence one, so nothing upstream (trackingState/confidence
                      // gating in [id].tsx) catches it. Landing here as a finite-but-implausible
                      // exactScale (observed: normal frames run ~2-3x, bad ones jump to ~5.5-5.9x
                      // and STAY there for many consecutive frames), which reads as the garment
                      // flashing to roughly double size and effectively vanishing.
                      //
                      // A blanket "reject any big single-frame jump" was considered and rejected:
                      // legitimate frame-to-frame swings on this pipeline are already large during
                      // ordinary fast movement or a turn (observed up to ~7x between throttled log
                      // samples), so a tight threshold would fight real motion. Instead, compare the
                      // new raw value against the CURRENT SMOOTHED value (which already lags single
                      // -frame noise) with a generous ratio band, and cap how long a rejection can
                      // persist so a genuine large real change is never stuck rejected forever.
                      // Sized against the one real bad episode captured live: it ran roughly 18
                      // consecutive throttled log samples (shouldLog fires every 20 frames -- see
                      // above), i.e. ~360 real frames of sustained implausible detection before the
                      // captured log ended -- verified by replaying that exact sequence through this
                      // logic (300 undershot it, letting the tail of the episode back in). 500 covers
                      // the captured episode with real margin. Still a bound chosen from one observed
                      // case, not a guarantee -- a longer bad stretch could still eventually be
                      // accepted. The alternative (no cap at all) risks freezing the garment forever
                      // if a real, large, sustained change is ever misread as implausible, which is
                      // worse than an occasional long glitch getting through.
                      const MAX_CONSECUTIVE_REJECTS = 500; // roughly 25s at this pipeline's ~20fps inference rate
                      // Bounds calibrated against the real captured session, not guessed: the
                      // largest legitimate frame-to-frame ratio seen in ordinary good tracking was
                      // ~1.65x; the captured bad jump was ~2.19x. An earlier version of this guard
                      // used 2.5x as the upper bound, reasoned from a coarser read of the same log
                      // -- verified by replaying the exact captured sequence through this logic
                      // before shipping, and 2.5x let the bad jump through untouched on its very
                      // first frame (2.19 < 2.5), after which every later bad frame compared against
                      // the now-corrupted baseline and looked "plausible" too. 1.9x sits with margin
                      // above the largest legitimate swing and below the captured bad jump.
                      let scalePlausible = true;
                      if (smoothedScale !== null && smoothedScale > 0) {
                        const ratio = exactScale / smoothedScale;
                        scalePlausible = ratio > 0.4 && ratio < 1.9;
                      }
                      if (!scalePlausible && consecutiveRejectedFrames < MAX_CONSECUTIVE_REJECTS) {
                        consecutiveRejectedFrames++;
                        if (shouldLog) {
                          console.warn('[AR-DEBUG-FRAME] implausible scale jump rejected (holding last good transform): exactScale=' + exactScale.toFixed(4) + ' smoothedScale=' + smoothedScale.toFixed(4) + ' consecutiveRejectedFrames=' + consecutiveRejectedFrames);
                        }
                      } else {
                        // Either plausible, or we've held long enough that this is more likely a
                        // real (if sudden) change than a glitch -- accept it and reset the counter.
                        consecutiveRejectedFrames = 0;
                      }
                      const frameAccepted = transformValid && scalePlausible;

                      if (frameAccepted) {
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

                      // TEMP DEBUG: throttled diagnostic dump -- remove once the wrong-arm /
                      // disappearing-garment issues are root-caused. Logs every ~20 frames.
                      if (shouldLog) {
                        console.log('[AR-DEBUG-FRAME] transformValid=' + transformValid
                          + ' scalePlausible=' + scalePlausible + ' frameAccepted=' + frameAccepted
                          + ' targetWorldWidth=' + targetWorldWidth.toFixed(4)
                          + ' garmentMetricWidth=' + garmentMetricWidth.toFixed(4)
                          + ' exactScale=' + exactScale.toFixed(4)
                          + ' l11(raw)=' + JSON.stringify(l11)
                          + ' l12(raw)=' + JSON.stringify(l12)
                          + ' boneRotations=' + JSON.stringify(boneRotations));
                      }
                    } else if (shouldLog) {
                      console.log('[AR-DEBUG-FRAME] SKIPPED: targetPos/targetL/targetR unprojection failed (likely NaN camera/vector math)');
                    }
                  } catch(e) { console.error('Projection Math Error', e); }
                } else {
                  // Fallback
                  console.log('[AR-DEBUG-FRAME] FALLBACK PATH: normalizedLandmarks[11]/[12] missing or camera not ready');
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
                const boneMap = ${metadata ? JSON.stringify(metadata.boneMap) : 'null'};
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

                // 3. Occlusion Compositor Uniforms
                if (occlusionMaterial && data.normalizedLandmarks && data.worldLandmarks) {
                  for (let i = 0; i < 33; i++) {
                    const norm = data.normalizedLandmarks[i];
                    if (norm) {
                      occlusionMaterial.uniforms.uJoints2D.value[i].set(norm.x, norm.y);
                    }
                    const world = data.worldLandmarks[i];
                    if (world) {
                      occlusionMaterial.uniforms.uJoints3D.value[i].set(world.x, world.y, world.z);
                    }
                  }
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
        transform: [{ perspective: 1000 }, { translateZ: 1 }, { scaleX: -1 }],
      }]}>
        {Platform.OS === 'web' ? (
          // @ts-ignore
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
          />
        ) : (
          <WebView
            ref={webviewRef}
            originWhitelist={['*']}
            source={{ html: htmlContent }}
            style={{ backgroundColor: 'transparent' }}
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    );
  }
);

GarmentRenderer.displayName = 'GarmentRenderer';
