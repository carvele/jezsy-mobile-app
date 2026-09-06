import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal, FlatList, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Database } from '@/src/types/database.types';
import { generateOutfits, GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';
import { FadeInView } from '@/src/components/FadeInView';
import { FlourishDivider } from '@/src/components/BrandFlourish';
import { useToast } from '@/src/context/ToastContext';

type Capsule = Database['public']['Tables']['capsules']['Row'];
type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export default function CapsuleDetailScreen() {
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { session } = useAuth();

  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [capsuleItems, setCapsuleItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [allItems, setAllItems] = useState<WardrobeItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const capsuleCombinations = useMemo(() => generateOutfits(capsuleItems, 4), [capsuleItems]);

  const handleSaveCombination = useCallback(async (outfit: GeneratedOutfit) => {
    if (!session?.user?.id) return;
    setSavingKey(outfit.key);
    try {
      const payload = outfit.items.map((i) => ({
        slot: (i.garment_type || 'accessory').toLowerCase(),
        product_id: i.product_id,
        image_url: i.image_url,
        name: i.garment_type || i.category || 'Item',
        color_tags: i.color_tags,
        owned: true,
      }));
      const { error } = await supabase.from('saved_outfits').insert({
        user_id: session.user.id,
        name: `${capsule?.name || 'Capsule'} look`,
        items: payload,
      });
      if (error) throw error;
      showToast('Look saved to your outfits.', 'success');
    } catch (err) {
      console.error('Error saving capsule look:', err);
      showToast('Could not save that look. Please try again.', 'error');
    } finally {
      setSavingKey(null);
    }
  }, [session?.user?.id, capsule?.name, showToast]);

  const fetchCapsule = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [{ data: capsuleData, error: capsuleError }, { data: itemRows, error: itemError }] = await Promise.all([
        supabase.from('capsules').select('*').eq('id', id).single(),
        supabase
          .from('capsule_items')
          .select('wardrobe_items!inner(*)')
          .eq('capsule_id', id)
          .eq('wardrobe_items.deleted', false),
      ]);
      if (capsuleError) throw capsuleError;
      if (itemError) throw itemError;
      setCapsule(capsuleData);
      const items = (itemRows || [])
        .map((row: any) => row.wardrobe_items)
        .filter((item: WardrobeItem | null): item is WardrobeItem => item != null);
      setCapsuleItems(items);
    } catch (err) {
      console.error('Error fetching capsule:', err);
      setCapsule(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCapsule();
  }, [fetchCapsule]);

  const openPicker = async () => {
    if (!session?.user?.id) return;
    setPickerVisible(true);
    setPickerLoading(true);
    try {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setAllItems(data || []);
    } catch (err) {
      console.error('Error fetching wardrobe items:', err);
    } finally {
      setPickerLoading(false);
    }
  };

  const capsuleItemIds = new Set(capsuleItems.map((i) => i.id));

  const handleAddItem = async (item: WardrobeItem) => {
    if (!id) return;
    setAddingId(item.id);
    try {
      const { error } = await supabase.from('capsule_items').insert({
        capsule_id: id,
        wardrobe_item_id: item.id,
      });
      if (error) throw error;
      setCapsuleItems((prev) => [...prev, item]);
    } catch (err) {
      console.error('Error adding item to capsule:', err);
      showToast('Could not add this item. Please try again.', 'error');
    } finally {
      setAddingId(null);
    }
  };

  const handleRemoveItem = async (item: WardrobeItem) => {
    if (!id) return;
    try {
      const { error } = await supabase
        .from('capsule_items')
        .delete()
        .eq('capsule_id', id)
        .eq('wardrobe_item_id', item.id);
      if (error) throw error;
      setCapsuleItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      console.error('Error removing item from capsule:', err);
      showToast('Could not remove this item. Please try again.', 'error');
    }
  };

  const executeDeleteCapsule = async () => {
    if (!capsule) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('capsules').delete().eq('id', capsule.id);
      if (error) throw error;
      showToast('Capsule deleted.', 'info');
      router.back();
    } catch (err) {
      console.error('Error deleting capsule:', err);
      showToast('Could not delete this capsule. Please try again.', 'error');
      setDeleting(false);
    }
  };

  const handleDeleteCapsule = () => {
    if (!capsule) return;
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm(`Delete "${capsule.name}"? Items stay in your wardrobe.`) : true;
      if (confirmed) {
        executeDeleteCapsule();
      }
    } else {
      Alert.alert('Delete Capsule', `Delete "${capsule.name}"? Items stay in your wardrobe.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: executeDeleteCapsule,
        },
      ]);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!capsule) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Capsule not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: Spacing.xl }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const target = capsule.target_count || 30;
  const progress = Math.min(capsuleItems.length / target, 1);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{capsule.name}</Text>
        <TouchableOpacity
          onPress={handleDeleteCapsule}
          disabled={deleting}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Delete capsule"
        >
          <IconSymbol name="trash.fill" size={20} color="#FF453A" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {capsule.description && (
          <Text style={[styles.description, { color: colors.secondaryText }]}>{capsule.description}</Text>
        )}

        <Text style={[styles.progressLabel, { color: colors.tint }]}>{capsuleItems.length} / {target} items</Text>
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.tint }]} />
        </View>

        <TouchableOpacity
          style={[styles.addButton, { borderColor: colors.tint }]}
          onPress={openPicker}
          accessibilityRole="button"
          accessibilityLabel="Add items to this capsule"
        >
          <IconSymbol name="plus" size={18} color={colors.tint} />
          <Text style={[styles.addButtonText, { color: colors.tint }]}>Add Items</Text>
        </TouchableOpacity>

        {capsuleItems.length === 0 ? (
          <View style={styles.emptyState}>
            <IconSymbol name="archivebox" size={48} color={colors.secondaryText} />
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No items in this capsule yet.</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {capsuleItems.map((item) => (
              <View key={item.id} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Image source={{ uri: item.image_url || undefined }} style={[styles.itemImage, { backgroundColor: colors.surface }]} contentFit="cover" />
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleRemoveItem(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.garment_type || item.category || 'item'} from capsule`}
                >
                  <IconSymbol name="xmark.circle" size={22} color="#fff" />
                </TouchableOpacity>
                <View style={styles.itemInfo}>
                  <Text style={[styles.itemLabel, { color: colors.secondaryText }]} numberOfLines={1}>{item.garment_type || item.category || 'Item'}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* The point of a capsule is how many looks a small set yields, so the
            combinations it unlocks belong here rather than only in the
            wardrobe tab. */}
        {capsuleCombinations.length > 0 && (
          <View style={styles.combinationsBlock}>
            <View style={styles.dividerWrap}>
              <FlourishDivider color={colors.tint} width={140} />
            </View>
            <Text style={[styles.combinationsTitle, { color: colors.text }]}>
              {capsuleCombinations.length} look{capsuleCombinations.length === 1 ? '' : 's'} from these pieces
            </Text>
            <Text style={[styles.combinationsSub, { color: colors.secondaryText }]}>
              Scored on colour harmony within the capsule.
            </Text>
            {capsuleCombinations.map((o, i) => (
              <FadeInView key={o.key} index={i}>
                <SuggestedOutfitCard outfit={o} onSave={handleSaveCombination} saving={savingKey === o.key} />
              </FadeInView>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View style={{ width: 32 }} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>Add to Capsule</Text>
            <TouchableOpacity onPress={() => setPickerVisible(false)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Done">
              <Text style={{ color: colors.tint, fontWeight: '700' }}>Done</Text>
            </TouchableOpacity>
          </View>
          {pickerLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : (
            <FlatList
              data={allItems}
              keyExtractor={(item) => item.id}
              numColumns={2}
              contentContainerStyle={styles.pickerContent}
              columnWrapperStyle={{ justifyContent: 'space-between' }}
              renderItem={({ item }) => {
                const inCapsule = capsuleItemIds.has(item.id);
                return (
                  <TouchableOpacity
                    style={[styles.pickerCard, { backgroundColor: colors.card, borderColor: inCapsule ? colors.tint : colors.border }]}
                    onPress={() => (inCapsule ? handleRemoveItem(item) : handleAddItem(item))}
                    disabled={addingId === item.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: inCapsule }}
                  >
                    <Image source={{ uri: item.image_url || undefined }} style={[styles.itemImage, { backgroundColor: colors.surface }]} contentFit="cover" />
                    {inCapsule && (
                      <View style={[styles.checkOverlay, { backgroundColor: colors.tint }]}>
                        <IconSymbol name="checkmark" size={16} color={colors.onTint} />
                      </View>
                    )}
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemLabel, { color: colors.secondaryText }]} numberOfLines={1}>{item.garment_type || item.category || 'Item'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={[styles.emptyText, { color: colors.secondaryText }]}>Your wardrobe is empty. Add items first.</Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  iconBtn: { padding: Spacing.xs },
  headerTitle: { ...Type.subtitle, fontWeight: '700', flex: 1, textAlign: 'center' },
  content: { padding: Spacing.xl, paddingBottom: 60 },
  description: { ...Type.body, marginBottom: Spacing.lg, lineHeight: 20 },
  progressLabel: { ...Type.bodyStrong, fontWeight: '700', marginBottom: Spacing.sm },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: Spacing.xl },
  progressFill: { height: '100%', borderRadius: 4 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radius.xl,
    borderWidth: 1,
    marginBottom: Spacing.xxl,
  },
  addButtonText: { ...Type.bodyStrong, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: Spacing.md },
  combinationsBlock: { marginTop: Spacing.sm },
  dividerWrap: { alignItems: 'center', marginBottom: Spacing.lg },
  combinationsTitle: { ...Type.subtitle, fontWeight: '700', marginBottom: Spacing.xs },
  combinationsSub: { ...Type.body, lineHeight: 21, marginBottom: Spacing.lg },
  emptyText: { ...Type.bodyStrong, textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: Spacing.lg,
  },
  itemCard: {
    width: '48%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
  },
  itemImage: { width: '100%', height: 160 },
  itemInfo: { padding: 10 },
  itemLabel: { ...Type.caption, fontWeight: '600', textTransform: 'uppercase' },
  removeBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.md,
  },
  checkOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContent: { padding: Spacing.xl, paddingBottom: 60 },
  pickerCard: {
    width: '48%',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 2,
    marginBottom: Spacing.lg,
  },
});
