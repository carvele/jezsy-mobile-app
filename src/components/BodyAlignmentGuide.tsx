import React, { useEffect, useRef } from 'react';
import { StyleSheet, Animated } from 'react-native';
import Svg, { Path, Ellipse } from 'react-native-svg';
import { AlignmentState } from '../hooks/useBodyAlignment';
import { ALIGNMENT_CONFIG, type RequestedPose } from '../utils/bodyAlignmentEvaluator';

export type AlignmentGuidePose = RequestedPose;

interface BodyAlignmentGuideProps {
  state: AlignmentState;
  footStatus: { left: boolean; right: boolean };
  requestedPose?: AlignmentGuidePose;
  /** Visibility is scan-experience state (brief positioning aid, restored on bad
   * misalignment), not geometry -- body-scan.tsx owns the timing, this just fades. */
  visible: boolean;
}

export const BodyAlignmentGuide: React.FC<BodyAlignmentGuideProps> = ({
  state,
  footStatus,
  requestedPose = 'front',
  visible,
}) => {
  let strokeColor = 'rgba(255, 255, 255, 0.35)'; // SEARCHING
  if (state === 'POSITIONING') {
    strokeColor = '#E5A93C'; // Gold
  } else if (state === 'STABILIZING' || state === 'LOCKED') {
    strokeColor = '#34C759'; // Success green
  }

  const visibilityOpacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(visibilityOpacity, {
      toValue: visible ? 1 : 0,
      duration: ALIGNMENT_CONFIG.guideFadeMs,
      useNativeDriver: true,
    }).start();
  }, [visible, visibilityOpacity]);

  // Cross-fade animation between front (0) and side (1)
  const animValue = useRef(new Animated.Value(requestedPose === 'front' ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: requestedPose === 'front' ? 0 : 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [requestedPose, animValue]);

  const frontOpacity = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const sideOpacity = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  // Front silhouette paths
  const frontSilhouettePath = `
    M 50 14 
    C 45 14, 45 23, 50 23 
    C 55 23, 55 14, 50 14 
    M 42 25 
    C 35 25, 30 30, 30 45 
    L 30 55
    M 58 25 
    C 65 25, 70 30, 70 45 
    L 70 55
    M 40 40
    L 40 70
    L 45 90
    M 60 40
    L 60 70
    L 55 90
    M 40 70
    L 60 70
  `;

  // Left & right front footprints
  const leftFootprint = "M 42 85 C 40 85, 38 87, 39 90 C 40 93, 43 95, 45 93 C 47 91, 46 87, 44 86 C 43 85.5, 42.5 85, 42 85 Z";
  const rightFootprint = "M 58 85 C 60 85, 62 87, 61 90 C 60 93, 57 95, 55 93 C 53 91, 54 87, 56 86 C 57 85.5, 57.5 85, 58 85 Z";

  // Side profile silhouette paths (profile head with nose cue, natural spine curvature, aligned arm and overlapping legs)
  const sideSilhouettePath = `
    M 49 14
    C 46 14, 45 19, 45 22
    C 45 23, 47 24, 48 24
    L 52 24
    C 54 24, 55 23, 55 20
    C 55 15, 52 14, 49 14
    M 47 25
    C 43 28, 42 35, 43 45
    C 43 55, 44 65, 45 70
    L 47 90
    M 53 25
    C 56 28, 57 35, 56 45
    C 56 55, 55 65, 54 70
    L 52 90
    M 48 30
    L 48 55
    C 48 57, 50 57, 50 55
    L 50 30
  `;

  // Central side profile footprint (facing right)
  const sideProfileFootprint = "M 47 89 C 45 89, 44 91, 45 93 C 46 94.5, 54 94.5, 56 93 C 57 91.5, 56 89, 54 89 C 52 89, 49 89, 47 89 Z";

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: visibilityOpacity }]} pointerEvents="none">
      {/* Front Silhouette Layer */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: frontOpacity }]}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
          <Path
            d={frontSilhouettePath}
            stroke={strokeColor}
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Dual Floor Ellipse */}
          <Ellipse
            cx="50"
            cy="90"
            rx="25"
            ry="8"
            stroke={strokeColor}
            strokeWidth="1.5"
            fill="rgba(255, 255, 255, 0.05)"
          />

          {/* Left Footprint Target */}
          <Path
            d={leftFootprint}
            fill={footStatus.left ? strokeColor : 'rgba(255, 255, 255, 0.15)'}
          />

          {/* Right Footprint Target */}
          <Path
            d={rightFootprint}
            fill={footStatus.right ? strokeColor : 'rgba(255, 255, 255, 0.15)'}
          />
        </Svg>
      </Animated.View>

      {/* Side Profile Layer */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: sideOpacity }]}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
          <Path
            d={sideSilhouettePath}
            stroke={strokeColor}
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Forgiving Central Floor Ellipse */}
          <Ellipse
            cx="50"
            cy="90"
            rx="16"
            ry="8"
            stroke={strokeColor}
            strokeWidth="1.5"
            fill="rgba(255, 255, 255, 0.05)"
          />

          {/* Central Profile Footprint Target */}
          <Path
            d={sideProfileFootprint}
            fill={(footStatus.left || footStatus.right) ? strokeColor : 'rgba(255, 255, 255, 0.15)'}
          />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
};
