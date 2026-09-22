import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { GarmentRendererProps, GarmentRendererRef } from '@/src/types/arRenderState';

export interface SceneViewExperimentProps extends GarmentRendererProps {
  stageWidth: number;
  stageHeight: number;
}

class SceneViewErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean; errorMessage: string | null }
> {
  state = { failed: false, errorMessage: null };

  static getDerivedStateFromError(error: Error) {
    return { failed: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) {
      console.warn('[SceneViewErrorBoundary] Caught SceneView error:', error);
    }
  }

  render() {
    if (this.state.failed) {
      return <SceneViewUnavailable message={this.state.errorMessage} />;
    }
    return this.props.children;
  }
}

function SceneViewUnavailable({ message }: { message?: string | null }) {
  return (
    <View style={styles.unavailableContainer}>
      <Text style={styles.unavailableTitle}>SceneView Renderer Unavailable</Text>
      <Text style={styles.unavailableSubtitle}>
        {message || 'Rebuild the native development client or switch back to Three.js.'}
      </Text>
    </View>
  );
}

export const SceneViewExperimentRenderer = forwardRef<
  GarmentRendererRef,
  SceneViewExperimentProps
>((props, ref) => {
  let SceneComponent: typeof import('./SceneViewScene.native').SceneViewScene;
  try {
    // Dynamically require native scene so older development clients degrade gracefully
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SceneComponent = require('./SceneViewScene.native').SceneViewScene;
  } catch (e) {
    if (__DEV__) {
      console.warn('[SceneViewExperimentRenderer] Native module load failed:', e);
    }
    return <SceneViewUnavailable />;
  }

  return (
    <SceneViewErrorBoundary>
      <SceneComponent {...props} ref={ref} />
    </SceneViewErrorBoundary>
  );
});

SceneViewExperimentRenderer.displayName = 'SceneViewExperimentRenderer';

const styles = StyleSheet.create({
  unavailableContainer: {
    padding: 16,
    backgroundColor: 'rgba(26, 38, 57, 0.9)',
    borderRadius: 8,
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 30,
  },
  unavailableTitle: {
    color: '#FF6B6B',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  unavailableSubtitle: {
    color: '#E0E0E0',
    fontSize: 12,
    textAlign: 'center',
  },
});
