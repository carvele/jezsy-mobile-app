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
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Database } from '@/src/types/database.types';
import { removeBackground } from '@six33/react-native-bg-removal';
import { evaluateColors } from '@/src/utils/colorMatcher';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];
type Product     = Database['public']['Tables']['products']['Row'];

// Outfit slot definition
type SlotKey = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory';
type SlotItem = { product_id: string | null; image_url: string; name: string; color_tags?: string[] | null };
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

const { width } = Dimensions.get('window');
const PICKER_CARD = (width - 48 - 12) / 2;

const EMPTY_SLOTS: Slots = {
  top: null, bottom: null, outerwear: null, shoes: null, accessory: null,
};

export default function OutfitBuilderScreen() {
  const theme  = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { session } = useAuth();

  const [slots, setSlots]             = useState<Slots>(EMPTY_SLOTS);
  const [activeSlot, setActiveSlot]   = useState<SlotKey | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saveVisible, setSaveVisible]     = useState(false);
  const [outfitName, setOutfitName]       = useState('');
  const [saving, setSaving]               = useState(false);

  // Picker state
  const [pickerTab, setPickerTab]         = useState<'wardrobe' | 'catalog'>('wardrobe');
  const [wardrobeItems, setWardrobeItems] = useState<WardrobeItem[]>([]);
  const [catalogItems, setCatalogItems]   = useState<Product[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const filledCount = SLOT_KEYS.filter((k) => slots[k] !== null).length;

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

  // Derive sorted items based on color harmony with already selected slots
  const sortedWardrobeItems = useMemo(() => {
    if (filledCount === 0) return wardrobeItems;
    const currentColors = SLOT_KEYS.filter(k => slots[k]?.color_tags).flatMap(k => slots[k]!.color_tags || []);
    return [...wardrobeItems].sort((a, b) => {
      const scoreA = evaluateColors([...currentColors, ...(a.color_tags || [])]).score;
      const scoreB = evaluateColors([...currentColors, ...(b.color_tags || [])]).score;
      return scoreB - scoreA;
    });
  }, [wardrobeItems, slots, filledCount]);

  const sortedCatalogItems = useMemo(() => {
    if (filledCount === 0) return catalogItems;
    const currentColors = SLOT_KEYS.filter(k => slots[k]?.color_tags).flatMap(k => slots[k]!.color_tags || []);
    return [...catalogItems].sort((a, b) => {
      const scoreA = evaluateColors([...currentColors, ...(a.color ? [a.color] : [])]).score;
      const scoreB = evaluateColors([...currentColors, ...(b.color ? [b.color] : [])]).score;
      return scoreB - scoreA;
    });
  }, [catalogItems, slots, filledCount]);

  const openPicker = useCallback((slot: SlotKey) => {
    setActiveSlot(slot);
    setPickerTab('wardrobe');
    setPickerVisible(true);
    fetchWardrobeItems();
  }, [fetchWardrobeItems]);

  useEffect(() => {
    if (pickerVisible && pickerTab === 'catalog' && catalogItems.length === 0) {
      fetchCatalogItems();
    }
  }, [pickerTab, pickerVisible, catalogItems.length, fetchCatalogItems]);

  const selectWardrobeItem = useCallback(async (item: WardrobeItem) => {
    if (!activeSlot) return;
    setPickerVisible(false); // Close picker immediately for better UX
    setSaving(true); // Re-use saving state to show a loader during BG removal

    try {
      let finalImageUrl = item.image_url || '';
      if (item.image_url) {
        try {
          finalImageUrl = await removeBackground(item.image_url);
        } catch (e) {
          console.log('Background removal failed or fallback required, using original image', e);
        }
      }

      setSlots((prev) => ({
        ...prev,
        [activeSlot]: {
          product_id: item.product_id,
          image_url:  finalImageUrl,
          name:       item.category || 'Item',
          color_tags: item.color_tags,
        },
      }));
    } finally {
      setSaving(false);
    }
  }, [activeSlot]);

  const selectCatalogItem = useCallback((item: Product) => {
    if (!activeSlot) return;
    setSlots((prev) => ({
      ...prev,
      [activeSlot]: {
        product_id: item.id,
        image_url:  item.image_url || '',
        name:       item.name,
        color_tags: item.color ? [item.color] : [],
      },
    }));
    setPickerVisible(false);
  }, [activeSlot]);

  const removeSlot = useCallback((slot: SlotKey) => {
    setSlots((prev) => ({ ...prev, [slot]: null }));
  }, []);

  const handleSave = async () => {
    if (!session?.user?.id) return;
    const name = outfitName.trim() || 'My Outfit';
    const items = SLOT_KEYS
      .filter((k) => slots[k] !== null)
      .map((k) => ({ slot: k, ...slots[k] }));

    if (items.length === 0) {
      Alert.alert('Empty Outfit', 'Add at least one item before saving.');
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
      Alert.alert('Outfit Saved!', `"${name}" has been added to your wardrobe.`, [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error('Error saving outfit:', err);
      Alert.alert('Save Failed', 'Could not save outfit. Please try again.');
    } finally {
      setSaving(false);
    }
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
          <TouchableOpacity style={styles.slotFilled} onPress={() => openPicker(slotKey)} activeOpacity={0.85}>
            <Image source={{ uri: item.image_url }} style={styles.slotImage} contentFit="cover" />
            <View style={styles.slotItemInfo}>
              <Text style={[styles.slotItemName, { color: colors.text }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[styles.slotChange, { color: colors.tint }]}>Tap to change</Text>
            </View>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => removeSlot(slotKey)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <IconSymbol name="xmark.circle.fill" size={22} color={colors.secondaryText} />
            </TouchableOpacity>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.slotEmpty, { borderColor: colors.border }]}
            onPress={() => openPicker(slotKey)}
            activeOpacity={0.75}
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
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Outfit Builder</Text>
        <TouchableOpacity
          style={[styles.saveHeaderBtn, { backgroundColor: colors.tint, opacity: filledCount === 0 ? 0.4 : 1 }]}
          onPress={() => filledCount > 0 && setSaveVisible(true)}
          disabled={filledCount === 0}
        >
          <Text style={styles.saveHeaderBtnText}>Save</Text>
        </TouchableOpacity>
      </View>

      {/* Outfit preview strip */}
      <View style={[styles.previewStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {SLOT_KEYS.map((k) => (
          <View key={k} style={styles.previewThumb}>
            {slots[k] ? (
              <Image source={{ uri: slots[k]!.image_url }} style={styles.previewThumbImage} contentFit="cover" />
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

      {/* Slots list */}
      <ScrollView contentContainerStyle={styles.slotsList} showsVerticalScrollIndicator={false}>
        {SLOT_KEYS.map(renderSlot)}
        <View style={{ height: 100 }} />
      </ScrollView>

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
            {(['wardrobe', 'catalog'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, pickerTab === tab && { borderBottomColor: colors.tint, borderBottomWidth: 2 }]}
                onPress={() => setPickerTab(tab)}
              >
                <Text style={[styles.tabText, { color: pickerTab === tab ? colors.tint : colors.secondaryText }]}>
                  {tab === 'wardrobe' ? 'My Wardrobe' : 'Catalog'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {pickerLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : pickerTab === 'wardrobe' ? (
            wardrobeItems.length === 0 ? (
              <View style={styles.center}>
                <IconSymbol name="tshirt.fill" size={48} color={colors.icon} />
                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                  No wardrobe items yet. Try the Catalog tab.
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
                      style={styles.pickerCardImage}
                      contentFit="cover"
                    />
                    <Text style={[styles.pickerCardName, { color: colors.text }]} numberOfLines={1}>
                      {item.category || 'Item'}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )
          ) : (
            <FlatList
              data={sortedCatalogItems}
              keyExtractor={(i) => i.id}
              numColumns={2}
              contentContainerStyle={styles.pickerGrid}
              columnWrapperStyle={styles.pickerRow}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pickerCard, { backgroundColor: colors.card }]}
                  onPress={() => selectCatalogItem(item)}
                  activeOpacity={0.8}
                >
                  <Image
                    source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
                    style={styles.pickerCardImage}
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
      <Modal visible={saveVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.saveOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.saveSheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.saveTitle, { color: colors.text }]}>Name Your Outfit</Text>
            <TextInput
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
                  <ActivityIndicator color="#0D0D0D" />
                ) : (
                  <Text style={styles.confirmBtnText}>Save Outfit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  saveHeaderBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
  },
  saveHeaderBtnText: { color: '#0D0D0D', fontWeight: '800', fontSize: 14 },
  previewStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  previewThumb: { width: 44, height: 52, borderRadius: 8, overflow: 'hidden' },
  previewThumbImage: { width: '100%', height: '100%' },
  previewThumbEmpty: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCount: { fontSize: 12, fontWeight: '600', marginLeft: 'auto' },
  colorHarmonyBadge: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    gap: 4,
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
  slotsList: { paddingHorizontal: 16, paddingTop: 8 },
  slotRow: { marginBottom: 12 },
  slotLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  slotLabelText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  slotFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
    paddingRight: 12,
  },
  slotImage: { width: 72, height: 80 },
  slotItemInfo: { flex: 1 },
  slotItemName: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  slotChange: { fontSize: 12, marginTop: 2 },
  removeBtn: { padding: 4 },
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
    padding: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginHorizontal: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 15, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  pickerGrid: { padding: 16, paddingBottom: 40 },
  pickerRow: { justifyContent: 'space-between', marginBottom: 12 },
  pickerCard: {
    width: PICKER_CARD,
    borderRadius: 12,
    overflow: 'hidden',
  },
  pickerCardImage: { width: '100%', aspectRatio: 1, backgroundColor: '#2A2A2A' },
  pickerCardName: { fontSize: 12, fontWeight: '600', padding: 8 },
  // Save modal
  saveOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  saveSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
  },
  saveTitle: { fontSize: 20, fontWeight: '700' },
  saveInput: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  saveActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: { fontWeight: '600', fontSize: 15 },
  confirmBtn: {
    flex: 2,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtnText: { color: '#0D0D0D', fontWeight: '800', fontSize: 15 },
});
