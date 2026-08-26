import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MannequinSilhouette } from '@/src/components/MannequinSilhouette';
import { CATEGORY_PLACEMENT_DEFAULTS, DEFAULT_FALLBACK_PLACEMENT } from '@/src/utils/mannequinConfig';

interface OutfitItem {
  image_url?: string;
  garment_type?: string;
  slot?: string;
  name?: string;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  z_index?: number;
}

interface Props {
  items: OutfitItem[];
  canvasWidth: number;
  canvasHeight: number;
  isDark?: boolean;
  backgroundColor?: string;
}

export function MannequinOutfitPreview({
  items,
  canvasWidth,
  canvasHeight,
  isDark = false,
  backgroundColor,
}: Props) {
  // Sort items by z_index
  const sortedItems = [...items].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));

  return (
    <View style={[styles.canvasStage, { width: canvasWidth, height: canvasHeight, backgroundColor: backgroundColor || (isDark ? '#1c1c1e' : '#F9F8F5') }]}>
      {/* Dress Form Mannequin Background */}
      <MannequinSilhouette
        color={isDark ? '#C9B99A' : '#D4C5B0'}
        opacity={isDark ? 0.85 : 1}
      />

      {/* Layered Styled Garments in exact saved coordinates */}
      {sortedItems.map((item, index) => {
        if (!item.image_url) return null;

        const gType = item.garment_type || item.slot || 'Top';
        const placement = CATEGORY_PLACEMENT_DEFAULTS[gType] || DEFAULT_FALLBACK_PLACEMENT;
        const baseItemWidth = canvasWidth * (placement.widthPercent || 0.34);
        const baseItemHeight = baseItemWidth * 1.25;

        // Position coordinates
        const posX = typeof item.x === 'number' ? item.x * canvasWidth : 0;
        const posY = typeof item.y === 'number' ? item.y * canvasHeight : (placement.yPercent || 0.2) * canvasHeight;
        const itemScale = typeof item.scale === 'number' ? item.scale : 1.0;
        const itemRotation = typeof item.rotation === 'number' ? item.rotation : 0;

        return (
          <View
            key={index}
            style={[
              styles.itemContainer,
              {
                width: baseItemWidth,
                height: baseItemHeight,
                left: (canvasWidth - baseItemWidth) / 2,
                top: 0,
                zIndex: item.z_index ?? index + 1,
                transform: [
                  { translateX: posX },
                  { translateY: posY },
                  { scale: itemScale },
                  { rotate: `${itemRotation}deg` },
                ],
              },
            ]}
          >
            <Image
              source={{ uri: item.image_url }}
              style={styles.image}
              contentFit="contain"
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvasStage: {
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
