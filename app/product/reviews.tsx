import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Type, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { reviewService, ReviewWithVote } from '@/src/services/reviewService';
import { ReviewFilterFacets, ReviewSortKey } from '@/src/types/dto/review';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';

const SORT_OPTIONS: { key: ReviewSortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'helpful', label: 'Most Helpful' },
  { key: 'highest', label: 'Highest' },
  { key: 'lowest', label: 'Lowest' },
];

const RATING_FILTERS = [5, 4, 3, 2, 1];
const PAGE_SIZE = 15;

export default function ProductReviewsScreen() {
  const { id, productId: paramProductId, name: paramName } = useLocalSearchParams<{
    id?: string;
    productId?: string;
    name?: string;
  }>();

  const productId = paramProductId || id || '';
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { user } = useAuth();
  const { showToast } = useToast();

  const [reviews, setReviews] = useState<ReviewWithVote[]>([]);
  const [totalFilteredCount, setTotalFilteredCount] = useState(0);
  const [facets, setFacets] = useState<ReviewFilterFacets>({
    sizes: [],
    colors: [],
    photo_count: 0,
    total_count: 0,
  });
  const [stats, setStats] = useState({ average: 0, count: 0, breakdown: [0, 0, 0, 0, 0] });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());

  // Filters state
  const [selectedSort, setSelectedSort] = useState<ReviewSortKey>('recent');
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [photosOnly, setPhotosOnly] = useState(false);

  const hasActiveFilters = useMemo(
    () => selectedRating !== null || selectedSize !== null || selectedColor !== null || photosOnly,
    [selectedRating, selectedSize, selectedColor, photosOnly],
  );

  const clearFilters = useCallback(() => {
    setSelectedRating(null);
    setSelectedSize(null);
    setSelectedColor(null);
    setPhotosOnly(false);
  }, []);

  // Fetch product review stats
  const fetchStats = useCallback(async () => {
    if (!productId) return;
    try {
      const { data, error } = await supabase.rpc('get_review_stats' as any, { p_product_id: productId });
      if (!error && data) {
        const statsData = data as any;
        setStats({
          count: Number(statsData.count || 0),
          average: Number(statsData.average || 0),
          breakdown: Array.isArray(statsData.breakdown) ? statsData.breakdown : [0, 0, 0, 0, 0],
        });
      }
    } catch (err) {
      console.error('Error fetching review stats:', err);
    }
  }, [productId]);

  // Fetch filter facets
  const fetchFacets = useCallback(async () => {
    if (!productId) return;
    const result = await reviewService.fetchReviewFilterFacets(productId);
    if (result.ok) {
      setFacets(result.data);
    }
  }, [productId]);

  // Initial and filtered load
  const loadReviews = useCallback(
    async (isRefresh = false) => {
      if (!productId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const result = await reviewService.fetchReviews({
          productId,
          limit: PAGE_SIZE,
          offset: 0,
          rating: selectedRating,
          size: selectedSize,
          color: selectedColor,
          photosOnly,
          sort: selectedSort,
        });

        if (!result.ok) throw result.error;

        setReviews(result.data.reviews);
        setTotalFilteredCount(result.data.totalFilteredCount);
        setOffset(PAGE_SIZE);
      } catch (err) {
        console.error('Error loading reviews:', err);
        showToast('Unable to load reviews. Please try again.', 'error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [productId, selectedRating, selectedSize, selectedColor, photosOnly, selectedSort, showToast],
  );

  // Pagination: load next page
  const loadMoreReviews = useCallback(async () => {
    if (loadingMore || loading || reviews.length >= totalFilteredCount) return;
    setLoadingMore(true);
    try {
      const result = await reviewService.fetchReviews({
        productId,
        limit: PAGE_SIZE,
        offset,
        rating: selectedRating,
        size: selectedSize,
        color: selectedColor,
        photosOnly,
        sort: selectedSort,
      });

      if (!result.ok) throw result.error;

      const newItems = result.data.reviews;
      setReviews((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const filteredNew = newItems.filter((item) => !existingIds.has(item.id));
        return [...prev, ...filteredNew];
      });
      setOffset((prev) => prev + PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more reviews:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [
    loadingMore,
    loading,
    reviews.length,
    totalFilteredCount,
    productId,
    offset,
    selectedRating,
    selectedSize,
    selectedColor,
    photosOnly,
    selectedSort,
  ]);

  useEffect(() => {
    fetchStats();
    fetchFacets();
  }, [fetchStats, fetchFacets]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  // Handle Like / Dislike voting
  const handleVote = useCallback(
    async (review: ReviewWithVote, voteType: 'like' | 'dislike') => {
      if (!user) {
        showToast('Log in to vote on reviews', 'info');
        return;
      }
      if (review.user_id === user.id) {
        showToast('You cannot vote on your own review', 'info');
        return;
      }
      if (votingIds.has(review.id)) return;

      const nextVote = review.user_vote === voteType ? null : voteType;
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
                    user_vote: resData.user_vote as 'like' | 'dislike' | null,
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

  const renderHeader = () => (
    <View style={styles.headerSection}>
      {/* Overall Score Summary */}
      {stats.count > 0 && (
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
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

      {/* Sort Options */}
      <View style={styles.filterSection}>
        <Text style={[styles.filterLabel, { color: colors.secondaryText }]}>SORT BY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {SORT_OPTIONS.map((opt) => {
            const active = selectedSort === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.chip,
                  { borderColor: active ? colors.tint : colors.border },
                  active && { backgroundColor: colors.tint + '18' },
                ]}
                onPress={() => setSelectedSort(opt.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, { color: active ? colors.tint : colors.text }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Rating Filters */}
      <View style={styles.filterSection}>
        <Text style={[styles.filterLabel, { color: colors.secondaryText }]}>RATING</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <TouchableOpacity
            style={[
              styles.chip,
              { borderColor: selectedRating === null ? colors.tint : colors.border },
              selectedRating === null && { backgroundColor: colors.tint + '18' },
            ]}
            onPress={() => setSelectedRating(null)}
          >
            <Text style={[styles.chipText, { color: selectedRating === null ? colors.tint : colors.text }]}>
              All Stars
            </Text>
          </TouchableOpacity>
          {RATING_FILTERS.map((star) => {
            const active = selectedRating === star;
            return (
              <TouchableOpacity
                key={star}
                style={[
                  styles.chip,
                  { borderColor: active ? colors.tint : colors.border },
                  active && { backgroundColor: colors.tint + '18' },
                ]}
                onPress={() => setSelectedRating(active ? null : star)}
              >
                <IconSymbol name="star.fill" size={11} color={active ? colors.tint : colors.warning} />
                <Text style={[styles.chipText, { color: active ? colors.tint : colors.text }]}>
                  {star} Star{star > 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Variant Attributes: Size & Color */}
      {(facets.sizes.length > 0 || facets.colors.length > 0 || facets.photo_count > 0) && (
        <View style={styles.filterSection}>
          <Text style={[styles.filterLabel, { color: colors.secondaryText }]}>ATTRIBUTES</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {facets.photo_count > 0 && (
              <TouchableOpacity
                style={[
                  styles.chip,
                  { borderColor: photosOnly ? colors.tint : colors.border },
                  photosOnly && { backgroundColor: colors.tint + '18' },
                ]}
                onPress={() => setPhotosOnly((v) => !v)}
              >
                <IconSymbol name="camera.fill" size={12} color={photosOnly ? colors.tint : colors.secondaryText} />
                <Text style={[styles.chipText, { color: photosOnly ? colors.tint : colors.text }]}>
                  With Photos ({facets.photo_count})
                </Text>
              </TouchableOpacity>
            )}

            {facets.sizes.map((size) => {
              const active = selectedSize === size;
              return (
                <TouchableOpacity
                  key={size}
                  style={[
                    styles.chip,
                    { borderColor: active ? colors.tint : colors.border },
                    active && { backgroundColor: colors.tint + '18' },
                  ]}
                  onPress={() => setSelectedSize(active ? null : size)}
                >
                  <Text style={[styles.chipText, { color: active ? colors.tint : colors.text }]}>
                    Size {size}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {facets.colors.map((color) => {
              const active = selectedColor === color;
              return (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.chip,
                    { borderColor: active ? colors.tint : colors.border },
                    active && { backgroundColor: colors.tint + '18' },
                  ]}
                  onPress={() => setSelectedColor(active ? null : color)}
                >
                  <Text style={[styles.chipText, { color: active ? colors.tint : colors.text }]}>
                    Color: {color}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Result Count and Clear Filters */}
      <View style={styles.resultsBar}>
        <Text style={[styles.resultsCountText, { color: colors.secondaryText }]}>
          Showing {totalFilteredCount} {totalFilteredCount === 1 ? 'review' : 'reviews'}
        </Text>
        {hasActiveFilters && (
          <TouchableOpacity onPress={clearFilters} style={styles.clearBtn}>
            <IconSymbol name="xmark.circle.fill" size={13} color={colors.tint} />
            <Text style={[styles.clearBtnText, { color: colors.tint }]}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderReviewItem = ({ item: review }: { item: ReviewWithVote }) => {
    const isOwnReview = user?.id === review.user_id;

    return (
      <View
        style={[
          styles.reviewCard,
          { backgroundColor: colors.card, borderColor: colors.border },
          review.is_pinned && {
            borderColor: colors.tint,
            backgroundColor: colors.tint + '0C',
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.reviewerMeta}>
            {review.is_pinned && (
              <IconSymbol name="pin.fill" size={13} color={colors.tint} style={{ marginRight: 4 }} />
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
          <Text style={[styles.dateText, { color: colors.secondaryText }]}>
            {new Date(review.created_at).toLocaleDateString()}
          </Text>
        </View>

        {/* Rating and Purchased Size/Color Badge */}
        <View style={styles.ratingRow}>
          {renderStars(review.rating)}
          {(review.size || review.color) && (
            <View style={[styles.variantBadge, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.variantBadgeText, { color: colors.secondaryText }]}>
                {review.size ? `Size: ${review.size}` : ''}
                {review.size && review.color ? ' • ' : ''}
                {review.color ? `Color: ${review.color}` : ''}
              </Text>
            </View>
          )}
        </View>

        {review.comment && (
          <Text style={[styles.commentText, { color: colors.text }]}>{review.comment}</Text>
        )}

        {review.images && review.images.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photoRow}
            contentContainerStyle={{ gap: Spacing.sm }}
          >
            {review.images.map((url: string, idx: number) => (
              <Image key={idx} source={{ uri: url }} style={styles.reviewPhoto} contentFit="cover" />
            ))}
          </ScrollView>
        )}

        {review.admin_reply && (
          <View style={[styles.adminReplyCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.adminReplyTitle, { color: colors.text }]}>Response from JezSy Collection</Text>
            <Text style={[styles.adminReplyText, { color: colors.secondaryText }]}>{review.admin_reply}</Text>
          </View>
        )}

        {/* Always-visible voting */}
        <View style={styles.voteRow}>
          <TouchableOpacity
            style={[styles.voteBtn, isOwnReview && styles.voteBtnDisabled]}
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
                styles.voteBtnText,
                { color: review.user_vote === 'like' ? colors.tint : colors.secondaryText },
              ]}
            >
              Helpful{(review.likes ?? 0) > 0 ? ` (${review.likes})` : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.voteBtn, isOwnReview && styles.voteBtnDisabled]}
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
                styles.voteBtnText,
                { color: review.user_vote === 'dislike' ? colors.tint : colors.secondaryText },
              ]}
            >
              Not helpful{(review.dislikes ?? 0) > 0 ? ` (${review.dislikes})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator color={colors.tint} />
        </View>
      );
    }
    if (reviews.length < totalFilteredCount && reviews.length > 0) {
      return (
        <TouchableOpacity
          style={[styles.loadMoreBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={loadMoreReviews}
        >
          <Text style={[styles.loadMoreText, { color: colors.text }]}>Load More Reviews</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Navigation Header */}
      <View style={[styles.navHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={[styles.navTitle, { color: colors.text }]}>Reviews</Text>
          {paramName && (
            <Text style={[styles.navSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
              {paramName}
            </Text>
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item) => item.id}
          renderItem={renderReviewItem}
          ListHeaderComponent={renderHeader}
          ListFooterComponent={renderFooter}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadReviews(true)}
              tintColor={colors.tint}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <IconSymbol name="star" size={54} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {hasActiveFilters ? 'No Matching Reviews' : 'No Reviews Yet'}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
                {hasActiveFilters
                  ? 'No reviews match your selected filter combination. Try adjusting or clearing filters.'
                  : 'Be the first to review this piece after completing your reservation!'}
              </Text>
              {hasActiveFilters && (
                <TouchableOpacity
                  style={[styles.clearEmptyBtn, { backgroundColor: colors.tint }]}
                  onPress={clearFilters}
                >
                  <Text style={[styles.clearEmptyText, { color: colors.onTint }]}>Clear Filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    padding: Spacing.xs,
  },
  titleWrap: {
    alignItems: 'center',
    flex: 1,
  },
  navTitle: {
    ...Type.subtitle,
  },
  navSubtitle: {
    ...Type.caption,
    marginTop: 2,
    maxWidth: 240,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl * 2,
  },
  headerSection: {
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xl,
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
  filterSection: {
    marginBottom: Spacing.md,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  resultsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  resultsCountText: {
    fontSize: 13,
    fontWeight: '600',
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  reviewCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  reviewerMeta: {
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
  dateText: {
    fontSize: 12,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: 2,
    marginBottom: 6,
  },
  variantBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  variantBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  commentText: {
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  photoRow: {
    marginTop: 10,
  },
  reviewPhoto: {
    width: 72,
    height: 72,
    borderRadius: Radius.sm,
  },
  adminReplyCard: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  adminReplyTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  adminReplyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  voteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.lg,
    gap: Spacing.xl,
  },
  voteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  voteBtnDisabled: {
    opacity: 0.65,
  },
  voteBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },
  footerLoader: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  loadMoreBtn: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  loadMoreText: {
    ...Type.bodyStrong,
  },
  emptyWrap: {
    paddingVertical: Spacing.xxxl * 2,
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    ...Type.bodyLargeStrong,
    marginTop: Spacing.lg,
  },
  emptySubtitle: {
    ...Type.body,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  clearEmptyBtn: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: 20,
  },
  clearEmptyText: {
    ...Type.bodyStrong,
  },
});
