import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import type { Landmark } from '../utils/poseDetector';

interface Props {
  landmarks: Landmark[];
}

// Matches isPoseValid/isSidePoseValid's own bar (poseDetector.ts) and
// BurstCollector's MIN_FRAME_POSE_CONFIDENCE (burstAverager.ts) -- this used to
// be 0.5/0.3, far looser than what the rest of the pipeline trusts. Elbows and
// wrists aren't in either validity check's REQUIRED_JOINTS, so a self-occluded
// arm could pass the whole-pose gate while its own elbow/wrist visibility sat
// anywhere in that gap and still got drawn, confidently, in the wrong place.
const MIN_LANDMARK_VISIBILITY = 0.85;

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

  // MediaPipe's raw output is unmirrored (see poseConstructor.ts's own note on
  // this), but this overlay sits on top of the front camera's mirrored preview
  // -- so x has to be flipped here or the skeleton drifts the opposite way from
  // the wearer's real movement instead of tracking them.
  const mirrorX = (x: number) => (1 - x) * 100;

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Svg width="100%" height="100%">
        {/* Draw connections */}
        {CONNECTIONS.map(([startIdx, endIdx], i) => {
          const start = landmarks[startIdx];
          const end = landmarks[endIdx];

          if (!start || !end) return null;
          if (start.visibility < MIN_LANDMARK_VISIBILITY || end.visibility < MIN_LANDMARK_VISIBILITY) return null;

          return (
            <Line
              key={`line-${i}`}
              x1={`${mirrorX(start.x)}%`}
              y1={`${start.y * 100}%`}
              x2={`${mirrorX(end.x)}%`}
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
          if (lm.visibility < MIN_LANDMARK_VISIBILITY) return null;

          return (
            <Circle
              key={`lm-${i}`}
              cx={`${mirrorX(lm.x)}%`}
              cy={`${lm.y * 100}%`}
              r="4"
              fill="#00FF00"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth="1"
            />
          );
        })}
      </Svg>
    </View>
  );
}
