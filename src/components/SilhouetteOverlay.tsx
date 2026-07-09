import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface Props {
  isActive: boolean;
}

export function SilhouetteOverlay({ isActive }: Props) {
  // A simple, smooth path outlining a human figure.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.container}>
        <Svg width="100%" height="80%" viewBox="0 0 100 250" style={{ opacity: isActive ? 0.8 : 0.4 }}>
          <Path
            d="M 50 10 C 58 10, 62 18, 62 26 C 62 34, 58 42, 50 42 C 42 42, 38 34, 38 26 C 38 18, 42 10, 50 10 Z 
               M 35 48 C 25 50, 15 65, 15 80 L 15 130 C 15 135, 20 140, 25 140 C 30 140, 35 135, 35 130 L 35 100 
               L 35 130 C 35 135, 30 140, 25 140 L 15 130 L 15 80 C 15 65, 25 50, 35 48 
               M 65 48 C 75 50, 85 65, 85 80 L 85 130 C 85 135, 80 140, 75 140 C 70 140, 65 135, 65 130 L 65 100
               M 35 48 L 65 48 L 70 120 L 55 120 L 55 230 C 55 240, 45 240, 45 230 L 45 120 L 30 120 Z"
            fill="none"
            stroke={isActive ? "#00FF00" : "#FFFFFF"}
            strokeWidth="2"
            strokeDasharray={isActive ? "" : "5, 5"}
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
