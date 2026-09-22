import React, { forwardRef } from 'react';
import { Text } from 'react-native';
import type { GarmentRendererProps, GarmentRendererRef } from '@/src/types/arRenderState';

export interface SceneViewExperimentProps extends GarmentRendererProps {
  stageWidth: number;
  stageHeight: number;
}

export const SceneViewExperimentRenderer = forwardRef<
  GarmentRendererRef,
  SceneViewExperimentProps
>(() => (
  <Text style={{ display: 'none' }}>
    SceneView requires a native Android development build. Use Three.js on web.
  </Text>
));

SceneViewExperimentRenderer.displayName = 'SceneViewExperimentRenderer';
