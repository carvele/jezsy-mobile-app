import React, { forwardRef } from 'react';
import { Text } from 'react-native';
import type { GarmentRendererRef } from './GarmentRenderer';
import type { FilamentExperimentProps } from './FilamentExperimentRenderer';

export const FilamentExperimentRenderer = forwardRef<GarmentRendererRef, FilamentExperimentProps>(() => (
  <Text>Filament requires a native development build. Use Three.js on web.</Text>
));
FilamentExperimentRenderer.displayName = 'FilamentExperimentRenderer';
