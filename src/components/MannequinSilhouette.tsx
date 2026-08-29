import React, { useId, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Ellipse, Rect, Path, G } from 'react-native-svg';
import type { BodySilhouetteParams } from '@/src/utils/bodySilhouette';

interface Props {
  color?: string;
  opacity?: number;
  mode?: 'default' | 'proportions';
  bodyParams?: BodySilhouetteParams | null;
}

/**
 * Couture dress form mannequin matching the studio reference photo.
 * In 'default' mode, renders the classic baseline couture dress-form.
 * In 'proportions' mode, dynamically adjusts shoulder, bust, waist, hip curves,
 * and torso proportions to represent the user's real body measurements.
 */
export function MannequinSilhouette({ opacity = 1, mode = 'default', bodyParams }: Props) {
  const reactId = useId().replace(/:/g, '_');
  const bodyGradId = `mannequinBody_${reactId}`;
  const neckGradId = `mannequinNeck_${reactId}`;

  const isProportions = mode === 'proportions' && !!bodyParams && bodyParams.isCustomProportioned !== false;

  const geometry = useMemo(() => {
    if (!isProportions || !bodyParams) {
      // Baseline default couture dress form
      return {
        neckLeftX: 124,
        neckRightX: 176,
        neckBottomY: 88,
        torsoPath: `
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
        `,
        bustLeftX: 135,
        bustRightX: 165,
        bustY: 122,
        bustRx: 11,
        bustRy: 13,
        trimX: 122,
        trimY: 250,
        trimWidth: 56,
        seamEndY: 250,
        mountTopY: 252,
      };
    }

    const {
      shoulderWidthRatio = 1.0,
      bustWidthRatio = 1.0,
      waistWidthRatio = 1.0,
      hipWidthRatio = 1.0,
      torsoHeightRatio = 1.0,
      bustApexY = 122,
      waistY = 174,
      hipY = 226,
    } = bodyParams;

    // Baseline offsets from center (150)
    const shoulderDx = 44 * shoulderWidthRatio;
    const bustDx = 41 * bustWidthRatio;
    const waistDx = 28 * waistWidthRatio;
    const hipDx = 37 * hipWidthRatio;

    const shoulderX_L = 150 - shoulderDx;
    const shoulderX_R = 150 + shoulderDx;

    const bustX_L = 150 - bustDx;
    const bustX_R = 150 + bustDx;

    const waistX_L = 150 - waistDx;
    const waistX_R = 150 + waistDx;

    const hipX_L = 150 - hipDx;
    const hipX_R = 150 + hipDx;

    const bottomY = 88 + 162 * torsoHeightRatio;
    const bottomTrimWidth = Math.round(56 * hipWidthRatio);
    const bottomTrimX = Math.round(150 - bottomTrimWidth / 2);

    // Parametric smooth cubic Bézier curves for the couture torso
    const torsoPath = `
      M 124 88
      C ${Math.round(150 - shoulderDx * 0.72)} 89, ${Math.round(150 - shoulderDx * 0.86)} 94, ${Math.round(shoulderX_L)} 102
      C ${Math.round(shoulderX_L - 5)} 110, ${Math.round(bustX_L - 5)} ${Math.round(bustApexY - 10)}, ${Math.round(bustX_L)} ${Math.round(bustApexY)}
      C ${Math.round(bustX_L + 5)} ${Math.round(bustApexY + 12)}, ${Math.round(waistX_L - 3)} ${Math.round(waistY - 10)}, ${Math.round(waistX_L)} ${Math.round(waistY)}
      C ${Math.round(waistX_L + 2)} ${Math.round(waistY + 10)}, ${Math.round(hipX_L - 1)} ${Math.round(hipY - 12)}, ${Math.round(hipX_L)} ${Math.round(hipY)}
      C ${Math.round(hipX_L + 1)} ${Math.round(hipY + 10)}, ${Math.round(bottomTrimX - 6)} ${Math.round(bottomY - 4)}, ${Math.round(bottomTrimX)} ${Math.round(bottomY)}
      C ${Math.round(bottomTrimX + 8)} ${Math.round(bottomY + 4)}, ${Math.round(150 + bottomTrimWidth / 2 - 8)} ${Math.round(bottomY + 4)}, ${Math.round(bottomTrimX + bottomTrimWidth)} ${Math.round(bottomY)}
      C ${Math.round(bottomTrimX + bottomTrimWidth + 6)} ${Math.round(bottomY - 4)}, ${Math.round(hipX_R - 1)} ${Math.round(hipY + 10)}, ${Math.round(hipX_R)} ${Math.round(hipY)}
      C ${Math.round(hipX_R + 1)} ${Math.round(hipY - 12)}, ${Math.round(waistX_R - 2)} ${Math.round(waistY + 10)}, ${Math.round(waistX_R)} ${Math.round(waistY)}
      C ${Math.round(waistX_R + 3)} ${Math.round(waistY - 10)}, ${Math.round(bustX_R - 5)} ${Math.round(bustApexY + 12)}, ${Math.round(bustX_R)} ${Math.round(bustApexY)}
      C ${Math.round(bustX_R + 5)} ${Math.round(bustApexY - 10)}, ${Math.round(shoulderX_R + 5)} 110, ${Math.round(shoulderX_R)} 102
      C ${Math.round(150 + shoulderDx * 0.86)} 94, ${Math.round(150 + shoulderDx * 0.72)} 89, 176 88
      Z
    `;

    return {
      neckLeftX: 124,
      neckRightX: 176,
      neckBottomY: 88,
      torsoPath,
      bustLeftX: Math.round(150 - 15 * bustWidthRatio),
      bustRightX: Math.round(150 + 15 * bustWidthRatio),
      bustY: Math.round(bustApexY),
      bustRx: Math.round(11 * bustWidthRatio),
      bustRy: 13,
      trimX: bottomTrimX,
      trimY: Math.round(bottomY),
      trimWidth: bottomTrimWidth,
      seamEndY: Math.round(bottomY),
      mountTopY: Math.round(bottomY + 2),
    };
  }, [isProportions, bodyParams]);

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

        {/* ─── Couture Dress Form Silhouette (Baseline or Custom Proportioned) ─── */}
        <Path
          d={geometry.torsoPath}
          fill={`url(#${bodyGradId})`}
          stroke="#C8B59B"
          strokeWidth={0.75}
        />

        {/* ─── Soft Subtle Bust Highlights ─── */}
        <Ellipse
          cx={geometry.bustLeftX}
          cy={geometry.bustY}
          rx={geometry.bustRx}
          ry={geometry.bustRy}
          fill="#FFFFFF"
          opacity={opacity * 0.28}
        />
        <Ellipse
          cx={geometry.bustRightX}
          cy={geometry.bustY}
          rx={geometry.bustRx}
          ry={geometry.bustRy}
          fill="#FFFFFF"
          opacity={opacity * 0.28}
        />

        {/* ─── Subtle Center Princess Seam ─── */}
        <Path
          d={`M 150 88 L 150 ${geometry.seamEndY}`}
          stroke="#B59F87"
          strokeWidth={0.6}
          strokeDasharray="2.5 3.5"
          opacity={opacity * 0.35}
        />

        {/* ─── Flat Bottom Trim ─── */}
        <Rect
          x={geometry.trimX}
          y={geometry.trimY}
          width={geometry.trimWidth}
          height={2}
          rx={1}
          fill="#B59F87"
          opacity={opacity * 0.55}
        />

        {/* ─── Metallic Mount Under Base ─── */}
        <Rect
          x={147}
          y={geometry.mountTopY}
          width={6}
          height={8}
          rx={1}
          fill="#AFAFAF"
          opacity={opacity * 0.9}
        />
        <Path
          d={`M 144 ${geometry.mountTopY + 8} L 156 ${geometry.mountTopY + 8} L 153 ${geometry.mountTopY + 22} L 147 ${geometry.mountTopY + 22} Z`}
          fill="#B59364"
          opacity={opacity * 0.95}
        />

        {/* ─── Long Wooden Stand Pole ─── */}
        <Rect
          x={147.5}
          y={geometry.mountTopY + 22}
          width={5}
          height={Math.max(120, 444 - (geometry.mountTopY + 22))}
          rx={2.5}
          fill="#B59364"
          opacity={opacity * 0.85}
        />

        {/* ─── Base Mount ─── */}
        <Ellipse cx={150} cy={446} rx={28} ry={6} fill="#A68153" opacity={opacity * 0.75} />
      </G>
    </Svg>
  );
}
