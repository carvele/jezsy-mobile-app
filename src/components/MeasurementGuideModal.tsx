import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface Props {
  visible: boolean;
  onClose: () => void;
  unit: 'cm' | 'in';
}

interface GuideItem {
  id: string;
  title: string;
  category: 'Primary' | 'Advanced';
  howTo: string;
  tip: string;
  typicalFemaleCm: string;
  typicalFemaleIn: string;
}

const GUIDE_ITEMS: GuideItem[] = [
  {
    id: 'bust',
    title: 'Bust / Chest',
    category: 'Primary',
    howTo: 'Wrap the tape measure around the fullest part of your bust, keeping the tape level across your back and parallel to the floor.',
    tip: 'Breathe normally and avoid holding your breath or pulling the tape too tight.',
    typicalFemaleCm: '82 – 102 cm',
    typicalFemaleIn: '32 – 40 in',
  },
  {
    id: 'waist',
    title: 'Natural Waist',
    category: 'Primary',
    howTo: 'Find the narrowest part of your torso, typically 2–3 cm above your belly button. Wrap the tape measure smoothly around this line.',
    tip: 'If unsure, bend gently to one side — your natural waist is where the crease forms.',
    typicalFemaleCm: '62 – 84 cm',
    typicalFemaleIn: '24 – 33 in',
  },
  {
    id: 'hips',
    title: 'Hips & Seat',
    category: 'Primary',
    howTo: 'Stand with your heels together. Wrap the measuring tape around the widest part of your hips and buttocks.',
    tip: 'Ensure the tape stays level all the way around without dipping at the back.',
    typicalFemaleCm: '88 – 110 cm',
    typicalFemaleIn: '35 – 43 in',
  },
  {
    id: 'inseam',
    title: 'Inseam Length',
    category: 'Primary',
    howTo: 'Measure from the highest point inside your crotch down along the inner leg to the bottom of your ankle bone.',
    tip: 'For greatest accuracy, measure along the inner seam of a well-fitting pair of pants.',
    typicalFemaleCm: '68 – 82 cm',
    typicalFemaleIn: '27 – 32 in',
  },
  {
    id: 'shoulderWidth',
    title: 'Shoulder Width',
    category: 'Advanced',
    howTo: 'Measure across the curve of your upper back from the tip of one shoulder bone to the tip of the other.',
    tip: 'Stand straight with relaxed shoulders. Having a friend measure this is easiest.',
    typicalFemaleCm: '35 – 43 cm',
    typicalFemaleIn: '14 – 17 in',
  },
  {
    id: 'armLength',
    title: 'Arm Length',
    category: 'Advanced',
    howTo: 'Measure from the top edge of your shoulder joint down the outside of your arm to your wrist bone.',
    tip: 'Keep your arm slightly relaxed or rested at your side.',
    typicalFemaleCm: '52 – 62 cm',
    typicalFemaleIn: '20 – 24 in',
  },
  {
    id: 'torsoLength',
    title: 'Torso Length',
    category: 'Advanced',
    howTo: 'Measure from the base of your neck (the prominent vertebra at the back) straight down your spine to your natural waistline.',
    tip: 'Tie a ribbon or string around your waist to mark the exact destination point.',
    typicalFemaleCm: '36 – 45 cm',
    typicalFemaleIn: '14 – 18 in',
  },
];

export function MeasurementGuideModal({ visible, onClose, unit }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [selectedCategory, setSelectedCategory] = useState<'All' | 'Primary' | 'Advanced'>('All');

  const filtered = GUIDE_ITEMS.filter((item) => {
    if (selectedCategory === 'All') return true;
    return item.category === selectedCategory;
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>Measurement Guide</Text>
            <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
              Tips to get accurate results in {unit.toUpperCase()} for your mannequin & sizes
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={[styles.closeBtn, { backgroundColor: colors.card }]}>
            <IconSymbol name="xmark" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Quick Tips Banner */}
        <View style={[styles.tipsBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.tipItem}>
            <Text style={styles.tipIcon}>📏</Text>
            <Text style={[styles.tipBannerText, { color: colors.text }]}>Use a soft, flexible tape measure</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipIcon}>✨</Text>
            <Text style={[styles.tipBannerText, { color: colors.text }]}>Keep the tape snug but not tight</Text>
          </View>
          <View style={styles.tipItem}>
            <Text style={styles.tipIcon}>👗</Text>
            <Text style={[styles.tipBannerText, { color: colors.text }]}>Wear fitted undergarments</Text>
          </View>
        </View>

        {/* Category Filters */}
        <View style={styles.filterRow}>
          {(['All', 'Primary', 'Advanced'] as const).map((cat) => {
            const active = selectedCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.filterChip,
                  { backgroundColor: active ? colors.tint : colors.card, borderColor: active ? colors.tint : colors.border },
                ]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[styles.filterChipText, { color: active ? colors.onTint : colors.text }]}>
                  {cat === 'All' ? 'All Measures' : `${cat} Fit`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Cards List */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {filtered.map((item) => (
            <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleWrap}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
                  <View style={[styles.badge, { backgroundColor: colors.surface }]}>
                    <Text style={[styles.badgeText, { color: colors.tint }]}>{item.category}</Text>
                  </View>
                </View>
                <Text style={[styles.rangeText, { color: colors.secondaryText }]}>
                  Typical: {unit === 'cm' ? item.typicalFemaleCm : item.typicalFemaleIn}
                </Text>
              </View>

              <Text style={[styles.howToText, { color: colors.text }]}>{item.howTo}</Text>

              <View style={[styles.proTipBox, { backgroundColor: colors.surface }]}>
                <IconSymbol name="lightbulb" size={13} color={colors.tint} style={{ marginTop: 2 }} />
                <Text style={[styles.proTipText, { color: colors.secondaryText }]}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>Pro tip: </Text>
                  {item.tip}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: {
    ...Type.subtitle,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipsBanner: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 6,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  tipIcon: {
    fontSize: 13,
  },
  tipBannerText: {
    ...Type.caption,
  },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: 36,
  },
  card: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  rangeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  howToText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  proTipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: Spacing.sm,
    borderRadius: Radius.sm,
  },
  proTipText: {
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
  },
});
