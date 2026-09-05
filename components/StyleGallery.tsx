import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { ProductCardSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Colors, Spacing, Type as Typography } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
  const { width } = useWindowDimensions();
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  
  // Don't stretch horizontally to fill half of an iPad screen
  const cardWidth = Math.min(220, (width - Spacing.lg * 2 - Spacing.md) / 2);
  const cardHeight = cardWidth / (3 / 4); // Standard 3:4 aspect ratio for clothing

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md }}>
        <View style={{ flexDirection: 'row', gap: Spacing.md }}>
          <SkeletonList count={4}>
            <ProductCardSkeleton width={cardWidth} />
          </SkeletonList>
        </View>
      </ScrollView>
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
          <Text style={[styles.sectionTitle, { color: colors.text }]}>✨ Style Inspiration</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.tabIconDefault }]}>Recreate styled poses & try the look</Text>
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
              style={[styles.chip, { backgroundColor: colors.surface }, isActive && { backgroundColor: colors.tint }]}
              onPress={() => setSelectedOccasion(occ)}
            >
              <Text style={[styles.chipText, { color: colors.secondaryText }, isActive && { color: colors.onTint }]}>
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
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, width: cardWidth }]}
            activeOpacity={0.88}
            onPress={() => router.push(`/style-pose/${pose.id}` as any)}
          >
            <View style={[styles.imageContainer, { backgroundColor: colors.imagePlaceholder, height: cardHeight }]}>
              {pose.image_url ? (
                <Image
                  source={{ uri: pose.image_url }}
                  style={styles.image}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={styles.placeholderImage}>
                  <IconSymbol name="camera.fill" size={32} color={colors.tabIconDefault} />
                </View>
              )}
              {pose.occasion && (
                <View style={styles.occasionBadge}>
                  <Text style={styles.occasionText}>{pose.occasion}</Text>
                </View>
              )}
              <View style={[styles.tryBadge, { backgroundColor: colors.tint }]}>
                <IconSymbol name="sparkles" size={12} color={colors.onTint} />
                <Text style={[styles.tryBadgeText, { color: colors.onTint }]}>Try Look</Text>
              </View>
            </View>

            <View style={styles.cardBody}>
              <Text style={[styles.poseName, { color: colors.text }]} numberOfLines={1}>
                {pose.name}
              </Text>
              <View style={styles.metaRow}>
                {pose.difficulty && (
                  <Text style={[styles.difficultyText, { color: colors.success }]}>
                    {pose.difficulty === 'easy' ? '● Easy' : pose.difficulty === 'intermediate' ? '●● Medium' : '●●● Pro'}
                  </Text>
                )}
                <Text style={[styles.tagText, { color: colors.tabIconDefault }]}>{pose.category || 'Style Hint'}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        {filteredPoses.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.tabIconDefault }]}>No style poses for &quot;{selectedOccasion}&quot;</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
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
    color: colors.text,
  },
  sectionSubtitle: {
    ...Typography.caption,
    color: colors.tabIconDefault,
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
    backgroundColor: colors.card,
  },
  activeChip: {
    backgroundColor: colors.tint,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondaryText,
  },
  activeChipText: {
    color: colors.onTint,
  },
  scrollFeed: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  card: {
    borderRadius: 14,
    backgroundColor: colors.background,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      web: { boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
    }),
  },
  imageContainer: {
    width: '100%',
    backgroundColor: colors.imagePlaceholder,
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
    color: colors.tint,
    fontSize: 10,
    fontWeight: '700',
  },
  tryBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: colors.tint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tryBadgeText: {
    color: colors.onTint,
    fontSize: 10,
    fontWeight: '700',
  },
  cardBody: {
    padding: Spacing.sm,
  },
  poseName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  difficultyText: {
    fontSize: 10,
    color: colors.success,
    fontWeight: '600',
  },
  tagText: {
    fontSize: 10,
    color: colors.tabIconDefault,
  },
  emptyContainer: {
    width: SCREEN_WIDTH - Spacing.lg * 2,
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: colors.tabIconDefault,
  },
});
