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
          let scene, camera, renderer, garmentModel;
          let skeletonBones = {};
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
                #extension GL_EXT_frag_depth : enable
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
            scene.add(occlusionMesh);

            const loader = new THREE.GLTFLoader();
            loader.load('${modelUrl}', (gltf) => {
              garmentModel = gltf.scene;
              scene.add(garmentModel);
              // Phase 5: Anatomical Anchoring
              const anchorOffset = ${metadata ? JSON.stringify(metadata.anatomicalAnchorOffset) : 'null'};
              if (anchorOffset) {
                // Shift the model inversely by its anatomical anchor
                garmentModel.position.set(-anchorOffset.x, -anchorOffset.y, -anchorOffset.z);
              } else {
                // Fallback to Box3 center
                const box = new THREE.Box3().setFromObject(garmentModel);
                const center = box.getCenter(new THREE.Vector3());
                garmentModel.position.sub(center);
              }

              // Extract skeleton bones for Phase 4B Skinning
              garmentModel.traverse((child) => {
                if (child.isBone) {
                  skeletonBones[child.name] = child;
                }
              });
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
              if (data && data.type === 'UPDATE_TRANSFORM' && garmentModel) {
                const { pos, rot, scl, boneRotations } = data;
                
                // 1. Rigid body anchor
                garmentModel.position.set(pos.x, pos.y, pos.z);
                garmentModel.quaternion.set(rot.x, rot.y, rot.z, rot.w);
                garmentModel.scale.set(scl, scl, scl);

                // 2. Mesh Skinning / Rig Retargeting
                if (boneRotations && Object.keys(skeletonBones).length > 0) {
                  const boneMap = ${metadata ? JSON.stringify(metadata.boneMap) : 'null'};
                  for (const [boneName, quat] of Object.entries(boneRotations)) {
                    // Try to map using ingestion metadata first, fallback to heuristics
                    const targetBoneName = boneMap ? boneMap[boneName] : (skeletonBones[boneName] ? boneName : 'mixamorig' + boneName);
                    const bone = skeletonBones[targetBoneName];
                    if (bone) {
                      bone.quaternion.set(quat.x, quat.y, quat.z, quat.w);
                    }
                  }
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
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
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
