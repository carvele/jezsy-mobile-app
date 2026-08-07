import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { Colors } from '@/constants/theme';
import { MONTH_NAMES, YEARS, DAYS, getDaysInMonth } from '@/src/utils/profileFields';

interface Props {
  visible: boolean;
  value: string; // MM/DD/YYYY
  onConfirm: (dob: string) => void;
  onClose: () => void;
}

const currentYear = new Date().getFullYear();

export function DobPickerModal({ visible, value, onConfirm, onClose }: Props) {
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
        <TouchableOpacity style={styles.sheet} activeOpacity={1}>
          <View style={styles.header}>
            <Text style={styles.title}>Date of Birth</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.columnsRow}>
            <View style={styles.column}>
              <Text style={styles.columnLabel}>MONTH</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.columnList}>
                {MONTH_NAMES.map((name, idx) => (
                  <TouchableOpacity
                    key={name}
                    style={[styles.item, month === idx && styles.itemActive]}
                    onPress={() => selectMonth(idx)}
                  >
                    <Text style={[styles.itemText, month === idx && styles.itemTextActive]}>
                      {name.substring(0, 3)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.column}>
              <Text style={styles.columnLabel}>DAY</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.columnList}>
                {DAYS.slice(0, getDaysInMonth(month, year)).map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.item, day === d && styles.itemActive]}
                    onPress={() => setDay(d)}
                  >
                    <Text style={[styles.itemText, day === d && styles.itemTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.column}>
              <Text style={styles.columnLabel}>YEAR</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.columnList}>
                {YEARS.map((yr) => (
                  <TouchableOpacity
                    key={yr}
                    style={[styles.item, year === yr && styles.itemActive]}
                    onPress={() => selectYear(yr)}
                  >
                    <Text style={[styles.itemText, year === yr && styles.itemTextActive]}>{yr}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <TouchableOpacity style={styles.confirmBtn} onPress={confirm} activeOpacity={0.8}>
            <Text style={[styles.confirmBtnText, { color: Colors.dark.onTint }]}>Confirm Date</Text>
          </TouchableOpacity>
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
  columnsRow: { flexDirection: 'row', justifyContent: 'space-between', height: 220, marginBottom: 20, gap: 8 },
  column: { flex: 1, alignItems: 'center' },
  columnLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  columnList: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  item: { height: 44, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.01)' },
  itemActive: { backgroundColor: 'rgba(201, 169, 110, 0.08)' },
  itemText: { color: 'rgba(255,255,255,0.45)', fontSize: 15, fontWeight: '500' },
  itemTextActive: { color: Colors.dark.tint, fontSize: 16, fontWeight: '700' },
  confirmBtn: { height: 50, backgroundColor: Colors.dark.tint, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  confirmBtnText: {  fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
