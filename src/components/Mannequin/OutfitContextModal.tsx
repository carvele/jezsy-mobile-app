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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OutfitContext } from '@/src/utils/aiStylistAdvisor';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  loading?: boolean;
  onConfirm: (context: OutfitContext) => void;
  onCancel: () => void;
}

export function OutfitContextModal({ visible, loading = false, onConfirm, onCancel }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  const [occasion, setOccasion] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');

  const trimmedOccasion = occasion.trim();
  const canProceed = trimmedOccasion.length > 0;

  const handleConfirm = () => {
    if (!canProceed || loading) return;
    const ctx: OutfitContext = {
      occasion: trimmedOccasion,
      additionalContext: additionalContext.trim() || undefined,
    };
    onConfirm(ctx);
  };

  const handleCancel = () => {
    if (!loading) {
      setOccasion('');
      setAdditionalContext('');
    }
    onCancel();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Dismiss modal"
        />
        <View style={styles.kavWrapper}>
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
              keyboardDismissMode="on-drag"
            >
              {/* Primary field: Where are you wearing this outfit? */}
              <View style={styles.formRow}>
                <Text style={[styles.label, { color: colors.text }]}>
                  Where are you wearing this outfit?
                </Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Example: Work, wedding, school, date night, casual day out..."
                  placeholderTextColor={colors.secondaryText}
                  value={occasion}
                  onChangeText={setOccasion}
                  autoFocus
                  maxLength={100}
                  editable={!loading}
                />
              </View>

              {/* Optional field: Anything else JeZsy should consider? */}
              <View style={styles.formRow}>
                <Text style={[styles.label, { color: colors.text }]}>
                  Anything else JeZsy should consider? (Optional)
                </Text>
                <TextInput
                  keyboardAppearance={theme}
                  style={[
                    styles.input,
                    styles.contextInput,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }
                  ]}
                  placeholder="Example: It may rain and I will be walking a lot."
                  placeholderTextColor={colors.secondaryText}
                  value={additionalContext}
                  onChangeText={setAdditionalContext}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  textAlignVertical="top"
                  editable={!loading}
                />
              </View>
            </ScrollView>

            {/* Actions */}
            <SafeAreaView edges={['bottom']} style={[styles.actions, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
              {loading ? (
                <Text style={[styles.loadingHint, { color: colors.secondaryText }]}>
                  This can take up to 2 minutes on our free AI tier — hang tight, or cancel anytime.
                </Text>
              ) : null}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={handleCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.cancelBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.checkBtn, { backgroundColor: canProceed ? colors.tint : colors.border }]}
                  onPress={handleConfirm}
                  disabled={!canProceed || loading}
                  accessibilityRole="button"
                  accessibilityLabel="Check My Outfit"
                >
                  {loading ? (
                    <>
                      <ActivityIndicator size="small" color={colors.onTint} />
                      <Text style={[styles.checkBtnText, { color: colors.onTint }]} numberOfLines={1}>
                        Analyzing…
                      </Text>
                    </>
                  ) : (
                    <>
                      <IconSymbol name="sparkles" size={14} color={canProceed ? colors.onTint : colors.secondaryText} />
                      <Text style={[styles.checkBtnText, { color: canProceed ? colors.onTint : colors.secondaryText }]}>
                        Check My Outfit
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  kavWrapper: {
    width: '100%',
    // Center and cap on desktop/tablet.
    maxWidth: Platform.OS === 'web' ? 600 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' as const : undefined,
    flexShrink: 1,
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxHeight: SCREEN_HEIGHT * 0.85,
    overflow: 'hidden',
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(201,169,110,0.12)',
  },
  headerBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  scroll: {
    maxHeight: SCREEN_HEIGHT * 0.55,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  formRow: {
    gap: Spacing.xs,
  },
  label: {
    ...Type.body,
    fontWeight: '700',
  },
  input: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    ...Type.bodyStrong,
  },
  contextInput: {
    height: 90,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  actions: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  loadingHint: {
    fontSize: 12,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
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
    ...Type.body,
    fontWeight: '600',
  },
  checkBtn: {
    flex: 2,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    elevation: 2,
  },
  checkBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
});
