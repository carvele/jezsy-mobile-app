import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Type, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { reviewService, ReviewWithVote } from '@/src/services/reviewService';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';

interface ReviewsListProps {
  productId: string;
  productName?: string;
  onStatsLoaded?: (stats: { average: number; count: number }) => void;
}

type VoteType = 'like' | 'dislike';

export function ReviewsList({ productId, productName, onStatsLoaded }: ReviewsListProps) {
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { user } = useAuth();
  const { showToast } = useToast();

  const [reviews, setReviews] = useState<ReviewWithVote[]>([]);
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ average: 0, count: 0, breakdown: [0, 0, 0, 0, 0] });

  const fetchStats = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_review_stats' as any, { p_product_id: productId });
      if (!error && data) {
        const statsData = data as any;
        const count = Number(statsData.count || 0);
        const average = Number(statsData.average || 0);
        setStats({
          count,
          average,
          breakdown: Array.isArray(statsData.breakdown) ? statsData.breakdown : [0, 0, 0, 0, 0],
        });
        onStatsLoaded?.({ average, count });
      }
    } catch (e) {
      console.error('Error fetching review stats:', e);
    }
  }, [productId, onStatsLoaded]);

  const fetchPreviewReviews = useCallback(async () => {
    setLoading(true);
    fetchStats();
    try {
      const result = await reviewService.fetchReviews({
        productId,
        limit: 3,
        offset: 0,
        sort: 'recent',
      });

      if (!result.ok) throw result.error;
      setReviews(result.data.reviews);
    } catch (err) {
      console.error('Error fetching review preview:', err);
    } finally {
      setLoading(false);
    }
  }, [productId, fetchStats]);

  const navigateToAllReviews = useCallback(() => {
    router.push({
      pathname: '/product/reviews',
      params: {
        productId,
        ...(productName ? { name: productName } : {}),
      },
    } as any);
  }, [router, productId, productName]);

  useEffect(() => {
    fetchPreviewReviews();
  }, [fetchPreviewReviews]);

  const handleVote = useCallback(
    async (review: ReviewWithVote, voteType: VoteType) => {
      if (!user) {
        showToast('Log in to vote on reviews', 'info');
        return;
      }
      if (review.user_id === user.id) {
        showToast('You cannot vote on your own review', 'info');
        return;
      }
      if (votingIds.has(review.id)) return;

      const nextVote: VoteType | null = review.user_vote === voteType ? null : voteType;
      const previous = { likes: review.likes, dislikes: review.dislikes, user_vote: review.user_vote };

      setVotingIds((prev) => new Set(prev).add(review.id));
      setReviews((prev) =>
        prev.map((r) => {
          if (r.id !== review.id) return r;
          let likes = r.likes ?? 0;
          let dislikes = r.dislikes ?? 0;
          if (previous.user_vote === 'like') likes -= 1;
          if (previous.user_vote === 'dislike') dislikes -= 1;
          if (nextVote === 'like') likes += 1;
          if (nextVote === 'dislike') dislikes += 1;
          return {
            ...r,
            likes: Math.max(0, likes),
            dislikes: Math.max(0, dislikes),
            user_vote: nextVote,
          };
        }),
      );

      try {
        const result = await reviewService.voteReview(review.id, nextVote);
        if (!result.ok) throw result.error;
        const resData = result.data;
        if (resData) {
          setReviews((prev) =>
            prev.map((r) =>
              r.id === review.id
                ? {
                    ...r,
                    likes: resData.likes,
                    dislikes: resData.dislikes,
                    user_vote: resData.user_vote as VoteType | null,
                  }
                : r,
            ),
          );
        }
      } catch (err) {
        console.error('Error voting on review:', err);
        setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, ...previous } : r)));
        showToast('Could not record your vote. Please try again.', 'error');
      } finally {
        setVotingIds((prev) => {
          const next = new Set(prev);
          next.delete(review.id);
          return next;
        });
      }
    },
    [user, votingIds, showToast],
  );

  const renderStars = (rating: number) => {
    return (
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <IconSymbol
            key={star}
            name={star <= rating ? 'star.fill' : 'star'}
            size={13}
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
        {stats.count > 0 && (
          <TouchableOpacity
            onPress={navigateToAllReviews}
            accessibilityRole="button"
            accessibilityLabel={`View all ${stats.count} reviews`}
          >
            <Text style={[styles.viewAllText, { color: colors.tint }]}>View All ({stats.count})</Text>
          </TouchableOpacity>
        )}
      </View>

      {stats.count > 0 && (
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.scoreCol}>
            <Text style={[styles.avgScore, { color: colors.text }]}>{stats.average.toFixed(1)}</Text>
            {renderStars(Math.round(stats.average))}
            <Text style={[styles.totalReviewsLabel, { color: colors.secondaryText }]}>
              {stats.count} verified {stats.count === 1 ? 'rating' : 'ratings'}
            </Text>
          </View>
          <View style={styles.barsCol}>
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats.breakdown[star - 1] || 0;
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

      {loading ? (
        <ActivityIndicator color={colors.tint} style={{ marginVertical: Spacing.xxl }} />
      ) : reviews.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
          No reviews yet. Be the first to review this piece after your reservation!
        </Text>
      ) : (
        <View style={styles.list}>
          {reviews.map((review) => {
            const isOwnReview = user?.id === review.user_id;

            return (
              <View
                key={review.id}
                style={[
                  styles.reviewCard,
                  { borderBottomColor: colors.border },
                  review.is_pinned && {
                    backgroundColor: colors.tint + '10',
                    borderColor: colors.tint,
                    borderWidth: 1,
                    padding: Spacing.md,
                    borderRadius: Radius.md,
                  },
                ]}
              >
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewerInfo}>
                    {review.is_pinned && (
                      <IconSymbol name="pin.fill" size={14} color={colors.tint} style={{ marginRight: 4 }} />
                    )}
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

                {/* Rating and Purchased Variant */}
                <View style={styles.ratingAndVariantRow}>
                  {renderStars(review.rating)}
                  {(review.size || review.color) && (
                    <View style={[styles.variantPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.variantPillText, { color: colors.secondaryText }]}>
                        {review.size ? `Size: ${review.size}` : ''}
                        {review.size && review.color ? ' • ' : ''}
                        {review.color ? `Color: ${review.color}` : ''}
                      </Text>
                    </View>
                  )}
                </View>

                {review.comment && <Text style={[styles.comment, { color: colors.text }]}>{review.comment}</Text>}

                {review.images && review.images.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.reviewPhotoRow}
                    contentContainerStyle={{ gap: Spacing.sm }}
                  >
                    {review.images.map((url: string, idx: number) => (
                      <Image key={idx} source={{ uri: url }} style={styles.reviewPhoto} contentFit="cover" />
                    ))}
                  </ScrollView>
                )}

                {review.admin_reply && (
                  <View style={{ marginTop: Spacing.md, padding: Spacing.md, backgroundColor: colors.card, borderRadius: Radius.sm }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
                      Response from JezSy Collection
                    </Text>
                    <Text style={{ fontSize: 13, color: colors.secondaryText, lineHeight: 18 }}>{review.admin_reply}</Text>
                  </View>
                )}

                {/* Always-visible voting actions */}
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.voteButton, isOwnReview && styles.voteButtonDisabled]}
                    onPress={() => handleVote(review, 'like')}
                    disabled={votingIds.has(review.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Helpful, ${review.likes ?? 0} likes`}
                    accessibilityState={{ selected: review.user_vote === 'like' }}
                  >
                    <IconSymbol
                      name="hand.thumbsup.fill"
                      size={13}
                      color={review.user_vote === 'like' ? colors.tint : colors.secondaryText}
                    />
                    <Text
                      style={[
                        styles.voteButtonText,
                        { color: review.user_vote === 'like' ? colors.tint : colors.secondaryText },
                      ]}
                    >
                      Helpful{(review.likes ?? 0) > 0 ? ` (${review.likes})` : ''}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.voteButton, isOwnReview && styles.voteButtonDisabled]}
                    onPress={() => handleVote(review, 'dislike')}
                    disabled={votingIds.has(review.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Not helpful, ${review.dislikes ?? 0} dislikes`}
                    accessibilityState={{ selected: review.user_vote === 'dislike' }}
                  >
                    <IconSymbol
                      name="hand.thumbsdown.fill"
                      size={13}
                      color={review.user_vote === 'dislike' ? colors.tint : colors.secondaryText}
                    />
                    <Text
                      style={[
                        styles.voteButtonText,
                        { color: review.user_vote === 'dislike' ? colors.tint : colors.secondaryText },
                      ]}
                    >
                      Not helpful{(review.dislikes ?? 0) > 0 ? ` (${review.dislikes})` : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {stats.count > 3 && (
            <TouchableOpacity
              style={[styles.viewAllButton, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={navigateToAllReviews}
              accessibilityRole="button"
              accessibilityLabel={`View all ${stats.count} reviews for this product`}
            >
              <Text style={[styles.viewAllButtonText, { color: colors.text }]}>
                View All {stats.count} Reviews
              </Text>
              <IconSymbol name="chevron.right" size={14} color={colors.secondaryText} />
            </TouchableOpacity>
          )}
        </View>
      )}
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
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  summary: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  scoreCol: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: Spacing.lg,
    borderRightWidth: 1,
    borderRightColor: 'rgba(150,150,150,0.2)',
  },
  avgScore: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: Spacing.xs,
  },
  totalReviewsLabel: {
    fontSize: 11,
    marginTop: 4,
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
    fontSize: 11,
    width: 10,
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
    fontSize: 14,
    lineHeight: 20,
    marginVertical: Spacing.xxl,
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
    borderRadius: 6,
  },
  verifiedText: {
    fontSize: 11,
    color: '#34C759',
    fontWeight: '600',
  },
  date: {
    fontSize: 12,
  },
  ratingAndVariantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: 2,
    marginBottom: 6,
  },
  variantPill: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  variantPillText: {
    fontSize: 11,
    fontWeight: '500',
  },
  comment: {
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  reviewPhotoRow: {
    marginTop: 10,
  },
  reviewPhoto: {
    width: 68,
    height: 68,
    borderRadius: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    gap: Spacing.xl,
  },
  voteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  voteButtonDisabled: {
    opacity: 0.65,
  },
  voteButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  viewAllButtonText: {
    ...Type.bodyStrong,
  },
});
