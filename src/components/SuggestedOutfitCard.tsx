import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type, Elevation } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { tapMedium, tapLight } from '@/src/utils/haptics';

interface Props {
  outfit: GeneratedOutfit | any;
  onSave: (outfit: any) => void;
  saving?: boolean;
  /** True when this exact combination already exists in the user's saved outfits. */
  alreadySaved?: boolean;
  /** When provided, renders a secondary "Pass" action next to Save. */
  onPass?: (outfit: any) => void;
}

const LABEL_COLOR: Record<string, string> = {
  'Perfect Harmony': '#047857',
  'Great Match': '#2563EB',
  'Neutral / Balanced': '#D4AF37',
  'Clashing Colors': '#DC2626',
};

export function SuggestedOutfitCard({ outfit, onSave, saving = false, alreadySaved = false, onPass }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const accent = LABEL_COLOR[outfit.label] || '#2563EB';
  const assessmentColor = outfit.assessment
    ? outfit.assessment === 'Appropriate for this occasion'
      ? '#047857'
      : outfit.assessment === 'Could work with changes'
      ? '#CA8A04'
      : '#DC2626'
    : accent;

  const badgeText = outfit.assessment || outfit.label;
  const headline = outfit.headline;
  const reasonText = outfit.whyThisWorks?.summary || outfit.reason;

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
        <View style={[styles.badge, { backgroundColor: assessmentColor + '22', borderColor: assessmentColor }]}>
          <Text style={[styles.badgeText, { color: assessmentColor }]}>
            {badgeText}
          </Text>
        </View>
        {outfit.label && outfit.label !== badgeText && (
          <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border, marginLeft: Spacing.xs }]}>
            <Text style={[styles.badgeText, { color: colors.text }]}>
              {outfit.label}
            </Text>
          </View>
        )}
        {outfit.isAiRanked && (
          <View style={[styles.aiBadge, { backgroundColor: colors.tint + '18', borderColor: colors.tint + '40', marginLeft: 'auto' }]}>
            <IconSymbol name="sparkles" size={12} color={colors.tint} />
            <Text style={[styles.aiBadgeText, { color: colors.tint }]}>AI Ranked</Text>
          </View>
        )}
      </View>

      {headline && (
        <Text style={[styles.headline, { color: colors.text }]}>{headline}</Text>
      )}

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
    // 44pt is the minimum comfortable touch target on both platforms.
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
