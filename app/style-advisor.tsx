import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { outfitService } from '@/src/services';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { Database } from '@/src/types/database.types';
import { generateOutfits, GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';
import { styleProfileService } from '@/src/services/styleProfileService';
import { outfitFeedbackService } from '@/src/services/outfitFeedbackService';
import { UserStyleProfileDto } from '@/src/types/dto/styleProfile';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

type OccasionKey = 'work' | 'casual' | 'date' | 'party' | 'formal' | 'interview' | 'dinner' | 'travel';

interface Occasion {
  key: OccasionKey;
  label: string;
  icon: string;
  tip: string;
}

const OCCASIONS: Occasion[] = [
  { key: 'work', label: 'Work', icon: 'bag.fill', tip: 'Keep it polished: a neutral base with one structured layer reads as professional.' },
  { key: 'casual', label: 'Casual', icon: 'tshirt', tip: 'Fewer pieces, more comfort — casual looks work best without over-layering.' },
  { key: 'date', label: 'Date Night', icon: 'heart.fill', tip: 'Lead with your best color pairing; this is the one place to take a chance on contrast.' },
  { key: 'party', label: 'Party', icon: 'sparkles', tip: 'An accessory does the work here — let one piece stand out against the rest.' },
  { key: 'formal', label: 'Formal', icon: 'star.fill', tip: 'A dress alone, or a top and bottom under a proper outer layer, is the safest formal formula.' },
  { key: 'interview', label: 'Interview', icon: 'briefcase.fill', tip: 'Crisp, structured tailoring with minimal distractions builds immediate confidence.' },
  { key: 'dinner', label: 'Dinner', icon: 'fork.knife', tip: 'Smart casual elegance that transitions effortlessly into ambient evening lighting.' },
  { key: 'travel', label: 'Travel', icon: 'airplane', tip: 'Wrinkle-resistant breathable layers designed for mobility and temperature changes.' },
];

export default function StyleAdvisorScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { session } = useAuth();
  const { showToast } = useToast();

  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [occasion, setOccasion] = useState<OccasionKey | null>(null);
  const [index, setIndex] = useState(0);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserStyleProfileDto | null>(null);
  const [showExplanation, setShowExplanation] = useState(true);

  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [itemsRes, userProfile] = await Promise.all([
          supabase
            .from('wardrobe_items')
            .select('*')
            .eq('user_id', session.user.id)
            .eq('deleted', false)
            .order('created_at', { ascending: false }),
          styleProfileService.getProfile(session.user.id),
        ]);

        if (mounted) {
          if (!itemsRes.error && itemsRes.data) {
            setItems(itemsRes.data);
          }
          if (userProfile) {
            setProfile(userProfile);
          }
        }
      } catch (e) {
        console.warn('Error loading style advisor data:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  const activeOccasion = OCCASIONS.find((o) => o.key === occasion) || null;

  const ranked = useMemo(() => {
    if (!occasion || items.length === 0) return [];
    return generateOutfits(items, {
      limit: 20,
      occasion: activeOccasion?.label || null,
      profile,
    });
  }, [items, occasion, activeOccasion, profile]);

  useEffect(() => {
    setIndex(0);
  }, [occasion]);

  const current = ranked[index] || null;

  const tips = useMemo(() => {
    if (!activeOccasion) return [];
    const list: string[] = [activeOccasion.tip];
    const types = new Set(items.map((i) => resolveEffectiveGarmentBucket(i)));
    if (!types.has('Shoes')) list.push('Add shoes to your wardrobe to complete full looks.');
    if (occasion === 'work' && !types.has('Outerwear')) {
      list.push('A blazer or cardigan would round this out for work.');
    }
    if (occasion === 'formal' && !types.has('Dress') && !(types.has('Top') && types.has('Bottom'))) {
      list.push('Add a dress, or a top and bottom, to get a formal recommendation.');
    }
    return list;
  }, [activeOccasion, items, occasion]);

  const handleShowAnother = useCallback(() => {
    if (ranked.length <= 1) return;
    setIndex((i) => (i + 1) % ranked.length);
  }, [ranked.length]);

  const handleSave = useCallback(
    async (outfit: GeneratedOutfit) => {
      if (!session?.user?.id) return;
      setSavingKey(outfit.key);
      try {
        const payload = outfit.items.map((i) => ({
          slot: (resolveEffectiveGarmentBucket(i) || i.garment_type || 'accessory').toLowerCase(),
          product_id: i.product_id,
          wardrobe_item_id: i.id,
          image_url: i.image_url,
          name: i.sub_category || resolveEffectiveGarmentBucket(i) || i.category || 'Item',
          color_tags: i.color_tags,
        }));

        const result = await outfitService.saveOutfit({
          userId: session.user.id,
          name: `${activeOccasion?.label || 'Advisor'} look`,
          items: payload,
        });
        if (!result.ok) throw result.error;

        // Log feedback event
        await outfitFeedbackService.logFeedback(
          {
            userId: session.user.id,
            feedbackType: 'saved',
            occasion: activeOccasion?.label,
          },
          outfit.items as any
        );

        showToast('Outfit saved to your wardrobe.', 'success');
      } catch (err) {
        console.error('Error saving advisor outfit:', err);
        showToast('Could not save that outfit. Please try again.', 'error');
      } finally {
        setSavingKey(null);
      }
    },
    [session?.user?.id, activeOccasion, showToast]
  );

  const handleLogWorn = useCallback(async () => {
    if (!session?.user?.id || !current) return;
    try {
      await outfitFeedbackService.logFeedback(
        {
          userId: session.user.id,
          feedbackType: 'worn',
          occasion: activeOccasion?.label,
        },
        current.items as any
      );

      // Increment wear count on items
      for (const item of current.items) {
        try {
          await (supabase.from('wardrobe_items') as any)
            .update({
              wear_count: (item.wear_count || 0) + 1,
              last_worn_at: new Date().toISOString(),
            })
            .eq('id', item.id);
        } catch {
          // Ignore individual wear update error
        }
      }

      showToast('Recorded as worn! Your stylist will remember your favorites.', 'success');
    } catch {
      showToast('Could not record wear.', 'error');
    }
  }, [session?.user?.id, current, activeOccasion, showToast]);

  const handlePass = useCallback(async () => {
    if (!session?.user?.id || !current) return;
    try {
      await outfitFeedbackService.logFeedback(
        {
          userId: session.user.id,
          feedbackType: 'rejected',
          occasion: activeOccasion?.label,
        },
        current.items as any
      );
    } catch {
      // Ignore background log error
    }
    handleShowAnother();
    showToast('Noted! Adjusting suggestions.', 'info');
  }, [session?.user?.id, current, activeOccasion, handleShowAnother, showToast]);

  const handleSendToMannequin = useCallback(async () => {
    if (!session?.user?.id || !current) return;
    setSavingKey(current.key);
    try {
      const payload = current.items.map((i) => ({
        slot: (resolveEffectiveGarmentBucket(i) || i.garment_type || 'accessory').toLowerCase(),
        product_id: i.product_id,
        wardrobe_item_id: i.id,
        image_url: i.image_url,
        name: i.sub_category || resolveEffectiveGarmentBucket(i) || i.category || 'Item',
        color_tags: i.color_tags,
      }));

      const result = await outfitService.saveOutfit({
        userId: session.user.id,
        name: `${activeOccasion?.label || 'Advisor'} look`,
        items: payload,
      });

      if (result.ok && result.data?.id) {
        router.push(`/wardrobe?tab=mannequin&loadOutfit=${result.data.id}` as any);
      } else {
        router.push('/wardrobe?tab=mannequin' as any);
      }
    } catch {
      router.push('/wardrobe?tab=mannequin' as any);
    } finally {
      setSavingKey(null);
    }
  }, [session?.user?.id, current, activeOccasion, router]);

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Style Advisor</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.prompt, { color: colors.secondaryText }]}>
          What&apos;s the occasion? I&apos;ll style a look from your own wardrobe.
        </Text>

        <View style={styles.chipRow}>
          {OCCASIONS.map((o) => {
            const active = occasion === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                style={[
                  styles.chip,
                  { backgroundColor: active ? colors.tint : colors.card, borderColor: active ? colors.tint : colors.border },
                ]}
                onPress={() => setOccasion(o.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <IconSymbol name={o.icon as any} size={16} color={active ? colors.onTint : colors.secondaryText} />
                <Text style={[styles.chipText, { color: active ? colors.onTint : colors.text }]}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.tint} style={{ marginTop: Spacing.xxxl }} />
        ) : !occasion ? null : items.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <IconSymbol name="hanger" size={32} color={colors.icon} />
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              Add a few items to your wardrobe first, and I&apos;ll style a look for you.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.tipsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {tips.map((tip, i) => (
                <View key={i} style={styles.tipRow}>
                  <IconSymbol name="sparkles" size={14} color={colors.tint} />
                  <Text style={[styles.tipText, { color: colors.text }]}>{tip}</Text>
                </View>
              ))}
            </View>

            {current ? (
              <>
                <SuggestedOutfitCard outfit={current} onSave={handleSave} saving={savingKey === current.key} />

                {/* AI Stylist Explanation Card */}
                {current.explanation && (
                  <View style={[styles.explanationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <TouchableOpacity
                      style={styles.explanationHeader}
                      onPress={() => setShowExplanation(!showExplanation)}
                    >
                      <View style={styles.explanationTitleRow}>
                        <IconSymbol name="sparkles" size={16} color={colors.tint} />
                        <Text style={[styles.explanationTitle, { color: colors.tint }]}>
                          Why This Works
                        </Text>
                      </View>
                      <IconSymbol
                        name={showExplanation ? 'chevron.up' : 'chevron.down'}
                        size={16}
                        color={colors.secondaryText}
                      />
                    </TouchableOpacity>

                    {showExplanation && (
                      <View style={styles.explanationBody}>
                        <Text style={[styles.explanationSummary, { color: colors.text }]}>
                          {current.explanation.summary}
                        </Text>
                        <View style={styles.explanationPillars}>
                          <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>
                            • Palette: {current.explanation.colorStory}
                          </Text>
                          <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>
                            • Silhouette: {current.explanation.silhouetteNote}
                          </Text>
                          <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>
                            • Occasion: {current.explanation.occasionFit}
                          </Text>
                        </View>
                        <View style={[styles.proTipBox, { backgroundColor: colors.background }]}>
                          <Text style={[styles.proTipText, { color: colors.tint }]}>
                             Pro Tip: {current.explanation.proTip}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* Stylist Actions Row */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.feedbackBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                    onPress={handleLogWorn}
                  >
                    <IconSymbol name="checkmark.circle.fill" size={16} color="#10B981" />
                    <Text style={[styles.feedbackBtnText, { color: colors.text }]}>Wear This</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.feedbackBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                    onPress={handlePass}
                  >
                    <IconSymbol name="xmark.circle.fill" size={16} color="#EF4444" />
                    <Text style={[styles.feedbackBtnText, { color: colors.text }]}>Pass</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.feedbackBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                    onPress={handleSendToMannequin}
                  >
                    <IconSymbol name="person.fill" size={16} color={colors.tint} />
                    <Text style={[styles.feedbackBtnText, { color: colors.tint }]}>Mannequin</Text>
                  </TouchableOpacity>
                </View>

                {/* Show another suggestion */}
                <TouchableOpacity
                  style={[styles.anotherBtn, { borderColor: colors.border, marginTop: Spacing.md }]}
                  onPress={handleShowAnother}
                  disabled={ranked.length <= 1}
                  accessibilityRole="button"
                  accessibilityLabel="Show another suggestion"
                >
                  <IconSymbol name="shuffle" size={16} color={ranked.length <= 1 ? colors.secondaryText : colors.tint} />
                  <Text style={[styles.anotherBtnText, { color: ranked.length <= 1 ? colors.secondaryText : colors.tint }]}>
                    Show me another combination
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <IconSymbol name="hanger" size={32} color={colors.icon} />
                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                  Not enough pieces yet for a {activeOccasion?.label.toLowerCase()} look — add a top, bottom, or dress.
                </Text>
              </View>
            )}
          </>
        )}
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
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Type.headline, fontSize: 18 },
  content: { padding: Spacing.xl, paddingBottom: 60 },
  prompt: { ...Type.body, marginBottom: Spacing.lg },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  tipsCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  tipText: { ...Type.body, fontSize: 13, flex: 1, lineHeight: 19 },
  explanationCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  explanationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  explanationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  explanationTitle: {
    ...Type.bodyStrong,
    fontSize: 15,
    fontWeight: '700',
  },
  explanationBody: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  explanationSummary: {
    ...Type.body,
    fontSize: 14,
    lineHeight: 20,
  },
  explanationPillars: {
    gap: 4,
    marginVertical: 4,
  },
  pillarLabel: {
    fontSize: 13,
    lineHeight: 18,
  },
  proTipBox: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: 6,
  },
  proTipText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Spacing.md,
  },
  feedbackBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  feedbackBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  anotherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  anotherBtnText: { fontSize: 14, fontWeight: '700' },
  emptyCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  emptyText: { ...Type.body, textAlign: 'center' },
});
