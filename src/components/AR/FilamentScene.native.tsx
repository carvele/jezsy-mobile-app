import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FilamentScene, FilamentView, Light, useModel, useFilamentContext, useAnimator, type Float3, type Entity, type RenderCallback } from 'react-native-filament';
import { useSharedValue } from 'react-native-worklets-core';
import type { GarmentRendererRef } from './GarmentRenderer';
import type { FilamentExperimentProps } from './FilamentExperimentRenderer';
import { anchoredPosition, axisAngle, correctBindRotation, FilamentProjection, rotationFromMatrix, type Projection } from '../../utils/filamentExperimentMath';
import type { Quaternion } from '../../types/pose';

type Binding = { entity: Entity; local: Quaternion; world: Quaternion; scale: Float3; position: Float3 };
type Transform = { entity: Entity; angle: number; axis: Float3; scale: Float3; position: Float3 };
type Packet = { sequence: number; camera: Projection; transforms: Transform[] };

const SceneContent = forwardRef<GarmentRendererRef, FilamentExperimentProps>((props, ref) => {
  const { modelUrl, metadata, cameraCalibration, fitModifier = 1, stageWidth, stageHeight, visible = true } = props;
  const { transformManager, camera } = useFilamentContext();
  const model = useModel({ uri: modelUrl }, { shouldReleaseSourceData: false });
  const asset = model.state === 'loaded' ? model.asset : undefined;
  const animator = useAnimator(asset);
  const root = model.state === 'loaded' ? model.rootEntity : undefined;
  const packet = useSharedValue<Packet | null>(null);
  const lastSequence = useSharedValue(-1);
  const sequence = useRef(0);
  const [rigError, setRigError] = useState<string | null>(null);
  const [boundCount, setBoundCount] = useState(0);
  const [hasTransform, setHasTransform] = useState(false);
  const bindings = useRef<Record<string, Binding>>({});
  const projection = useMemo(() => new FilamentProjection(cameraCalibration), [cameraCalibration]);

  useEffect(() => {
    bindings.current = {};
    packet.value = null;
    if (!asset) return;
    try {
      for (const name of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']) {
        const entity = asset.getFirstEntityByName(name)
          ?? asset.getFirstEntityByName(metadata?.boneMap[name] ?? `mixamorig${name}`);
        if (!entity) throw new Error(`Missing mapped bone: ${name}`);
        const local = transformManager.getTransform(entity);
        bindings.current[name] = { entity, local: rotationFromMatrix(local.data),
          world: rotationFromMatrix(transformManager.getWorldTransform(entity).data), scale: local.scale, position: local.translation };
      }
      setBoundCount(Object.keys(bindings.current).length);
      setRigError(null);
    } catch (error) {
      bindings.current = {};
      setRigError(error instanceof Error ? error.message : 'Cannot bind garment rig');
    }
  }, [asset, metadata, transformManager, packet]);

  useEffect(() => { if (!visible) packet.value = null; }, [visible, packet]);

  useImperativeHandle(ref, () => ({
    updateTransform(_position, rotation, _scale, boneRotations, _segmentation, landmarks) {
      if (!root || rigError || !metadata || !landmarks?.[11] || !landmarks?.[12] || !visible || boundCount !== 4) return;
      const projected = projection.update(landmarks[11], landmarks[12], rotation, stageWidth, stageHeight, metadata.restPoseMetricWidth, fitModifier);
      if (!projected) return;
      const transforms: Transform[] = [{ entity: root, ...axisAngle(projected.rotation),
        scale: [projected.scale, projected.scale, projected.scale], position: anchoredPosition(projected, metadata.anatomicalAnchorOffset) }];
      for (const [name, bind] of Object.entries(bindings.current)) {
        const delta = boneRotations?.[name] ?? { x: 0, y: 0, z: 0, w: 1 };
        transforms.push({ entity: bind.entity, ...axisAngle(correctBindRotation(bind.local, bind.world, delta)), scale: bind.scale, position: bind.position });
      }
      packet.value = { sequence: ++sequence.current, camera: projected, transforms };
      if (!hasTransform) setHasTransform(true);
    },
  }), [root, rigError, metadata, visible, boundCount, projection, stageWidth, stageHeight, fitModifier, packet, hasTransform]);

  const renderCallback = useCallback<RenderCallback>(() => {
    'worklet';
    const current = packet.value;
    if (!current || !animator || current.sequence === lastSequence.value) return;
    const p = current.camera;
    // Version 1.11.0's native method requires a fifth argument omitted from its TypeScript declaration.
    (camera.setProjection as (fov: number, aspect: number, near: number, far: number, direction: string) => void)(p.fov, p.aspect, 0.1, 1000, 'vertical');
    camera.lookAt([0, 0, p.distance], [0, 0, 0], [0, 1, 0]);
    transformManager.openLocalTransformTransaction();
    try {
      for (const transform of current.transforms) {
        const matrix = transformManager.createIdentityMatrix().scaling(transform.scale)
          .rotate(transform.angle, transform.axis).translate(transform.position);
        transformManager.setTransform(transform.entity, matrix);
      }
    } finally {
      transformManager.commitLocalTransformTransaction();
    }
    animator.updateBoneMatrices();
    lastSequence.value = current.sequence;
  }, [packet, animator, lastSequence, camera, transformManager]);

  return <>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: visible && hasTransform && !rigError ? 1 : 0, transform: [{ scaleX: -1 }] }]}>
      <FilamentView style={{ flex: 1, backgroundColor: 'transparent' }} enableTransparentRendering renderCallback={renderCallback}>
        <Light type="directional" intensity={10000} direction={[0, -1, -1]} />
      </FilamentView>
    </View>
    <Text style={{ color: 'white', backgroundColor: '#352b16', padding: 8, position: 'absolute', bottom: 8 }}>
      {rigError ?? (asset ? `Filament prototype: ${boundCount}/4 arm bones. Occlusion not ported; no performance verdict.` : 'Loading Filament garment...')}
    </Text>
  </>;
});
SceneContent.displayName = 'FilamentSceneContent';

export const FilamentExperimentScene = forwardRef<GarmentRendererRef, FilamentExperimentProps>((props, ref) => (
  <FilamentScene><SceneContent {...props} ref={ref} /></FilamentScene>
));
FilamentExperimentScene.displayName = 'FilamentExperimentScene';
