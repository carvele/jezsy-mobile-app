import React, { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Ellipse, Rect, Path, G } from 'react-native-svg';

interface Props {
  color?: string;
  opacity?: number;
}

/**
 * Couture dress form mannequin matching the studio reference photo.
 * Uses robust gradient IDs and a warm linen base color with subtle contour strokes
 * so it never blends in or disappears against white or dark backgrounds.
 */
export function MannequinSilhouette({ opacity = 1 }: Props) {
  const reactId = useId().replace(/:/g, '_');
  const bodyGradId = `mannequinBody_${reactId}`;
  const neckGradId = `mannequinNeck_${reactId}`;

  return (
    <Svg
      viewBox="0 0 300 480"
      style={StyleSheet.absoluteFill}
      preserveAspectRatio="xMidYMid meet"
    >
      <Defs>
        {/* Linear gradient from left shoulder to right with center highlight */}
        <LinearGradient id={bodyGradId} x1="0%" y1="30%" x2="100%" y2="70%">
          <Stop offset="0%" stopColor="#DFD0B8" stopOpacity={String(opacity)} />
          <Stop offset="35%" stopColor="#F5EFE4" stopOpacity={String(opacity)} />
          <Stop offset="70%" stopColor="#EADBCE" stopOpacity={String(opacity)} />
          <Stop offset="100%" stopColor="#CCA986" stopOpacity={String(opacity)} />
        </LinearGradient>

        <LinearGradient id={neckGradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#D8C7AE" stopOpacity={String(opacity)} />
          <Stop offset="50%" stopColor="#F2EAE0" stopOpacity={String(opacity)} />
          <Stop offset="100%" stopColor="#D0BEA5" stopOpacity={String(opacity)} />
        </LinearGradient>
      </Defs>

      <G>
        {/* ─── Top Wooden Cap (Flat disc with rounded bevel) ─── */}
        <Ellipse cx={150} cy={48} rx={16} ry={4.5} fill="#C4A375" opacity={opacity * 0.95} />
        <Path
          d="M 134 48 C 134 44, 166 44, 166 48 L 164 53 C 164 55, 136 55, 136 53 Z"
          fill="#B59364"
          opacity={opacity * 0.9}
        />

        {/* ─── Cylindrical Neck ─── */}
        <Path
          d={`
            M 136 52
            C 136 60, 135 68, 133 74
            C 131 80, 128 84, 124 88
            L 176 88
            C 172 84, 169 80, 167 74
            C 165 68, 164 60, 164 52
            Z
          `}
          fill={`url(#${neckGradId})`}
          stroke="#C8B59B"
          strokeWidth={0.75}
        />

        {/* ─── Slender V-Shape Couture Dress Form ─── */}
        <Path
          d={`
            M 124 88
            C 118 89, 112 94, 106 102
            C 101 110, 104 120, 109 132
            C 114 144, 120 154, 123 165
            C 125 174, 122 184, 118 194
            C 114 204, 112 214, 113 226
            C 114 236, 116 244, 122 248
            C 130 252, 170 252, 178 248
            C 184 244, 186 236, 187 226
            C 188 214, 186 204, 182 194
            C 178 184, 175 174, 177 165
            C 180 154, 186 144, 191 132
            C 196 120, 199 110, 194 102
            C 188 94, 182 89, 176 88
            Z
          `}
          fill={`url(#${bodyGradId})`}
          stroke="#C8B59B"
          strokeWidth={0.75}
        />

        {/* ─── Soft Subtle Bust Highlights ─── */}
        <Ellipse cx={135} cy={122} rx={11} ry={13} fill="#FFFFFF" opacity={opacity * 0.28} />
        <Ellipse cx={165} cy={122} rx={11} ry={13} fill="#FFFFFF" opacity={opacity * 0.28} />

        {/* ─── Subtle Center Princess Seam ─── */}
        <Path
          d="M 150 88 L 150 250"
          stroke="#B59F87"
          strokeWidth={0.6}
          strokeDasharray="2.5 3.5"
          opacity={opacity * 0.35}
        />

        {/* ─── Flat Bottom Trim ─── */}
        <Rect x={122} y={250} width={56} height={2} rx={1} fill="#B59F87" opacity={opacity * 0.55} />

        {/* ─── Metallic Mount Under Base ─── */}
        <Rect x={147} y={252} width={6} height={8} rx={1} fill="#AFAFAF" opacity={opacity * 0.9} />
        <Path
          d="M 144 260 L 156 260 L 153 274 L 147 274 Z"
          fill="#B59364"
          opacity={opacity * 0.95}
        />

        {/* ─── Long Wooden Stand Pole ─── */}
        <Rect x={147.5} y={274} width={5} height={170} rx={2.5} fill="#B59364" opacity={opacity * 0.85} />

        {/* ─── Base Mount ─── */}
        <Ellipse cx={150} cy={446} rx={28} ry={6} fill="#A68153" opacity={opacity * 0.75} />
      </G>
    </Svg>
  );
}
