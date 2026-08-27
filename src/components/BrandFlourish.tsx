import React, { useMemo } from 'react';
import Svg, { Path, Ellipse, G, Defs, LinearGradient, Stop } from 'react-native-svg';

/**
 * Decorative marks drawn from the JezSy logo: the laurel sweep of the line
 * mark and the four-point sparkles of the emblem.
 *
 * Used only where there is nothing to compete with -- empty states and section
 * headers. Dense surfaces like the item grid stay undecorated, because
 * ornament layered over content is what makes a decorated interface hard to
 * read rather than luxurious.
 *
 * Purely presentational, so every export is hidden from assistive tech.
 */

const GOLD_MID = '#E8D5B7';

// Quadratic bezier, used to lay leaves along the stem rather than hand-placing
// each one.
function pointAt(t: number, p0: [number, number], p1: [number, number], p2: [number, number]) {
  const u = 1 - t;
  return {
    x: u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    y: u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  };
}

// Tangent angle in degrees, so each leaf sits along the stem's direction.
function angleAt(t: number, p0: [number, number], p1: [number, number], p2: [number, number]) {
  const u = 1 - t;
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

const P0: [number, number] = [60, 33];
const P1: [number, number] = [30, 37];
const P2: [number, number] = [7, 9];

function useLeaves() {
  return useMemo(() => {
    const out: { x: number; y: number; rot: number; rx: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const t = 0.16 + i * 0.13;
      const { x, y } = pointAt(t, P0, P1, P2);
      const rot = angleAt(t, P0, P1, P2);
      // Leaves taper toward the tip, the way a real laurel sprig does.
      const rx = 5.4 - i * 0.42;
      out.push({ x, y, rot: rot - 26, rx });
      out.push({ x, y, rot: rot + 26, rx });
    }
    return out;
  }, []);
}

interface LaurelProps {
  width?: number;
  color?: string;
  opacity?: number;
}

/** The wreath sweep beneath the wordmark, mirrored into a full cradle. */
export function LaurelWreath({ width = 140, color = '#C9A96E', opacity = 1 }: LaurelProps) {
  const leaves = useLeaves();
  const height = width * (44 / 120);
  const stem = `M ${P0[0]} ${P0[1]} Q ${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`;

  const half = (
    <G>
      <Path d={stem} stroke="url(#laurelGold)" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      {leaves.map((l, i) => (
        <Ellipse
          key={i}
          cx={l.x}
          cy={l.y}
          rx={l.rx}
          ry={1.9}
          fill="url(#laurelGold)"
          transform={`rotate(${l.rot}, ${l.x}, ${l.y})`}
        />
      ))}
    </G>
  );

  return (
    <Svg width={width} height={height} viewBox="0 0 120 44" opacity={opacity} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="laurelGold" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity={0.75} />
          <Stop offset="0.5" stopColor={GOLD_MID} stopOpacity={1} />
          <Stop offset="1" stopColor={color} stopOpacity={0.75} />
        </LinearGradient>
      </Defs>
      {half}
      {/* Mirrored rather than redrawn, so both sprigs stay identical. */}
      <G transform="translate(120, 0) scale(-1, 1)">
        {half}
      </G>
    </Svg>
  );
}

interface SparkleProps {
  size?: number;
  color?: string;
  opacity?: number;
}

/** Four-point star from the emblem. Concave edges keep the points sharp. */
export function Sparkle({ size = 14, color = '#C9A96E', opacity = 1 }: SparkleProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M12 0 C12.8 7.4 16.6 11.2 24 12 C16.6 12.8 12.8 16.6 12 24 C11.2 16.6 7.4 12.8 0 12 C7.4 11.2 11.2 7.4 12 0 Z" fill={color} />
    </Svg>
  );
}

/** A hairline rule with a sparkle centred on it, for section breaks. */
export function FlourishDivider({ color = '#C9A96E', width = 120 }: { color?: string; width?: number }) {
  return (
    <Svg width={width} height={12} viewBox="0 0 120 12" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="ruleGold" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity={0} />
          <Stop offset="0.5" stopColor={color} stopOpacity={0.7} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d="M4 6 H116" stroke="url(#ruleGold)" strokeWidth={1} />
      <Path
        d="M60 1.5 C60.35 4.7 62 6.35 65 6 C62 6.35 60.35 8 60 11 C59.65 8 58 6.35 55 6 C58 6.35 59.65 4.7 60 1.5 Z"
        fill={color}
      />
    </Svg>
  );
}
