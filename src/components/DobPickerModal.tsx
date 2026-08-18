import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MONTH_NAMES, YEARS, DAYS, getDaysInMonth } from '@/src/utils/profileFields';

interface Props {
  visible: boolean;
  value: string; // MM/DD/YYYY
  onConfirm: (dob: string) => void;
  onClose: () => void;
}

const currentYear = new Date().getFullYear();

export function DobPickerModal({ visible, value, onConfirm, onClose }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [day, setDay] = useState(1);
  const [month, setMonth] = useState(0);
  const [year, setYear] = useState(2000);

  // Seed from the current field value each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const parts = value.split('/');
    if (parts.length === 3) {
      const m = parseInt(parts[0], 10) - 1;
      const d = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      if (!isNaN(m) && m >= 0 && m < 12) setMonth(m);
      if (!isNaN(d) && d > 0 && d <= 31) setDay(d);
      if (!isNaN(y) && y >= 1940 && y <= currentYear) setYear(y);
    }
  }, [visible, value]);

  const selectMonth = (mIndex: number) => {
    setMonth(mIndex);
    const maxDays = getDaysInMonth(mIndex, year);
    if (day > maxDays) setDay(maxDays);
  };

  const selectYear = (y: number) => {
    setYear(y);
    const maxDays = getDaysInMonth(month, y);
    if (day > maxDays) setDay(maxDays);
  };

  const confirm = () => {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onConfirm(`${mm}/${dd}/${year}`);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={1}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Date of Birth</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={[styles.closeText, { color: colors.tint }]}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.columnsRow}>
            <View style={styles.column}>
              <Text style={[styles.columnLabel, { color: colors.secondaryText }]}>MONTH</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={[styles.columnList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {MONTH_NAMES.map((name, idx) => (
                  <TouchableOpacity
                    key={name}
                    style={[styles.item, { borderBottomColor: colors.border }, month === idx && { backgroundColor: `${colors.tint}18` }]}
                    onPress={() => selectMonth(idx)}
                  >
                    <Text style={[styles.itemText, { color: colors.secondaryText }, month === idx && { color: colors.tint, fontSize: 16, fontWeight: '700' }]}>
                      {name.substring(0, 3)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.column}>
              <Text style={[styles.columnLabel, { color: colors.secondaryText }]}>DAY</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={[styles.columnList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {DAYS.slice(0, getDaysInMonth(month, year)).map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.item, { borderBottomColor: colors.border }, day === d && { backgroundColor: `${colors.tint}18` }]}
                    onPress={() => setDay(d)}
                  >
                    <Text style={[styles.itemText, { color: colors.secondaryText }, day === d && { color: colors.tint, fontSize: 16, fontWeight: '700' }]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.column}>
              <Text style={[styles.columnLabel, { color: colors.secondaryText }]}>YEAR</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={[styles.columnList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {YEARS.map((yr) => (
                  <TouchableOpacity
                    key={yr}
                    style={[styles.item, { borderBottomColor: colors.border }, year === yr && { backgroundColor: `${colors.tint}18` }]}
                    onPress={() => selectYear(yr)}
                  >
                    <Text style={[styles.itemText, { color: colors.secondaryText }, year === yr && { color: colors.tint, fontSize: 16, fontWeight: '700' }]}>{yr}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.tint }]} onPress={confirm} activeOpacity={0.8}>
            <Text style={[styles.confirmBtnText, { color: colors.onTint }]}>Confirm Date</Text>
          </TouchableOpacity>
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
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    maxHeight: '75%',
    borderWidth: 1,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: 0.2 },
  closeBtn: { padding: 4 },
  closeText: { fontSize: 15, fontWeight: '600' },
  columnsRow: { flexDirection: 'row', justifyContent: 'space-between', height: 220, marginBottom: 20, gap: 8 },
  column: { flex: 1, alignItems: 'center' },
  columnLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  columnList: {
    flex: 1,
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
  },
  item: { height: 44, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1 },
  itemText: { fontSize: 15, fontWeight: '500' },
  confirmBtn: { height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  confirmBtnText: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
