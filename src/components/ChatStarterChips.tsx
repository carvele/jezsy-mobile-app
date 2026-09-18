import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Shown only on a brand-new conversation, before the customer has typed
// anything -- a lower-friction start than a blank input box. Selecting one
// sends its text through the same path as a manually typed message.
export const STARTER_MESSAGES: { label: string; text: string }[] = [
  { label: 'Track My Order', text: "Hi! I'd like to check the status of my reservation." },
  { label: 'Product Sizing', text: 'Hi! I have a question about sizing for an item.' },
  { label: 'Return / Refund Policy', text: 'Hi! I have a question about your return/refund policy.' },
  { label: 'Store Pickup', text: 'Hi! I have a question about picking up my reservation.' },
];

interface ChatStarterChipsProps {
  onSelect: (text: string) => void;
}

export function ChatStarterChips({ onSelect }: ChatStarterChipsProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <View style={styles.container}>
      <Text style={[styles.prompt, { color: colors.secondaryText }]}>How can we help?</Text>
      <View style={styles.chipRow}>
        {STARTER_MESSAGES.map((starter) => (
          <TouchableOpacity
            key={starter.label}
            style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => onSelect(starter.text)}
            accessibilityRole="button"
            accessibilityLabel={`Send starter message: ${starter.label}`}
          >
            <Text style={[styles.chipText, { color: colors.text }]}>{starter.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
  },
  prompt: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: Spacing.lg,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
