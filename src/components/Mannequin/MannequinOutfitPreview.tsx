import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MannequinSilhouette } from '@/src/components/MannequinSilhouette';
import { CATEGORY_PLACEMENT_DEFAULTS, DEFAULT_FALLBACK_PLACEMENT } from '@/src/utils/mannequinConfig';

import type { BodySilhouetteParams } from '@/src/utils/bodySilhouette';

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
  // Normalized drag offset saved from the Outfit Builder canvas (0-1 fraction
  // of canvas dimensions). Applied as an extra translate on top of default placement.
  drag_x?: number;
  drag_y?: number;
}

interface Props {
  items: OutfitItem[];
  canvasWidth: number;
  canvasHeight: number;
  isDark?: boolean;
  backgroundColor?: string;
  mode?: 'default' | 'proportions';
  bodyParams?: BodySilhouetteParams | null;
}

export function MannequinOutfitPreview({
  items,
  canvasWidth,
  canvasHeight,
  isDark = false,
  backgroundColor,
  mode = 'default',
  bodyParams,
}: Props) {
  // Sort items by z_index
  const sortedItems = [...items].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));

  return (
    <View style={[styles.canvasStage, { width: canvasWidth, height: canvasHeight, backgroundColor: backgroundColor || (isDark ? '#1c1c1e' : '#F9F8F5') }]}>
      {/* Dress Form Mannequin Background */}
      <MannequinSilhouette
        color={isDark ? '#C9B99A' : '#D4C5B0'}
        opacity={isDark ? 0.85 : 1}
        mode={mode}
        bodyParams={bodyParams}
      />

      {/* Layered Styled Garments in exact saved coordinates */}
      {sortedItems.map((item, index) => {
        if (!item.image_url) return null;

        const rawType = item.garment_type || item.slot || 'Top';
        const normalizedType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
        const placement = CATEGORY_PLACEMENT_DEFAULTS[normalizedType] || CATEGORY_PLACEMENT_DEFAULTS[rawType] || DEFAULT_FALLBACK_PLACEMENT;
        const baseItemWidth = canvasWidth * (placement.widthPercent || 0.34);
        const baseItemHeight = baseItemWidth * 1.25;

        // Position coordinates
        const posX = typeof item.x === 'number' ? item.x * canvasWidth : 0;
        const posY = typeof item.y === 'number' ? item.y * canvasHeight : (placement.yPercent || 0.2) * canvasHeight;
        const itemScale = typeof item.scale === 'number' ? item.scale : 1.0;
        const itemRotation = typeof item.rotation === 'number' ? item.rotation : 0;
        // Drag offsets saved from the Outfit Builder canvas; zero for items that
        // were never repositioned or were saved from advisor/suggestions.
        const dragOffsetX = (item.drag_x ?? 0) * canvasWidth;
        const dragOffsetY = (item.drag_y ?? 0) * canvasHeight;

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
                  { translateX: dragOffsetX },
                  { translateY: dragOffsetY },
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
