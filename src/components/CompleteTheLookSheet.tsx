import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getCompleteTheLook, CompleteTheLookItem as CompleteTheLookItemType } from '@/src/services/completeTheLookService';
import { CompleteTheLookItem } from './CompleteTheLookItem';
import { BrandEmptyState } from './BrandEmptyState';

interface Props {
  productId: string | null;
  visible: boolean;
  onClose: () => void;
}

// Stable identity across renders, same reasoning as explore.tsx's own
// renderSheetBackdrop: a new function every render reads to BottomSheetModal
// as a changed prop.
const renderBackdrop = (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
  <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} pressBehavior="close" />
);

/**
 * Full-height shoppable sheet for Complete the Look: fetches the hierarchy
 * (Curated -> Styled Look Siblings -> Algorithmic) for the current product
 * and renders each result as an actionable CompleteTheLookItem.
 */
export function CompleteTheLookSheet({ productId, visible, onClose }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['75%'], []);

  const [items, setItems] = useState<CompleteTheLookItemType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  useEffect(() => {
    if (!visible || !productId) return;
    let active = true;
    setLoading(true);
    getCompleteTheLook(productId, 6)
      .then((res) => { if (active) setItems(res); })
      .catch((err) => {
        console.error('Error loading Complete the Look sheet:', err);
        if (active) setItems([]);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible, productId]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.background }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      onDismiss={onClose}
    >
      <BottomSheetView style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Complete the Look</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Pieces that pair well with this item</Text>
      </BottomSheetView>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.tint} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <BrandEmptyState
            icon="bag.fill"
            title="No matches yet"
            message="We couldn't find any complementary pieces currently in stock."
          />
        </View>
      ) : (
        <BottomSheetScrollView contentContainerStyle={styles.list}>
          {items.map((item) => (
            <CompleteTheLookItem key={item.product.id} item={item} />
          ))}
        </BottomSheetScrollView>
      )}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    ...Type.title,
  },
  subtitle: {
    ...Type.caption,
    marginTop: 2,
  },
  loadingContainer: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: Spacing.xl,
  },
  list: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
});
