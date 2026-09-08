import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string;
  items?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// System-styled stand-in for window.confirm()/Alert.alert() so a confirmation
// looks the same as every other in-app dialog (ConsentModal, etc.) on every
// platform -- the browser's native confirm() renders as an unstyled OS popup
// that visually breaks the app's design on web.
export function ConfirmModal({
  visible,
  title,
  message,
  items,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <Modal visible={visible} transparent animationType="fade" accessibilityViewIsModal onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {title}
          </Text>

          {message ? <Text style={[styles.message, { color: colors.secondaryText }]}>{message}</Text> : null}

          {items && items.length > 0 && (
            <View style={styles.itemList}>
              {items.map((item, i) => (
                <View key={i} style={styles.itemRow}>
                  <View style={[styles.bullet, { backgroundColor: colors.tint }]} />
                  <Text style={[styles.itemText, { color: colors.text }]}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn, { borderColor: colors.border }]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>{cancelLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn, { backgroundColor: colors.tint }]}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <Text style={[styles.btnText, styles.confirmText]}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
  itemList: {
    gap: Spacing.sm,
    marginBottom: Spacing.xxl,
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
  confirmText: {},
});
