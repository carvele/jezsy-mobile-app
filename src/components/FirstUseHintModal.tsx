import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface FirstUseHintModalProps {
  visible: boolean;
  icon: Parameters<typeof IconSymbol>[0]['name'];
  title: string;
  message: string;
  actionLabel?: string;
  onAcknowledge: () => void;
}

/**
 * Generic one-time explainer for a feature that has no natural empty state
 * to carry the explanation (contrast BrandEmptyState, which covers that
 * case). Deliberately not a positioned/measured coachmark -- no view
 * measurement, no masking, no sequencing -- just a single acknowledgment
 * shown once, right before the moment it's relevant (e.g. before a camera
 * permission prompt whose purpose isn't otherwise explained in-app).
 */
export function FirstUseHintModal({ visible, icon, title, message, actionLabel = 'Got it', onAcknowledge }: FirstUseHintModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onAcknowledge}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
            <IconSymbol name={icon} size={28} color={colors.tint} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.message, { color: colors.secondaryText }]}>{message}</Text>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.tint }]}
            onPress={onAcknowledge}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={[styles.actionText, { color: colors.onTint }]}>{actionLabel}</Text>
          </TouchableOpacity>
        </View>
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
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: Spacing.xxl,
    alignItems: 'center',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  actionBtn: {
    height: 52,
    width: '100%',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
