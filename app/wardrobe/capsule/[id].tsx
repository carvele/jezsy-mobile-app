import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal, FlatList, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { outfitService, wardrobeService } from '@/src/services';
import { useAuth } from '@/src/context/AuthContext';
import { Database } from '@/src/types/database.types';
import { generateOutfits, GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';
import { FadeInView } from '@/src/components/FadeInView';
import { FlourishDivider } from '@/src/components/BrandFlourish';
import { useToast } from '@/src/context/ToastContext';
import { ConfirmModal } from '@/src/components/ConfirmModal';

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
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [savedSignatures, setSavedSignatures] = useState<Set<string>>(new Set());
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  const capsuleCombinations = useMemo(() => generateOutfits(capsuleItems, 4), [capsuleItems]);

  // Saved-outfit rows only carry image_url per item (product_id is often
  // null for wardrobe-only pieces), so that's the one field reliably present
  // on both sides to match a generated combo against an already-saved look.
  const signatureOf = (items: { image_url?: string | null }[]) =>
    items.map((i) => i.image_url).filter(Boolean).sort().join('|');

  const fetchSavedSignatures = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase
      .from('saved_outfits')
      .select('items')
      .eq('user_id', session.user.id)
      .eq('deleted', false);
    if (error) {
      console.error('Error fetching saved outfits for dedup:', error);
      return;
    }
    const signatures = new Set(
      (data || []).map((row) => signatureOf(Array.isArray(row.items) ? (row.items as any[]) : []))
    );
    setSavedSignatures(signatures);
  }, [session?.user?.id]);

  useEffect(() => {
    fetchSavedSignatures();
  }, [fetchSavedSignatures]);

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
      const result = await outfitService.saveOutfit({
        userId: session.user.id,
        name: `${capsule?.name || 'Collection'} look`,
        items: payload,
      });
      if (!result.ok) throw result.error;
      showToast('Look saved to your outfits.', 'success');
      fetchSavedSignatures();
    } catch (err) {
      console.error('Error saving capsule look:', err);
      showToast('Could not save that look. Please try again.', 'error');
    } finally {
      setSavingKey(null);
    }
  }, [session?.user?.id, capsule?.name, showToast, fetchSavedSignatures]);

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
      const result = await wardrobeService.addCapsuleItem({
        capsuleId: id,
        wardrobeItemId: item.id,
      });
      if (!result.ok) throw result.error;
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
      const result = await wardrobeService.removeCapsuleItem({
        capsuleId: id,
        wardrobeItemId: item.id,
      });
      if (!result.ok) throw result.error;
      setCapsuleItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      console.error('Error removing item from capsule:', err);
      showToast('Could not remove this item. Please try again.', 'error');
    }
  };

  const startEditingGoal = () => {
    setGoalInput(String(capsule?.target_count || 30));
    setEditingGoal(true);
  };

  const saveGoal = async () => {
    if (!capsule) return;
    const parsed = parseInt(goalInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showToast('Goal must be a positive number.', 'error');
      return;
    }
    setSavingGoal(true);
    try {
      const result = await wardrobeService.updateCapsuleGoal(capsule.id, parsed);
      if (!result.ok) throw result.error;
      setCapsule((prev) => (prev ? { ...prev, target_count: parsed } : prev));
      setEditingGoal(false);
      showToast('Goal updated.', 'success');
    } catch (err) {
      console.error('Error updating capsule goal:', err);
      showToast('Could not update the goal. Please try again.', 'error');
    } finally {
      setSavingGoal(false);
    }
  };

  const executeDeleteCapsule = async () => {
    if (!capsule) return;
    setDeleting(true);
    try {
      const result = await wardrobeService.deleteCapsule(capsule.id);
      if (!result.ok) throw result.error;
      showToast('Collection deleted.', 'info');
      router.back();
    } catch (err) {
      console.error('Error deleting capsule:', err);
      showToast('Could not delete this collection. Please try again.', 'error');
      setDeleting(false);
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
        <Text style={{ color: colors.text }}>Collection not found.</Text>
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
          onPress={() => setConfirmDeleteVisible(true)}
          disabled={deleting}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Delete collection"
        >
          <IconSymbol name="trash.fill" size={20} color="#FF453A" />
        </TouchableOpacity>
      </View>

      <ConfirmModal
        visible={confirmDeleteVisible}
        title="Delete Collection"
        message={`Delete "${capsule.name}"? Items stay in your wardrobe.`}
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteVisible(false)}
        onConfirm={() => {
          setConfirmDeleteVisible(false);
          executeDeleteCapsule();
        }}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {capsule.description && (
          <Text style={[styles.description, { color: colors.secondaryText }]}>{capsule.description}</Text>
        )}

        {/* target_count is a personal styling goal the user set when
            creating the collection, not an enforced cap -- adding past it
            is always allowed, the bar just fills past 100%. Editable here
            in case they under- or over-estimated it at creation time. */}
        {editingGoal ? (
          <View style={styles.goalEditRow}>
            <Text style={[styles.progressLabel, { color: colors.tint }]}>Goal:</Text>
            <TextInput keyboardAppearance={theme}
              style={[styles.goalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              value={goalInput}
              onChangeText={(t) => setGoalInput(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              autoFocus
              maxLength={4}
            />
            <TouchableOpacity onPress={saveGoal} disabled={savingGoal} accessibilityRole="button" accessibilityLabel="Save goal">
              {savingGoal ? <ActivityIndicator size="small" color={colors.tint} /> : <IconSymbol name="checkmark" size={18} color={colors.tint} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditingGoal(false)} accessibilityRole="button" accessibilityLabel="Cancel editing goal">
              <IconSymbol name="xmark" size={18} color={colors.secondaryText} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={startEditingGoal} style={styles.goalEditRow} accessibilityRole="button" accessibilityLabel="Edit item goal">
            <Text style={[styles.progressLabel, { color: colors.tint }]}>Goal: {capsuleItems.length} of {target} items</Text>
            <IconSymbol name="pencil" size={14} color={colors.secondaryText} />
          </TouchableOpacity>
        )}
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.tint }]} />
        </View>

        <TouchableOpacity
          style={[styles.addButton, { borderColor: colors.tint }]}
          onPress={openPicker}
          accessibilityRole="button"
          accessibilityLabel="Add items to this collection"
        >
          <IconSymbol name="plus" size={18} color={colors.tint} />
          <Text style={[styles.addButtonText, { color: colors.tint }]}>Add Items</Text>
        </TouchableOpacity>

        {capsuleItems.length === 0 ? (
          <View style={styles.emptyState}>
            <IconSymbol name="archivebox" size={48} color={colors.secondaryText} />
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No items in this collection yet.</Text>
          </View>
        ) : (
          // Vertical wrapping grid, not a horizontal strip: unlike an
          // outfit's fixed handful of pieces, a collection can reasonably
          // hold 20-30+ items -- side-scrolling through all of them would
          // be worse than what this replaced, not better.
          <View style={styles.grid}>
            {capsuleItems.map((item) => (
              <View key={item.id} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Image source={{ uri: item.image_url || undefined }} style={[styles.itemImage, { backgroundColor: colors.surface }]} contentFit="cover" />
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleRemoveItem(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.garment_type || item.category || 'item'} from collection`}
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
              Scored on colour harmony within the collection.
            </Text>
            {capsuleCombinations.map((o, i) => (
              <FadeInView key={o.key} index={i}>
                <SuggestedOutfitCard
                  outfit={o}
                  onSave={handleSaveCombination}
                  saving={savingKey === o.key}
                  alreadySaved={savedSignatures.has(signatureOf(o.items))}
                />
              </FadeInView>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View style={{ width: 32 }} />
            <Text style={[styles.headerTitle, { color: colors.text }]}>Add to Collection</Text>
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
  progressLabel: { ...Type.bodyStrong, fontWeight: '700' },
  goalEditRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  goalInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    minWidth: 50,
    fontSize: 15,
    fontWeight: '700',
  },
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
