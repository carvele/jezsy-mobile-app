import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { Colors } from '@/constants/theme';
import { COUNTRIES, type Country } from '@/src/utils/profileFields';

interface Props {
  visible: boolean;
  selectedCountry: Country;
  onSelect: (country: Country) => void;
  onClose: () => void;
}

export function CountryPickerModal({ visible, selectedCountry, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Country</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.list}>
            {COUNTRIES.map((c) => (
              <TouchableOpacity
                key={c.code}
                style={[styles.item, selectedCountry.code === c.code && styles.itemActive]}
                onPress={() => onSelect(c)}
                activeOpacity={0.7}
              >
                <View style={styles.itemLeft}>
                  <Text style={styles.itemFlag}>{c.flag}</Text>
                  <Text style={styles.itemName}>{c.name}</Text>
                </View>
                <Text style={styles.itemDialCode}>{c.dialCode}</Text>
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
    backgroundColor: '#141414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 0.2 },
  closeBtn: { padding: 4 },
  closeText: { color: Colors.dark.tint, fontSize: 15, fontWeight: '600' },
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  itemActive: {
    borderColor: `${Colors.dark.tint}4D`,
    backgroundColor: 'rgba(201, 169, 110, 0.06)',
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemFlag: { fontSize: 20 },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  itemDialCode: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: '600' },
});
