import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useSharedBottomInset } from '@/src/hooks/useFloatingTabBarMetrics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { outfitService } from '@/src/services';
import { wardrobeService, WARDROBE_LIST_COLUMNS } from '@/src/services/wardrobeService';
import { describeWearLogResult } from '@/src/utils/wearLog';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { Database } from '@/src/types/database.types';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';
import { styleProfileService } from '@/src/services/styleProfileService';
import { outfitFeedbackService } from '@/src/services/outfitFeedbackService';
import { UserStyleProfileDto } from '@/src/types/dto/styleProfile';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';
import { tapMedium, tapLight } from '@/src/utils/haptics';
import {
  createStylingSession,
  refineStylingSession,
  StylingSessionState,
} from '@/src/services/styling/stylingSessionService';
import { StylingOption, StylingRefinementType } from '@/src/types/styleAdvisor';

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
  const bottomInset = useSharedBottomInset();

  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loadingWardrobe, setLoadingWardrobe] = useState(true);
  const [profile, setProfile] = useState<UserStyleProfileDto | null>(null);

  // Styling inputs
  const [prompt, setPrompt] = useState('');
  const [occasion, setOccasion] = useState<OccasionKey | null>(null);

  // Active session and options
  const [sessionState, setSessionState] = useState<StylingSessionState | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [isStyling, setIsStyling] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(true);

  // Load wardrobe & profile
  useEffect(() => {
    if (!session?.user?.id) return;
    let mounted = true;
    (async () => {
      setLoadingWardrobe(true);
      try {
        const [itemsRes, userProfile] = await Promise.all([
          supabase
            .from('wardrobe_items')
            .select(WARDROBE_LIST_COLUMNS)
            .eq('user_id', session.user.id)
            .eq('deleted', false)
            .order('created_at', { ascending: false }),
          styleProfileService.getProfile(session.user.id),
        ]);

        if (mounted) {
          if (!itemsRes.error && itemsRes.data) {
            setItems(itemsRes.data as unknown as WardrobeItem[]);
          }
          if (userProfile) {
            setProfile(userProfile);
          }
        }
      } catch (e) {
        console.warn('Error loading style advisor data:', e);
      } finally {
        if (mounted) setLoadingWardrobe(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  const activeOccasion = OCCASIONS.find((o) => o.key === occasion) || null;

  // Primary action: Style Me
  const handleStyleMe = useCallback(async () => {
    if (items.length === 0 || isStyling) return;
    tapMedium();
    setIsStyling(true);
    setActiveOptionIndex(0);

    try {
      const state = await createStylingSession(
        prompt,
        activeOccasion?.label || null,
        items,
        profile
      );
      setSessionState(state);
      if (state.error) {
        showToast(state.error, 'info');
      }
    } catch (err) {
      console.error('Styling session failed:', err);
      showToast('Could not generate outfits. Please try again.', 'error');
    } finally {
      setIsStyling(false);
    }
  }, [items, isStyling, prompt, activeOccasion, profile, showToast]);

  // Occasion chip toggle
  const handleOccasionPress = useCallback((key: OccasionKey) => {
    tapLight();
    setOccasion((prev) => (prev === key ? null : key));
  }, []);

  // Active outfit option
  const currentOption: StylingOption | null = useMemo(() => {
    if (!sessionState || sessionState.options.length === 0) return null;
    return sessionState.options[activeOptionIndex] || sessionState.options[0];
  }, [sessionState, activeOptionIndex]);

  // Interactive Refinements
  const handleRefine = useCallback(
    async (type: StylingRefinementType, targetItemId?: string) => {
      if (!sessionState || isRefining) return;
      tapLight();
      setIsRefining(true);

      try {
        const nextState = await refineStylingSession(sessionState, type, targetItemId);
        setSessionState(nextState);
        setActiveOptionIndex(0);
        if (nextState.error) {
          showToast(nextState.error, 'info');
        } else {
          showToast('Updated your recommendation options.', 'success');
        }
      } catch (err) {
        console.error('Refinement failed:', err);
        showToast('Could not refine recommendation.', 'error');
      } finally {
        setIsRefining(false);
      }
    },
    [sessionState, isRefining, showToast]
  );

  // Save Outfit
  const handleSave = useCallback(
    async (outfit: StylingOption) => {
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

        const result = await outfitService.saveOutfitOnce({
          userId: session.user.id,
          name: `${outfit.label || activeOccasion?.label || 'Advisor'} look`,
          items: payload,
        });

        if (!result.ok) throw result.error;

        await outfitFeedbackService.logFeedback(
          {
            userId: session.user.id,
            feedbackType: 'saved',
            occasion: activeOccasion?.label || sessionState?.intent.selectedOccasion || undefined,
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
    [session?.user?.id, activeOccasion, sessionState?.intent, showToast]
  );

  // Wear This
  const wearLogInFlight = useRef(false);
  const handleLogWorn = useCallback(async () => {
    if (!session?.user?.id || !currentOption || wearLogInFlight.current) return;
    wearLogInFlight.current = true;
    tapMedium();
    try {
      const outcome = await wardrobeService.logItemsWorn(currentOption.items.map((i) => i.id));
      const summary = describeWearLogResult(outcome, currentOption.items.length);
      if (summary.recorded) {
        await outfitFeedbackService.logFeedback(
          {
            userId: session.user.id,
            feedbackType: 'worn',
            occasion: activeOccasion?.label || sessionState?.intent.selectedOccasion || undefined,
            wardrobeItemIds: outcome.succeeded,
          },
          currentOption.items.filter((i) => outcome.succeeded.includes(i.id)) as any
        );
      }
      showToast(summary.message, summary.kind);
    } catch {
      showToast('Could not record wear.', 'error');
    } finally {
      wearLogInFlight.current = false;
    }
  }, [session?.user?.id, currentOption, activeOccasion, sessionState?.intent, showToast]);

  // Pass
  const handlePass = useCallback(async () => {
    if (!session?.user?.id || !currentOption) return;
    tapLight();
    try {
      await outfitFeedbackService.logFeedback(
        {
          userId: session.user.id,
          feedbackType: 'rejected',
          occasion: activeOccasion?.label || sessionState?.intent.selectedOccasion || undefined,
        },
        currentOption.items as any
      );
    } catch {
      // background error ignored
    }

    if (sessionState && sessionState.options.length > 1) {
      // Advance to next option
      setActiveOptionIndex((prev) => (prev + 1) % sessionState.options.length);
      showToast('Showing next option.', 'info');
    } else {
      // Regenerate fresh options
      handleRefine('tryAnother');
    }
  }, [session?.user?.id, currentOption, activeOccasion, sessionState, handleRefine, showToast]);

  // Send to Mannequin
  const sendInFlight = useRef(false);
  const handleSendToMannequin = useCallback(async () => {
    if (!session?.user?.id || !currentOption || sendInFlight.current) return;
    sendInFlight.current = true;
    setSavingKey(currentOption.key);
    tapMedium();
    try {
      const payload = currentOption.items.map((i) => ({
        slot: (resolveEffectiveGarmentBucket(i) || i.garment_type || 'accessory').toLowerCase(),
        product_id: i.product_id,
        wardrobe_item_id: i.id,
        image_url: i.image_url,
        name: i.sub_category || resolveEffectiveGarmentBucket(i) || i.category || 'Item',
        color_tags: i.color_tags,
      }));

      const result = await outfitService.saveOutfitOnce({
        userId: session.user.id,
        name: `${currentOption.label || 'Advisor'} look`,
        items: payload,
      });

      if (result.ok && result.data?.id) {
        router.push(`/wardrobe?tab=mannequin&loadOutfit=${result.data.id}` as any);
      } else {
        showToast('Could not open this look in the Mannequin.', 'error');
      }
    } catch {
      showToast('Could not open this look in the Mannequin.', 'error');
    } finally {
      sendInFlight.current = false;
      setSavingKey(null);
    }
  }, [session?.user?.id, currentOption, router, showToast]);

  // Occasion advice tips
  const tips = useMemo(() => {
    if (!activeOccasion) return [];
    const list: string[] = [activeOccasion.tip];
    const types = new Set(items.map((i) => resolveEffectiveGarmentBucket(i)));
    if (!types.has('Shoes')) list.push('Add shoes to your wardrobe to complete full looks.');
    if (occasion === 'work' && !types.has('Outerwear')) {
      list.push('A blazer or cardigan would round this out for work.');
    }
    if (occasion === 'formal' && !types.has('Dress') && !(types.has('Top') && types.has('Bottom'))) {
      list.push('Add a formal dress, or an elevated top and bottom.');
    }
    return list;
  }, [activeOccasion, items, occasion]);

  const canStyle = (prompt.trim().length > 0 || occasion !== null) && items.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Style Advisor</Text>
          <View style={styles.aiBadge}>
            <IconSymbol name="sparkles" size={11} color={colors.tint} />
            <Text style={[styles.aiBadgeText, { color: colors.tint }]}>AI Stylist</Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(bottomInset, Spacing.xxxl) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Primary Prompt Input */}
          <View style={[styles.promptBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>What are you dressing for?</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Dinner with clients, polished but comfortable. Use my black blazer and avoid red."
              placeholderTextColor={colors.secondaryText}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              numberOfLines={2}
              maxLength={300}
              editable={!isStyling && !isRefining}
            />

            {/* Quick Context Shortcuts */}
            <Text style={[styles.quickLabel, { color: colors.secondaryText }]}>Quick context shortcuts:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipContainer}>
              {OCCASIONS.map((o) => {
                const active = occasion === o.key;
                return (
                  <TouchableOpacity
                    key={o.key}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.tint : colors.surface, borderColor: active ? colors.tint : colors.border },
                    ]}
                    onPress={() => handleOccasionPress(o.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <IconSymbol name={o.icon as any} size={14} color={active ? colors.onTint : colors.secondaryText} />
                    <Text style={[styles.chipText, { color: active ? colors.onTint : colors.text }]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Primary Action Button */}
            <TouchableOpacity
              style={[
                styles.styleMeBtn,
                { backgroundColor: canStyle ? colors.tint : colors.surface, opacity: canStyle ? 1 : 0.6 },
              ]}
              onPress={handleStyleMe}
              disabled={!canStyle || isStyling}
              accessibilityRole="button"
              accessibilityLabel="Style Me"
            >
              {isStyling ? (
                <View style={styles.btnLoadingRow}>
                  <ActivityIndicator size="small" color={colors.onTint} />
                  <Text style={[styles.styleMeBtnText, { color: colors.onTint }]}>Styling from your wardrobe...</Text>
                </View>
              ) : (
                <View style={styles.btnLoadingRow}>
                  <IconSymbol name="sparkles" size={16} color={canStyle ? colors.onTint : colors.secondaryText} />
                  <Text style={[styles.styleMeBtnText, { color: canStyle ? colors.onTint : colors.secondaryText }]}>
                    {sessionState ? 'Re-Style Looks' : 'Style Me'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Body content based on state */}
          {loadingWardrobe ? (
            <ActivityIndicator size="large" color={colors.tint} style={{ marginTop: Spacing.xxxl }} />
          ) : items.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="hanger" size={36} color={colors.tint} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Your Wardrobe is Empty</Text>
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                Add garments to your wardrobe first, and your AI stylist will curate complete looks for you.
              </Text>
            </View>
          ) : sessionState?.error ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: '#EF4444' + '40' }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={32} color="#EF4444" />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Styling Constraint Issue</Text>
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                {sessionState.error}
              </Text>
            </View>
          ) : currentOption ? (
            <>
              {/* Option Selector Tabs (2-3 Curated Looks) */}
              {sessionState && sessionState.options.length > 1 && (
                <View style={styles.optionsRow}>
                  {sessionState.options.map((opt, idx) => {
                    const active = idx === activeOptionIndex;
                    return (
                      <TouchableOpacity
                        key={opt.key + idx}
                        style={[
                          styles.optionTab,
                          {
                            backgroundColor: active ? colors.tint : colors.card,
                            borderColor: active ? colors.tint : colors.border,
                          },
                        ]}
                        onPress={() => {
                          tapLight();
                          setActiveOptionIndex(idx);
                        }}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                      >
                        <Text
                          style={[
                            styles.optionTabText,
                            { color: active ? colors.onTint : colors.text, fontWeight: active ? '700' : '500' },
                          ]}
                          numberOfLines={1}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Outfit Card */}
              <SuggestedOutfitCard
                outfit={currentOption}
                onSave={handleSave}
                saving={savingKey === currentOption.key}
              />

              {/* "Why This Works" Garment-Grounded Card */}
              {currentOption.whyThisWorks && (
                <View style={[styles.explanationCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <TouchableOpacity
                    style={styles.explanationHeader}
                    onPress={() => setShowExplanation(!showExplanation)}
                    accessibilityRole="button"
                    accessibilityLabel="Toggle Why This Works details"
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
                        {currentOption.whyThisWorks.summary}
                      </Text>

                      {currentOption.intentMatch ? (
                        <View style={[styles.intentPill, { backgroundColor: colors.tint + '12', borderColor: colors.tint + '30' }]}>
                          <Text style={[styles.intentText, { color: colors.tint }]}>
                            {currentOption.intentMatch}
                          </Text>
                        </View>
                      ) : null}

                      <View style={styles.pillarsRow}>
                        {currentOption.whyThisWorks.palette ? (
                          <View style={[styles.pillarChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>Palette</Text>
                            <Text style={[styles.pillarValue, { color: colors.text }]}>
                              {currentOption.whyThisWorks.palette}
                            </Text>
                          </View>
                        ) : null}

                        {currentOption.whyThisWorks.silhouette ? (
                          <View style={[styles.pillarChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>Silhouette</Text>
                            <Text style={[styles.pillarValue, { color: colors.text }]}>
                              {currentOption.whyThisWorks.silhouette}
                            </Text>
                          </View>
                        ) : null}

                        {currentOption.whyThisWorks.occasion ? (
                          <View style={[styles.pillarChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>Occasion</Text>
                            <Text style={[styles.pillarValue, { color: colors.text }]}>
                              {currentOption.whyThisWorks.occasion}
                            </Text>
                          </View>
                        ) : null}

                        {currentOption.whyThisWorks.layering ? (
                          <View style={[styles.pillarChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>Layering</Text>
                            <Text style={[styles.pillarValue, { color: colors.text }]}>
                              {currentOption.whyThisWorks.layering}
                            </Text>
                          </View>
                        ) : null}

                        {currentOption.whyThisWorks.footwear ? (
                          <View style={[styles.pillarChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.pillarLabel, { color: colors.secondaryText }]}>Footwear</Text>
                            <Text style={[styles.pillarValue, { color: colors.text }]}>
                              {currentOption.whyThisWorks.footwear}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {currentOption.proTip ? (
                        <View style={[styles.proTipBox, { backgroundColor: colors.background }]}>
                          <Text style={[styles.proTipText, { color: colors.tint }]}>
                            Pro Tip: {currentOption.proTip}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
              )}

              {/* Primary Actions Row */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.feedbackBtn, { borderColor: '#10B981', backgroundColor: '#10B981' + '18' }]}
                  onPress={handleLogWorn}
                  accessibilityRole="button"
                  accessibilityLabel="Wear this outfit"
                >
                  <IconSymbol name="checkmark.circle.fill" size={16} color="#10B981" />
                  <Text style={[styles.feedbackBtnText, { color: '#10B981' }]}>Wear This</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.feedbackBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={handlePass}
                  accessibilityRole="button"
                  accessibilityLabel="Pass on this recommendation"
                >
                  <IconSymbol name="xmark.circle.fill" size={16} color="#EF4444" />
                  <Text style={[styles.feedbackBtnText, { color: colors.text }]}>Pass</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.feedbackBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  onPress={handleSendToMannequin}
                  accessibilityRole="button"
                  accessibilityLabel="Send outfit to mannequin"
                >
                  <IconSymbol name="person.fill" size={16} color={colors.tint} />
                  <Text style={[styles.feedbackBtnText, { color: colors.tint }]}>Mannequin</Text>
                </TouchableOpacity>
              </View>

              {/* Interactive Refinement Pills */}
              <View style={styles.refinementSection}>
                <Text style={[styles.refineTitle, { color: colors.secondaryText }]}>Refine this look:</Text>
                <View style={styles.refineChipsRow}>
                  <TouchableOpacity
                    style={[styles.refineChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleRefine('moreFormal')}
                    disabled={isRefining}
                  >
                    <IconSymbol name="bag.fill" size={13} color={colors.tint} />
                    <Text style={[styles.refineChipText, { color: colors.text }]}>More Formal</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.refineChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleRefine('moreRelaxed')}
                    disabled={isRefining}
                  >
                    <IconSymbol name="tshirt" size={13} color={colors.tint} />
                    <Text style={[styles.refineChipText, { color: colors.text }]}>More Relaxed</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.refineChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleRefine('moreComfortable')}
                    disabled={isRefining}
                  >
                    <IconSymbol name="sparkles" size={13} color={colors.tint} />
                    <Text style={[styles.refineChipText, { color: colors.text }]}>More Comfortable</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.refineChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleRefine('tryAnother')}
                    disabled={isRefining}
                  >
                    <IconSymbol name="shuffle" size={13} color={colors.tint} />
                    <Text style={[styles.refineChipText, { color: colors.text }]}>Try Another</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Stylist Occasion Advice Card */}
              {tips.length > 0 && (
                <View style={[styles.tipsCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: Spacing.lg }]}>
                  {tips.map((tip, i) => (
                    <View key={i} style={styles.tipRow}>
                      <IconSymbol name="sparkles" size={14} color={colors.tint} />
                      <Text style={[styles.tipText, { color: colors.text }]}>{tip}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            /* Idle initial state */
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.emptyIconBadge, { backgroundColor: colors.tint + '18' }]}>
                <IconSymbol name="sparkles" size={32} color={colors.tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Personalized AI Stylist</Text>
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                Describe what you need above or select a quick shortcut. JeZsy will assemble and rank complete looks from your own wardrobe.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  headerTitle: {
    ...Type.headline,
    fontSize: 18,
    fontWeight: '700',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: '#CA8A04' + '18',
  },
  aiBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  promptBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  inputLabel: {
    ...Type.bodyStrong,
    fontWeight: '700',
    fontSize: 15,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  quickLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  chipScroll: {
    marginHorizontal: -Spacing.xs,
  },
  chipContainer: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  styleMeBtn: {
    height: 46,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  styleMeBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
    fontSize: 15,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: Spacing.xs,
  },
  optionTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTabText: {
    fontSize: 13,
  },
  explanationCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
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
  intentPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  intentText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  pillarsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 4,
  },
  pillarChip: {
    flexDirection: 'column',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 2,
    minWidth: '47%',
    flexGrow: 1,
  },
  pillarLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pillarValue: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  proTipBox: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: 4,
  },
  proTipText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: Spacing.xs,
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
  refinementSection: {
    marginTop: Spacing.xs,
    gap: Spacing.xs,
  },
  refineTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  refineChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  refineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  refineChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tipsCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  tipText: {
    ...Type.caption,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  emptyCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  emptyIconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    ...Type.headline,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: { ...Type.body, textAlign: 'center', maxWidth: 360 },
});
