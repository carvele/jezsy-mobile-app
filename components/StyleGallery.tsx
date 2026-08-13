import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Colors, Spacing, Type as Typography } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.md) / 2;

export interface StylePose {
  id: string;
  name: string;
  category: string;
  image_url: string | null;
  description: string | null;
  occasion: string | null;
  difficulty: string | null;
  is_featured: boolean | null;
  base_pose_type: string | null;
}

const OCCASIONS = ['All', 'Party', 'Formal', 'Wedding', 'Date Night', 'Casual', 'Festival'];

export function StyleGallery() {
  const router = useRouter();
  const [poses, setPoses] = useState<StylePose[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOccasion, setSelectedOccasion] = useState('All');

  useEffect(() => {
    fetchStylePoses();
  }, []);

  const fetchStylePoses = async () => {
    try {
      setLoading(true);
      let { data, error } = await supabase
        .from('pose_guides')
        .select('*')
        .eq('deleted', false)
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false });

      if (error && (error as any).code === '42703') {
        const fallback = await supabase
          .from('pose_guides')
          .select('*')
          .eq('deleted', false)
          .order('created_at', { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;
      setPoses((data as StylePose[]) || []);
    } catch (e) {
      console.error('Error fetching style poses:', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredPoses = poses.filter((p) => {
    if (selectedOccasion === 'All') return true;
    return p.occasion?.toLowerCase() === selectedOccasion.toLowerCase();
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={Colors.light.tint} />
      </View>
    );
  }

  if (poses.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.sectionTitle}>✨ Style Inspiration</Text>
          <Text style={styles.sectionSubtitle}>Recreate styled poses & try the look</Text>
        </View>
      </View>

      {/* Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContainer}
      >
        {OCCASIONS.map((occ) => {
          const isActive = selectedOccasion === occ;
          return (
            <TouchableOpacity
              key={occ}
              style={[styles.chip, isActive && styles.activeChip]}
              onPress={() => setSelectedOccasion(occ)}
            >
              <Text style={[styles.chipText, isActive && styles.activeChipText]}>
                {occ}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Poses Horizontal Scroll Feed */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollFeed}
      >
        {filteredPoses.map((pose) => (
          <TouchableOpacity
            key={pose.id}
            style={styles.card}
            activeOpacity={0.88}
            onPress={() => router.push(`/style-pose/${pose.id}` as any)}
          >
            <View style={styles.imageContainer}>
              {pose.image_url ? (
                <Image
                  source={{ uri: pose.image_url }}
                  style={styles.image}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={styles.placeholderImage}>
                  <IconSymbol name="camera.fill" size={32} color={Colors.light.tabIconDefault} />
                </View>
              )}
              {pose.occasion && (
                <View style={styles.occasionBadge}>
                  <Text style={styles.occasionText}>{pose.occasion}</Text>
                </View>
              )}
              <View style={styles.tryBadge}>
                <IconSymbol name="sparkles" size={12} color="#FFF" />
                <Text style={styles.tryBadgeText}>Try Look</Text>
              </View>
            </View>

            <View style={styles.cardBody}>
              <Text style={styles.poseName} numberOfLines={1}>
                {pose.name}
              </Text>
              <View style={styles.metaRow}>
                {pose.difficulty && (
                  <Text style={styles.difficultyText}>
                    {pose.difficulty === 'easy' ? '● Easy' : pose.difficulty === 'intermediate' ? '●● Medium' : '●●● Pro'}
                  </Text>
                )}
                <Text style={styles.tagText}>{pose.category || 'Style Hint'}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        {filteredPoses.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No style poses for &quot;{selectedOccasion}&quot;</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.md,
  },
  loadingContainer: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontWeight: '700',
    color: Colors.light.text,
  },
  sectionSubtitle: {
    ...Typography.caption,
    color: Colors.light.tabIconDefault,
    marginTop: 2,
  },
  chipsContainer: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  activeChip: {
    backgroundColor: Colors.light.tint,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  activeChipText: {
    color: '#FFFFFF',
  },
  scrollFeed: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  imageContainer: {
    width: '100%',
    height: 180,
    backgroundColor: '#1E293B',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  occasionBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  occasionText: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '700',
  },
  tryBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tryBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  cardBody: {
    padding: Spacing.sm,
  },
  poseName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  difficultyText: {
    fontSize: 10,
    color: '#059669',
    fontWeight: '600',
  },
  tagText: {
    fontSize: 10,
    color: Colors.light.tabIconDefault,
  },
  emptyContainer: {
    width: SCREEN_WIDTH - Spacing.lg * 2,
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.light.tabIconDefault,
  },
});
