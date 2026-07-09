import React, { useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';

interface ReviewModalProps {
  visible: boolean;
  productId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReviewModal({ visible, productId, onClose, onSuccess }: ReviewModalProps) {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const { user } = useAuth();
  
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to review.');
      return;
    }
    if (rating < 1 || rating > 5) return;
    
    setSubmitting(true);
    try {
      const { error } = await supabase.from('reviews').insert({
        product_id: productId,
        user_id: user.id,
        rating,
        comment: comment.trim() || null,
        images: [] // Image upload omitted for brevity on free tier
      });
      
      if (error) throw error;
      
      Alert.alert('Success', 'Thank you for your review!');
      setRating(5);
      setComment('');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error submitting review:', err);
      Alert.alert('Error', err.message || 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Write a Review</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.body}>
            <Text style={[styles.label, { color: colors.text }]}>Rate your item</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRating(star)} style={styles.starBtn}>
                  <IconSymbol 
                    name={star <= rating ? 'star.fill' : 'star'} 
                    size={36} 
                    color={star <= rating ? '#FFD700' : colors.border} 
                  />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.ratingText, { color: colors.secondaryText }]}>
              {rating === 1 && 'Terrible'}
              {rating === 2 && 'Bad'}
              {rating === 3 && 'Okay'}
              {rating === 4 && 'Good'}
              {rating === 5 && 'Excellent'}
            </Text>

            <Text style={[styles.label, { color: colors.text }]}>Tell us more</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="What did you like or dislike?"
              placeholderTextColor={colors.secondaryText}
              multiline
              textAlignVertical="top"
              value={comment}
              onChangeText={setComment}
            />

            <TouchableOpacity 
              style={[styles.submitBtn, { backgroundColor: colors.tint, opacity: submitting ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#0D0D0D" />
              ) : (
                <Text style={styles.submitBtnText}>Submit Review</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    minHeight: Dimensions.get('window').height * 0.6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    position: 'relative',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    padding: 8,
  },
  body: {
    padding: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 8,
  },
  starBtn: {
    padding: 4,
  },
  ratingText: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 32,
  },
  input: {
    height: 120,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    marginBottom: 24,
  },
  submitBtn: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  },
});
