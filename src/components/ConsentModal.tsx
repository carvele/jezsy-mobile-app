import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface ConsentModalProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onPrivacyPress?: () => void;
}

export function ConsentModal({ visible, onAccept, onDecline, onPrivacyPress }: ConsentModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      accessibilityViewIsModal
      onRequestClose={onDecline}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.iconContainer}>
            <IconSymbol name="camera.viewfinder" size={48} color={colors.tint} />
          </View>
          
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            Body Measurement Camera
          </Text>
          
          <View style={styles.bulletList}>
            <View style={styles.bulletItem}>
              <IconSymbol name="eye.slash.fill" size={20} color={colors.tint} />
              <Text style={[styles.bulletText, { color: colors.text }]}>Your photos are processed entirely in-memory and are immediately deleted.</Text>
            </View>
            <View style={styles.bulletItem}>
              <IconSymbol name="cloud.fill" size={20} color={colors.tint} />
              <Text style={[styles.bulletText, { color: colors.text }]}>No images are ever saved to your device or uploaded to our servers.</Text>
            </View>
            <View style={styles.bulletItem}>
              <IconSymbol name="lock.fill" size={20} color={colors.tint} />
              <Text style={[styles.bulletText, { color: colors.text }]}>Only the final numerical measurements (in cm) are saved to your profile.</Text>
            </View>
          </View>

          <View style={styles.legalRow}>
            <Text style={[styles.legalText, { color: colors.secondaryText }]}>By proceeding, you explicitly consent to the temporary processing of your biometric image data for the sole purpose of estimating body measurements, in accordance with our </Text>
            <TouchableOpacity
              onPress={onPrivacyPress}
              disabled={!onPrivacyPress}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
              accessibilityState={{ disabled: !onPrivacyPress }}
            >
              <Text style={[styles.legalText, styles.privacyLink, { color: colors.tint }]}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={[styles.legalText, { color: colors.secondaryText }]}>.</Text>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity 
              style={[styles.btn, styles.declineBtn, { borderColor: colors.border }]} 
              onPress={onDecline}
              accessibilityRole="button"
              accessibilityLabel="Decline body measurement camera consent"
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Decline</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.btn, styles.acceptBtn, { backgroundColor: colors.tint }]} 
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel="Consent to body measurement camera processing"
            >
              <Text style={[styles.btnText, styles.acceptText]}>I Consent</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    padding: Spacing.xxl,
    borderWidth: 1,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: Spacing.xxl,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: Spacing.xxl,
    textAlign: 'center',
  },
  bulletList: {
    gap: Spacing.lg,
    marginBottom: Spacing.xxl,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  legalText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xxxl,
  },
  privacyLink: {
    textDecorationLine: 'underline',
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
  declineBtn: {
    borderWidth: 1,
  },
  acceptBtn: {},
  btnText: {
    ...Type.bodyLargeStrong,
  },
  acceptText: {
    
  }
});
