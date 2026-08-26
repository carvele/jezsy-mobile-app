import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { useToast } from '@/src/context/ToastContext';

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
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useColorScheme();
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
      const now = new Date();
      const lastWorn = item.last_worn_at ? new Date(item.last_worn_at) : null;
      let newStreak = (item as any).current_streak || 1;

      if (lastWorn) {
        const diffMs = now.getTime() - lastWorn.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          newStreak += 1;
        } else if (diffDays > 1) {
          newStreak = 1;
        }
      } else {
        newStreak = 1;
      }

      const { data, error } = await supabase
        .from('wardrobe_items')
        .update({
          wear_count: item.wear_count + 1,
          last_worn_at: now.toISOString(),
          current_streak: newStreak,
          longest_streak: Math.max(newStreak, (item as any).longest_streak || 0),
        } as any)
        .eq('id', item.id)
        .select('*')
        .single();
      if (error) throw error;
      setItem(data);
      showToast(`Logged! 🔥 ${newStreak}-day wear streak`, 'success');
    } catch (err) {
      console.error('Error logging wear:', err);
      showToast('Could not log this wear. Please try again.', 'error');
    } finally {
      setLogging(false);
    }
  };

  const executeDelete = async () => {
    if (!item) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('wardrobe_items')
        .update({ deleted: true })
        .eq('id', item.id);
      if (error) throw error;
      showToast('Item removed from wardrobe.', 'info');
      router.back();
    } catch (err) {
      console.error('Error deleting wardrobe item:', err);
      showToast('Could not remove this item. Please try again.', 'error');
      setDeleting(false);
    }
  };

  const handleDelete = () => {
    if (!item) return;
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' ? window.confirm('Remove this item from your digital wardrobe?') : true;
      if (confirmed) {
        executeDelete();
      }
    } else {
      Alert.alert('Remove Item', 'Remove this item from your digital wardrobe?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: executeDelete,
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

  if (!item) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Item not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: Spacing.xl }}>
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Item Details</Text>
        <TouchableOpacity
          onPress={handleDelete}
          style={styles.deleteButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel="Delete this item"
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.notification} />
          ) : (
            <IconSymbol name="trash.fill" size={20} color={colors.notification} />
          )}
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
              <Text style={[styles.tagText, { color: colors.onTint }]}>{item.garment_type}</Text>
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

        <View style={styles.wearRow}>
          <View style={[styles.wearCard, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
            <IconSymbol name="chart.bar.fill" size={20} color={colors.tint} />
            <Text style={[styles.wearLabel, { color: colors.text }]}>{wearLabel}</Text>
          </View>
          <View style={[styles.wearCard, { backgroundColor: colors.card, borderColor: colors.border, marginLeft: Spacing.sm }]}>
            <Text style={{ fontSize: 18 }}>🔥</Text>
            <Text style={[styles.wearLabel, { color: colors.text }]}>
              {(item as any).current_streak || 0}d streak
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.logButton, { backgroundColor: colors.tint, opacity: logging ? 0.6 : 1 }]}
          onPress={handleLogWear}
          disabled={logging}
          accessibilityRole="button"
          accessibilityLabel="Log a wear for this item"
        >
          {logging ? (
            <ActivityIndicator color={colors.onTint} size="small" />
          ) : (
            <>
              <IconSymbol name="checkmark" size={18} color={colors.onTint} />
              <Text style={[styles.logButtonText, { color: colors.onTint }]}>Log Wear (Wearing Today)</Text>
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButton: { padding: Spacing.xs },
  deleteButton: { padding: Spacing.xs },
  headerTitle: { ...Type.subtitle, fontWeight: '700' },
  content: { padding: Spacing.xl, paddingBottom: 60 },
  image: {
    width: '100%',
    height: 380,
    borderRadius: Radius.lg,
    marginBottom: Spacing.xl,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  tag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.lg,
  },
  tagText: {
    ...Type.caption,
    fontWeight: '700',
  },
  subCategory: {
    ...Type.body,
    marginBottom: Spacing.lg,
  },
  colorsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.xxl,
  },
  colorChip: {
    paddingHorizontal: 10,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  colorChipText: {
    ...Type.caption,
    fontWeight: '600',
  },
  wearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  wearCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  wearLabel: {
    ...Type.bodyStrong,
    fontWeight: '600',
    flexShrink: 1,
  },
  logButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    borderRadius: Radius.pill,
  },
  logButtonText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
});
