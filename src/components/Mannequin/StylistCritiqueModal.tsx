import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StylistCritique, GradeLetter } from '@/src/utils/aiStylistAdvisor';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  visible: boolean;
  critique: StylistCritique;
  onClose: () => void;
  onSaveLook?: () => void;
}

export function StylistCritiqueModal({ visible, critique, onClose, onSaveLook }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  if (!visible) return null;

  const getGradeColor = (grade: GradeLetter): { bg: string; text: string; border: string } => {
    if (grade.startsWith('A')) {
      return { bg: 'rgba(34,197,94,0.15)', text: '#16A34A', border: '#22C55E' };
    }
    if (grade.startsWith('B')) {
      return { bg: 'rgba(59,130,246,0.15)', text: '#2563EB', border: '#3B82F6' };
    }
    if (grade.startsWith('C')) {
      return { bg: 'rgba(234,179,8,0.15)', text: '#CA8A04', border: '#EAB308' };
    }
    return { bg: 'rgba(239,68,68,0.15)', text: '#DC2626', border: '#EF4444' };
  };

  const getStatusBadge = (status: 'excellent' | 'good' | 'warning' | 'alert') => {
    switch (status) {
      case 'excellent':
        return { label: 'Excellent', color: '#16A34A', bg: 'rgba(34,197,94,0.12)' };
      case 'good':
        return { label: 'Good', color: colors.tint, bg: colors.tint + '18' };
      case 'warning':
        return { label: 'Attention', color: '#D97706', bg: 'rgba(217,119,6,0.12)' };
      case 'alert':
        return { label: 'Incomplete', color: '#DC2626', bg: 'rgba(220,38,38,0.12)' };
    }
  };

  const gradeStyle = getGradeColor(critique.grade);
  const colorPillarBadge = getStatusBadge(critique.pillars.colorHarmony.status);
  const compPillarBadge = getStatusBadge(critique.pillars.compositionAndLayers.status);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerTitleWrap}>
              <View style={[styles.headerBadge, { backgroundColor: colors.tint + '18' }]}>
                <IconSymbol name="sparkles" size={12} color={colors.tint} />
                <Text style={[styles.headerBadgeText, { color: colors.tint }]}>AI Stylist Critique</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close critique modal"
            >
              <IconSymbol name="xmark" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Top Score Banner */}
            <View style={[styles.scoreCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.scoreRow}>
                {/* Grade Badge */}
                <View
                  style={[
                    styles.gradeBadge,
                    { backgroundColor: gradeStyle.bg, borderColor: gradeStyle.border },
                  ]}
                >
                  <Text style={[styles.gradeText, { color: gradeStyle.text }]}>{critique.grade}</Text>
                  <Text style={[styles.gradeSub, { color: gradeStyle.text }]}>{critique.score}/100</Text>
                </View>

                {/* Headline & Vibe */}
                <View style={styles.scoreInfo}>
                  <Text style={[styles.scoreHeadline, { color: colors.text }]}>{critique.headline}</Text>
                  <View style={styles.vibeRow}>
                    <View style={[styles.vibePill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <IconSymbol name="tag.fill" size={10} color={colors.secondaryText} />
                      <Text style={[styles.vibeText, { color: colors.secondaryText }]}>{critique.vibe}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Progress meter */}
              <View style={[styles.meterTrack, { backgroundColor: colors.surface }]}>
                <View
                  style={[
                    styles.meterFill,
                    { width: `${Math.max(5, critique.score)}%`, backgroundColor: gradeStyle.border },
                  ]}
                />
              </View>
            </View>

            {/* Stylist Honest Verdict Quote */}
            <View style={[styles.verdictCard, { backgroundColor: colors.tint + '0C', borderColor: colors.tint + '30' }]}>
              <View style={styles.verdictHeader}>
                <IconSymbol name="bubble.left.and.bubble.right" size={13} color={colors.tint} />
                <Text style={[styles.verdictTitle, { color: colors.tint }]}>Stylist&apos;s Verdict</Text>
              </View>
              <Text style={[styles.verdictText, { color: colors.text }]}>
                &quot;{critique.verdict}&quot;
              </Text>
            </View>

            {/* Evaluated Color Palette Chips */}
            {critique.paletteColors.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Detected Palette</Text>
                <View style={styles.paletteRow}>
                  {critique.paletteColors.map((colorName, idx) => (
                    <View
                      key={idx}
                      style={[styles.paletteChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={[styles.colorDot, { backgroundColor: colorName.toLowerCase() }]} />
                      <Text style={[styles.paletteText, { color: colors.text }]}>
                        {colorName.charAt(0).toUpperCase() + colorName.slice(1)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Pillar 1: Color Chemistry */}
            <View style={[styles.pillarCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.pillarHeader}>
                <View style={styles.pillarTitleRow}>
                  <IconSymbol name="paintpalette.fill" size={14} color={colors.tint} />
                  <Text style={[styles.pillarTitle, { color: colors.text }]}>Color Chemistry</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: colorPillarBadge.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: colorPillarBadge.color }]}>
                    {colorPillarBadge.label}
                  </Text>
                </View>
              </View>
              <Text style={[styles.pillarSubtitle, { color: colors.tint }]}>
                {critique.pillars.colorHarmony.title} ({critique.pillars.colorHarmony.score}/100)
              </Text>
              <Text style={[styles.pillarFeedback, { color: colors.secondaryText }]}>
                {critique.pillars.colorHarmony.feedback}
              </Text>
            </View>

            {/* Pillar 2: Composition & Layering */}
            <View style={[styles.pillarCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.pillarHeader}>
                <View style={styles.pillarTitleRow}>
                  <IconSymbol name="tshirt.fill" size={14} color={colors.tint} />
                  <Text style={[styles.pillarTitle, { color: colors.text }]}>Composition & Layers</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: compPillarBadge.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: compPillarBadge.color }]}>
                    {compPillarBadge.label}
                  </Text>
                </View>
              </View>
              <Text style={[styles.pillarSubtitle, { color: colors.tint }]}>
                {critique.pillars.compositionAndLayers.title} ({critique.pillars.compositionAndLayers.score}/100)
              </Text>
              <Text style={[styles.pillarFeedback, { color: colors.secondaryText }]}>
                {critique.pillars.compositionAndLayers.feedback}
              </Text>
            </View>

            {/* Stylist Pro-Tips */}
            {critique.tips.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Stylist&apos;s Pro-Tips</Text>
                <View style={styles.tipsList}>
                  {critique.tips.map((tip, idx) => (
                    <View
                      key={idx}
                      style={[styles.tipCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={[styles.tipIconWrap, { backgroundColor: colors.tint + '18' }]}>
                        <IconSymbol name="lightbulb" size={12} color={colors.tint} />
                      </View>
                      <Text style={[styles.tipText, { color: colors.text }]}>{tip}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Fashion Stylist Disclaimer */}
            <View style={[styles.disclaimerCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.disclaimerHeader}>
                <IconSymbol name="info.circle.fill" size={12} color={colors.secondaryText} />
                <Text style={[styles.disclaimerTitle, { color: colors.secondaryText }]}>
                  Stylist Guidance Disclaimer
                </Text>
              </View>
              <Text style={[styles.disclaimerText, { color: colors.secondaryText }]}>
                Fashion critiques and grades are algorithmic styling recommendations based on classical color harmony geometry and garment composition rules. Personal style and creative expression are subjective.
              </Text>
            </View>
          </ScrollView>

          {/* Bottom Actions */}
          <View style={[styles.bottomBar, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
            {onSaveLook && critique.score > 0 && (
              <TouchableOpacity
                style={[styles.saveActionBtn, { backgroundColor: colors.tint }]}
                onPress={() => {
                  onClose();
                  onSaveLook();
                }}
              >
                <IconSymbol name="heart.fill" size={13} color={colors.onTint} />
                <Text style={[styles.saveActionText, { color: colors.onTint }]}>Save Styled Look</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.doneActionBtn,
                { borderColor: colors.border, backgroundColor: onSaveLook ? colors.surface : colors.tint },
              ]}
              onPress={onClose}
            >
              <Text
                style={[
                  styles.doneActionText,
                  { color: onSaveLook ? colors.text : colors.onTint },
                ]}
              >
                Continue Styling
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  content: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    gap: 5,
  },
  headerBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: 30,
    gap: Spacing.lg,
  },
  /* Score Card */
  scoreCard: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  gradeBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gradeText: {
    ...Type.headline,
    lineHeight: 28,
  },
  gradeSub: {
    fontSize: 10,
    fontWeight: '700',
  },
  scoreInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  scoreHeadline: {
    ...Type.bodyLargeStrong,
  },
  vibeRow: {
    flexDirection: 'row',
  },
  vibePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  vibeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  meterTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  meterFill: {
    height: '100%',
    borderRadius: 3,
  },
  /* Verdict Card */
  verdictCard: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 6,
  },
  verdictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verdictTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  verdictText: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  /* Palette Row */
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  paletteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
    gap: 6,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  paletteText: {
    fontSize: 12,
    fontWeight: '600',
  },
  /* Pillars */
  pillarCard: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 6,
  },
  pillarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pillarTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillarTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  pillarSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillarFeedback: {
    fontSize: 12,
    lineHeight: 18,
  },
  /* Tips */
  tipsList: {
    gap: Spacing.sm,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 10,
  },
  tipIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  /* Bottom Bar */
  bottomBar: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderTopWidth: 1,
    gap: 10,
  },
  saveActionBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    gap: 6,
  },
  saveActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  doneActionBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  doneActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  /* Disclaimer */
  disclaimerCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  disclaimerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  disclaimerTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  disclaimerText: {
    fontSize: 11,
    lineHeight: 16,
  },
});
