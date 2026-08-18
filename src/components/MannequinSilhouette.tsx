import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Ellipse, Rect, Path } from 'react-native-svg';

interface Props {
  color: string;
  opacity?: number;
}

// A stylised female dress-form silhouette (head/neck/torso/hip/legs/feet) so
// the Outfit Builder's canvas view shows garments styled onto a body shape
// instead of floating on a blank background.
export function MannequinSilhouette({ color, opacity = 0.5 }: Props) {
  return (
    <Svg
      viewBox="0 0 300 400"
      style={StyleSheet.absoluteFill}
      preserveAspectRatio="xMidYMax meet"
    >
      {/* Head */}
      <Ellipse cx={150} cy={45} rx={28} ry={32} fill={color} opacity={opacity} />
      {/* Neck */}
      <Rect x={135} y={74} width={30} height={18} rx={6} fill={color} opacity={opacity} />
      {/* Torso + hips */}
      <Path
        d="M110,96 Q150,86 190,96 C205,120 198,150 182,190 C198,215 205,235 188,262 C188,262 112,262 112,262 C95,235 102,215 118,190 C102,150 95,120 110,96 Z"
        fill={color}
        opacity={opacity}
      />
      {/* Arms */}
      <Rect x={95} y={100} width={18} height={110} rx={9} fill={color} opacity={opacity} transform="rotate(-6 104 100)" />
      <Rect x={187} y={100} width={18} height={110} rx={9} fill={color} opacity={opacity} transform="rotate(6 196 100)" />
      {/* Legs */}
      <Path d="M112,262 L145,262 L138,390 L108,390 Z" fill={color} opacity={opacity} />
      <Path d="M155,262 L188,262 L192,390 L162,390 Z" fill={color} opacity={opacity} />
      {/* Feet */}
      <Ellipse cx={123} cy={393} rx={18} ry={6} fill={color} opacity={opacity} />
      <Ellipse cx={177} cy={393} rx={18} ry={6} fill={color} opacity={opacity} />
    </Svg>
  );
}
