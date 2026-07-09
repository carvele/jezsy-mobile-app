import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import type { Landmark } from '../utils/poseDetector';

interface Props {
  landmarks: Landmark[];
}

// Connections between BlazePose landmarks
const CONNECTIONS = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
];

export function PoseLandmarkOverlay({ landmarks }: Props) {
  if (!landmarks || landmarks.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        {/* Draw connections */}
        {CONNECTIONS.map(([startIdx, endIdx], i) => {
          const start = landmarks[startIdx];
          const end = landmarks[endIdx];
          
          if (!start || !end) return null;
          if (start.visibility < 0.5 || end.visibility < 0.5) return null;

          return (
            <Line
              key={`line-${i}`}
              x1={`${start.x * 100}%`}
              y1={`${start.y * 100}%`}
              x2={`${end.x * 100}%`}
              y2={`${end.y * 100}%`}
              stroke="rgba(255, 255, 255, 0.6)"
              strokeWidth="2"
            />
          );
        })}

        {/* Draw landmarks */}
        {landmarks.map((lm, i) => {
          // Only draw key body landmarks (ignore face except nose)
          if (i > 0 && i < 11) return null;
          if (lm.visibility < 0.3) return null;

          const color = lm.visibility > 0.85 ? '#00FF00' : lm.visibility > 0.6 ? '#FFFF00' : '#FF0000';

          return (
            <Circle
              key={`lm-${i}`}
              cx={`${lm.x * 100}%`}
              cy={`${lm.y * 100}%`}
              r="4"
              fill={color}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth="1"
            />
          );
        })}
      </Svg>
    </View>
  );
}
