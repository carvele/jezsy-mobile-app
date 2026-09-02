import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { Colors, Type, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { COUNTRIES, type Country } from '@/src/utils/profileFields';

interface Props {
  visible: boolean;
  selectedCountry: Country;
  onSelect: (country: Country) => void;
  onClose: () => void;
}

export function CountryPickerModal({ visible, selectedCountry, onSelect, onClose }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={1}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Select Country</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={[styles.closeText, { color: colors.tint }]}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.list}>
            {COUNTRIES.map((c) => (
              <TouchableOpacity
                key={c.code}
                style={[
                  styles.item,
                  { backgroundColor: colors.surface, borderColor: 'transparent' },
                  selectedCountry.code === c.code && { borderColor: `${colors.tint}4D`, backgroundColor: `${colors.tint}18` },
                ]}
                onPress={() => onSelect(c)}
                activeOpacity={0.7}
              >
                <View style={styles.itemLeft}>
                  <Text style={styles.itemFlag}>{c.flag}</Text>
                  <Text style={[styles.itemName, { color: colors.text }]}>{c.name}</Text>
                </View>
                <Text style={[styles.itemDialCode, { color: colors.secondaryText }]}>{c.dialCode}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.xxl,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    maxHeight: '75%',
    borderWidth: 1,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
  title: { ...Type.subtitle, letterSpacing: 0.2 },
  closeBtn: { padding: Spacing.xs },
  closeText: { ...Type.bodyStrong },
  list: { gap: Spacing.sm },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    borderRadius: 12,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  itemFlag: { fontSize: 20 },
  itemName: { fontSize: 15, fontWeight: '500' },
  itemDialCode: { fontSize: 14, fontWeight: '600' },
});
