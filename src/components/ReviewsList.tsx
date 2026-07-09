import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { ReviewModal } from './ReviewModal';

interface ReviewsListProps {
  productId: string;
}

export function ReviewsList({ productId }: ReviewsListProps) {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [stats, setStats] = useState({ average: 0, count: 0, breakdown: [0,0,0,0,0] });

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select(`
          *,
          user:user_id(first_name, last_name)
        `)
        .eq('product_id', productId)
        .order('created_at', { ascending: false });
        
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
          count: items.length,
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

  const renderStars = (rating: number) => {
    return (
      <View style={{ flexDirection: 'row' }}>
        {[1, 2, 3, 4, 5].map(star => (
          <IconSymbol 
            key={star} 
            name={star <= rating ? 'star.fill' : 'star'} 
            size={12} 
            color={star <= rating ? '#FFD700' : colors.border} 
          />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Reviews ({stats.count})</Text>
        <TouchableOpacity style={[styles.writeBtn, { borderColor: colors.tint }]} onPress={() => setModalVisible(true)}>
          <Text style={[styles.writeBtnText, { color: colors.tint }]}>Write a Review</Text>
        </TouchableOpacity>
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
                    <View style={[styles.barFill, { backgroundColor: '#FFD700', width: `${pct}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.tint} style={{ marginVertical: 32 }} />
      ) : reviews.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No reviews yet. Be the first to share your thoughts!</Text>
      ) : (
        <View style={styles.list}>
          {reviews.map(review => (
            <View key={review.id} style={[styles.reviewCard, { borderBottomColor: colors.border }]}>
              <View style={styles.reviewHeader}>
                <View style={styles.reviewerInfo}>
                  <Text style={[styles.reviewerName, { color: colors.text }]}>
                    {review.user?.first_name || 'Anonymous'} {review.user?.last_name?.[0] ? `${review.user.last_name[0]}.` : ''}
                  </Text>
                </View>
                <Text style={[styles.date, { color: colors.secondaryText }]}>
                  {new Date(review.created_at).toLocaleDateString()}
                </Text>
              </View>
              {renderStars(review.rating)}
              {review.comment && <Text style={[styles.comment, { color: colors.text }]}>{review.comment}</Text>}
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
    marginTop: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  writeBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  writeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  summary: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
    gap: 16,
  },
  scoreCol: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 16,
    borderRightWidth: 1,
    borderRightColor: 'rgba(150,150,150,0.2)'
  },
  avgScore: {
    fontSize: 36,
    fontWeight: '800',
    marginBottom: 4,
  },
  barsCol: {
    flex: 1,
    justifyContent: 'center',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
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
    marginVertical: 24,
  },
  list: {
    gap: 16,
  },
  reviewCard: {
    paddingBottom: 16,
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
    gap: 8,
  },
  reviewerName: {
    fontSize: 15,
    fontWeight: '600',
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
    fontSize: 10,
    color: '#34C759',
    fontWeight: '600',
  },
  date: {
    fontSize: 12,
  },
  comment: {
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
});
