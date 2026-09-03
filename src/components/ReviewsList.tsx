import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Colors, Type, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { ReviewModal } from './ReviewModal';

interface ReviewsListProps {
  productId: string;
}

type SortKey = 'recent' | 'highest' | 'lowest';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'highest', label: 'Highest' },
  { key: 'lowest', label: 'Lowest' },
];

export function ReviewsList({ productId }: ReviewsListProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { user } = useAuth();

  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [stats, setStats] = useState({ average: 0, count: 0, breakdown: [0,0,0,0,0] });
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [photosOnly, setPhotosOnly] = useState(false);
  // null while unchecked/logged-out -- the write button stays visible so a
  // signed-out visitor still gets ReviewModal's "log in to review" prompt.
  // The reviews RLS policy is the real gate; this only avoids sending an
  // eligible-looking customer into a submit that the DB will reject.
  const [eligible, setEligible] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const checkEligibility = async () => {
      if (!user?.id) {
        if (active) setEligible(null);
        return;
      }
      const { data } = await supabase
        .from('reservation_items')
        .select('id, reservations!inner(customer_id, deleted, status)')
        .eq('product_id', productId)
        .eq('reservations.customer_id', user.id);
      if (!active) return;
      setEligible(!!data?.some((row: any) => !row.reservations?.deleted && ['Completed', 'Active'].includes(row.reservations?.status)));
    };
    checkEligibility();
    return () => { active = false; };
  }, [productId, user?.id]);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error, count } = await supabase
        .from('reviews')
        .select('*', { count: 'exact' })
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(10);
        
      if (error) throw error;
      
      const items = data || [];
      setReviews(items);
      
      if (items.length > 0) {
        let sum = 0;
        const bd = [0,0,0,0,0];
        items.forEach(r => {
          sum += r.rating;
          if (r.rating >= 1 && r.rating <= 5) {
            bd[r.rating - 1]++;
          }
        });
        setStats({
          average: sum / items.length,
          count: count ?? items.length,
          breakdown: bd
        });
      } else {
        setStats({ average: 0, count: 0, breakdown: [0,0,0,0,0] });
      }
    } catch (err) {
      console.error('Error fetching reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const visibleReviews = useMemo(() => {
    const filtered = photosOnly
      ? reviews.filter(r => r.images && r.images.length > 0)
      : reviews;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      if (sortBy === 'highest') return b.rating - a.rating;
      if (sortBy === 'lowest') return a.rating - b.rating;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return sorted;
  }, [reviews, sortBy, photosOnly]);

  const photoReviewCount = useMemo(
    () => reviews.filter(r => r.images && r.images.length > 0).length,
    [reviews]
  );

  const renderStars = (rating: number) => {
    return (
      <View style={{ flexDirection: 'row' }}>
        {[1, 2, 3, 4, 5].map(star => (
          <IconSymbol 
            key={star} 
            name={star <= rating ? 'star.fill' : 'star'} 
            size={12} 
            color={star <= rating ? colors.warning : colors.border} 
          />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Reviews ({stats.count})</Text>
        {!user || eligible ? (
          <TouchableOpacity style={[styles.writeBtn, { borderColor: colors.tint }]} onPress={() => setModalVisible(true)}>
            <Text style={[styles.writeBtnText, { color: colors.tint }]}>Write a Review</Text>
          </TouchableOpacity>
        ) : eligible === false ? (
          <Text style={[styles.ineligibleNote, { color: colors.secondaryText }]}>
            Reserve this item to review it
          </Text>
        ) : null}
      </View>

      {stats.count > 0 && (
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.scoreCol}>
            <Text style={[styles.avgScore, { color: colors.text }]}>{stats.average.toFixed(1)}</Text>
            {renderStars(Math.round(stats.average))}
          </View>
          <View style={styles.barsCol}>
            {[5, 4, 3, 2, 1].map((star, idx) => {
              const count = stats.breakdown[star - 1];
              const pct = stats.count > 0 ? (count / stats.count) * 100 : 0;
              return (
                <View key={star} style={styles.barRow}>
                  <Text style={[styles.starLabel, { color: colors.secondaryText }]}>{star}</Text>
                  <View style={[styles.barBg, { backgroundColor: colors.border }]}>
                    <View style={[styles.barFill, { backgroundColor: colors.warning, width: `${pct}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {reviews.length > 1 && (
        <View style={styles.controlsRow}>
          {SORT_OPTIONS.map(opt => {
            const active = sortBy === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, { borderColor: active ? colors.tint : colors.border }, active && { backgroundColor: colors.tint + '20' }]}
                onPress={() => setSortBy(opt.key)}
                accessibilityRole="button"
                accessibilityLabel={`Sort reviews by ${opt.label}`}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, { color: active ? colors.tint : colors.secondaryText }]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
          {photoReviewCount > 0 && (
            <TouchableOpacity
              style={[styles.chip, { borderColor: photosOnly ? colors.tint : colors.border }, photosOnly && { backgroundColor: colors.tint + '20' }]}
              onPress={() => setPhotosOnly(v => !v)}
              accessibilityRole="button"
              accessibilityLabel="Show only reviews with photos"
              accessibilityState={{ selected: photosOnly }}
            >
              <Text style={[styles.chipText, { color: photosOnly ? colors.tint : colors.secondaryText }]}>
                With photos ({photoReviewCount})
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.tint} style={{ marginVertical: Spacing.xxxl }} />
      ) : reviews.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No reviews yet. Write the first review.</Text>
      ) : visibleReviews.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No reviews match this filter.</Text>
      ) : (
        <View style={styles.list}>
          {visibleReviews.map(review => (
            <View key={review.id} style={[styles.reviewCard, { borderBottomColor: colors.border }, review.is_pinned && { backgroundColor: colors.tint + '10', borderColor: colors.tint, borderWidth: 1, padding: Spacing.md, borderRadius: 8 }]}>
              <View style={styles.reviewHeader}>
                <View style={styles.reviewerInfo}>
                  {review.is_pinned && <IconSymbol name="pin.fill" size={14} color={colors.tint} style={{ marginRight: 4 }} />}
                  <Text style={[styles.reviewerName, { color: colors.text }]}>
                    {review.reviewer_name || 'Anonymous'}
                  </Text>
                  {review.verified_purchase && (
                    <View style={styles.verifiedBadge}>
                      <IconSymbol name="checkmark.circle.fill" size={10} color="#34C759" />
                      <Text style={styles.verifiedText}>Verified</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.date, { color: colors.secondaryText }]}>
                  {new Date(review.created_at).toLocaleDateString()}
                </Text>
              </View>
              {renderStars(review.rating)}
              {review.comment && <Text style={[styles.comment, { color: colors.text }]}>{review.comment}</Text>}
              {review.images && review.images.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reviewPhotoRow} contentContainerStyle={{ gap: Spacing.sm }}>
                  {review.images.map((url: string, idx: number) => (
                    <Image key={idx} source={{ uri: url }} style={styles.reviewPhoto} contentFit="cover" />
                  ))}
                </ScrollView>
              )}
              {review.admin_reply && (
                <View style={{ marginTop: Spacing.md, padding: Spacing.md, backgroundColor: colors.card, borderRadius: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 4 }}>Response from JezSy Couture</Text>
                  <Text style={{ fontSize: 13, color: colors.secondaryText, lineHeight: 18 }}>{review.admin_reply}</Text>
                </View>
              )}
              {(review.likes > 0 || review.dislikes > 0) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, gap: Spacing.lg }}>
                  {review.likes > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <IconSymbol name="hand.thumbsup.fill" size={12} color={colors.secondaryText} />
                      <Text style={{ fontSize: 12, color: colors.secondaryText }}>{review.likes}</Text>
                    </View>
                  )}
                  {review.dislikes > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <IconSymbol name="hand.thumbsdown.fill" size={12} color={colors.secondaryText} />
                      <Text style={{ fontSize: 12, color: colors.secondaryText }}>{review.dislikes}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      <ReviewModal 
        visible={modalVisible} 
        productId={productId} 
        onClose={() => setModalVisible(false)} 
        onSuccess={fetchReviews} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: Spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    ...Type.subtitle,
  },
  ineligibleNote: {
    fontSize: 12,
    fontStyle: 'italic',
    maxWidth: 160,
    textAlign: 'right',
  },
  writeBtn: {
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
  },
  writeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  summary: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  scoreCol: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: Spacing.lg,
    borderRightWidth: 1,
    borderRightColor: 'rgba(150,150,150,0.2)'
  },
  avgScore: {
    fontSize: 36,
    fontWeight: '800',
    marginBottom: Spacing.xs,
  },
  barsCol: {
    flex: 1,
    justifyContent: 'center',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  starLabel: {
    fontSize: 12,
    width: 12,
  },
  barBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 15,
    marginVertical: Spacing.xxl,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    gap: Spacing.lg,
  },
  reviewCard: {
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  reviewerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  reviewerName: {
    ...Type.bodyStrong,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  verifiedText: {
    fontSize: 12,
    color: Colors.light.success,
    fontWeight: '600',
  },
  date: {
    fontSize: 12,
  },
  comment: {
    fontSize: 14,
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  reviewPhotoRow: {
    marginTop: 10,
  },
  reviewPhoto: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
});


