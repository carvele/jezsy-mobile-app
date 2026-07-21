import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

export default function WardrobeItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  const [item, setItem] = useState<WardrobeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      setItem(data);
    } catch (err) {
      console.error('Error fetching wardrobe item:', err);
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const handleLogWear = async () => {
    if (!item) return;
    setLogging(true);
    try {
      const { data, error } = await supabase
        .from('wardrobe_items')
        .update({ wear_count: item.wear_count + 1, last_worn_at: new Date().toISOString() })
        .eq('id', item.id)
        .select('*')
        .single();
      if (error) throw error;
      setItem(data);
    } catch (err) {
      console.error('Error logging wear:', err);
      Alert.alert('Error', 'Could not log this wear. Please try again.');
    } finally {
      setLogging(false);
    }
  };

  const handleDelete = () => {
    if (!item) return;
    Alert.alert('Remove Item', 'Remove this item from your digital wardrobe?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await supabase
              .from('wardrobe_items')
              .update({ deleted: true })
              .eq('id', item.id);
            if (error) throw error;
            router.back();
          } catch (err) {
            console.error('Error deleting wardrobe item:', err);
            Alert.alert('Error', 'Could not remove this item. Please try again.');
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

  if (!item) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Item not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const wearLabel =
    item.wear_count === 0
      ? 'Never worn'
      : `Worn ${item.wear_count} time${item.wear_count === 1 ? '' : 's'}${item.last_worn_at ? ` · last worn ${timeAgo(item.last_worn_at)}` : ''}`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Item Details</Text>
        <TouchableOpacity
          onPress={handleDelete}
          disabled={deleting}
          style={styles.deleteButton}
          accessibilityRole="button"
          accessibilityLabel="Remove item from wardrobe"
        >
          <IconSymbol name="trash.fill" size={20} color="#FF453A" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image
          source={{ uri: item.image_url || undefined }}
          style={[styles.image, { backgroundColor: colors.card }]}
          contentFit="contain"
        />

        <View style={styles.tagsRow}>
          {item.garment_type && (
            <View style={[styles.tag, { backgroundColor: colors.tint }]}>
              <Text style={styles.tagText}>{item.garment_type}</Text>
            </View>
          )}
          {item.category && (
            <View style={[styles.tag, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
              <Text style={[styles.tagText, { color: colors.text }]}>{item.category}</Text>
            </View>
          )}
        </View>

        {item.sub_category && (
          <Text style={[styles.subCategory, { color: colors.secondaryText }]}>{item.sub_category}</Text>
        )}

        {item.color_tags && item.color_tags.length > 0 && (
          <View style={styles.colorsRow}>
            {item.color_tags.map((c) => (
              <View key={c} style={[styles.colorChip, { borderColor: colors.border }]}>
                <Text style={[styles.colorChipText, { color: colors.text }]}>{c}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.wearCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="chart.bar.fill" size={20} color={colors.tint} />
          <Text style={[styles.wearLabel, { color: colors.text }]}>{wearLabel}</Text>
        </View>

        <TouchableOpacity
          style={[styles.logButton, { backgroundColor: colors.tint, opacity: logging ? 0.6 : 1 }]}
          onPress={handleLogWear}
          disabled={logging}
          accessibilityRole="button"
          accessibilityLabel="Log a wear for this item"
        >
          {logging ? (
            <ActivityIndicator color="#0D0D0D" size="small" />
          ) : (
            <>
              <IconSymbol name="checkmark" size={18} color="#0D0D0D" />
              <Text style={styles.logButtonText}>Log Wear (Wearing Today)</Text>
            </>
          )}
        </TouchableOpacity>
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
  },
  backButton: { padding: 4 },
  deleteButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 60 },
  image: {
    width: '100%',
    height: 380,
    borderRadius: 16,
    marginBottom: 20,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0D0D0D',
  },
  subCategory: {
    fontSize: 14,
    marginBottom: 16,
  },
  colorsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  colorChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  colorChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  wearCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  wearLabel: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: 28,
  },
  logButtonText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  },
});
