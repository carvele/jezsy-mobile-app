import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors, Spacing, Type, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string;
  items?: string[];
  consequences?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDestructive?: boolean;
  isLoading?: boolean;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
  confirmKeyword?: string;
  confirmInputPlaceholder?: string;
}

/**
 * System-styled modal for destructive or high-impact actions with:
 * - Severity tiers: LOW (informational), MEDIUM (consequences), HIGH (irreversible + typed keyword)
 * - Consequence summaries
 * - Optional typed keyword confirmation
 * - Loading lock states with ActivityIndicator
 * - Complete accessibility states
 */
export function ConfirmModal({
  visible,
  title,
  message,
  items,
  consequences,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isDestructive = false,
  isLoading = false,
  severity,
  confirmKeyword,
  confirmInputPlaceholder,
}: ConfirmModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [typedInput, setTypedInput] = useState('');

  const effectiveSeverity = severity || (isDestructive ? 'MEDIUM' : 'LOW');
  const bulletItems = consequences || items || [];

  useEffect(() => {
    if (visible) {
      setTypedInput('');
    }
  }, [visible]);

  const isKeywordMatching =
    !confirmKeyword || typedInput.trim().toLowerCase() === confirmKeyword.trim().toLowerCase();
  const isConfirmDisabled = isLoading || !isKeywordMatching;

  const confirmBgColor =
    isDestructive || effectiveSeverity === 'HIGH' ? colors.error : colors.tint;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      accessibilityViewIsModal
      onRequestClose={() => {
        if (!isLoading) onCancel();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {effectiveSeverity === 'HIGH' && (
            <View style={[styles.severityBadge, { backgroundColor: colors.error + '20', borderColor: colors.error }]}>
              <Text style={[styles.severityText, { color: colors.error }]}>Irreversible Action</Text>
            </View>
          )}

          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {title}
          </Text>

          {message ? <Text style={[styles.message, { color: colors.secondaryText }]}>{message}</Text> : null}

          {bulletItems.length > 0 && (
            <View style={styles.itemList}>
              <Text style={[styles.consequenceHeader, { color: colors.text }]}>Impact Summary:</Text>
              {bulletItems.map((item, i) => (
                <View key={i} style={styles.itemRow}>
                  <View
                    style={[
                      styles.bullet,
                      { backgroundColor: isDestructive || effectiveSeverity === 'HIGH' ? colors.error : colors.tint },
                    ]}
                  />
                  <Text style={[styles.itemText, { color: colors.text }]}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {confirmKeyword && (
            <View style={styles.keywordContainer}>
              <Text style={[styles.keywordPrompt, { color: colors.text }]}>
                To confirm, type <Text style={{ fontWeight: '800', color: colors.error }}>{confirmKeyword}</Text> below:
              </Text>
              <TextInput
                style={[
                  styles.keywordInput,
                  {
                    color: colors.text,
                    borderColor: isKeywordMatching && typedInput ? colors.tint : colors.border,
                    backgroundColor: colors.card,
                  },
                ]}
                placeholder={confirmInputPlaceholder || `Type "${confirmKeyword}"`}
                placeholderTextColor={colors.secondaryText}
                value={typedInput}
                onChangeText={setTypedInput}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
              />
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn, { borderColor: colors.border, opacity: isLoading ? 0.5 : 1 }]}
              onPress={onCancel}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              accessibilityState={{ disabled: isLoading }}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>{cancelLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.btn,
                styles.confirmBtn,
                { backgroundColor: confirmBgColor, opacity: isConfirmDisabled ? 0.4 : 1 },
              ]}
              onPress={onConfirm}
              disabled={isConfirmDisabled}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: isConfirmDisabled, busy: isLoading }}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[styles.btnText, { color: '#FFFFFF' }]}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  content: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    padding: Spacing.xxl,
    borderWidth: 1,
    flexShrink: 1,
  },
  severityBadge: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  severityText: {
    ...Type.label,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  consequenceHeader: {
    ...Type.bodyStrong,
    marginBottom: Spacing.xs,
  },
  itemList: {
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  keywordContainer: {
    marginBottom: Spacing.xl,
  },
  keywordPrompt: {
    fontSize: 13,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  keywordInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    width: '100%',
  },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
  },
  confirmBtn: {},
  btnText: {
    ...Type.bodyLargeStrong,
  },
});
