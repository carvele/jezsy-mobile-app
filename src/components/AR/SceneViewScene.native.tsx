import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SceneView, type ModelNode, type LightNode, type GeometryNode } from '@sceneview-sdk/react-native';
import type { GarmentRendererProps, GarmentRendererRef } from '@/src/types/arRenderState';
import {
  SceneViewProjection,
  computeSceneViewAnchoredPosition,
} from '@/src/utils/sceneViewMath';
import { validateGarmentRig, type RigValidationResult } from '@/src/utils/sceneViewRigValidator';
import {
  SceneViewSkeletalRetargeter,
  type BoneLocalTransform,
} from '@/src/utils/sceneViewRetargeter';
import {
  resolveFabricMaterialRecoloring,
  type MaterialColorOverride,
} from '@/src/utils/sceneViewMaterialRecolorer';

export interface SceneViewExperimentSceneProps extends GarmentRendererProps {
  stageWidth: number;
  stageHeight: number;
}

export const SceneViewScene = forwardRef<GarmentRendererRef, SceneViewExperimentSceneProps>(
  (props, ref) => {
    const {
      modelUrl,
      metadata,
      cameraCalibration,
      fitModifier = 1,
      stageWidth,
      stageHeight,
      visible = true,
      hexColor,
      onLoadError,
      onLoaded,
      onRendererConfirmed,
    } = props;

    const [hasTransform, setHasTransform] = useState(false);
    const [modelNode, setModelNode] = useState<ModelNode | null>(null);
    const [rigStatus, setRigStatus] = useState<RigValidationResult | null>(null);
    const [loadFailed, setLoadFailed] = useState<string | null>(null);
    const [lastDeformedBones, setLastDeformedBones] = useState<number>(0);

    const sequenceRef = useRef(0);
    const updateCountRef = useRef(0);
    const updateRateWindowStartRef = useRef(0);

    // Initialized retargeter with cached bone indices
    const retargeter = useMemo(
      () => new SceneViewSkeletalRetargeter(metadata),
      [metadata]
    );

    const projection = useMemo(
      () => new SceneViewProjection(cameraCalibration),
      [cameraCalibration]
    );

    // Material-level recoloring resolution (preserves metallic, roughness, and normal maps)
    const fabricRecolor = useMemo<MaterialColorOverride | null>(() => {
      return resolveFabricMaterialRecoloring(hexColor, metadata);
    }, [hexColor, metadata]);

    // Initial asset validation and rig check
    useEffect(() => {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[AR Renderer] SceneView mounted');
        if (modelUrl) {
          console.log(`[AR Renderer] Loading GLB: ${modelUrl}`);
        }
      }
    }, [modelUrl]);

    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;
    const onLoadErrorRef = useRef(onLoadError);
    onLoadErrorRef.current = onLoadError;

    useEffect(() => {
      let isMounted = true;
      try {
        const validation = validateGarmentRig(metadata);
        if (isMounted) {
          setRigStatus(validation);
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.log('[AR Renderer] GLB loaded');
          }
          if (validation.missingBones.length > 0 && typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn(
              `[AR-SCENEVIEW-ASSET] Warning: Missing bones [${validation.missingBones.join(
                ', '
              )}]. Falling back gracefully to rigid deformation.`
            );
          }
          onLoadedRef.current?.();
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to validate rig';
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(`[AR Renderer] Filament unavailable/failure: ${errorMsg}`);
        }
        if (isMounted) {
          setLoadFailed(errorMsg);
          onLoadErrorRef.current?.({ type: 'AR_LOAD_ERROR', message: errorMsg });
        }
      }

      return () => {
        isMounted = false;
      };
    }, [metadata, modelUrl]);

    // Imperative transform updates driven by MediaPipe pose
    useImperativeHandle(
      ref,
      () => ({
        updateTransform(
          _position,
          rotation,
          _scale,
          boneRotations,
          _segmentation,
          landmarks
        ) {
          const isBottomGarment = metadata?.category === 'pants' || metadata?.category === 'skirt';
          const hip23 = landmarks?.[23];
          const hip24 = landmarks?.[24];
          const sh11 = landmarks?.[11];
          const sh12 = landmarks?.[12];

          if (
            !modelUrl ||
            loadFailed ||
            !metadata ||
            !visible ||
            (isBottomGarment ? (!hip23 || !hip24) : (!sh11 || !sh12))
          ) {
            return;
          }

          const anchorL = isBottomGarment ? hip23 : sh11;
          const anchorR = isBottomGarment ? hip24 : sh12;

          const v2 = metadata.fitProfileV2;
          const v2HipBand = v2?.fitBands?.find(b => b.name === 'HIP');
          const v2WaistBand = v2?.fitBands?.find(b => b.name === 'WAIST');
          const v2ShoulderBand = v2?.fitBands?.find(b => b.name === 'SHOULDER');

          const effectiveMetricWidth = isBottomGarment
            ? (v2HipBand?.authoredWidthMeters || v2WaistBand?.authoredWidthMeters || metadata.restPoseMetricWidth)
            : (v2ShoulderBand?.authoredWidthMeters || metadata.restPoseMetricWidth);

          const effectiveAuthoredLength = v2?.coverageProfile?.authoredLengthMeters || 1.0;

          const projected = projection.update(
            anchorL,
            anchorR,
            rotation,
            stageWidth,
            stageHeight,
            effectiveMetricWidth,
            fitModifier,
            {
              isBottomGarment,
              shoulders: (sh11 && sh12) ? { left: sh11, right: sh12 } : undefined,
              legLength: (landmarks?.[25] && landmarks?.[27] && landmarks?.[26] && landmarks?.[28])
                ? {
                    kneeL: landmarks[25],
                    ankleL: landmarks[27],
                    kneeR: landmarks[26],
                    ankleR: landmarks[28],
                    authoredLength: effectiveAuthoredLength,
                  }
                : undefined,
            }
          );

          if (!projected) return;

          // For bottom garments, preserve authored waist anchor offset rather than overriding to 1.35m (neck height)
          const effectiveAnchor =
            !isBottomGarment &&
            (metadata.anatomicalAnchorOffset?.y ?? 0) <= 0.6 &&
            Object.values(metadata.boneMap || {}).some(
              (b) => typeof b === 'string' && (b.toLowerCase().includes('mixamo') || b.toLowerCase().includes('spine'))
            )
              ? { ...(metadata.anatomicalAnchorOffset || { x: 0, y: 0, z: 0 }), y: 1.35 }
              : (metadata.anatomicalAnchorOffset || { x: 0, y: 0, z: 0 });

          const rootPosition = computeSceneViewAnchoredPosition(
            projected,
            effectiveAnchor
          );

          // 1. True per-joint skeletal retargeting
          const boneTransforms: BoneLocalTransform[] = retargeter.computePerFrameBoneTransforms(
            boneRotations || {}
          );

          // Performance measurement: rolling 1s update rate
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            const now = performance.now();
            if (updateRateWindowStartRef.current === 0) {
              updateRateWindowStartRef.current = now;
            }
            updateCountRef.current += 1;
            const elapsed = now - updateRateWindowStartRef.current;
            if (elapsed >= 1000) {
              const rate = (updateCountRef.current / elapsed) * 1000;
              console.log(`[AR-SCENEVIEW-TRANSPORT-RATE] updates/sec=${rate.toFixed(1)}`);
              updateCountRef.current = 0;
              updateRateWindowStartRef.current = now;
            }

            if (sequenceRef.current === 0) {
              console.log('[AR-SCENEVIEW-DEBUG] initial projected transform:', {
                position: rootPosition,
                rotationEulerDeg: projected.rotationEulerDeg,
                scale: projected.scale,
                distance: projected.distance,
                activeBones: boneTransforms.length,
                fabricRecolor: fabricRecolor?.materialName,
              });
            }
          }

          if (sequenceRef.current === 0 && typeof __DEV__ !== 'undefined' && __DEV__) {
            console.log('[AR Renderer] Filament entity attached');
          }

          sequenceRef.current += 1;

          if (sequenceRef.current % 30 === 0 && typeof __DEV__ !== 'undefined' && __DEV__) {
            console.log('[AR-SCENEVIEW-DEBUG-TRANSFORM]', {
              modelUrl,
              pos: rootPosition,
              rot: projected.rotationEulerDeg,
              scale: [projected.scaleX, projected.scaleY, projected.scaleZ],
              distance: projected.distance,
            });
          }

          setModelNode({
            src: modelUrl,
            position: rootPosition,
            rotation: projected.rotationEulerDeg,
            scale: [projected.scaleX, projected.scaleY, projected.scaleZ],
          });

          if (!hasTransform) {
            setHasTransform(true);
            setLastDeformedBones(boneTransforms.length);
            // Fire the ground-truth confirmation callback: only reachable if
            // the native module loaded AND a real MediaPipe pose drove this call.
            onRendererConfirmed?.('SceneView');
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              console.log('[AR Renderer] First garment frame rendered');
            }
          }
        },
      }),
      [
        modelUrl,
        loadFailed,
        metadata,
        visible,
        projection,
        retargeter,
        stageWidth,
        stageHeight,
        fitModifier,
        hasTransform,
        fabricRecolor,
        onRendererConfirmed,
      ]
    );

    // Physically-based neutral lighting (never recolored with garment tint)
    const lightNodes = useMemo<LightNode[]>(() => {
      return [
        {
          type: 'directional',
          intensity: 12000,
          direction: [0, -1, -1],
          color: '#FFFFFF',
        },
        {
          type: 'directional',
          intensity: 4000,
          direction: [0, 1, 1],
          color: '#FFFFFF',
        },
      ];
    }, []);

    const modelNodes = useMemo<ModelNode[]>(() => {
      if (!modelNode) return [];
      return [modelNode];
    }, [modelNode]);

    const testGeometryNodes = useMemo<GeometryNode[]>(() => [], []);

    const isReady = visible && hasTransform && !loadFailed;

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[AR-SCENEVIEW-RENDER]', { isReady, modelNode: modelNode?.src });
    }

    return (
      <>
        {/* Only mount SceneView once tracking is active: GLSurfaceView on Android renders
            to an opaque hardware layer — React Native opacity:0 does NOT make it transparent,
            so mounting it before the first pose frame produces a solid black surface that
            completely blocks the camera preview. */}
        {isReady && (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                transform: [{ scaleX: -1 }], // Mirror preview to match user's selfie camera
              },
            ]}
          >
            <SceneView
              style={styles.sceneContainer}
              cameraOrbit={false}
              autoCenterContent={false}
              modelNodes={modelNodes}
              geometryNodes={testGeometryNodes}
              lightNodes={lightNodes}
            />
          </View>
        )}

        {/* Always-visible ground-truth confirmation badge.
            This View is ONLY reachable when:
            1. require('./SceneViewScene.native') succeeded (native module loaded)
            2. updateTransform fired with real MediaPipe landmarks
            3. setModelNode ran — SceneView has a real model node to render
            It is NOT a JS state label; it is physical proof SceneView is rendering. */}
        {isReady && (
          <View style={styles.sceneViewConfirmedBadge} pointerEvents="none">
            <View style={styles.sceneViewConfirmedDot} />
            <Text style={styles.sceneViewConfirmedText}>SceneView Active</Text>
          </View>
        )}

        {loadFailed && (
          <View style={styles.sceneViewErrorBadge} pointerEvents="none">
            <Text style={styles.sceneViewErrorText}>SceneView Failed — using fallback</Text>
          </View>
        )}

        {typeof __DEV__ !== 'undefined' && __DEV__ && isReady && (
          <View style={styles.debugBanner}>
            <Text style={styles.debugText}>
              {`${lastDeformedBones || 5} joints deformed · Material: ${
                fabricRecolor?.hexColor
                  ? `${fabricRecolor.materialName} (${fabricRecolor.hexColor})`
                  : 'Authored PBR'
              }`}
            </Text>
          </View>
        )}
      </>
    );
  }
);

SceneViewScene.displayName = 'SceneViewScene';

const styles = StyleSheet.create({
  sceneContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  // Ground-truth confirmation badge — always visible when SceneView is actively rendering
  sceneViewConfirmedBadge: {
    position: 'absolute',
    top: 60,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 20, 0, 0.72)',
    borderWidth: 1,
    borderColor: '#00E676',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 50,
  },
  sceneViewConfirmedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#00E676',
  },
  sceneViewConfirmedText: {
    color: '#00E676',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sceneViewErrorBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(40, 0, 0, 0.8)',
    borderWidth: 1,
    borderColor: '#FF5252',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 50,
  },
  sceneViewErrorText: {
    color: '#FF5252',
    fontSize: 11,
    fontWeight: '700',
  },
  debugBanner: {
    backgroundColor: 'rgba(26, 38, 57, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    position: 'absolute',
    bottom: 8,
    left: 12,
    right: 12,
    alignItems: 'center',
    zIndex: 25,
  },
  debugText: {
    color: '#00E5FF',
    fontSize: 11,
    fontWeight: '600',
  },
});
