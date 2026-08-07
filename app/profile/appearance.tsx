import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemePreference, ThemePreference } from '@/src/context/ThemeContext';

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: 'circle.lefthalf.filled' | 'sun.max.fill' | 'moon.fill' }[] = [
  { value: 'system', label: 'Match device', hint: 'Follows your phone display setting', icon: 'circle.lefthalf.filled' },
  { value: 'light', label: 'Light', hint: 'Always light, whatever the device does', icon: 'sun.max.fill' },
  { value: 'dark', label: 'Dark', hint: 'Always dark, whatever the device does', icon: 'moon.fill' },
];

export default function AppearanceScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { preference, setPreference } = useThemePreference();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Appearance</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: colors.secondaryText }]}>
          Choose how JezSy looks. Changes apply straight away.
        </Text>

        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {OPTIONS.map((option, index) => {
            const isSelected = preference === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.row,
                  { borderBottomColor: colors.border },
                  index === OPTIONS.length - 1 && styles.rowLast,
                ]}
                onPress={() => setPreference(option.value)}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityHint={option.hint}
                accessibilityState={{ selected: isSelected, checked: isSelected }}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                  <IconSymbol name={option.icon} size={20} color={colors.tint} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: colors.text }]}>{option.label}</Text>
                  <Text style={[styles.rowHint, { color: colors.secondaryText }]}>{option.hint}</Text>
                </View>
                {isSelected ? (
                  <IconSymbol name="checkmark.circle.fill" size={22} color={colors.tint} />
                ) : (
                  <View style={[styles.emptyCheck, { borderColor: colors.border }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: { padding: Spacing.sm },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: Spacing.xl },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: Spacing.xl },
  group: { borderRadius: Radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: { borderBottomWidth: 0 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 2 },
  emptyCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
});
