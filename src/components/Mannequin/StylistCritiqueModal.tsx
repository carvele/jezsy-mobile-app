import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StylistCritique, OverallAssessment } from '@/src/utils/aiStylistAdvisor';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/** CSS only recognizes single-word color names; multi-word fashion terms (e.g. "neon green")
 * usually end in the base hue, so fall back to the last word rather than rendering no color. */
function resolveSwatchColor(colorName: string): string {
  const trimmed = colorName.trim().toLowerCase();
  const words = trimmed.split(/\s+/);
  return words[words.length - 1] || trimmed;
}

interface Props {
  visible: boolean;
  critique: StylistCritique;
  occasion?: string;
  onClose: () => void;
  onSaveLook?: () => void;
  onFeedback?: (feedbackType: 'liked' | 'passed' | 'worn') => void;
  feedbackGiven?: 'liked' | 'passed' | 'worn' | null;
}

export function StylistCritiqueModal({
  visible,
  critique,
  occasion,
  onClose,
  onSaveLook,
  onFeedback,
  feedbackGiven,
}: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];

  if (!visible) return null;

  const effectiveOccasion = critique.context?.occasion || occasion;
  const additionalContext = critique.context?.additionalContext;

  const getAssessmentStyle = (assessment: OverallAssessment) => {
    switch (assessment) {
      case 'Appropriate for this occasion':
        return {
          bg: 'rgba(34,197,94,0.15)',
          text: '#16A34A',
          border: '#22C55E',
          icon: 'checkmark.circle.fill' as const,
        };
      case 'Could work with changes':
        return {
          bg: 'rgba(234,179,8,0.15)',
          text: '#CA8A04',
          border: '#EAB308',
          icon: 'exclamationmark.triangle.fill' as const,
        };
      case 'Not appropriate for this occasion':
        return {
          bg: 'rgba(239,68,68,0.15)',
          text: '#DC2626',
          border: '#EF4444',
          icon: 'xmark.circle.fill' as const,
        };
      case 'Incomplete outfit':
      default:
        return {
          bg: 'rgba(59,130,246,0.15)',
          text: '#2563EB',
          border: '#3B82F6',
          icon: 'exclamationmark.circle' as const,
        };
    }
  };

  const assessmentStyle = getAssessmentStyle(critique.assessment);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerTitleWrap}>
              <View style={[styles.headerBadge, { backgroundColor: colors.tint + '18' }]}>
                <IconSymbol name="sparkles" size={13} color={colors.tint} />
                <Text style={[styles.headerBadgeText, { color: colors.tint }]}>
                  {critique.analysisMode === 'hybridLLM' ? 'JeZsy AI Stylist' : 'JeZsy Stylist'}
                </Text>
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
            {/* YOUR CONTEXT */}
            {effectiveOccasion ? (
              <View style={[styles.contextCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.contextSectionLabel, { color: colors.secondaryText }]}>YOUR CONTEXT</Text>
                <View style={styles.contextRow}>
                  <Text style={[styles.contextFieldLabel, { color: colors.text }]}>Where: </Text>
                  <Text style={[styles.contextFieldValue, { color: colors.text }]}>{effectiveOccasion}</Text>
                </View>
                {additionalContext ? (
                  <View style={[styles.contextRow, { marginTop: 4 }]}>
                    <Text style={[styles.contextFieldLabel, { color: colors.text }]}>Additional context: </Text>
                    <Text style={[styles.contextFieldValue, { color: colors.secondaryText }]}>{additionalContext}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* DEV Diagnostic Freshness Indicator */}
            {__DEV__ && critique.analysisId ? (
              <View
                style={[
                  styles.contextCard,
                  { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 8, padding: 10 },
                ]}
              >
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.secondaryText, letterSpacing: 0.5 }}>
                  STYLIST DIAGNOSTICS (DEV)
                </Text>
                <Text style={{ fontSize: 11, color: colors.text, marginTop: 2 }}>
                  Instance: {critique.analysisId}
                </Text>
                <Text style={{ fontSize: 11, color: colors.secondaryText }}>
                  Engine: v{critique.analysisVersion || '3.0.0'} | Mode: {critique.analysisMode || 'ruleBasedEvidence'}
                </Text>
                <Text style={{ fontSize: 11, color: colors.secondaryText }}>
                  Provider: {critique.aiProvider || 'none'} | Model: {critique.aiModel || 'none'}
                </Text>
                <Text style={{ fontSize: 11, color: colors.secondaryText }}>
                  Evidence Count: {critique.evidenceCount || 0}
                </Text>
                <Text style={{ fontSize: 11, color: colors.secondaryText }}>
                  Context Hash: {critique.contextHash} | Outfit Hash: {critique.outfitHash}
                </Text>
                {critique.mannequinItems && critique.mannequinItems.length > 0 ? (
                  <Text style={{ fontSize: 10, color: colors.text, marginTop: 2 }} numberOfLines={2}>
                    Items: {critique.mannequinItems.map((i) => `${i.name || i.garment_type}`).join(' + ')}
                  </Text>
                ) : null}
                {critique.fallbackReason ? (
                  <Text style={{ fontSize: 10, color: colors.secondaryText, fontStyle: 'italic', marginTop: 2 }}>
                    Fallback note: {critique.fallbackReason}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* YOUR OUTFIT — Actual Mannequin Items */}
            {critique.mannequinItems && critique.mannequinItems.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Outfit</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.outfitItemsRow}
                >
                  {critique.mannequinItems.map((item, idx) => (
                    <View
                      key={item.id || idx}
                      style={[styles.outfitItemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      {item.image_url ? (
                        <Image source={{ uri: item.image_url }} style={styles.outfitItemImage} contentFit="contain" />
                      ) : (
                        <View style={[styles.outfitItemPlaceholder, { backgroundColor: colors.surface }]}>
                          <IconSymbol name="tshirt.fill" size={22} color={colors.secondaryText} />
                        </View>
                      )}
                      <Text style={[styles.outfitItemName, { color: colors.text }]} numberOfLines={1}>
                        {item.name || 'Garment'}
                      </Text>
                      <Text style={[styles.outfitItemType, { color: colors.secondaryText }]} numberOfLines={1}>
                        {item.garment_type || 'Piece'}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* OVERALL ASSESSMENT (Qualitative - No 0-100 or letter scores) */}
            <View style={[styles.assessmentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.assessmentHeader}>
                <View
                  style={[
                    styles.assessmentPill,
                    { backgroundColor: assessmentStyle.bg, borderColor: assessmentStyle.border },
                  ]}
                >
                  <IconSymbol name={assessmentStyle.icon} size={14} color={assessmentStyle.text} />
                  <Text style={[styles.assessmentPillText, { color: assessmentStyle.text }]}>
                    {critique.assessment}
                  </Text>
                </View>

                {critique.vibe ? (
                  <View style={[styles.vibePill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <IconSymbol name="tag.fill" size={10} color={colors.secondaryText} />
                    <Text style={[styles.vibeText, { color: colors.secondaryText }]}>{critique.vibe}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[styles.assessmentHeadline, { color: colors.text }]}>{critique.headline}</Text>
              {critique.verdict ? (
                <Text style={[styles.assessmentVerdict, { color: colors.secondaryText }]}>
                  {critique.verdict}
                </Text>
              ) : null}
            </View>

            {/* WHY JEZSY SAYS THIS — Evidence-grounded explanation */}
            {critique.whyJezsySaysThis ? (
              <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.insightHeader}>
                  <View style={[styles.insightIconBadge, { backgroundColor: colors.tint + '18' }]}>
                    <IconSymbol name="sparkles" size={13} color={colors.tint} />
                  </View>
                  <Text style={[styles.insightTitle, { color: colors.tint }]}>WHY JEZSY SAYS THIS</Text>
                </View>
                <Text style={[styles.insightBody, { color: colors.text }]}>{critique.whyJezsySaysThis}</Text>
              </View>
            ) : null}

            {/* Evaluated Color Palette Chips */}
            {critique.paletteColors && critique.paletteColors.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Colors in This Outfit</Text>
                <View style={styles.paletteRow}>
                  {critique.paletteColors.map((colorName, idx) => (
                    <View
                      key={idx}
                      style={[styles.paletteChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={[styles.colorDot, { backgroundColor: resolveSwatchColor(colorName) }]} />
                      <Text style={[styles.paletteText, { color: colors.text }]}>
                        {colorName.charAt(0).toUpperCase() + colorName.slice(1)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* WHAT WORKS — Strictly omitted when outfit lacks genuine strengths or has unmitigated conflicts */}
            {critique.whatWorks && (
              <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: 'rgba(34,197,94,0.3)' }]}>
                <View style={styles.insightHeader}>
                  <View style={[styles.insightIconBadge, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                    <IconSymbol name="checkmark.circle.fill" size={13} color="#16A34A" />
                  </View>
                  <Text style={[styles.insightTitle, { color: '#16A34A' }]}>WHAT WORKS</Text>
                </View>
                <Text style={[styles.insightBody, { color: colors.text }]}>{critique.whatWorks}</Text>
              </View>
            )}

            {/* WHAT COULD BE BETTER — Specific grounded issues */}
            {critique.whatCouldBeBetter && (
              <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: 'rgba(217,119,6,0.3)' }]}>
                <View style={styles.insightHeader}>
                  <View style={[styles.insightIconBadge, { backgroundColor: 'rgba(217,119,6,0.15)' }]}>
                    <IconSymbol name="exclamationmark.triangle.fill" size={13} color="#D97706" />
                  </View>
                  <Text style={[styles.insightTitle, { color: '#D97706' }]}>WHAT COULD BE BETTER</Text>
                </View>
                <Text style={[styles.insightBody, { color: colors.text }]}>{critique.whatCouldBeBetter}</Text>
              </View>
            )}

            {/* WHAT'S MISSING — Rendered ONLY when something is genuinely missing */}
            {critique.whatsMissing && (
              <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: 'rgba(239,68,68,0.3)' }]}>
                <View style={styles.insightHeader}>
                  <View style={[styles.insightIconBadge, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
                    <IconSymbol name="exclamationmark.circle" size={13} color="#DC2626" />
                  </View>
                  <Text style={[styles.insightTitle, { color: '#DC2626' }]}>WHAT&apos;S MISSING</Text>
                </View>
                <Text style={[styles.insightBody, { color: colors.text }]}>{critique.whatsMissing}</Text>
              </View>
            )}

            {/* WARDROBE ALTERNATIVES — Real owned wardrobe items only */}
            {critique.wardrobeAlternatives && critique.wardrobeAlternatives.length > 0 && (
              <View style={[styles.insightCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.insightHeader}>
                  <View style={[styles.insightIconBadge, { backgroundColor: colors.tint + '18' }]}>
                    <IconSymbol name="tshirt.fill" size={13} color={colors.tint} />
                  </View>
                  <Text style={[styles.insightTitle, { color: colors.tint }]}>WARDROBE ALTERNATIVES</Text>
                </View>
                {critique.wardrobeAlternatives.map((alt, idx) => (
                  <View key={idx} style={[styles.altItemRow, idx > 0 && { marginTop: 8 }]}>
                    <IconSymbol
                      name={alt.found ? 'checkmark.circle.fill' : 'info.circle.fill'}
                      size={14}
                      color={alt.found ? '#16A34A' : colors.secondaryText}
                    />
                    <Text style={[styles.altItemText, { color: colors.text }]}>
                      {alt.recommendationText}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* STYLIST'S TAKE — Honest, direct assessment */}
            <View style={[styles.takeCard, { backgroundColor: colors.tint + '0C', borderColor: colors.tint + '30' }]}>
              <View style={styles.takeHeader}>
                <IconSymbol name="bubble.left.and.bubble.right" size={13} color={colors.tint} />
                <Text style={[styles.takeTitle, { color: colors.tint }]}>Stylist&apos;s Take</Text>
              </View>
              <Text style={[styles.takeText, { color: colors.text }]}>
                &quot;{critique.stylistsTake || critique.verdict}&quot;
              </Text>
            </View>

            {/* STYLIST TIPS — Actionable recommendations */}
            {critique.tips && critique.tips.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Stylist Tips</Text>
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

            {/* Personalization: Train Your Stylist */}
            {onFeedback && (
              <View style={[styles.feedbackSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.feedbackHeader}>
                  <IconSymbol name="sparkles" size={13} color={colors.tint} />
                  <Text style={[styles.feedbackTitle, { color: colors.text }]}>Train Your Stylist</Text>
                </View>
                <Text style={[styles.feedbackSub, { color: colors.secondaryText }]}>
                  Does this outfit match your personal style?
                </Text>
                <View style={styles.feedbackBtnRow}>
                  <TouchableOpacity
                    style={[
                      styles.feedbackChip,
                      { borderColor: colors.border, backgroundColor: feedbackGiven === 'liked' ? colors.tint + '20' : colors.surface },
                      feedbackGiven === 'liked' && { borderColor: colors.tint },
                    ]}
                    onPress={() => onFeedback('liked')}
                    accessibilityRole="button"
                    accessibilityLabel="Like this outfit"
                  >
                    <IconSymbol name="hand.thumbsup.fill" size={13} color={feedbackGiven === 'liked' ? colors.tint : colors.text} />
                    <Text style={[styles.feedbackChipText, { color: feedbackGiven === 'liked' ? colors.tint : colors.text }]}>
                      Like
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.feedbackChip,
                      { borderColor: colors.border, backgroundColor: feedbackGiven === 'passed' ? 'rgba(239,68,68,0.15)' : colors.surface },
                      feedbackGiven === 'passed' && { borderColor: '#EF4444' },
                    ]}
                    onPress={() => onFeedback('passed')}
                    accessibilityRole="button"
                    accessibilityLabel="Pass on this outfit"
                  >
                    <IconSymbol name="hand.thumbsdown.fill" size={13} color={feedbackGiven === 'passed' ? '#EF4444' : colors.text} />
                    <Text style={[styles.feedbackChipText, { color: feedbackGiven === 'passed' ? '#EF4444' : colors.text }]}>
                      Pass
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.feedbackChip,
                      { borderColor: colors.border, backgroundColor: feedbackGiven === 'worn' ? 'rgba(34,197,94,0.15)' : colors.surface },
                      feedbackGiven === 'worn' && { borderColor: '#16A34A' },
                    ]}
                    onPress={() => onFeedback('worn')}
                    accessibilityRole="button"
                    accessibilityLabel="Mark as worn"
                  >
                    <IconSymbol name="checkmark.circle.fill" size={13} color={feedbackGiven === 'worn' ? '#16A34A' : colors.text} />
                    <Text style={[styles.feedbackChipText, { color: feedbackGiven === 'worn' ? '#16A34A' : colors.text }]}>
                      Wore This
                    </Text>
                  </TouchableOpacity>
                </View>
                {feedbackGiven && (
                  <Text style={[styles.feedbackSavedNote, { color: colors.tint }]}>
                    Preference saved! JeZsy will personalize future styling based on this.
                  </Text>
                )}
              </View>
            )}

            {/* Stylist Context Disclaimer */}
            <View style={[styles.disclaimerCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.disclaimerHeader}>
                <IconSymbol name="info.circle.fill" size={12} color={colors.secondaryText} />
                <Text style={[styles.disclaimerTitle, { color: colors.secondaryText }]}>
                  About JeZsy&apos;s Stylist
                </Text>
              </View>
              <Text style={[styles.disclaimerText, { color: colors.secondaryText }]}>
                JeZsy evaluates outfit compatibility against your selected occasion using garment structure, dress code appropriateness, completeness, and color harmony. Personal style is subjective.
              </Text>
            </View>
          </ScrollView>

          {/* Bottom Actions */}
          <View style={[styles.bottomBar, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
            {onSaveLook && critique.mannequinItems && critique.mannequinItems.length > 0 && (
              <TouchableOpacity
                style={[styles.saveActionBtn, { backgroundColor: colors.tint }]}
                onPress={() => {
                  onClose();
                  onSaveLook();
                }}
                accessibilityRole="button"
                accessibilityLabel="Save styled look"
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
              accessibilityRole="button"
              accessibilityLabel="Continue styling"
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
    maxHeight: SCREEN_HEIGHT * 0.88,
    // Center and cap on desktop/tablet so the sheet doesn't stretch full-width.
    ...(Platform.OS === 'web' ? { maxWidth: 600, alignSelf: 'center' as const, width: '100%' } : {}),
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
  /* Context Card */
  contextCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 6,
  },
  contextSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  contextFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  contextFieldValue: {
    fontSize: 13,
  },
  altItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  altItemText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  /* Your Outfit Items */
  outfitItemsRow: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  outfitItemCard: {
    width: 90,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.xs,
    alignItems: 'center',
  },
  outfitItemImage: {
    width: 64,
    height: 64,
    borderRadius: Radius.sm,
    marginBottom: 4,
  },
  outfitItemPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: Radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  outfitItemName: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  outfitItemType: {
    fontSize: 9,
    textAlign: 'center',
    width: '100%',
  },
  /* Overall Assessment Card */
  assessmentCard: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  assessmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  assessmentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  assessmentPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  vibePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  vibeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  assessmentHeadline: {
    ...Type.bodyLargeStrong,
    fontSize: 16,
    marginTop: 4,
  },
  assessmentVerdict: {
    fontSize: 13,
    lineHeight: 18,
  },
  /* Stylist's Take Card */
  takeCard: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 6,
  },
  takeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  takeTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  takeText: {
    fontSize: 13,
    lineHeight: 19,
  },
  /* Insights: What Works, What Could Be Better, What's Missing */
  insightCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  insightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  insightIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  insightTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  insightBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  /* Palette */
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    ...Type.label,
  },
  paletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  paletteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
    gap: 5,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  paletteText: {
    fontSize: 11,
    fontWeight: '600',
  },
  /* Tips */
  tipsList: {
    gap: Spacing.xs,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  tipIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  /* Feedback */
  feedbackSection: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  feedbackTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  feedbackSub: {
    fontSize: 12,
    marginBottom: 4,
  },
  feedbackBtnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  feedbackChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 4,
  },
  feedbackChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  feedbackSavedNote: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  /* Disclaimer */
  disclaimerCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  disclaimerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  disclaimerTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  disclaimerText: {
    fontSize: 11,
    lineHeight: 16,
  },
  /* Bottom Bar */
  bottomBar: {
    padding: Spacing.md,
    borderTopWidth: 1,
    gap: Spacing.xs,
  },
  saveActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
    gap: 6,
  },
  saveActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  doneActionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  doneActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
