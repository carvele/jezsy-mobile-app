import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { WardrobeTokens, Radius } from '@/constants/theme';
import { normalizeGarment } from '@/src/utils/garmentSemanticClassifier';

type SlotName = 'top' | 'outerwear' | 'bottom' | 'dress' | 'shoes' | 'accessory1' | 'accessory2';

interface SlotAnchor {
  x: number;
  y: number;
  scale: number;
  maxDim: number;
  zIndex: number;
}

const SLOT_ANCHORS: Record<SlotName, SlotAnchor> = {
  top:         { x: 0.50, y: 0.30, scale: 1.00, maxDim: 135, zIndex: 2 },
  outerwear:   { x: 0.30, y: 0.28, scale: 1.05, maxDim: 145, zIndex: 3 },
  bottom:      { x: 0.52, y: 0.62, scale: 1.00, maxDim: 135, zIndex: 1 },
  dress:       { x: 0.50, y: 0.48, scale: 1.15, maxDim: 160, zIndex: 2 },
  shoes:       { x: 0.28, y: 0.82, scale: 0.70, maxDim: 85,  zIndex: 2 },
  accessory1:  { x: 0.76, y: 0.78, scale: 0.65, maxDim: 75,  zIndex: 4 },
  accessory2:  { x: 0.78, y: 0.22, scale: 0.60, maxDim: 70,  zIndex: 4 },
};

function resolveItemSlot(item: FlatLayItem): SlotName | null {
  const norm = normalizeGarment(
    item.category || '',
    item.sub_category || '',
    '',
    '',
    ''
  );

  if (norm.family !== 'Unknown') {
    switch (norm.family) {
      case 'Top': return 'top';
      case 'Bottom': return 'bottom';
      case 'Dress': return 'dress';
      case 'Outerwear': return 'outerwear';
      case 'Footwear': return 'shoes';
      case 'Accessory': return 'accessory1';
    }
  }

  // Fallback string matching on category, garment_type, sub_category
  const text = `${item.category || ''} ${item.garment_type || ''} ${item.sub_category || ''}`.toLowerCase();
  if (/\b(top|shirt|blouse|knit|sweater|tee|t-shirt|polo|tank|camisole|hoodie|sweatshirt)\b/.test(text)) {
    return 'top';
  }
  if (/\b(outerwear|jacket|coat|blazer|cardigan|vest|parka)\b/.test(text)) {
    return 'outerwear';
  }
  if (/\b(bottom|pants|trousers|jeans|shorts|skirt|legging)\b/.test(text)) {
    return 'bottom';
  }
  if (/\b(dress|jumpsuit|romper)\b/.test(text)) {
    return 'dress';
  }
  if (/\b(shoes|footwear|sneaker|boot|loafer|sandal|heel)\b/.test(text)) {
    return 'shoes';
  }
  if (/\b(accessory|bag|hat|scarf|belt|jewelry|watch|sunglasses|tie|socks)\b/.test(text)) {
    return 'accessory1';
  }

  return null;
}

interface FlatLayItem {
  id: string;
  image_url?: string | null;
  category?: string | null;
  garment_type?: string | null;
  sub_category?: string | null;
}

interface DeterministicFlatLayCanvasProps {
  items: FlatLayItem[];
  height?: number;
}

interface SlotAssignment {
  item: FlatLayItem;
  slot: SlotName;
}

function assignSlots(items: FlatLayItem[]): { assigned: SlotAssignment[]; useGrid: boolean } {
  const assignments: SlotAssignment[] = [];
  let accessoryIdx = 0;
  let unresolved = 0;
  let hasDress = false;

  for (const item of items) {
    let slot = resolveItemSlot(item);

    if (!slot) {
      unresolved++;
      continue;
    }

    if (slot === 'dress') hasDress = true;

    // Second accessory gets accessory2 slot
    if (slot === 'accessory1') {
      accessoryIdx++;
      if (accessoryIdx > 1) slot = 'accessory2';
    }

    // Skip duplicate slots (first item in each slot wins)
    if (assignments.some(a => a.slot === slot)) continue;

    assignments.push({ item, slot });
  }

  // If dress present, remove top/bottom to avoid overlap
  if (hasDress) {
    const filtered = assignments.filter(a => a.slot !== 'top' && a.slot !== 'bottom');
    return { assigned: filtered, useGrid: filtered.length === 0 };
  }

  // Grid fallback if majority unrecognized
  if (unresolved > items.length / 2) {
    return { assigned: [], useGrid: true };
  }

  return { assigned: assignments, useGrid: assignments.length === 0 };
}

export function DeterministicFlatLayCanvas({ items, height }: DeterministicFlatLayCanvasProps) {
  const canvasHeight = height ?? WardrobeTokens.flatLayCanvasHeight;

  const result = useMemo(() => assignSlots(items), [items]);

  if (items.length === 0) return null;

  // Single item: center it
  if (items.length === 1) {
    return (
      <View style={[styles.canvas, { height: canvasHeight }]}>
        <View style={styles.singleCenter}>
          <Image
            source={{ uri: items[0].image_url ?? undefined }}
            style={{ width: 160, height: 160 }}
            contentFit="contain"
            transition={200}
          />
        </View>
      </View>
    );
  }

  // Grid fallback
  if (result.useGrid) {
    const cols = items.length <= 4 ? 2 : 3;
    return (
      <View style={[styles.canvas, { height: canvasHeight }]}>
        <View style={styles.gridContainer}>
          {items.map(item => (
            <View key={item.id} style={[styles.gridCell, { width: `${Math.floor(100 / cols)}%` as any }]}>
              <Image
                source={{ uri: item.image_url ?? undefined }}
                style={styles.gridImage}
                contentFit="contain"
                transition={200}
              />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // Slot-based flat-lay composition
  return (
    <View style={[styles.canvas, { height: canvasHeight }]}>
      {result.assigned.map(({ item, slot }) => {
        const anchor = SLOT_ANCHORS[slot];
        const scaleFactor = Math.min(1.0, Math.max(0.65, canvasHeight / 300));
        const dim = Math.round(anchor.maxDim * anchor.scale * scaleFactor);
        const rawTop = anchor.y * canvasHeight - dim / 2;
        const safeTop = Math.max(6, Math.min(canvasHeight - dim - 6, rawTop));
        return (
          <View
            key={item.id}
            style={[
              styles.slotItem,
              {
                left: `${anchor.x * 100}%` as any,
                top: safeTop,
                width: dim,
                height: dim,
                zIndex: anchor.zIndex,
                marginLeft: -dim / 2,
              },
            ]}
          >
            <Image
              source={{ uri: item.image_url ?? undefined }}
              style={styles.slotImage}
              contentFit="contain"
              transition={200}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    position: 'relative',
    overflow: 'hidden',
  },
  singleCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotItem: {
    position: 'absolute',
  },
  slotImage: {
    width: '100%',
    height: '100%',
  },
  gridContainer: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 8,
  },
  gridCell: {
    aspectRatio: 1,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
});
