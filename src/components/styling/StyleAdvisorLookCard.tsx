import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Colors, Spacing, Radius, Type, WardrobeTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StylingOption, StylingRefinementType } from '@/src/types/styleAdvisor';
import { DeterministicFlatLayCanvas } from '@/src/components/styling/DeterministicFlatLayCanvas';
import { tapLight, tapMedium } from '@/src/utils/haptics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental && !(globalThis as any).nativeFabricUIManager) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  look: StylingOption;
  index: number;
  onSave: (look: StylingOption) => Promise<void> | void;
  onOpenMannequin: (look: StylingOption) => Promise<void> | void;
  onRefine?: (refinement: StylingRefinementType, targetItemId?: string) => void;
  isSaved?: boolean;
  isSaving?: boolean;
  isTransferring?: boolean;
}

export function StyleAdvisorLookCard({
  look,
  index,
  onSave,
  onOpenMannequin,
  onRefine,
  isSaved = false,
  isSaving = false,
  isTransferring = false,
}: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const wt = WardrobeTokens.theme[theme];
  const [expanded, setExpanded] = useState(false);
  const [showRefineMenu, setShowRefineMenu] = useState(false);

  const toggleExpanded = () => {
    tapLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  const toggleRefineMenu = () => {
    tapLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowRefineMenu((prev) => !prev);
  };

  const handleRefineAction = (refinement: StylingRefinementType) => {
    tapLight();
    setShowRefineMenu(false);
    onRefine?.(refinement);
  };

  const wtw = look.whyThisWorks;

  return (
    <View style={[styles.card, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}>
      {/* ── Look Header ── */}
      <View style={styles.header}>
        <View style={styles.titleColumn}>
          <Text style={[styles.lookNumber, { color: wt.actionSecondaryText }]}>
            Look {index + 1} · {look.label}
          </Text>
          <Text style={[styles.headline, { color: colors.text }]} numberOfLines={2}>
            {look.headline}
          </Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: wt.accentGoldSubtle, borderColor: wt.cardBorder }]}>
          <Text style={[styles.scoreText, { color: wt.actionPrimary }]}>{look.score}/100</Text>
        </View>
      </View>

      {/* ── Flat-Lay Visual Canvas ── */}
      <View style={styles.canvasContainer}>
        <DeterministicFlatLayCanvas items={look.items} height={260} />
      </View>

      {/* ── Grounded Summary & Why This Works Accordion ── */}
      <View style={styles.explanationSection}>
        <Text style={[styles.intentMatch, { color: colors.secondaryText }]}>
          {look.intentMatch}
        </Text>

        <TouchableOpacity
          style={styles.expandHeader}
          onPress={toggleExpanded}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Hide styling rationale' : 'View styling rationale'}
          accessibilityState={{ expanded }}
        >
          <Text style={[styles.expandTitle, { color: wt.actionPrimary }]}>
            {expanded ? 'Hide Styling Rationale' : 'Why This Works'}
          </Text>
          <IconSymbol
            name={expanded ? 'chevron.up' : 'chevron.down'}
            size={14}
            color={wt.actionPrimary}
          />
        </TouchableOpacity>

        {expanded && wtw && (
          <View style={[styles.detailsBox, { backgroundColor: wt.cardSurfaceSubtle, borderColor: wt.cardBorder }]}>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>Palette:</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{wtw.palette}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>Silhouette:</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{wtw.silhouette}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>Occasion:</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>{wtw.occasion}</Text>
            </View>
            {wtw.layering && (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>Layering:</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{wtw.layering}</Text>
              </View>
            )}
            {wtw.footwear && (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>Footwear:</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{wtw.footwear}</Text>
              </View>
            )}
            {look.proTip && (
              <View style={[styles.proTipBox, { borderLeftColor: wt.actionPrimary }]}>
                <Text style={[styles.proTipText, { color: colors.text }]}>
                  <Text style={{ fontWeight: '700', color: wt.actionPrimary }}>Stylist Tip: </Text>
                  {look.proTip}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* ── Refinement Menu Sheet (if opened) ── */}
      {showRefineMenu && (
        <View style={[styles.refineMenu, { backgroundColor: wt.cardSurfaceSubtle, borderColor: wt.cardBorder }]}>
          <Text style={[styles.refineMenuTitle, { color: colors.secondaryText }]}>Refine this styling session:</Text>
          <View style={styles.refineButtonsGrid}>
            <TouchableOpacity
              style={[styles.refinePill, { borderColor: wt.cardBorder }]}
              onPress={() => handleRefineAction('tryAnother')}
              accessibilityRole="button"
              accessibilityLabel="Try another outfit combination"
            >
              <Text style={[styles.refinePillText, { color: colors.text }]}>Try Another</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.refinePill, { borderColor: wt.cardBorder }]}
              onPress={() => handleRefineAction('moreFormal')}
              accessibilityRole="button"
              accessibilityLabel="Elevate formality"
            >
              <Text style={[styles.refinePillText, { color: colors.text }]}>More Formal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.refinePill, { borderColor: wt.cardBorder }]}
              onPress={() => handleRefineAction('moreRelaxed')}
              accessibilityRole="button"
              accessibilityLabel="More relaxed formality"
            >
              <Text style={[styles.refinePillText, { color: colors.text }]}>More Relaxed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.refinePill, { borderColor: wt.cardBorder }]}
              onPress={() => handleRefineAction('moreComfortable')}
              accessibilityRole="button"
              accessibilityLabel="Prioritize comfort"
            >
              <Text style={[styles.refinePillText, { color: colors.text }]}>More Comfortable</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Main Actions Row ── */}
      <View style={styles.actionRow}>
        {/* Save Look button */}
        <TouchableOpacity
          style={[
            styles.actionBtn,
            styles.saveBtn,
            isSaved
              ? { backgroundColor: wt.actionSecondary, borderColor: wt.cardBorder, borderWidth: 1 }
              : { backgroundColor: wt.actionPrimary, opacity: isSaving ? 0.6 : 1 },
          ]}
          onPress={() => {
            if (isSaved || isSaving) return;
            tapMedium();
            onSave(look);
          }}
          disabled={isSaved || isSaving}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? 'Look saved' : 'Save look to your wardrobe'}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={wt.actionPrimaryText} />
          ) : isSaved ? (
            <View style={styles.btnInnerRow}>
              <IconSymbol name="checkmark" size={14} color={wt.actionSecondaryText} />
              <Text style={[styles.saveBtnText, { color: wt.actionSecondaryText }]}>Saved</Text>
            </View>
          ) : (
            <View style={styles.btnInnerRow}>
              <IconSymbol name="heart" size={14} color={wt.actionPrimaryText} />
              <Text style={[styles.saveBtnText, { color: wt.actionPrimaryText }]}>Save Look</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Open in Mannequin button */}
        <TouchableOpacity
          style={[
            styles.actionBtn,
            styles.mannequinBtn,
            { borderColor: wt.cardBorder, backgroundColor: wt.cardSurfaceSubtle, opacity: isTransferring ? 0.6 : 1 },
          ]}
          onPress={() => {
            if (isTransferring) return;
            tapLight();
            onOpenMannequin(look);
          }}
          disabled={isTransferring}
          accessibilityRole="button"
          accessibilityLabel="Open this look on 3D mannequin"
        >
          {isTransferring ? (
            <ActivityIndicator size="small" color={wt.actionSecondaryText} />
          ) : (
            <View style={styles.btnInnerRow}>
              <IconSymbol name="sparkles" size={14} color={wt.actionSecondaryText} />
              <Text style={[styles.mannequinBtnText, { color: wt.actionSecondaryText }]}>Mannequin</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Refine toggle button */}
        {onRefine && (
          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.refineToggleBtn,
              { borderColor: wt.cardBorder, backgroundColor: showRefineMenu ? wt.accentGoldSubtle : wt.cardSurfaceSubtle },
            ]}
            onPress={toggleRefineMenu}
            accessibilityRole="button"
            accessibilityLabel="Refine session options"
          >
            <View style={styles.btnInnerRow}>
              <Text style={[styles.refineToggleText, { color: wt.actionSecondaryText }]}>Refine</Text>
              <IconSymbol
                name={showRefineMenu ? 'chevron.up' : 'chevron.down'}
                size={12}
                color={wt.actionSecondaryText}
              />
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  titleColumn: {
    flex: 1,
    paddingRight: Spacing.md,
  },
  lookNumber: {
    ...Type.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  headline: {
    ...Type.bodyStrong,
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 22,
  },
  scoreBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  scoreText: {
    ...Type.caption,
    fontWeight: '700',
    fontSize: 12,
  },
  canvasContainer: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  explanationSection: {
    marginBottom: Spacing.md,
  },
  intentMatch: {
    ...Type.body,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.xs,
  },
  expandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    alignSelf: 'flex-start',
  },
  expandTitle: {
    ...Type.caption,
    fontWeight: '700',
    fontSize: 12,
  },
  detailsBox: {
    marginTop: Spacing.xs,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  detailLabel: {
    ...Type.caption,
    fontWeight: '600',
    minWidth: 70,
  },
  detailValue: {
    ...Type.caption,
    flex: 1,
    fontWeight: '500',
  },
  proTipBox: {
    marginTop: Spacing.xs,
    paddingLeft: Spacing.sm,
    borderLeftWidth: 2,
  },
  proTipText: {
    ...Type.caption,
    fontSize: 11,
    fontStyle: 'italic',
  },
  refineMenu: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  refineMenuTitle: {
    ...Type.caption,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  refineButtonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  refinePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  refinePillText: {
    ...Type.caption,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  actionBtn: {
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  saveBtn: {
    flex: 1.2,
  },
  mannequinBtn: {
    flex: 1.1,
    borderWidth: 1,
  },
  refineToggleBtn: {
    flex: 0.9,
    borderWidth: 1,
  },
  btnInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  saveBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
    fontSize: 13,
  },
  mannequinBtnText: {
    ...Type.bodyStrong,
    fontWeight: '600',
    fontSize: 13,
  },
  refineToggleText: {
    ...Type.bodyStrong,
    fontWeight: '600',
    fontSize: 13,
  },
});
