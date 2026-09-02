import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { Database } from '@/src/types/database.types';
import { generateOutfits, GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

type OccasionKey = 'work' | 'casual' | 'date' | 'party' | 'formal';

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
];

// Rule-based re-ranking, not a new scoring model: generateOutfits() already
// ranks by colour harmony + neglect, this just nudges that order toward what
// reads right for the chosen occasion, using the garment types already picked.
function occasionBoost(occasion: OccasionKey, outfit: GeneratedOutfit): number {
  const types = new Set(outfit.items.map((i) => i.garment_type));
  switch (occasion) {
    case 'work':
      return (types.has('Outerwear') ? 10 : 0) + (outfit.label === 'Clashing Colors' ? -15 : 5);
    case 'formal':
      return (types.has('Dress') ? 15 : 0) + (types.has('Outerwear') ? 8 : 0);
    case 'date':
    case 'party':
      return (outfit.label === 'Perfect Harmony' || outfit.label === 'Great Match' ? 10 : 0)
        + (types.has('Accessory') ? 6 : 0);
    case 'casual':
    default:
      return types.has('Outerwear') ? -4 : 4;
  }
}

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

  useEffect(() => {
    if (!session?.user?.id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('deleted', false)
        .order('created_at', { ascending: false });
      if (!error) setItems(data || []);
      setLoading(false);
    })();
  }, [session?.user?.id]);

  const ranked = useMemo(() => {
    if (!occasion) return [];
    return generateOutfits(items, 20)
      .map((o) => ({ outfit: o, adjusted: o.score + occasionBoost(occasion, o) }))
      .sort((a, b) => b.adjusted - a.adjusted)
      .map((r) => r.outfit);
  }, [items, occasion]);

  useEffect(() => {
    setIndex(0);
  }, [occasion]);

  const current = ranked[index] || null;
  const activeOccasion = OCCASIONS.find((o) => o.key === occasion) || null;

  const tips = useMemo(() => {
    if (!activeOccasion) return [];
    const list: string[] = [activeOccasion.tip];
    const types = new Set(items.map((i) => i.garment_type));
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

  const handleSave = useCallback(async (outfit: GeneratedOutfit) => {
    if (!session?.user?.id) return;
    setSavingKey(outfit.key);
    try {
      const payload = outfit.items.map((i) => ({
        slot: (i.garment_type || 'accessory').toLowerCase(),
        product_id: i.product_id,
        image_url: i.image_url,
        name: i.garment_type || i.category || 'Item',
        color_tags: i.color_tags,
      }));

      const { error } = await supabase.from('saved_outfits').insert({
        user_id: session.user.id,
        name: `${activeOccasion?.label || 'Advisor'} look`,
        items: payload,
      });
      if (error) throw error;
      showToast('Outfit saved to your wardrobe.', 'success');
    } catch (err) {
      console.error('Error saving advisor outfit:', err);
      showToast('Could not save that outfit. Please try again.', 'error');
    } finally {
      setSavingKey(null);
    }
  }, [session?.user?.id, activeOccasion, showToast]);

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
                style={[styles.chip, { backgroundColor: active ? colors.tint : colors.card, borderColor: active ? colors.tint : colors.border }]}
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
                <TouchableOpacity
                  style={[styles.anotherBtn, { borderColor: colors.border }]}
                  onPress={handleShowAnother}
                  disabled={ranked.length <= 1}
                  accessibilityRole="button"
                  accessibilityLabel="Show another suggestion"
                >
                  <IconSymbol name="shuffle" size={16} color={ranked.length <= 1 ? colors.secondaryText : colors.tint} />
                  <Text style={[styles.anotherBtnText, { color: ranked.length <= 1 ? colors.secondaryText : colors.tint }]}>
                    Show me another
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
  anotherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginTop: -Spacing.sm,
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
