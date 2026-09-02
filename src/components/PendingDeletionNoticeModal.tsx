import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { withdrawDeletionRequest } from '@/src/utils/accountDeletion';
import type { DeletionRequestStatus } from '@/src/utils/accountDeletion';
import { useToast } from '@/src/context/ToastContext';

interface PendingDeletionNoticeModalProps {
  visible: boolean;
  requestId: string;
  status: DeletionRequestStatus;
  onResolved: () => void;
  onDismiss: () => void;
}

/**
 * Shown once per app launch when the signed-in user has a pending
 * account_deletion_request -- an explicit, visible confirmation, not a
 * silent side effect of opening the app (Nielsen's "visibility of system
 * status" heuristic: cancelling a customer's own filed request should never
 * happen invisibly). The account itself was never locked or logged out for
 * having a pending request -- see account-settings.tsx's own copy -- so this
 * is a notice, not a login gate.
 */
export function PendingDeletionNoticeModal({ visible, requestId, status, onResolved, onDismiss }: PendingDeletionNoticeModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleKeepAccount = async () => {
    if (status !== 'pending') return;
    setBusy(true);
    try {
      await withdrawDeletionRequest(requestId);
      showToast('Deletion request cancelled. Welcome back!', 'success');
      onResolved();
    } catch (err: any) {
      showToast(err.message ?? 'Could not cancel the request. Try again from Account Settings.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
            <IconSymbol name="clock.arrow.circlepath" size={28} color={colors.tint} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            {status === 'pending' ? 'Account deletion pending' : 'Account deletion is being finalized'}
          </Text>
          <Text style={[styles.body, { color: colors.secondaryText }]}>
            {status === 'pending'
              ? 'You have a pending request to delete this account. It hasn\'t been processed yet, so nothing has been removed. If you\'d like to keep using JezSy, confirm below and we\'ll cancel the request.'
              : 'Your data has been erased and account access is being revoked. No action is required. Contact support if you can still sign in after a few minutes.'}
          </Text>

          {status === 'pending' && <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.tint, opacity: busy ? 0.7 : 1 }]}
            onPress={handleKeepAccount}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Keep my account and cancel the deletion request"
          >
            {busy ? <ActivityIndicator color={colors.onTint} /> : (
              <Text style={[styles.primaryBtnText, { color: colors.onTint }]}>Keep My Account</Text>
            )}
          </TouchableOpacity>}

          <TouchableOpacity
            onPress={onDismiss}
            disabled={busy}
            style={styles.dismissBtn}
            accessibilityRole="button"
            accessibilityLabel={status === 'pending' ? 'Not now, I still want my account deleted' : 'Close deletion status notice'}
          >
            <Text style={[styles.dismissText, { color: colors.secondaryText }]}>
              {status === 'pending' ? 'Not now -- I still want it deleted' : 'Close'}
            </Text>
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
    ...Type.subtitle,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  primaryBtn: {
    height: 52,
    width: '100%',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
  dismissBtn: {
    marginTop: Spacing.lg,
    padding: Spacing.sm,
  },
  dismissText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
