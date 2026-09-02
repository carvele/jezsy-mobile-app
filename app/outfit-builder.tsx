import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useWishlist } from '@/src/context/WishlistContext';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Database } from '@/src/types/database.types';
import { evaluateColors } from '@/src/utils/colorMatcher';

import { useToast } from '@/src/context/ToastContext';
import { Gesture, GestureDetector, ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, ZoomIn, FadeOut } from 'react-native-reanimated';
import { MannequinSilhouette } from '@/src/components/MannequinSilhouette';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];
type Product     = Database['public']['Tables']['products']['Row'];

// Outfit slot definition
type SlotKey = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';
// image_url is what the builder previews (may be a background-removed cutout);
// original_image_url is the persistent remote URL saved to the DB, so saved
// outfits never reference an ephemeral on-device file:// path.
// `source` drives the "not yet owned" treatment: a wishlist piece is styling
// the user cannot actually wear yet, so it has to be visually distinct from
// something already hanging in their wardrobe.
type ItemSource = 'wardrobe' | 'catalog' | 'wishlist';
type SlotItem = { product_id: string | null; image_url: string; original_image_url: string; name: string; color_tags?: string[] | null; source: ItemSource };
type Slots = Record<SlotKey, SlotItem | null>;

const SLOT_LABELS: Record<SlotKey, string> = {
  top:       'Top',
  bottom:    'Bottom',
  outerwear: 'Outerwear',
  shoes:     'Shoes',
  accessory: 'Accessory',
};
const SLOT_ICONS: Record<SlotKey, string> = {
  top:       'tshirt.fill',
  bottom:    'rectangle.fill',
  outerwear: 'cloud.fill',
  shoes:     'shoeprints.fill',
  accessory: 'sparkles',
};
const SLOT_KEYS: SlotKey[] = ['top', 'bottom', 'outerwear', 'shoes', 'accessory'];
// wardrobe_items.garment_type is capitalized (Top/Bottom/Outerwear/Shoes/
// Accessory); products has no equivalent structured field -- catalog/
// wishlist categories are boutique formal-wear categories (Ball Gowns,
// Evening Wear, Cocktail & Party...), not garment slots, so there is
// nothing reliable to filter those two tabs by.
const SLOT_TO_GARMENT_TYPE: Record<SlotKey, string> = {
  top: 'Top', bottom: 'Bottom', outerwear: 'Outerwear', shoes: 'Shoes', accessory: 'Accessory',
};

const { width } = Dimensions.get('window');
const PICKER_CARD = (width - 48 - 12) / 2;

const EMPTY_SLOTS: Slots = {
  top: null, bottom: null, outerwear: null, shoes: null, accessory: null,
};

// Canvas items previously rendered at fixed percentage positions with no way
// to move them, so a customer couldn't nudge an item into a more natural
// spot to actually judge how the look reads together. baseStyle supplies the
// starting position/size (unchanged); the pan gesture only adds a transform
// on top, so layout math stays untouched and ViewShot still captures the
// result correctly (transforms are part of the native render, not layout).
function DraggableCanvasItem({ uri, baseStyle, resetKey }: { uri: string; baseStyle: any; resetKey: string }) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
    startX.value = 0;
    startY.value = 0;
    // resetKey changing means the underlying item changed (new pick, or a
    // cleared slot refilled) -- a repositioned top shouldn't hand its offset
    // to an unrelated item that happens to land in the same slot next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = startX.value + e.translationX;
      translateY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View 
        key={resetKey}
        entering={ZoomIn.duration(500).springify()} 
        exiting={FadeOut.duration(200)}
        style={[baseStyle, animatedStyle]}
      >
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

export default function OutfitBuilderScreen() {
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isDark = theme === 'dark';
  const router = useRouter();
  const { session } = useAuth();
  const { wishlistIds } = useWishlist();

  const [slots, setSlots]             = useState<Slots>(EMPTY_SLOTS);
  const [activeSlot, setActiveSlot]   = useState<SlotKey | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saveVisible, setSaveVisible]     = useState(false);
  const [outfitName, setOutfitName]       = useState('');
  const [saving, setSaving]               = useState(false);

  const [pendingShare, setPendingShare]   = useState(false);
  const [shuffling, setShuffling]         = useState(false);

  const [viewMode, setViewMode]           = useState<'slots' | 'canvas'>('slots');
  const viewShotRef                       = React.useRef<React.ElementRef<typeof ViewShot>>(null);

  // Picker state
  const [pickerTab, setPickerTab]         = useState<ItemSource>('wardrobe');
  const [wardrobeItems, setWardrobeItems] = useState<WardrobeItem[]>([]);
  const [catalogItems, setCatalogItems]   = useState<Product[]>([]);
  const [wishlistItems, setWishlistItems] = useState<Product[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const filledCount = SLOT_KEYS.filter((k) => slots[k] !== null).length;

  const captureAndShare = useCallback(async () => {
    if (viewShotRef.current?.capture) {
      try {
        const uri = await viewShotRef.current.capture();
        await Sharing.shareAsync(uri, { dialogTitle: 'Share my outfit' });
      } catch (err) {
        console.error(err);
        showToast('Failed to capture outfit image', 'error');
      }
    }
  }, [showToast]);

  useEffect(() => {
    if (pendingShare && viewMode === 'canvas') {
      setPendingShare(false);
      // Give canvas one layout frame to finalize rendering
      requestAnimationFrame(() => {
        captureAndShare();
      });
    }
  }, [pendingShare, viewMode, captureAndShare]);

  const fetchWardrobeItems = useCallback(async () => {
    if (!session?.user?.id) return;
    setPickerLoading(true);
    try {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('deleted', false)
        .order('created_at', { ascending: false });
      if (!error) setWardrobeItems(data || []);
    } finally {
      setPickerLoading(false);
    }
  }, [session?.user?.id]);

  const fetchCatalogItems = useCallback(async () => {
    setPickerLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('visibility', 'public')
        .eq('deleted', false)
        .limit(60);
      if (!error) setCatalogItems(data || []);
    } finally {
      setPickerLoading(false);
    }
  }, []);

  const fetchWishlistItems = useCallback(async () => {
    const ids = Array.from(wishlistIds);
    if (ids.length === 0) { setWishlistItems([]); return; }
    setPickerLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .in('id', ids)
        .eq('visibility', 'public')
        .eq('deleted', false);
      if (!error) setWishlistItems(data || []);
    } finally {
      setPickerLoading(false);
    }
  }, [wishlistIds]);

  // Derive sorted items based on color harmony with already selected slots
  const sortedWardrobeItems = useMemo(() => {
    const forSlot = activeSlot
      ? wardrobeItems.filter((item) => item.garment_type === SLOT_TO_GARMENT_TYPE[activeSlot])
      : wardrobeItems;
    if (filledCount === 0) return forSlot;
    const currentColors = SLOT_KEYS.filter(k => slots[k]?.color_tags).flatMap(k => slots[k]!.color_tags || []);
    const scored = forSlot.map(item => ({
      item,
      score: evaluateColors([...currentColors, ...(item.color_tags || [])]).score,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.item);
  }, [wardrobeItems, slots, filledCount, activeSlot]);

  const sortedCatalogItems = useMemo(() => {
    if (filledCount === 0) return catalogItems;
    const currentColors = SLOT_KEYS.filter(k => slots[k]?.color_tags).flatMap(k => slots[k]!.color_tags || []);
    const scored = catalogItems.map(item => ({
      item,
      score: evaluateColors([...currentColors, ...(item.color ? [item.color] : [])]).score,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.item);
  }, [catalogItems, slots, filledCount]);

  const sortedWishlistItems = useMemo(() => {
    if (filledCount === 0) return wishlistItems;
    const currentColors = SLOT_KEYS.filter(k => slots[k]?.color_tags).flatMap(k => slots[k]!.color_tags || []);
    const scored = wishlistItems.map(item => ({
      item,
      score: evaluateColors([...currentColors, ...(item.color ? [item.color] : [])]).score,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.item);
  }, [wishlistItems, slots, filledCount]);

  // Loaded eagerly (not just when the picker opens) so Shuffle has a pool to
  // draw from as soon as the screen mounts.
  useEffect(() => {
    fetchWardrobeItems();
  }, [fetchWardrobeItems]);

  const handleShuffle = useCallback(async () => {
    if (wardrobeItems.length === 0) {
      showToast('Add items to your wardrobe first to shuffle an outfit.', 'info');
      return;
    }

    setShuffling(true);
    try {
      // Process sequentially to prevent multiple heavy ML tasks from crashing the device concurrently
      const picks: [string, SlotItem | null][] = [];
      for (const slotKey of SLOT_KEYS) {
        const pool = wardrobeItems.filter((item) => item.garment_type === SLOT_TO_GARMENT_TYPE[slotKey]);
        if (pool.length === 0) {
          picks.push([slotKey, null]);
          continue;
        }
        
        const item = pool[Math.floor(Math.random() * pool.length)];
        const finalImageUrl = item.image_url || '';
        
        const slotItem: SlotItem = {
          product_id: item.product_id,
          image_url: finalImageUrl,
          original_image_url: item.image_url || '',
          name: item.category || 'Item',
          color_tags: item.color_tags,
          source: 'wardrobe',
        };
        picks.push([slotKey, slotItem]);
      }

      const filled = picks.filter(([, item]) => item !== null).length;
      if (filled === 0) {
        showToast('No wardrobe items are tagged with a garment type yet.', 'info');
        return;
      }

      setSlots(Object.fromEntries(picks) as Slots);
      showToast('Shuffled your outfit ✨', 'success');
    } finally {
      setShuffling(false);
    }
  }, [wardrobeItems, showToast]);

  const openPicker = useCallback((slot: SlotKey) => {
    setActiveSlot(slot);
    setPickerTab('wardrobe');
    setPickerVisible(true);
    fetchWardrobeItems();
  }, [fetchWardrobeItems]);

  useEffect(() => {
    if (!pickerVisible) return;
    if (pickerTab === 'catalog' && catalogItems.length === 0) fetchCatalogItems();
    if (pickerTab === 'wishlist') fetchWishlistItems();
  }, [pickerTab, pickerVisible, catalogItems.length, fetchCatalogItems, fetchWishlistItems]);

  const selectWardrobeItem = useCallback(async (item: WardrobeItem) => {
    if (!activeSlot) return;
    setPickerVisible(false); // Close picker immediately for better UX
    setSaving(true); // Re-use saving state to show a loader during BG removal

    try {
      const finalImageUrl = item.image_url || '';

      setSlots((prev) => ({
        ...prev,
        [activeSlot]: {
          product_id: item.product_id,
          image_url:  finalImageUrl,
          original_image_url: item.image_url || '',
          name:       item.category || 'Item',
          color_tags: item.color_tags,
          source:     'wardrobe',
        },
      }));
    } finally {
      setSaving(false);
    }
  }, [activeSlot]);

  const selectProduct = useCallback(async (item: Product, source: Exclude<ItemSource, 'wardrobe'>) => {
    if (!activeSlot) return;
    setPickerVisible(false); // Close picker immediately for better UX
    setSaving(true); // Re-use saving state to show a loader during BG removal

    try {
      const finalImageUrl = item.image_url || '';

      setSlots((prev) => ({
        ...prev,
        [activeSlot]: {
          product_id: item.id,
          image_url:  finalImageUrl,
          original_image_url: item.image_url || '',
          name:       item.name,
          color_tags: item.color ? [item.color] : [],
          source,
        },
      }));
    } finally {
      setSaving(false);
    }
  }, [activeSlot]);

  const removeSlot = useCallback((slot: SlotKey) => {
    setSlots((prev) => ({ ...prev, [slot]: null }));
  }, []);

  const handleSave = async () => {
    if (!session?.user?.id) return;
    const name = outfitName.trim() || 'My Outfit';
    // Persist the original remote URL (not the possibly background-removed,
    // device-local preview URL) so the saved outfit renders on any device.
    const items = SLOT_KEYS
      .filter((k) => slots[k] !== null)
      .map((k) => {
        const s = slots[k]!;
        return {
          slot: k,
          product_id: s.product_id,
          image_url: s.original_image_url || s.image_url,
          name: s.name,
          color_tags: s.color_tags,
          // Persisted so a saved look still shows which pieces the user would
          // have to buy to actually wear it.
          owned: s.source !== 'wishlist',
        };
      });

    if (items.length === 0) {
      showToast('Add at least one item before saving.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('saved_outfits').insert({
        user_id: session.user.id,
        name,
        items,
      });
      if (error) throw error;
      setSaveVisible(false);
      setOutfitName('');
      Alert.alert('Outfit Saved', `"${name}" added to your wardrobe.`, [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error('Error saving outfit:', err);
      showToast('Could not save that outfit. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    if (filledCount === 0) {
      showToast('Add at least one item before sharing.', 'error');
      return;
    }
    if (viewMode !== 'canvas') {
      setViewMode('canvas');
      setPendingShare(true);
      return;
    }

    await captureAndShare();
  };

  const handleDiscard = () => {
    Alert.alert(
      'Discard Outfit?',
      'This will clear all currently selected items.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => setSlots(EMPTY_SLOTS) },
      ]
    );
  };

  // ── Render slot card ──────────────────────────────────────────────────────
  const renderSlot = (slotKey: SlotKey) => {
    const item = slots[slotKey];
    return (
      <View key={slotKey} style={styles.slotRow}>
        <View style={[styles.slotLabel, { backgroundColor: colors.card }]}>
          <IconSymbol name={SLOT_ICONS[slotKey] as any} size={16} color={colors.tint} />
          <Text style={[styles.slotLabelText, { color: colors.text }]}>
            {SLOT_LABELS[slotKey]}
          </Text>
        </View>

        {item ? (
          <TouchableOpacity
            style={[
              styles.slotFilled,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              },
            ]}
            onPress={() => openPicker(slotKey)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${SLOT_LABELS[slotKey]}: ${item.name}. Tap to change`}
            accessibilityHint={`Opens the picker to replace the ${SLOT_LABELS[slotKey].toLowerCase()}`}
          >
            <Image source={{ uri: item.image_url }} style={styles.slotImage} contentFit="cover" />
            <View style={styles.slotItemInfo}>
              <Text style={[styles.slotItemName, { color: colors.text }]} numberOfLines={2}>
                {item.name}
              </Text>
              {item.source === 'wishlist' ? (
                <View style={[styles.wishlistTag, { borderColor: colors.blush }]}>
                  <IconSymbol name="heart.fill" size={11} color={colors.blush} />
                  <Text style={[styles.wishlistTagText, { color: colors.blush }]}>Wishlist - not owned</Text>
                </View>
              ) : null}
              <Text style={[styles.slotChange, { color: colors.tint }]}>Tap to change</Text>
            </View>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => removeSlot(slotKey)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${SLOT_LABELS[slotKey].toLowerCase()}`}
              accessibilityHint={`Clears the ${SLOT_LABELS[slotKey].toLowerCase()} slot`}
            >
              <IconSymbol name="xmark.circle.fill" size={22} color={colors.secondaryText} />
            </TouchableOpacity>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.slotEmpty, { borderColor: colors.border }]}
            onPress={() => openPicker(slotKey)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Add ${SLOT_LABELS[slotKey]}`}
            accessibilityHint={`Opens the picker to choose a ${SLOT_LABELS[slotKey].toLowerCase()}`}
          >
            <IconSymbol name="plus" size={24} color={colors.icon} />
            <Text style={[styles.slotEmptyText, { color: colors.secondaryText }]}>Add {SLOT_LABELS[slotKey]}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Outfit Builder</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={handleShuffle}
            disabled={shuffling || wardrobeItems.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Shuffle outfit"
            accessibilityHint="Fills each slot with a random item from your wardrobe"
          >
            <IconSymbol name="shuffle" size={20} color={shuffling || wardrobeItems.length === 0 ? colors.secondaryText : colors.tint} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={handleShare}
            disabled={filledCount === 0}
            accessibilityRole="button"
            accessibilityLabel="Share outfit"
          >
            <IconSymbol name="square.and.arrow.up" size={20} color={filledCount === 0 ? colors.secondaryText : colors.tint} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={handleDiscard}
            disabled={filledCount === 0}
            accessibilityRole="button"
            accessibilityLabel="Discard outfit"
          >
            <IconSymbol name="trash" size={20} color={filledCount === 0 ? colors.secondaryText : colors.error} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveHeaderBtn, { backgroundColor: colors.tint, opacity: filledCount === 0 ? 0.4 : 1 }]}
            onPress={() => filledCount > 0 && setSaveVisible(true)}
            disabled={filledCount === 0}
            accessibilityRole="button"
            accessibilityLabel="Save outfit"
            accessibilityHint={filledCount === 0 ? "Add at least one item to save" : "Opens the save dialog to name and store this outfit"}
            accessibilityState={{ disabled: filledCount === 0 }}
          >
            <Text style={[styles.saveHeaderBtnText, { color: colors.onTint }]}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Outfit preview strip */}
      <View style={[styles.previewStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {SLOT_KEYS.map((k) => (
          <View key={k} style={styles.previewThumb}>
            {slots[k] ? (
              <>
                <Image source={{ uri: slots[k]!.image_url }} style={styles.previewThumbImage} contentFit="cover" />
                {slots[k]!.source === 'wishlist' ? (
                  <View style={[styles.previewWishDot, { backgroundColor: colors.blush }]} />
                ) : null}
              </>
            ) : (
              <View style={[styles.previewThumbEmpty, { borderColor: colors.border }]}>
                <IconSymbol name={SLOT_ICONS[k] as any} size={14} color={colors.icon} />
              </View>
            )}
          </View>
        ))}
        <Text style={[styles.previewCount, { color: colors.secondaryText }]}>
          {filledCount}/5 filled
        </Text>
      </View>

      {/* Color Harmony Badge */}
      {filledCount >= 2 && (() => {
        const allColorTags = SLOT_KEYS
          .filter((k) => slots[k]?.color_tags)
          .flatMap((k) => slots[k]!.color_tags || []);
        if (allColorTags.length === 0) return null;
        const colorMatch = evaluateColors(allColorTags);
        const badgeBg =
          colorMatch.label === 'Perfect Harmony' ? '#047857' :
          colorMatch.label === 'Great Match' ? '#2563EB' :
          colorMatch.label === 'Neutral / Balanced' ? '#D4AF37' : '#DC2626';
        return (
          <View style={[styles.colorHarmonyBadge, { backgroundColor: badgeBg + '22', borderColor: badgeBg }]}>
            <Text style={[styles.colorHarmonyLabel, { color: badgeBg }]}>
              {colorMatch.label} · {colorMatch.score}%
            </Text>
            <Text style={[styles.colorHarmonyFeedback, { color: colors.secondaryText }]} numberOfLines={2}>
              {colorMatch.feedback}
            </Text>
          </View>
        );
      })()}

      {/* View Mode Toggle */}
      <View style={[styles.viewToggleContainer, { backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={[styles.viewToggleBtn, viewMode === 'slots' && { backgroundColor: colors.tint }]}
          onPress={() => setViewMode('slots')}
        >
          <Text style={[styles.viewToggleText, { color: viewMode === 'slots' ? colors.onTint : colors.text }]}>List</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.viewToggleBtn, viewMode === 'canvas' && { backgroundColor: colors.tint }]}
          onPress={() => setViewMode('canvas')}
        >
          <Text style={[styles.viewToggleText, { color: viewMode === 'canvas' ? colors.onTint : colors.text }]}>Canvas</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      {viewMode === 'slots' ? (
        <ScrollView contentContainerStyle={styles.slotsList} showsVerticalScrollIndicator={false}>
          {SLOT_KEYS.map(renderSlot)}
          <View style={{ height: 100 }} />
        </ScrollView>
      ) : (
        <GestureScrollView contentContainerStyle={styles.canvasContainer} showsVerticalScrollIndicator={false}>
          <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 0.9 }} style={[styles.canvasStage, { backgroundColor: colors.background }]}>
            <MannequinSilhouette color={colors.secondaryText} opacity={isDark ? 0.35 : 0.25} />
            {slots.shoes && <DraggableCanvasItem uri={slots.shoes.image_url} baseStyle={styles.canvasShoes} resetKey={slots.shoes.image_url} />}
            {slots.bottom && <DraggableCanvasItem uri={slots.bottom.image_url} baseStyle={styles.canvasBottom} resetKey={slots.bottom.image_url} />}
            {slots.top && <DraggableCanvasItem uri={slots.top.image_url} baseStyle={styles.canvasTop} resetKey={slots.top.image_url} />}
            {slots.outerwear && <DraggableCanvasItem uri={slots.outerwear.image_url} baseStyle={styles.canvasOuterwear} resetKey={slots.outerwear.image_url} />}
            {slots.accessory && <DraggableCanvasItem uri={slots.accessory.image_url} baseStyle={styles.canvasAccessory} resetKey={slots.accessory.image_url} />}
          </ViewShot>
          {filledCount > 0 && (
            <Text style={[styles.canvasHint, { color: colors.secondaryText }]}>Drag items to reposition</Text>
          )}
          <View style={{ height: 100 }} />
        </GestureScrollView>
      )}

      {/* Processing overlay: background removal runs after the picker closes,
          which otherwise looks frozen for a few seconds with no feedback. */}
      {(saving || shuffling) && !saveVisible && (
        <View style={styles.processingOverlay} pointerEvents="auto">
          <View style={[styles.processingCard, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.tint} />
            <Text style={[styles.processingText, { color: colors.text }]}>
              {shuffling ? 'Shuffling your outfit…' : 'Processing item…'}
            </Text>
          </View>
        </View>
      )}

      {/* ── Item Picker Modal ── */}
      <Modal visible={pickerVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Pick {activeSlot ? SLOT_LABELS[activeSlot] : 'Item'}
            </Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)}>
              <IconSymbol name="xmark" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Tab switcher */}
          <View style={[styles.tabRow, { borderColor: colors.border }]}>
            {(['wardrobe', 'wishlist', 'catalog'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, pickerTab === tab && { borderBottomColor: colors.tint, borderBottomWidth: 2 }]}
                onPress={() => setPickerTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected: pickerTab === tab }}
              >
                <Text style={[styles.tabText, { color: pickerTab === tab ? colors.tint : colors.secondaryText }]}>
                  {tab === 'wardrobe' ? 'My Wardrobe' : tab === 'wishlist' ? 'Wishlist' : 'Catalog'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {pickerLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : pickerTab === 'wardrobe' ? (
            sortedWardrobeItems.length === 0 ? (
              <View style={styles.center}>
                <IconSymbol name="tshirt.fill" size={48} color={colors.icon} />
                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                  {wardrobeItems.length === 0
                    ? 'No wardrobe items available. Select pieces from Catalog or add items.'
                    : `No ${activeSlot ? SLOT_LABELS[activeSlot].toLowerCase() : 'matching'} items in your wardrobe yet. Try Catalog, or add one tagged as ${activeSlot ? SLOT_LABELS[activeSlot] : 'this type'} in My Items.`}
                </Text>
              </View>
            ) : (
              <FlatList
                data={sortedWardrobeItems}
                keyExtractor={(i) => i.id}
                numColumns={2}
                contentContainerStyle={styles.pickerGrid}
                columnWrapperStyle={styles.pickerRow}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.pickerCard, { backgroundColor: colors.card }]}
                    onPress={() => selectWardrobeItem(item)}
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: item.image_url || '' }}
                      style={[styles.pickerCardImage, { backgroundColor: colors.imagePlaceholder }]}
                      contentFit="cover"
                    />
                    <Text style={[styles.pickerCardName, { color: colors.text }]} numberOfLines={1}>
                      {item.category || 'Item'}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )
          ) : pickerTab === 'wishlist' && wishlistItems.length === 0 ? (
            <View style={styles.center}>
              <IconSymbol name="heart" size={48} color={colors.icon} />
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                Wishlist empty. Save items from the catalog to style them here.
              </Text>
            </View>
          ) : (
            <FlatList
              data={pickerTab === 'wishlist' ? sortedWishlistItems : sortedCatalogItems}
              keyExtractor={(i) => i.id}
              numColumns={2}
              contentContainerStyle={styles.pickerGrid}
              columnWrapperStyle={styles.pickerRow}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pickerCard, { backgroundColor: colors.card }]}
                  onPress={() => selectProduct(item, pickerTab === 'wishlist' ? 'wishlist' : 'catalog')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    pickerTab === 'wishlist' ? `${item.name}, from your wishlist, not yet owned` : item.name
                  }
                >
                  <Image
                    source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
                    style={[styles.pickerCardImage, { backgroundColor: colors.imagePlaceholder }]}
                    contentFit="cover"
                  />
                  <Text style={[styles.pickerCardName, { color: colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* ── Save Outfit Modal ── */}
      {saveVisible && (
      <Modal visible={saveVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.saveOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.saveSheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.saveTitle, { color: colors.text }]}>Name Your Outfit</Text>
            <TextInput keyboardAppearance={theme}
              style={[styles.saveInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="e.g. Summer Date Night"
              placeholderTextColor={colors.secondaryText}
              value={outfitName}
              onChangeText={setOutfitName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            <View style={styles.saveActions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => setSaveVisible(false)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: colors.tint }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onTint} />
                ) : (
                  <Text style={[styles.confirmBtnText, { color: colors.onTint }]}>Save Outfit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  headerBtn: { padding: Spacing.sm },
  headerTitle: { ...Type.subtitle },
  saveHeaderBtn: {
    paddingHorizontal: 18,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
  },
  saveHeaderBtnText: { fontWeight: '800', fontSize: 14 },
  previewStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: Spacing.sm,
  },
  previewThumb: { width: 44, height: 52, borderRadius: Radius.sm, overflow: 'hidden' },
  previewThumbImage: { width: '100%', height: '100%' },
  previewThumbEmpty: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewWishDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewCount: { fontSize: 12, fontWeight: '600', marginLeft: 'auto' },
  colorHarmonyBadge: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  colorHarmonyLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  colorHarmonyFeedback: {
    fontSize: 12,
    lineHeight: 17,
  },
  slotsList: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  slotRow: { marginBottom: Spacing.md },
  slotLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  slotLabelText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  slotFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    gap: Spacing.md,
    paddingRight: Spacing.md,
  },
  slotImage: { width: 72, height: 80 },
  slotItemInfo: { flex: 1 },
  slotItemName: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  slotChange: { fontSize: 12, marginTop: 2 },
  wishlistTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: Spacing.xs,
  },
  wishlistTagText: { fontSize: 10, fontWeight: '700' },
  removeBtn: { padding: Spacing.xs },
  slotEmpty: {
    height: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  slotEmptyText: { fontSize: 14, fontWeight: '500' },
  // Picker modal
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalTitle: { ...Type.title },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginHorizontal: Spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { ...Type.bodyStrong },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  emptyText: { ...Type.body, textAlign: 'center', paddingHorizontal: Spacing.xxxl },
  pickerGrid: { padding: Spacing.lg, paddingBottom: 40 },
  pickerRow: { justifyContent: 'space-between', marginBottom: Spacing.md },
  pickerCard: {
    width: PICKER_CARD,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  pickerCardImage: { width: '100%', aspectRatio: 1 },
  pickerCardName: { fontSize: 12, fontWeight: '600', padding: Spacing.sm },
  // Save modal
  saveOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  saveSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.xxl,
    gap: Spacing.lg,
  },
  saveTitle: { ...Type.title },
  saveInput: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    fontSize: 16,
  },
  saveActions: { flexDirection: 'row', gap: Spacing.md },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: { ...Type.bodyStrong },
  confirmBtn: {
    flex: 2,
    height: 52,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtnText: { fontWeight: '800', fontSize: 15 },
  processingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  processingCard: {
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.xxxl,
    borderRadius: Radius.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  processingText: { fontSize: 14, fontWeight: '600' },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleContainer: {
    flexDirection: 'row',
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    padding: Spacing.xs,
  },
  viewToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Radius.pill,
  },
  viewToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  canvasContainer: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  canvasStage: {
    width: width - Spacing.xl * 2,
    aspectRatio: 3 / 4,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  canvasHint: {
    fontSize: 12,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  canvasShoes: {
    position: 'absolute',
    bottom: '5%',
    left: '20%',
    right: '20%',
    height: '25%',
    zIndex: 5,
  },
  canvasBottom: {
    position: 'absolute',
    bottom: '25%',
    left: '15%',
    right: '15%',
    height: '45%',
    zIndex: 10,
  },
  canvasTop: {
    position: 'absolute',
    top: '15%',
    left: '15%',
    right: '15%',
    height: '45%',
    zIndex: 20,
  },
  canvasAccessory: {
    position: 'absolute',
    top: '5%',
    right: '5%',
    width: '30%',
    height: '20%',
    zIndex: 30,
  },
  canvasOuterwear: {
    position: 'absolute',
    top: '10%',
    bottom: '20%',
    left: '5%',
    right: '5%',
    zIndex: 40,
  },
});




