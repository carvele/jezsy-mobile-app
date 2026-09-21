import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SceneView, type ModelNode, type LightNode } from '@sceneview-sdk/react-native';
import type { GarmentRendererProps, GarmentRendererRef } from '@/src/types/arRenderState';
import {
  SceneViewProjection,
  computeSceneViewAnchoredPosition,
} from '@/src/utils/sceneViewMath';
import { validateGarmentRig, type RigValidationResult } from '@/src/utils/sceneViewRigValidator';

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
    } = props;

    const [hasTransform, setHasTransform] = useState(false);
    const [modelNode, setModelNode] = useState<ModelNode | null>(null);
    const [rigStatus, setRigStatus] = useState<RigValidationResult | null>(null);
    const [loadFailed, setLoadFailed] = useState<string | null>(null);

    const sequenceRef = useRef(0);
    const updateCountRef = useRef(0);
    const updateRateWindowStartRef = useRef(0);

    const projection = useMemo(
      () => new SceneViewProjection(cameraCalibration),
      [cameraCalibration]
    );

    // Initial asset validation and rig check
    useEffect(() => {
      let isMounted = true;
      try {
        const validation = validateGarmentRig(metadata);
        if (isMounted) {
          setRigStatus(validation);
          if (validation.missingBones.length > 0 && __DEV__) {
            console.warn(
              `[AR-SCENEVIEW-ASSET] Warning: Missing bones [${validation.missingBones.join(
                ', '
              )}]. Falling back gracefully to rigid deformation.`
            );
          }
          if (onLoaded) {
            onLoaded();
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to validate rig';
        if (isMounted) {
          setLoadFailed(errorMsg);
          if (onLoadError) {
            onLoadError({ type: 'AR_LOAD_ERROR', message: errorMsg });
          }
        }
      }

      return () => {
        isMounted = false;
      };
    }, [metadata, modelUrl, onLoaded, onLoadError]);

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
          if (
            !modelUrl ||
            loadFailed ||
            !metadata ||
            !landmarks?.[11] ||
            !landmarks?.[12] ||
            !visible
          ) {
            return;
          }

          const projected = projection.update(
            landmarks[11],
            landmarks[12],
            rotation,
            stageWidth,
            stageHeight,
            metadata.restPoseMetricWidth,
            fitModifier
          );

          if (!projected) return;

          const rootPosition = computeSceneViewAnchoredPosition(
            projected,
            metadata.anatomicalAnchorOffset
          );

          // Performance measurement: rolling 1s update rate
          if (__DEV__) {
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
                activeBones: Object.keys(boneRotations || {}).length,
              });
            }
          }

          sequenceRef.current += 1;

          setModelNode({
            src: modelUrl,
            position: rootPosition,
            rotation: projected.rotationEulerDeg,
            scale: projected.scale,
          });

          if (!hasTransform) {
            setHasTransform(true);
          }
        },
      }),
      [
        modelUrl,
        loadFailed,
        metadata,
        visible,
        projection,
        stageWidth,
        stageHeight,
        fitModifier,
        hasTransform,
      ]
    );

    // Dynamic light nodes, adapting for runtime variant recoloring
    const lightNodes = useMemo<LightNode[]>(() => {
      const lights: LightNode[] = [
        {
          type: 'directional',
          intensity: 12000,
          direction: [0, -1, -1],
          color: hexColor ? hexColor : '#FFFFFF',
        },
        {
          type: 'directional',
          intensity: 4000,
          direction: [0, 1, 1],
          color: '#FFFFFF',
        },
      ];
      return lights;
    }, [hexColor]);

    const modelNodes = useMemo<ModelNode[]>(() => {
      if (!modelNode) return [];
      return [modelNode];
    }, [modelNode]);

    const isReady = visible && hasTransform && !loadFailed;

    return (
      <>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: isReady ? 1 : 0,
              transform: [{ scaleX: -1 }], // Mirror preview to match user's selfie camera
            },
          ]}
        >
          <SceneView
            style={styles.sceneContainer}
            cameraOrbit={false}
            autoCenterContent={false}
            modelNodes={modelNodes}
            lightNodes={lightNodes}
          />
        </View>

        {__DEV__ && (
          <View style={styles.debugBanner}>
            <Text style={styles.debugText}>
              {loadFailed
                ? `SceneView error: ${loadFailed}`
                : isReady
                ? `SceneView prototype: ${
                    rigStatus?.boneCount ?? 4
                  } bones mapped. ${hexColor ? `Color: ${hexColor}` : 'Authored PBR'}`
                : 'Initializing SceneView garment...'}
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
