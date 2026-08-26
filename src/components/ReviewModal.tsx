import React, { useState } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Dimensions, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { resolveImageFileInfo } from '@/src/utils/imageUpload';

const MAX_REVIEW_IMAGES = 4;

interface ReviewModalProps {
  visible: boolean;
  productId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReviewModal({ visible, productId, onClose, onSuccess }: ReviewModalProps) {
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { user, profile } = useAuth();
  
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<{ uri: string; base64: string; ext: string; contentType: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handlePickImage = async () => {
    if (images.length >= MAX_REVIEW_IMAGES) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) return;
    const { contentType, ext } = resolveImageFileInfo(asset.uri);
    setImages(prev => [...prev, { uri: asset.uri, base64: asset.base64!, ext, contentType }]);
  };

  const removeImage = (uri: string) => {
    setImages(prev => prev.filter(img => img.uri !== uri));
  };

  const handleSubmit = async () => {
    if (!user) {
      showToast('You must be logged in to review.', 'error');
      return;
    }
    if (rating < 1 || rating > 5) return;

    setSubmitting(true);
    try {
      const uploadedUrls: string[] = [];
      for (const img of images) {
        const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${img.ext}`;
        const { error: uploadError } = await supabase.storage
          .from('review-images')
          .upload(filePath, decode(img.base64), { contentType: img.contentType });
        if (uploadError) throw uploadError;
        const { data: publicUrl } = supabase.storage.from('review-images').getPublicUrl(filePath);
        uploadedUrls.push(publicUrl.publicUrl);
      }

      // profiles' read policy only lets a customer see their own row, so
      // ReviewsList can't resolve another reviewer's name via an embed --
      // denormalize the display name here, at the one point where the
      // author's own profile is guaranteed readable.
      const reviewerName = profile?.first_name
        ? [profile.first_name, profile.last_name ? `${profile.last_name[0]}.` : null]
            .filter(Boolean)
            .join(' ')
        : null;

      const { error } = await supabase.from('reviews').insert({
        product_id: productId,
        user_id: user.id,
        rating,
        comment: comment.trim() || null,
        images: uploadedUrls,
        reviewer_name: reviewerName,
      });

      if (error) throw error;

      showToast('Thank you for your review!', 'success');
      setRating(5);
      setComment('');
      setImages([]);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error submitting review:', err);
      showToast(err.message || 'Failed to submit review.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
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
            <TextInput keyboardAppearance={theme}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="What did you like or dislike?"
              placeholderTextColor={colors.secondaryText}
              multiline
              textAlignVertical="top"
              value={comment}
              onChangeText={setComment}
            />

            <Text style={[styles.label, { color: colors.text }]}>Add photos (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow} contentContainerStyle={{ gap: 12 }}>
              {images.map(img => (
                <View key={img.uri} style={styles.photoThumbWrap}>
                  <Image source={{ uri: img.uri }} style={styles.photoThumb} contentFit="cover" />
                  <TouchableOpacity
                    style={styles.photoRemoveBtn}
                    onPress={() => removeImage(img.uri)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove this photo"
                  >
                    <IconSymbol name="xmark" size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {images.length < MAX_REVIEW_IMAGES && (
                <TouchableOpacity
                  style={[styles.photoAddBtn, { borderColor: colors.border }]}
                  onPress={handlePickImage}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo to your review"
                >
                  <IconSymbol name="camera.fill" size={22} color={colors.secondaryText} />
                </TouchableOpacity>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.tint, opacity: submitting ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onTint} />
              ) : (
                <Text style={[styles.submitBtnText, { color: colors.onTint }]}>Submit Review</Text>
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
    
    fontSize: 16,
    fontWeight: '700',
  },
  photoRow: {
    marginBottom: 24,
  },
  photoThumbWrap: {
    position: 'relative',
  },
  photoThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoAddBtn: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
