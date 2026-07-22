import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import { Image } from 'expo-image';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';

type SavedOutfit = Database['public']['Tables']['saved_outfits']['Row'];
type OutfitSlotItem = {
  slot: string;
  product_id: string | null;
  image_url: string;
  name: string;
  color_tags?: string[];
};

const SLOT_LABELS: Record<string, string> = {
  top: 'Top',
  bottom: 'Bottom',
  outerwear: 'Outerwear',
  shoes: 'Shoes',
  accessory: 'Accessory',
};

export default function OutfitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  const [outfit, setOutfit] = useState<SavedOutfit | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const fetchOutfit = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.from('saved_outfits').select('*').eq('id', id).single();
      if (error) throw error;
      setOutfit(data);
    } catch (err) {
      console.error('Error fetching outfit:', err);
      setOutfit(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchOutfit();
  }, [fetchOutfit]);

  const handleDelete = () => {
    if (!outfit) return;
    Alert.alert('Delete Outfit', `Delete "${outfit.name || 'this outfit'}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await supabase
              .from('saved_outfits')
              .update({ deleted: true })
              .eq('id', outfit.id);
            if (error) throw error;
            router.back();
          } catch (err) {
            console.error('Error deleting outfit:', err);
            Alert.alert('Error', 'Could not delete this outfit. Please try again.');
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

  if (!outfit) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Outfit not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const items: OutfitSlotItem[] = Array.isArray(outfit.items) ? (outfit.items as unknown as OutfitSlotItem[]) : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{outfit.name || 'Outfit'}</Text>
        <TouchableOpacity
          onPress={handleDelete}
          disabled={deleting}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Delete outfit"
        >
          <IconSymbol name="trash.fill" size={20} color="#FF453A" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.itemCount, { color: colors.secondaryText }]}>{items.length} item{items.length === 1 ? '' : 's'}</Text>

        <View style={styles.grid}>
          {items.map((slotItem, index) => {
            const card = (
              <View style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Image source={{ uri: slotItem.image_url }} style={styles.itemImage} contentFit="cover" />
                <View style={styles.itemInfo}>
                  <Text style={[styles.slotLabel, { color: colors.tint }]}>
                    {SLOT_LABELS[slotItem.slot] || slotItem.slot}
                  </Text>
                  <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>{slotItem.name}</Text>
                </View>
              </View>
            );
            return slotItem.product_id ? (
              <Link key={index} href={`/product/${slotItem.product_id}`} asChild>
                <TouchableOpacity activeOpacity={0.85}>{card}</TouchableOpacity>
              </Link>
            ) : (
              <View key={index}>{card}</View>
            );
          })}
        </View>
      </ScrollView>
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
  itemCount: { fontSize: 14, marginBottom: 16 },
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
  itemImage: {
    width: '100%',
    height: 180,
  },
  itemInfo: {
    padding: 12,
  },
  slotLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
  },
});
