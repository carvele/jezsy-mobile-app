import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Database } from '@/src/types/database.types';
import { useToast } from '@/src/context/ToastContext';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { MannequinOutfitPreview } from '@/src/components/Mannequin/MannequinOutfitPreview';
import { ConfirmModal } from '@/src/components/ConfirmModal';

type SavedOutfit = Database['public']['Tables']['saved_outfits']['Row'];
type OutfitSlotItem = {
  slot: string;
  product_id?: string | null;
  wardrobe_item_id?: string | null;
  image_url: string;
  name: string;
  color_tags?: string[];
  owned?: boolean;
};

const SLOT_LABELS: Record<string, string> = {
  top: 'Top',
  bottom: 'Bottom',
  dress: 'Dress',
  outerwear: 'Outerwear',
  shoes: 'Shoes',
  accessory: 'Accessory',
};

export default function OutfitDetailScreen() {
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isDark = theme === 'dark';
  const { width: windowWidth } = useWindowDimensions();
  const { session } = useAuth();
  const flatListRef = useRef<FlatList<SavedOutfit>>(null);

  // Viewing one saved outfit swipes to the next/previous rather than
  // requiring a trip back to the list -- so this fetches the user's whole
  // saved-outfits list (same order as the wardrobe tab) rather than a
  // single row, and pages through it horizontally.
  const [outfits, setOutfits] = useState<SavedOutfit[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [loggingWear, setLoggingWear] = useState(false);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);

  const fetchOutfits = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('saved_outfits')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('deleted', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const list = data || [];
      setOutfits(list);
      const idx = list.findIndex((o) => o.id === id);
      setCurrentIndex(idx >= 0 ? idx : 0);
    } catch (err) {
      console.error('Error fetching outfits:', err);
      setOutfits([]);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id, id]);

  useEffect(() => {
    fetchOutfits();
  }, [fetchOutfits]);

  const outfit = outfits[currentIndex] as SavedOutfit | undefined;

  const executeDelete = async () => {
    if (!outfit) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('saved_outfits')
        .update({ deleted: true })
        .eq('id', outfit.id);
      if (error) throw error;
      showToast('Outfit deleted.', 'success');
      const remaining = outfits.filter((o) => o.id !== outfit.id);
      if (remaining.length === 0) {
        router.back();
        return;
      }
      const nextIndex = Math.min(currentIndex, remaining.length - 1);
      setOutfits(remaining);
      setCurrentIndex(nextIndex);
      // Removing a page shifts every later page left by one page-width, but
      // the FlatList's own scroll offset doesn't move on its own -- without
      // this it'd land showing whatever now sits at that stale offset.
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToIndex({ index: nextIndex, animated: false });
      });
    } catch (err) {
      console.error('Error deleting outfit:', err);
      showToast('Could not delete this outfit. Please try again.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Takes the target outfit explicitly rather than closing over the outer
  // `outfit` (= outfits[currentIndex]) state: renderOutfitPage is memoized
  // and doesn't depend on currentIndex, so a closure over `outfit` there
  // would still reference whichever outfit was current when that render
  // was memoized -- stale the instant the user swipes to a different page.
  const handleLogWear = async (targetOutfit: SavedOutfit) => {
    setLoggingWear(true);
    try {
      const items: OutfitSlotItem[] = Array.isArray(targetOutfit.items)
        ? (targetOutfit.items as unknown as OutfitSlotItem[])
        : [];

      const wardrobeItemIds = items
        .map((i) => i.wardrobe_item_id)
        .filter((wId): wId is string => Boolean(wId));

      if (wardrobeItemIds.length > 0) {
        // Collect errors rather than swallowing them so a failed RPC
        // (expired session, RLS denial) surfaces a real error toast.
        const results = await Promise.allSettled(
          wardrobeItemIds.map((itemId) =>
            supabase.rpc('increment_wear_count', { p_item_id: itemId })
          )
        );
        const failures = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error));
        if (failures.length > 0) {
          console.error('increment_wear_count partial failure:', failures);
          throw new Error('One or more wear counts could not be updated.');
        }
      }

      showToast('Outfit wear logged for today.', 'success');
    } catch (err) {
      console.error('Error logging outfit wear:', err);
      showToast('Could not log wear right now.', 'error');
    } finally {
      setLoggingWear(false);
    }
  };

  const horizontalPadding = Spacing.xl * 2;
  const contentWidth = Math.min(windowWidth - horizontalPadding, 600);
  // Pieces scroll horizontally rather than wrapping into rows, so a fixed
  // card width (not a column-count calc) -- matches the saved-outfits
  // carousel pattern on the wardrobe tab.
  const cardWidth = 150;

  const renderOutfitPage = useCallback(({ item }: { item: SavedOutfit }) => {
    const items: OutfitSlotItem[] = Array.isArray(item.items) ? (item.items as unknown as OutfitSlotItem[]) : [];
    const savedBackdrop = (item.items as any[])?.find((i) => i.canvas_bg)?.canvas_bg;
    const cardBg = savedBackdrop || (isDark ? '#1c1c1e' : '#F9F8F5');

    return (
      <ScrollView
        style={{ width: windowWidth }}
        contentContainerStyle={[styles.content, { alignItems: 'center' }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: contentWidth }}>
          {/* Mannequin Styled Display Card */}
          <View style={[styles.mannequinCard, { backgroundColor: cardBg, borderColor: colors.border }]}>
            <View style={styles.mannequinBadgeRow}>
              <View style={[styles.mannequinBadge, { backgroundColor: colors.tint + '18' }]}>
                <IconSymbol name="sparkles" size={13} color={colors.tint} />
                <Text style={[styles.mannequinBadgeText, { color: colors.tint }]}>My Mannequin Styled Look</Text>
              </View>
            </View>

            <View style={styles.mannequinPreviewWrapper}>
              <MannequinOutfitPreview
                items={items}
                canvasWidth={contentWidth - 32}
                canvasHeight={380}
                isDark={isDark}
                backgroundColor={savedBackdrop}
              />
            </View>
          </View>

          {/* Section Heading */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Outfit Pieces</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
              Garments styled in this mannequin look
            </Text>
          </View>

          {/* Horizontally-scrolling pieces strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.grid}
            style={{ marginHorizontal: -Spacing.xl }}
          >
            <View style={{ width: Spacing.xl }} />
            {items.map((slotItem, index) => {
              const isProduct = Boolean(slotItem.product_id);
              const isOwned = slotItem.owned !== false;

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.itemCard,
                    {
                      width: cardWidth,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                  activeOpacity={isProduct ? 0.75 : 1}
                  onPress={() => {
                    if (slotItem.product_id) {
                      router.push(`/product/${slotItem.product_id}` as any);
                    }
                  }}
                  disabled={!isProduct}
                >
                  {/* Image Container with Contain Fit */}
                  <View style={[styles.imageContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F5F5F7' }]}>
                    <Image
                      source={{ uri: slotItem.image_url }}
                      style={styles.itemImage}
                      contentFit="contain"
                    />
                    <View style={[styles.slotBadge, { backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)' }]}>
                      <Text style={[styles.slotLabel, { color: colors.tint }]}>
                        {SLOT_LABELS[slotItem.slot] || slotItem.slot}
                      </Text>
                    </View>
                  </View>

                  {/* Item Info */}
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={2}>
                      {slotItem.name || 'Garment Piece'}
                    </Text>

                    <View style={styles.statusRow}>
                      <Text style={[styles.statusText, { color: isOwned ? colors.tint : colors.blush }]}>
                        {isOwned ? 'In Wardrobe' : 'Wishlist'}
                      </Text>
                      {isProduct && (
                        <IconSymbol name="chevron.right" size={12} color={colors.secondaryText} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={{ width: Spacing.xl }} />
          </ScrollView>

          {/* Action CTAs */}
          <View style={styles.actionsContainer}>
            <PrimaryButton
              label="Log Outfit Wear"
              onPress={() => handleLogWear(item)}
              loading={loggingWear}
              dark={isDark}
            />

            <TouchableOpacity
              style={[styles.remixBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/wardrobe?tab=mannequin&loadOutfit=${item.id}` as any)}
              activeOpacity={0.8}
            >
              <IconSymbol name="hanger" size={18} color={colors.tint} />
              <Text style={[styles.remixBtnText, { color: colors.text }]}>Edit on Mannequin</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowWidth, contentWidth, colors, isDark, loggingWear]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }

  if (!outfit) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: colors.text }]}>Outfit Not Found</Text>
          <Text style={[styles.errorSubtitle, { color: colors.secondaryText }]}>
            This outfit may have been removed or is no longer available.
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={[styles.backHomeBtn, { backgroundColor: colors.tint }]}>
            <Text style={[styles.backHomeText, { color: colors.onTint }]}>Back to Wardrobe</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const currentItems: OutfitSlotItem[] = Array.isArray(outfit.items) ? (outfit.items as unknown as OutfitSlotItem[]) : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {/* Header Bar -- reflects whichever outfit is currently swiped into view */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {outfit.name || 'Saved Outfit'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]}>
            {currentItems.length} piece{currentItems.length === 1 ? '' : 's'}
            {outfits.length > 1 ? ` · ${currentIndex + 1} of ${outfits.length}` : ''}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => setConfirmDeleteVisible(true)}
          disabled={deleting}
          style={[styles.iconBtn, { backgroundColor: isDark ? 'rgba(255,69,58,0.15)' : '#FFF0F0', borderColor: isDark ? 'rgba(255,69,58,0.3)' : '#FFD2D2' }]}
          accessibilityRole="button"
          accessibilityLabel="Delete outfit"
        >
          <IconSymbol name="trash.fill" size={18} color="#FF453A" />
        </TouchableOpacity>
      </View>

      {outfits.length > 1 && (
        <Text style={[styles.swipeHint, { color: colors.secondaryText }]}>Swipe to browse your other saved outfits</Text>
      )}

      <ConfirmModal
        visible={confirmDeleteVisible}
        title="Delete Outfit"
        message={`Are you sure you want to delete "${outfit.name || 'this outfit'}"?`}
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteVisible(false)}
        onConfirm={() => {
          setConfirmDeleteVisible(false);
          executeDelete();
        }}
      />

      <FlatList
        ref={flatListRef}
        data={outfits}
        keyExtractor={(o) => o.id}
        renderItem={renderOutfitPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={currentIndex}
        getItemLayout={(_, index) => ({ length: windowWidth, offset: windowWidth * index, index })}
        onMomentumScrollEnd={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
          setCurrentIndex(Math.max(0, Math.min(newIndex, outfits.length - 1)));
        }}
        windowSize={3}
        initialNumToRender={1}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  errorTitle: {
    ...Type.title,
    marginBottom: Spacing.xs,
  },
  errorSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  backHomeBtn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  backHomeText: {
    fontSize: 15,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swipeHint: {
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: Spacing.xs,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: Spacing.md,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: 100,
  },
  mannequinCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    alignItems: 'center',
    overflow: 'hidden',
    elevation: 4,
    ...Platform.select({
      ios: {
        shadowColor: 'black',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.1)' },
    }),
  },
  mannequinBadgeRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: Spacing.sm,
  },
  mannequinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
  },
  mannequinBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  mannequinPreviewWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  sectionHeader: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    ...Type.subtitle,
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  itemCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    elevation: 3,
    ...Platform.select({
      ios: {
        shadowColor: 'black',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
      },
      web: { boxShadow: '0 4px 10px rgba(0,0,0,0.08)' },
    }),
  },
  imageContainer: {
    width: '100%',
    height: 170,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    padding: Spacing.sm,
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  slotBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 6,
  },
  slotLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  itemInfo: {
    padding: Spacing.md,
    gap: 6,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    minHeight: 36,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actionsContainer: {
    marginTop: Spacing.xxl,
    gap: Spacing.md,
  },
  remixBtn: {
    height: 54,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  remixBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
