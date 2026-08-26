import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

export interface GarmentRendererRef {
  updateTransform: (
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number },
    scale: number,
    worldLandmarks?: { x: number; y: number; z: number }[]
  ) => void;
}

interface GarmentRendererProps {
  modelUrl: string;
}

export const GarmentRenderer = forwardRef<GarmentRendererRef, GarmentRendererProps>(
  ({ modelUrl }, ref) => {
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

            const loader = new THREE.GLTFLoader();
            loader.load('${modelUrl}', (gltf) => {
              garmentModel = gltf.scene;
              scene.add(garmentModel);
              // Center model
              const box = new THREE.Box3().setFromObject(garmentModel);
              const center = box.getCenter(new THREE.Vector3());
              garmentModel.position.sub(center);

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
            renderer.render(scene, camera);
          }

          window.addEventListener('message', (event) => {
            try {
              const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
              if (data && data.type === 'UPDATE_TRANSFORM' && garmentModel) {
                const { pos, rot, scl, landmarks } = data;
                
                // 1. Rigid body anchor
                garmentModel.position.set(pos.x, pos.y, pos.z);
                garmentModel.quaternion.set(rot.x, rot.y, rot.z, rot.w);
                garmentModel.scale.set(scl, scl, scl);

                // 2. Mesh Skinning / Rig Retargeting (Phase 4B)
                // If the GLB has a skeleton, we map MediaPipe world landmarks to bone rotations.
                if (landmarks && Object.keys(skeletonBones).length > 0) {
                  // Example: Map LeftArm (shoulder to elbow) to MediaPipe landmarks 11 & 13
                  const leftShoulder = landmarks[11];
                  const leftElbow = landmarks[13];
                  const leftArmBone = skeletonBones['mixamorigLeftArm'] || skeletonBones['LeftArm'];
                  
                  if (leftArmBone && leftShoulder && leftElbow) {
                    // Calculate direction vector from shoulder to elbow
                    const dir = new THREE.Vector3(
                      leftElbow.x - leftShoulder.x,
                      -(leftElbow.y - leftShoulder.y), // Invert Y
                      leftElbow.z - leftShoulder.z
                    ).normalize();
                    
                    // In a full production implementation, we would apply IK constraints 
                    // or calculate the relative quaternion rotation from the rest pose.
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
      updateTransform: (position, rotation, scale, worldLandmarks) => {
        const message = JSON.stringify({
          type: 'UPDATE_TRANSFORM',
          pos: { x: position.x / 100, y: -position.y / 100, z: position.z },
          rot: rotation,
          scl: scale,
          landmarks: worldLandmarks
        });

        if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(message, '*');
        } else if (webviewRef.current) {
          const script = "window.postMessage(" + message + ", '*'); true;";
          webviewRef.current.injectJavaScript(script);
        }
      }
    }));

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
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
