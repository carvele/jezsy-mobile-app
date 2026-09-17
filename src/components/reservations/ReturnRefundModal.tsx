import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { resolveImageFileInfo } from '@/src/utils/imageUpload';
import { requestCustomerRefund } from '@/src/services/reservationService';

const REASON_OPTIONS = [
  'Damaged or defective item',
  'Wrong size or fit issue',
  'Item differs from description',
  'Missing items or accessories',
  'Other',
];

interface ReturnRefundModalProps {
  visible: boolean;
  reservation: {
    id: string;
    display_id?: string | null;
    product_name?: string | null;
  } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReturnRefundModal({
  visible,
  reservation,
  onClose,
  onSuccess,
}: ReturnRefundModalProps) {
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { user } = useAuth();

  const [selectedReason, setSelectedReason] = useState(REASON_OPTIONS[0]);
  const [details, setDetails] = useState('');
  const [evidencePhoto, setEvidencePhoto] = useState<{
    uri: string;
    base64: string;
    ext: string;
    contentType: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const handlePickImage = async () => {
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
    setEvidencePhoto({ uri: asset.uri, base64: asset.base64, ext, contentType });
  };

  const handleRemoveImage = () => {
    setEvidencePhoto(null);
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current || submitting) return;
    if (!user) {
      showToast('You must be logged in to submit a request.', 'error');
      return;
    }
    if (!reservation) {
      showToast('No reservation selected.', 'error');
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);

    try {
      let photoStoragePath: string | undefined;

      if (evidencePhoto) {
        const filePath = `${user.id}/${reservation.id}/${Date.now()}.${evidencePhoto.ext}`;
        const { error: uploadError } = await supabase.storage
          .from('return-refund-evidence')
          .upload(filePath, decode(evidencePhoto.base64), {
            contentType: evidencePhoto.contentType,
            upsert: false,
          });

        if (uploadError) {
          throw new Error(`Failed to upload photo: ${uploadError.message}`);
        }
        photoStoragePath = filePath;
      }

      const res = await requestCustomerRefund(
        reservation.id,
        selectedReason,
        details.trim() || undefined,
        photoStoragePath
      );

      if (!res.ok) {
        throw new Error(res.error.message || 'Failed to submit refund request.');
      }

      showToast('Return/refund request submitted for review.', 'success');
      setDetails('');
      setEvidencePhoto(null);
      setSelectedReason(REASON_OPTIONS[0]);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error submitting return/refund request:', err);
      showToast(err?.message || 'Could not submit request. Please try again.', 'error');
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!visible || !reservation) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View
          style={[
            styles.modalContent,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Request Return / Refund</Text>
              <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]}>
                Order #{reservation.display_id || reservation.id.substring(0, 8)}
                {reservation.product_name ? ` • ${reservation.product_name}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close modal">
              <IconSymbol name="xmark" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Reason for Return</Text>
            <View style={styles.reasonsContainer}>
              {REASON_OPTIONS.map((reason) => {
                const isSelected = selectedReason === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    style={[
                      styles.reasonOption,
                      {
                        borderColor: isSelected ? colors.tint : colors.border,
                        backgroundColor: isSelected ? colors.tint + '12' : colors.card,
                      },
                    ]}
                    onPress={() => setSelectedReason(reason)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <View
                      style={[
                        styles.radioCircle,
                        { borderColor: isSelected ? colors.tint : colors.border },
                      ]}
                    >
                      {isSelected && <View style={[styles.radioDot, { backgroundColor: colors.tint }]} />}
                    </View>
                    <Text
                      style={[
                        styles.reasonText,
                        { color: isSelected ? colors.tint : colors.text, fontWeight: isSelected ? '700' : '400' },
                      ]}
                    >
                      {reason}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.text, marginTop: Spacing.md }]}>
              Details / Explanation
            </Text>
            <TextInput
              style={[
                styles.detailsInput,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              multiline
              numberOfLines={4}
              placeholder="Describe the issue or reason in detail..."
              placeholderTextColor={colors.secondaryText}
              value={details}
              onChangeText={setDetails}
            />

            <Text style={[styles.sectionLabel, { color: colors.text, marginTop: Spacing.md }]}>
              Supporting Photo (Optional)
            </Text>
            {evidencePhoto ? (
              <View style={styles.photoPreviewContainer}>
                <Image source={{ uri: evidencePhoto.uri }} style={styles.photoPreview} contentFit="cover" />
                <TouchableOpacity
                  style={[styles.removePhotoBtn, { backgroundColor: colors.card }]}
                  onPress={handleRemoveImage}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <IconSymbol name="trash" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.uploadBox, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={handlePickImage}
                accessibilityRole="button"
                accessibilityLabel="Upload evidence photo"
              >
                <IconSymbol name="camera.fill" size={24} color={colors.secondaryText} />
                <Text style={[styles.uploadText, { color: colors.secondaryText }]}>
                  Tap to add a photo of the item
                </Text>
              </TouchableOpacity>
            )}

            <View style={[styles.infoBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="info.circle.fill" size={16} color={colors.secondaryText} />
              <Text style={[styles.infoText, { color: colors.secondaryText }]}>
                Requests are reviewed by boutique staff. Once approved, refund processing or replacement instructions will follow.
              </Text>
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={onClose}
              disabled={submitting}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelBtnText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: colors.tint, opacity: submitting ? 0.7 : 1 },
              ]}
              onPress={handleSubmit}
              disabled={submitting}
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator color={colors.onTint} size="small" />
              ) : (
                <Text style={[styles.submitBtnText, { color: colors.onTint }]}>Submit Request</Text>
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
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '90%',
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    ...Type.subtitle,
  },
  headerSubtitle: {
    ...Type.caption,
    marginTop: 2,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  body: {
    padding: Spacing.xl,
  },
  sectionLabel: {
    ...Type.label,
    marginBottom: Spacing.sm,
  },
  reasonsContainer: {
    gap: Spacing.sm,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.md,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  reasonText: {
    fontSize: 14,
    flex: 1,
  },
  detailsInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  uploadBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  uploadText: {
    fontSize: 13,
  },
  photoPreviewContainer: {
    position: 'relative',
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    height: 140,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  removePhotoBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    padding: 6,
    borderRadius: Radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: Spacing.lg,
  },
  infoText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    height: 48,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
