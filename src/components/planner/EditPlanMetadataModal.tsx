import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PlannedOutfit } from '@/src/types/planner';
import { updatePlannedOutfitMetadata } from '@/src/services/plannerService';

export interface EditPlanMetadataModalProps {
  visible: boolean;
  plan: PlannedOutfit | null;
  onClose: () => void;
  onSuccess: (updatedPlan: PlannedOutfit) => void;
  onRefreshPlan?: (planId: string) => Promise<PlannedOutfit | null>;
}

export const EditPlanMetadataModal: React.FC<EditPlanMetadataModalProps> = ({
  visible,
  plan,
  onClose,
  onSuccess,
  onRefreshPlan,
}) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const [notes, setNotes] = useState<string>('');
  const [occasion, setOccasion] = useState<string>('');
  const [currentRevision, setCurrentRevision] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible && plan) {
      setNotes(plan.notes || '');
      setOccasion(plan.occasion || '');
      setCurrentRevision(plan.revision);
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [visible, plan]);

  if (!plan) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    // Call updatePlannedOutfitMetadata with notes and climateContext (NEVER slot)
    const result = await updatePlannedOutfitMetadata({
      planId: plan.id,
      expectedRevision: currentRevision,
      notes: notes.trim() || undefined,
      climateContext: plan.climate_context || undefined,
    });

    setIsSubmitting(false);

    if (result.ok) {
      const updatedPlan: PlannedOutfit = {
        ...result.data,
        occasion: occasion.trim() || null,
      };
      onSuccess(updatedPlan);
      onClose();
    } else {
      const err = result.error;
      const rawMessage = (err?.message || '') + ((err?.cause as any)?.message || '');
      const errCode = err?.code;
      const causeCode = (err?.cause as any)?.code;

      if (
        rawMessage.includes('OCC_CONFLICT') ||
        rawMessage.includes('OCC conflict') ||
        errCode === 'P0001' ||
        causeCode === 'P0001'
      ) {
        if (onRefreshPlan) {
          const fresh = await onRefreshPlan(plan.id);
          if (fresh) {
            setCurrentRevision(fresh.revision);
          }
        }
        setErrorMessage(
          "This plan changed on another device. We've refreshed the latest version. Your notes draft was preserved — tap Save Changes to apply."
        );
      } else {
        setErrorMessage('Unable to save changes. Please check your connection and retry.');
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={[styles.sheetCard, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.headerTitle, { color: theme.text }]}>Edit Styling Notes</Text>
              <Text style={[styles.headerSubtitle, { color: theme.secondaryText }]}>
                Add outfit tips, styling notes, or garment pairings
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close notes modal"
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={8}
            >
              <IconSymbol name="xmark" size={24} color={theme.text} />
            </Pressable>
          </View>

          {/* Occasion Input */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>OCCASION (OPTIONAL)</Text>
            <TextInput
              testID="input-plan-occasion"
              style={[
                styles.textInput,
                { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
              ]}
              placeholder="e.g. Gallery Opening, Board Meeting, Dinner"
              placeholderTextColor={theme.secondaryText}
              value={occasion}
              onChangeText={setOccasion}
              maxLength={60}
              accessibilityLabel="Occasion input"
            />
          </View>

          {/* Notes Input */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>STYLING NOTES</Text>
            <TextInput
              testID="input-plan-notes"
              style={[
                styles.textArea,
                { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
              ]}
              placeholder="e.g. Roll sleeves, pair with gold jewelry, carry structured bag"
              placeholderTextColor={theme.secondaryText}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              maxLength={250}
              accessibilityLabel="Styling notes text area"
            />
          </View>

          {/* Error message */}
          {errorMessage ? (
            <View testID="edit-notes-error-banner" style={[styles.errorBox, { backgroundColor: theme.glass, borderColor: theme.error }]}>
              <IconSymbol name="info.circle.fill" size={18} color={theme.error} style={{ marginRight: 6 }} />
              <Text style={[styles.errorText, { color: theme.error }]}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Footer Save Button */}
          <View style={[styles.footer, { borderTopColor: theme.hairline }]}>
            <Pressable
              testID="btn-save-notes"
              accessibilityRole="button"
              accessibilityLabel="Save styling notes"
              disabled={isSubmitting}
              onPress={handleSubmit}
              style={[styles.submitButton, { backgroundColor: theme.tint }, isSubmitting && styles.disabledButton]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={theme.onTint} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.onTint }]}>
                  Save Notes
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    flexShrink: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  headerTitle: {
    ...Type.subtitle,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    ...Type.caption,
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    ...Type.body,
    fontSize: 14,
  },
  textArea: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    textAlignVertical: 'top',
    ...Type.body,
    fontSize: 14,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  errorText: {
    ...Type.caption,
    fontSize: 12,
    flex: 1,
  },
  footer: {
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitButton: {
    minHeight: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  submitButtonText: {
    ...Type.bodyStrong,
    fontSize: 15,
  },
});
