import React, { forwardRef } from 'react';
import { Text, View } from 'react-native';
import type { GarmentRendererProps, GarmentRendererRef } from './GarmentRenderer';

export interface FilamentExperimentProps extends GarmentRendererProps {
  stageWidth: number;
  stageHeight: number;
}

class ExperimentBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Unavailable /> : this.props.children;
  }
}

function Unavailable() {
  return <View style={{ padding: 20 }}><Text style={{ color: 'white' }}>
    Filament experiment unavailable. Rebuild the native development client or switch back to Three.js.
  </Text></View>;
}

export const FilamentExperimentRenderer = forwardRef<GarmentRendererRef, FilamentExperimentProps>((props, ref) => {
  let Component: typeof import('./FilamentScene.native').FilamentExperimentScene;
  try {
    // Native installation can be absent in an older development client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Component = require('./FilamentScene.native').FilamentExperimentScene;
  } catch {
    return <Unavailable />;
  }
  return <ExperimentBoundary><Component {...props} ref={ref} /></ExperimentBoundary>;
});
FilamentExperimentRenderer.displayName = 'FilamentExperimentRenderer';
