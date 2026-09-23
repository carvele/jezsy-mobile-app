import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type, Elevation, WardrobeTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { tapMedium, tapLight } from '@/src/utils/haptics';
import { DeterministicFlatLayCanvas } from '@/src/components/styling/DeterministicFlatLayCanvas';

import { PlanLaterPayload } from '@/src/types/planner';

interface Props {
  outfit: GeneratedOutfit | any;
  onSave: (outfit: any) => void;
  saving?: boolean;
  /** True when this exact combination already exists in the user's saved outfits. */
  alreadySaved?: boolean;
  /** When provided, renders a secondary "Pass" action next to Save. */
  onPass?: (outfit: any) => void;
  /** 'legacy' preserves horizontal thumbnails; 'atelier' enables flat-lay canvas. */
  variant?: 'legacy' | 'atelier';
  /** Optional callback for Open in Mannequin (saved outfits only). */
  onOpenMannequin?: (outfit: any) => void;
  /** Optional callback for Remixing the outfit. */
  onRemix?: (outfit: any) => void;
  /** Optional callback for Plan Later: rendered ONLY when caller provides a truthful existing source type */
  onPlanLater?: (payload: PlanLaterPayload) => void;
  planLaterPayload?: PlanLaterPayload;
}

// Status badge colors derived from WardrobeTokens for atelier; legacy uses inline originals.
const LEGACY_LABEL_COLOR: Record<string, string> = {
  'Perfect Harmony': '#047857',
  'Great Match': '#2563EB',
  'Neutral / Balanced': '#D4AF37',
  'Clashing Colors': '#DC2626',
};

function resolveStatusColors(outfit: any, theme: 'light' | 'dark', isAtelier: boolean) {
  const wt = WardrobeTokens.theme[theme];
  if (isAtelier) {
    if (outfit.assessment === 'Appropriate for this occasion' || outfit.label === 'Perfect Harmony' || outfit.label === 'Great Match') {
      return { bg: wt.statusAppropriateBg, text: wt.statusAppropriateText };
    }
    if (outfit.assessment === 'Could work with changes' || outfit.label === 'Neutral / Balanced') {
      return { bg: wt.statusConsiderBg, text: wt.statusConsiderText };
    }
    if (outfit.assessment || outfit.label === 'Clashing Colors') {
      return { bg: wt.statusConflictBg, text: wt.statusConflictText };
    }
    return { bg: wt.statusAppropriateBg, text: wt.statusAppropriateText };
  }
  // Legacy path uses inline colors
  const accent = LEGACY_LABEL_COLOR[outfit.label] || '#2563EB';
  const assessmentColor = outfit.assessment
    ? outfit.assessment === 'Appropriate for this occasion'
      ? '#047857'
      : outfit.assessment === 'Could work with changes'
      ? '#CA8A04'
      : '#DC2626'
    : accent;
  return { bg: assessmentColor + '22', text: assessmentColor };
}

/** Build grounded Why This Works bullets from real outfit data only. */
function buildGroundedBullets(outfit: any): string[] {
  const bullets: string[] = [];

  if (outfit.whyThisWorks?.bullets?.length) return outfit.whyThisWorks.bullets;

  if (outfit.reason) bullets.push(outfit.reason);

  for (const item of outfit.items || []) {
    if (item.wear_count === 0) {
      const name = item.sub_category || item.garment_type || item.category || 'piece';
      bullets.push(`Features a new, unworn ${name}`);
    } else if (item.last_worn_at) {
      const days = Math.floor((Date.now() - new Date(item.last_worn_at).getTime()) / (1000 * 60 * 60 * 24));
      if (days >= 14) {
        const name = item.sub_category || item.garment_type || item.category || 'piece';
        bullets.push(`Surfaces ${name} unworn in ${days} days`);
      }
    }
  }

  return bullets.length > 0 ? bullets : (outfit.reason ? [outfit.reason] : []);
}

export function SuggestedOutfitCard({
  outfit,
  onSave,
  saving = false,
  alreadySaved = false,
  onPass,
  variant = 'legacy',
  onOpenMannequin,
  onRemix,
  onPlanLater,
  planLaterPayload,
}: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isAtelier = variant === 'atelier';
  const wt = WardrobeTokens.theme[theme];
  const status = resolveStatusColors(outfit, theme, isAtelier);

  const badgeText = outfit.assessment || outfit.label;
  const headline = outfit.headline;
  const reasonText = outfit.whyThisWorks?.summary || outfit.reason;

  // ── LEGACY VARIANT ──
  if (!isAtelier) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.thumbRow}>
          {outfit.items.map((item: any) => (
            <View key={item.id} style={[styles.thumb, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Image source={{ uri: item.image_url || (item as any).photo_url || undefined }} style={styles.thumbImg} contentFit="cover" />
            </View>
          ))}
        </View>

        <View style={styles.headerRow}>
          <View style={[styles.badge, { backgroundColor: status.bg, borderColor: status.text }]}>
            <Text style={[styles.badgeText, { color: status.text }]}>{badgeText}</Text>
          </View>
          {outfit.label && outfit.label !== badgeText && (
            <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border, marginLeft: Spacing.xs }]}>
              <Text style={[styles.badgeText, { color: colors.text }]}>{outfit.label}</Text>
            </View>
          )}
          {outfit.isAiRanked && (
            <View style={[styles.aiBadge, { backgroundColor: colors.tint + '18', borderColor: colors.tint + '40', marginLeft: 'auto' }]}>
              <IconSymbol name="sparkles" size={12} color={colors.tint} />
              <Text style={[styles.aiBadgeText, { color: colors.tint }]}>AI Ranked</Text>
            </View>
          )}
        </View>

        {headline && <Text style={[styles.headline, { color: colors.text }]}>{headline}</Text>}

        {/* The explanation is the feature: a suggestion the user cannot reason
            about is one they will not trust or learn from. */}
        <Text style={[styles.reason, { color: colors.secondaryText }]}>{reasonText}</Text>

        <View style={styles.actionRow}>
          {onPass && (
            <TouchableOpacity
              style={[styles.passBtn, { borderColor: colors.border }]}
              onPress={() => { tapLight(); onPass(outfit); }}
              accessibilityRole="button"
              accessibilityLabel="Pass on this suggestion"
            >
              <Text style={[styles.passBtnText, { color: colors.secondaryText }]}>Pass</Text>
            </TouchableOpacity>
          )}

          {onOpenMannequin && (
            <TouchableOpacity
              style={[styles.passBtn, { borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 4 }]}
              onPress={() => { tapLight(); onOpenMannequin(outfit); }}
              accessibilityRole="button"
              accessibilityLabel="Open this outfit on Mannequin"
            >
              <IconSymbol name="sparkles" size={13} color={colors.secondaryText} />
              <Text style={[styles.passBtnText, { color: colors.secondaryText }]}>Mannequin</Text>
            </TouchableOpacity>
          )}

          {onPlanLater && planLaterPayload && (
            <TouchableOpacity
              style={[styles.passBtn, { borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 4 }]}
              onPress={() => { tapLight(); onPlanLater(planLaterPayload); }}
              accessibilityRole="button"
              accessibilityLabel="Plan this outfit for an upcoming day"
            >
              <IconSymbol name="calendar" size={13} color={colors.secondaryText} />
              <Text style={[styles.passBtnText, { color: colors.secondaryText }]}>Plan</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.saveBtn,
              { flex: 1 },
              alreadySaved
                ? { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }
                : { backgroundColor: colors.tint, opacity: saving ? 0.6 : 1 },
            ]}
            onPress={() => { if (alreadySaved) return; tapMedium(); onSave(outfit); }}
            disabled={saving || alreadySaved}
            accessibilityRole="button"
            accessibilityLabel={alreadySaved ? 'Already saved to your outfits' : `Save this ${outfit.items.length}-piece outfit`}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.onTint} />
            ) : alreadySaved ? (
              <View style={styles.savedRow}>
                <IconSymbol name="checkmark" size={14} color={colors.secondaryText} />
                <Text style={[styles.saveBtnText, { color: colors.secondaryText }]}>Saved</Text>
              </View>
            ) : (
              <Text style={[styles.saveBtnText, { color: colors.onTint }]}>Save Outfit</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── ATELIER VARIANT ──
  const bullets = buildGroundedBullets(outfit);

  return (
    <View style={[atelierStyles.card, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}>
      {/* Accessible summary region */}
      <View
        accessible={true}
        accessibilityLabel={`Suggested outfit: ${headline || outfit.label || 'Look'}. ${badgeText}. ${outfit.items.length} pieces. ${bullets.join('. ')}`}
      >
        <DeterministicFlatLayCanvas items={outfit.items} />

        <View style={atelierStyles.headerRow}>
          <View style={[atelierStyles.statusBadge, { backgroundColor: status.bg }]}>
            <Text style={[atelierStyles.statusBadgeText, { color: status.text }]}>{badgeText}</Text>
          </View>
          {outfit.isAiRanked && (
            <View style={[atelierStyles.aiBadge, { backgroundColor: wt.accentGoldSubtle }]}>
              <IconSymbol name="sparkles" size={11} color={wt.actionPrimary} />
              <Text style={[atelierStyles.aiBadgeLabel, { color: wt.actionPrimary }]}>AI Ranked</Text>
            </View>
          )}
        </View>

        {headline && <Text style={[atelierStyles.headline, { color: wt.actionSecondaryText }]}>{headline}</Text>}

        {/* Why This Works checklist — derived exclusively from real data */}
        {bullets.length > 0 && (
          <View style={[atelierStyles.whyBox, { backgroundColor: wt.cardSurfaceSubtle }]}>
            {bullets.map((b, i) => (
              <View key={i} style={atelierStyles.bulletRow}>
                <IconSymbol name="checkmark.circle.fill" size={14} color={wt.statusAppropriateText} />
                <Text style={[atelierStyles.bulletText, { color: wt.actionSecondaryText }]}>{b}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Independent action row — separately traversable */}
      <View accessible={false} style={atelierStyles.actionRow}>
        <View style={atelierStyles.secondaryActionRow}>
          {onPass && (
            <TouchableOpacity
              style={[atelierStyles.passBtn, { borderColor: wt.cardBorder }]}
              onPress={() => { tapLight(); onPass(outfit); }}
              accessibilityRole="button"
              accessibilityLabel="Pass on this look"
            >
              <Text style={[atelierStyles.passBtnText, { color: wt.actionSecondaryText }]}>Pass</Text>
            </TouchableOpacity>
          )}

          {onOpenMannequin && (
            <TouchableOpacity
              style={[atelierStyles.passBtn, { borderColor: wt.cardBorder }]}
              onPress={() => { tapLight(); onOpenMannequin(outfit); }}
              accessibilityRole="button"
              accessibilityLabel="Open this outfit on Mannequin"
            >
              <IconSymbol name="sparkles" size={13} color={wt.actionSecondaryText} />
              <Text style={[atelierStyles.passBtnText, { color: wt.actionSecondaryText }]} numberOfLines={1}>Mannequin</Text>
            </TouchableOpacity>
          )}

          {onRemix && (
            <TouchableOpacity
              style={[atelierStyles.passBtn, { borderColor: wt.cardBorder }]}
              onPress={() => { tapLight(); onRemix(outfit); }}
              accessibilityRole="button"
              accessibilityLabel="Remix this outfit"
            >
              <IconSymbol name="shuffle" size={13} color={wt.actionSecondaryText} />
              <Text style={[atelierStyles.passBtnText, { color: wt.actionSecondaryText }]} numberOfLines={1}>Remix</Text>
            </TouchableOpacity>
          )}

          {onPlanLater && planLaterPayload && (
            <TouchableOpacity
              style={[atelierStyles.passBtn, { borderColor: wt.cardBorder }]}
              onPress={() => {
                tapLight();
                onPlanLater(planLaterPayload);
              }}
              accessibilityRole="button"
              accessibilityLabel="Plan this outfit for an upcoming day"
            >
              <IconSymbol name="calendar" size={13} color={wt.actionSecondaryText} />
              <Text style={[atelierStyles.passBtnText, { color: wt.actionSecondaryText }]} numberOfLines={1}>Plan</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[
            atelierStyles.saveBtn,
            alreadySaved
              ? { backgroundColor: wt.actionSecondary, borderWidth: 1, borderColor: wt.cardBorder }
              : { backgroundColor: wt.actionPrimary, opacity: saving ? 0.6 : 1 },
          ]}
          onPress={() => { if (alreadySaved) return; tapMedium(); onSave(outfit); }}
          disabled={saving || alreadySaved}
          accessibilityRole="button"
          accessibilityLabel={alreadySaved ? 'Already saved to your outfits' : 'Save outfit to wardrobe'}
        >
          {saving ? (
            <ActivityIndicator size="small" color={wt.actionPrimaryText} />
          ) : alreadySaved ? (
            <View style={atelierStyles.savedRow}>
              <IconSymbol name="checkmark" size={14} color={wt.actionSecondaryText} />
              <Text style={[atelierStyles.saveBtnText, { color: wt.actionSecondaryText }]}>Saved</Text>
            </View>
          ) : (
            <Text style={[atelierStyles.saveBtnText, { color: wt.actionPrimaryText }]}>Save Outfit</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Legacy styles (unchanged) ──
const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Elevation.sm,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  thumb: {
    flex: 1,
    aspectRatio: 0.85,
    borderRadius: Radius.sm,
    borderWidth: 1,
    overflow: 'hidden',
    maxWidth: 90,
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: Spacing.sm,
  },
  badge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  badgeText: {
    ...Type.caption,
    fontWeight: '700',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  aiBadgeText: {
    ...Type.caption,
    fontWeight: '700',
    fontSize: 11,
  },
  headline: {
    ...Type.bodyStrong,
    fontWeight: '700',
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  reason: {
    ...Type.body,
    marginBottom: Spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  saveBtn: {
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passBtn: {
    height: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passBtnText: {
    ...Type.bodyStrong,
    fontWeight: '600',
  },
});

// ── Atelier styles ──
const atelierStyles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Elevation.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
  },
  statusBadgeText: {
    ...Type.caption,
    fontWeight: '700',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    marginLeft: 'auto',
  },
  aiBadgeLabel: {
    ...Type.caption,
    fontWeight: '700',
    fontSize: 11,
  },
  headline: {
    ...Type.subtitle,
    marginBottom: Spacing.sm,
  },
  whyBox: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  bulletText: {
    ...Type.body,
    flex: 1,
  },
  actionRow: {
    gap: Spacing.sm,
  },
  secondaryActionRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    width: '100%',
  },
  saveBtn: {
    width: '100%',
    height: WardrobeTokens.actionButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passBtn: {
    flex: 1,
    height: 40,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  passBtnText: {
    ...Type.bodyStrong,
    fontSize: 12,
    fontWeight: '600',
  },
});
