import React from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface ConsentModalProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function ConsentModal({ visible, onAccept, onDecline }: ConsentModalProps) {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.iconContainer}>
            <IconSymbol name="camera.viewfinder" size={48} color={colors.tint} />
          </View>
          
          <Text style={[styles.title, { color: colors.text }]}>Body Measurement Camera</Text>
          
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

          <Text style={[styles.legalText, { color: colors.secondaryText }]}>
            By proceeding, you explicitly consent to the temporary processing of your biometric image data for the sole purpose of estimating body measurements, in accordance with our Privacy Policy.
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity 
              style={[styles.btn, styles.declineBtn, { borderColor: colors.border }]} 
              onPress={onDecline}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Decline</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.btn, styles.acceptBtn, { backgroundColor: colors.tint }]} 
              onPress={onAccept}
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
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 24,
    textAlign: 'center',
  },
  bulletList: {
    gap: 16,
    marginBottom: 24,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    marginBottom: 32,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
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
    fontSize: 16,
    fontWeight: '700',
  },
  acceptText: {
    color: '#0D0D0D',
  }
});
