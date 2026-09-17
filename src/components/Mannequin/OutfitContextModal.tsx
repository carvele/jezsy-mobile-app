import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OutfitContext } from '@/src/utils/aiStylistAdvisor';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const OCCASIONS = [
  'Everyday / Casual',
  'Work / Office',
  'School',
  'Date',
  'Dinner',
  'Party',
  'Wedding / Formal Event',
  'Church',
  'Interview',
  'Sports / Gym',
  'Travel',
  'Beach',
  'Outdoor',
  'Custom',
] as const;

interface Props {
  visible: boolean;
  onConfirm: (context: OutfitContext) => void;
  onCancel: () => void;
}

export function OutfitContextModal({ visible, onConfirm, onCancel }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [selectedOccasion, setSelectedOccasion] = useState<string>('');
  const [customOccasion, setCustomOccasion] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');

  const effectiveOccasion = selectedOccasion === 'Custom' ? customOccasion.trim() : selectedOccasion;
  const canProceed = effectiveOccasion.length > 0;

  const handleConfirm = () => {
    if (!canProceed) return;
    const ctx: OutfitContext = {
      occasion: effectiveOccasion,
      additionalContext: additionalContext.trim() || undefined,
    };
    // Reset for next time
    setSelectedOccasion('');
    setCustomOccasion('');
    setAdditionalContext('');
    onConfirm(ctx);
  };

  const handleCancel = () => {
    setSelectedOccasion('');
    setCustomOccasion('');
    setAdditionalContext('');
    onCancel();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kavWrapper}
        >
          <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={styles.headerBadge}>
                <IconSymbol name="sparkles" size={13} color={colors.tint} />
                <Text style={[styles.headerBadgeText, { color: colors.tint }]}>JeZsy Stylist</Text>
              </View>
              <TouchableOpacity onPress={handleCancel} style={styles.closeBtn} accessibilityLabel="Cancel">
                <IconSymbol name="xmark" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.title, { color: colors.text }]}>
                Where are you wearing this outfit?
              </Text>
              <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                JeZsy will evaluate your outfit for the selected occasion.
              </Text>

              {/* Occasion grid */}
              <View style={styles.occasionGrid}>
                {OCCASIONS.map((occ) => {
                  const isSelected = selectedOccasion === occ;
                  return (
                    <TouchableOpacity
                      key={occ}
                      style={[
                        styles.occasionChip,
                        {
                          borderColor: isSelected ? colors.tint : colors.border,
                          backgroundColor: isSelected ? colors.tint : colors.card,
                        },
                      ]}
                      onPress={() => setSelectedOccasion(occ)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.occasionChipText, { color: isSelected ? colors.onTint : colors.text }]}>
                        {occ}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Custom occasion input */}
              {selectedOccasion === 'Custom' && (
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.customInput, { color: colors.text, borderColor: colors.tint, backgroundColor: colors.card }]}
                  placeholder="E.g. Wedding Guest, Family Gathering, Graduation..."
                  placeholderTextColor={colors.secondaryText}
                  value={customOccasion}
                  onChangeText={setCustomOccasion}
                  autoFocus
                  maxLength={80}
                />
              )}

              {/* Additional context */}
              <Text style={[styles.contextLabel, { color: colors.text }]}>
                Anything else JeZsy should consider? (Optional)
              </Text>
              <TextInput
                keyboardAppearance={theme}
                style={[styles.contextInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                placeholder="Example: It may rain, I will be walking a lot, and I want to look smart but comfortable."
                placeholderTextColor={colors.secondaryText}
                value={additionalContext}
                onChangeText={setAdditionalContext}
                multiline
                numberOfLines={3}
                maxLength={500}
                textAlignVertical="top"
              />
            </ScrollView>

            {/* Actions */}
            <SafeAreaView edges={['bottom']} style={[styles.actions, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              <TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={handleCancel}>
                <Text style={[styles.cancelBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.checkBtn, { backgroundColor: canProceed ? colors.tint : colors.border }]}
                onPress={handleConfirm}
                disabled={!canProceed}
              >
                <IconSymbol name="sparkles" size={14} color={canProceed ? colors.onTint : colors.secondaryText} />
                <Text style={[styles.checkBtnText, { color: canProceed ? colors.onTint : colors.secondaryText }]}>
                  Check My Outfit
                </Text>
              </TouchableOpacity>
            </SafeAreaView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  kavWrapper: {
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: SCREEN_HEIGHT * 0.88,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.lg,
    gap: Spacing.lg,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: -Spacing.sm,
  },
  occasionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  occasionChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  occasionChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  customInput: {
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.lg,
    ...Type.bodyStrong,
  },
  contextLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  contextInput: {
    minHeight: 80,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    padding: Spacing.lg,
    gap: Spacing.sm,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  checkBtn: {
    flex: 2,
    height: 48,
    borderRadius: Radius.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  checkBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
