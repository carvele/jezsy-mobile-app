import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { styleDnaSyncManager } from '@/src/services/styling/styleDnaSyncManager';
import { getQualitativeStyleMaturity } from '@/src/utils/personalStyleEngine';
import { StyleDnaProfile } from '@/src/types/dto/styleProfile';
import { tapLight, tapMedium } from '@/src/utils/haptics';

const AVAILABLE_COLORS = ['Black', 'White', 'Navy', 'Beige', 'Gray', 'Olive', 'Brown', 'Camel', 'Cream', 'Burgundy'];
const AVOIDABLE_COLORS = ['Neon', 'Orange', 'Bright Yellow', 'Hot Pink', 'Purple', 'Bright Red', 'Lime Green'];
const AVAILABLE_FITS = ['Regular', 'Relaxed', 'Slim', 'Oversized', 'Tailored'];
const AVOIDABLE_FITS = ['Skinny', 'Very Tight', 'Ultra Baggy', 'Crop Top'];
const AVOIDABLE_PATTERNS = ['Animal Print', 'Loud Graphics', 'Polka Dots', 'Floral', 'Bold Stripes', 'Plaid'];

export default function StylePreferencesScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<StyleDnaProfile | null>(null);
  const [resetModalVisible, setResetModalVisible] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    try {
      const p = await styleDnaSyncManager.getProfile(user.id);
      setProfile(p);
    } catch {
      showToast('Failed to load style preferences', 'error');
    } finally {
      setLoading(false);
    }
  }, [user, showToast]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const explicit = profile?.explicitPreferences || {};
  const preferredColors = (explicit.preferredColors as string[]) || [];
  const avoidedColors = (explicit.avoidedColors as string[]) || [];
  const preferredFits = (explicit.preferredFits as string[]) || [];
  const avoidedFits = (explicit.avoidedFits as string[]) || [];
  const avoidedPatterns = (explicit.avoidedPatterns as string[]) || [];

  const handleTogglePreference = async (
    key: 'preferredColors' | 'avoidedColors' | 'preferredFits' | 'avoidedFits' | 'avoidedPatterns',
    item: string
  ) => {
    if (!user) return;
    tapLight();

    const currentList = (explicit[key] as string[]) || [];
    const exists = currentList.includes(item);
    const updatedList = exists
      ? currentList.filter((x) => x !== item)
      : [...currentList, item];

    try {
      await styleDnaSyncManager.recordExplicitSetting(user.id, key, updatedList, 'set');
      await loadProfile();
    } catch {
      showToast('Failed to save preference', 'error');
    }
  };

  const handleResetLearnedStyle = async () => {
    if (!user) return;
    tapMedium();
    setResetting(true);
    try {
      await styleDnaSyncManager.resetLearnedPreferences(user.id);
      await loadProfile();
      setResetModalVisible(false);
      showToast('Learned style reset to baseline', 'success');
    } catch {
      showToast('Failed to reset style preferences', 'error');
    } finally {
      setResetting(false);
    }
  };

  if (loading || !profile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Style Preferences & DNA</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }

  const maturity = getQualitativeStyleMaturity(profile);
  const badgeColor =
    maturity.level === 2
      ? '#10B981'
      : maturity.level === 1
      ? '#6366F1'
      : colors.secondaryText;

  // Extract top learned traits
  const topLearnedPalettes = Object.entries(profile.paletteAffinities || {})
    .filter(([, v]) => (v.score ?? 0.5) > 0.5 || (v.affinityScore ?? 0) > 0)
    .sort((a, b) => (b[1].score ?? 0.5) - (a[1].score ?? 0.5))
    .slice(0, 3)
    .map(([k]) => k);

  const topLearnedSilhouettes = Object.entries(profile.silhouetteAffinities || {})
    .filter(([, v]) => (v.score ?? 0.5) > 0.5 || (v.affinityScore ?? 0) > 0)
    .sort((a, b) => (b[1].score ?? 0.5) - (a[1].score ?? 0.5))
    .slice(0, 3)
    .map(([k]) => k);

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Style Preferences & DNA</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Style DNA Status Card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.maturityRow}>
            <View style={[styles.badge, { backgroundColor: badgeColor + '20', borderColor: badgeColor }]}>
              <IconSymbol name="sparkles" size={14} color={badgeColor} />
              <Text style={[styles.badgeText, { color: badgeColor }]}>{maturity.label}</Text>
            </View>
            <Text style={[styles.eventCountText, { color: colors.secondaryText }]}>
              {profile.eventCount} interaction{profile.eventCount !== 1 ? 's' : ''}
            </Text>
          </View>

          <Text style={[styles.maturityExplanation, { color: colors.text }]}>
            {maturity.explanation}
          </Text>

          {profile.eventCount > 0 && (
            <View style={[styles.statsContainer, { borderTopColor: colors.border }]}>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {Math.round(profile.globalConfidence * 100)}%
                </Text>
                <Text style={[styles.statLabel, { color: colors.secondaryText }]}>DNA Confidence</Text>
              </View>
              {topLearnedPalettes.length > 0 && (
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: colors.tint }]} numberOfLines={1}>
                    {topLearnedPalettes.join(', ')}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.secondaryText }]}>Learned Palettes</Text>
                </View>
              )}
              {topLearnedSilhouettes.length > 0 && (
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: colors.tint }]} numberOfLines={1}>
                    {topLearnedSilhouettes.join(', ')}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.secondaryText }]}>Learned Fits</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Explicit Preferred Colors */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Favorite Colors</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
            Colors you love wearing; boosts recommendation ranking.
          </Text>
          <View style={styles.chipGrid}>
            {AVAILABLE_COLORS.map((c) => {
              const active = preferredColors.includes(c);
              return (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.chip,
                    { borderColor: active ? colors.tint : colors.border },
                    active && { backgroundColor: colors.tint + '15' },
                  ]}
                  onPress={() => handleTogglePreference('preferredColors', c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Toggle favorite color ${c}`}
                >
                  <Text style={[styles.chipText, { color: active ? colors.tint : colors.text }]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Colors to Avoid */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Colors to Avoid</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
            Strictly excluded or heavily penalized in all outfit generations.
          </Text>
          <View style={styles.chipGrid}>
            {AVOIDABLE_COLORS.map((c) => {
              const active = avoidedColors.includes(c);
              return (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.chip,
                    { borderColor: active ? '#EF4444' : colors.border },
                    active && { backgroundColor: '#EF444415' },
                  ]}
                  onPress={() => handleTogglePreference('avoidedColors', c)}
                  accessibilityRole="button"
                  accessibilityLabel={`Toggle avoided color ${c}`}
                >
                  <Text style={[styles.chipText, { color: active ? '#EF4444' : colors.text }]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Preferred Fits */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Preferred Fits & Silhouettes</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
            Silhouettes that feel most natural to you.
          </Text>
          <View style={styles.chipGrid}>
            {AVAILABLE_FITS.map((f) => {
              const active = preferredFits.includes(f);
              return (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.chip,
                    { borderColor: active ? colors.tint : colors.border },
                    active && { backgroundColor: colors.tint + '15' },
                  ]}
                  onPress={() => handleTogglePreference('preferredFits', f)}
                  accessibilityRole="button"
                  accessibilityLabel={`Toggle preferred fit ${f}`}
                >
                  <Text style={[styles.chipText, { color: active ? colors.tint : colors.text }]}>
                    {f}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Fits to Avoid */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Fits & Cuts to Avoid</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
            Cuts you prefer not to see suggested.
          </Text>
          <View style={styles.chipGrid}>
            {AVOIDABLE_FITS.map((f) => {
              const active = avoidedFits.includes(f);
              return (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.chip,
                    { borderColor: active ? '#EF4444' : colors.border },
                    active && { backgroundColor: '#EF444415' },
                  ]}
                  onPress={() => handleTogglePreference('avoidedFits', f)}
                  accessibilityRole="button"
                  accessibilityLabel={`Toggle avoided fit ${f}`}
                >
                  <Text style={[styles.chipText, { color: active ? '#EF4444' : colors.text }]}>
                    {f}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Patterns to Avoid */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Patterns to Avoid</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.secondaryText }]}>
            Patterns to exclude from curated looks.
          </Text>
          <View style={styles.chipGrid}>
            {AVOIDABLE_PATTERNS.map((p) => {
              const active = avoidedPatterns.includes(p);
              return (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.chip,
                    { borderColor: active ? '#EF4444' : colors.border },
                    active && { backgroundColor: '#EF444415' },
                  ]}
                  onPress={() => handleTogglePreference('avoidedPatterns', p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Toggle avoided pattern ${p}`}
                >
                  <Text style={[styles.chipText, { color: active ? '#EF4444' : colors.text }]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Reset Learned Preferences Card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Reset Learned Style</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
            Reset all learned wear and save history affinities back to neutral. Your explicit preferred and avoided choices above will be kept.
          </Text>
          <TouchableOpacity
            style={[styles.resetButton, { borderColor: '#EF4444' }]}
            onPress={() => setResetModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Reset learned preferences"
          >
            <IconSymbol name="arrow.clockwise" size={16} color="#EF4444" />
            <Text style={styles.resetButtonText}>Reset Learned Style DNA</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Reset Confirmation Modal */}
      <ConfirmModal
        visible={resetModalVisible}
        title="Reset Learned Style DNA?"
        message="This resets learned color and silhouette affinities back to baseline while keeping your explicit preferences intact."
        consequences={[
          'All learned color and silhouette affinities will be reset to neutral',
          'Historical wear and save events will no longer influence recommendations',
          'Your explicit favorite/avoided chips above will remain untouched',
        ]}
        confirmLabel="Reset Learned Style"
        cancelLabel="Keep Preferences"
        onConfirm={handleResetLearnedStyle}
        onCancel={() => setResetModalVisible(false)}
        isDestructive={true}
        isLoading={resetting}
        severity="MEDIUM"
      />
    </SafeAreaView>
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...Type.headline,
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  maturityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  badgeText: {
    ...Type.caption,
    fontWeight: '700',
    fontSize: 12,
  },
  eventCountText: {
    ...Type.caption,
    fontSize: 12,
  },
  maturityExplanation: {
    ...Type.body,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  statsContainer: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  statBox: {
    flex: 1,
  },
  statValue: {
    ...Type.headline,
    fontSize: 15,
    fontWeight: '700',
  },
  statLabel: {
    ...Type.caption,
    fontSize: 11,
    marginTop: 2,
  },
  sectionTitle: {
    ...Type.subtitle,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionSubtitle: {
    ...Type.caption,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipText: {
    ...Type.body,
    fontSize: 13,
    fontWeight: '500',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  resetButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
});
