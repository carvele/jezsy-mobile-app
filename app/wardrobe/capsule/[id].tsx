import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Database } from '@/src/types/database.types';

type Capsule = Database['public']['Tables']['capsules']['Row'];
type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export default function CapsuleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
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

  const fetchCapsule = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [{ data: capsuleData, error: capsuleError }, { data: itemRows, error: itemError }] = await Promise.all([
        supabase.from('capsules').select('*').eq('id', id).single(),
        supabase
          .from('capsule_items')
          .select('wardrobe_items(*)')
          .eq('capsule_id', id),
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
        .order('created_at', { ascending: false });
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
      Alert.alert('Error', 'Could not add this item. Please try again.');
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
      Alert.alert('Error', 'Could not remove this item. Please try again.');
    }
  };

  const handleDeleteCapsule = () => {
    if (!capsule) return;
    Alert.alert('Delete Capsule', `Delete "${capsule.name}"? Items stay in your wardrobe.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await supabase.from('capsules').delete().eq('id', capsule.id);
            if (error) throw error;
            router.back();
          } catch (err) {
            console.error('Error deleting capsule:', err);
            Alert.alert('Error', 'Could not delete this capsule. Please try again.');
            setDeleting(false);
          }
        },
      },
    ]);
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
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
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
                  <Text style={[styles.itemLabel, { color: colors.secondaryText }]}>{item.garment_type || item.category || 'Item'}</Text>
                </View>
              </View>
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
                        <IconSymbol name="checkmark" size={16} color="#0D0D0D" />
                      </View>
                    )}
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemLabel, { color: colors.secondaryText }]}>{item.garment_type || item.category || 'Item'}</Text>
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
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  iconBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  content: { padding: 20, paddingBottom: 60 },
  description: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  progressLabel: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 20 },
  progressFill: { height: '100%', borderRadius: 4 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: 24,
  },
  addButtonText: { fontSize: 15, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  itemCard: {
    width: '48%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  itemImage: { width: '100%', height: 160 },
  itemInfo: { padding: 10 },
  itemLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  removeBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
  },
  checkOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContent: { padding: 20, paddingBottom: 60 },
  pickerCard: {
    width: '48%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    marginBottom: 16,
  },
});
