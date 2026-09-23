import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Radius, Spacing, Type, WardrobeTokens } from '@/constants/theme';
import { useSharedBottomInset } from '@/src/hooks/useFloatingTabBarMetrics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { outfitService } from '@/src/services';
import { WARDROBE_LIST_COLUMNS } from '@/src/services/wardrobeService';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { Database } from '@/src/types/database.types';
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
import {
  StylingOption,
  StylingRefinementType,
  StyleAdvisorChipContext,
  StyleAdvisorVibe,
} from '@/src/types/styleAdvisor';
import { StyleAdvisorLookCard } from '@/src/components/styling/StyleAdvisorLookCard';
import { transientMannequinService } from '@/src/services/styling/transientMannequinService';
import { OutfitRemixModal } from '@/src/components/styling/OutfitRemixModal';
import { adaptStyleAdvisorLookToRemix } from '@/src/services/styling/outfitRemixService';
import { OutfitRemixState, OutfitRemixResult } from '@/src/types/outfitRemix';
import { supabase } from '@/src/lib/supabase';
import { PlanOutfitModal } from '@/src/components/planner/PlanOutfitModal';
import { buildPlannerItemSnapshots } from '@/src/utils/plannerSnapshotAdapter';
import { PlanLaterPayload } from '@/src/types/planner';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

const OCCASION_CHIPS = ['Dinner', 'Work', 'Casual', 'Date Night', 'Event', 'Travel'];
const WEATHER_CHIPS = ['Sunny', 'Rain', 'Snow'];
const TEMPERATURE_CHIPS = ['Warm', 'Mild', 'Cool'];
const VIBE_CHIPS: StyleAdvisorVibe[] = ['polished', 'relaxed', 'comfortable', 'minimal'];

export default function StyleAdvisorScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const wt = WardrobeTokens.theme[theme];
  const router = useRouter();
  const params = useLocalSearchParams<{ styleAroundItemId?: string }>();
  const { session } = useAuth();
  const { showToast } = useToast();
  const bottomInset = useSharedBottomInset();

  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loadingWardrobe, setLoadingWardrobe] = useState(true);
  const [profile, setProfile] = useState<UserStyleProfileDto | null>(null);

  // Styling inputs
  const [prompt, setPrompt] = useState('');
  const [selectedOccasion, setSelectedOccasion] = useState<string | null>(null);
  const [selectedWeather, setSelectedWeather] = useState<string | null>(null);
  const [selectedTemperature, setSelectedTemperature] = useState<string | null>(null);
  const [selectedVibe, setSelectedVibe] = useState<StyleAdvisorVibe | null>(null);
  const [comfortPriority, setComfortPriority] = useState<boolean>(false);

  // Locked item for "Style Around This Item"
  const [lockedGarment, setLockedGarment] = useState<WardrobeItem | null>(null);
  const validatedLockRef = useRef<string | null>(null);

  // Active session and options
  const [sessionState, setSessionState] = useState<StylingSessionState | null>(null);
  const [isStyling, setIsStyling] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [transferringKey, setTransferringKey] = useState<string | null>(null);

  // Outfit Remix state
  const [remixModalVisible, setRemixModalVisible] = useState(false);
  const [remixInitialState, setRemixInitialState] = useState<OutfitRemixState | null>(null);
  const [remixLookIndex, setRemixLookIndex] = useState<number>(-1);

  // Planner Plan Later state
  const [planLaterPayload, setPlanLaterPayload] = useState<PlanLaterPayload | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  const handlePlanLook = useCallback(
    (look: StylingOption) => {
      const snapshots = buildPlannerItemSnapshots(look.items, { authoritativeInventory: items });
      setPlanLaterPayload({
        items: snapshots,
        sourceType: 'style_advisor',
        occasion: look.whyThisWorks?.occasion || sessionState?.intent?.selectedOccasion || undefined,
        name: 'Style Advisor Look',
      });
      setIsPlanModalOpen(true);
    },
    [items, sessionState]
  );

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

  // Gate Style Around validation strictly until wardrobe loading completes
  useEffect(() => {
    if (loadingWardrobe || !params.styleAroundItemId) return;
    const targetId = params.styleAroundItemId;
    if (validatedLockRef.current === targetId) return;
    validatedLockRef.current = targetId;

    const targetItem = items.find((w) => w.id === targetId);
    if (!targetItem) {
      showToast('The selected item is no longer available in your wardrobe.', 'info');
      router.setParams({ styleAroundItemId: undefined });
      return;
    }

    const bucket = resolveEffectiveGarmentBucket(targetItem);
    const isCoreCategory = ['Top', 'Bottom', 'Dress', 'Shoes', 'Outerwear'].includes(bucket);
    if (!isCoreCategory) {
      showToast('Accessories cannot currently be used as anchor garments for styling.', 'info');
      router.setParams({ styleAroundItemId: undefined });
      return;
    }

    setLockedGarment(targetItem);
  }, [loadingWardrobe, params.styleAroundItemId, items, router, showToast]);

  // Remove lock affordance: clears locked state, intent mustUseItemIds, and route parameter
  const handleRemoveLock = useCallback(() => {
    tapLight();
    const removedItemId = lockedGarment?.id;
    setLockedGarment(null);
    validatedLockRef.current = null;
    router.setParams({ styleAroundItemId: undefined });

    if (sessionState) {
      setSessionState((prev) => {
        if (!prev) return null;
        const toRemove = new Set(prev.lockedWardrobeItemIds || []);
        if (removedItemId) toRemove.add(removedItemId);
        return {
          ...prev,
          lockedWardrobeItemIds: [],
          intent: {
            ...prev.intent,
            mustUseItemIds: (prev.intent.mustUseItemIds || []).filter((id) => !toRemove.has(id)),
          },
        };
      });
    }
  }, [router, sessionState, lockedGarment]);

  // Chip toggles: single-select within semantic group, multi-select across groups
  const handleToggleOccasion = useCallback((occ: string) => {
    tapLight();
    setSelectedOccasion((prev) => (prev === occ ? null : occ));
  }, []);

  const handleToggleWeather = useCallback((w: string) => {
    tapLight();
    setSelectedWeather((prev) => (prev === w ? null : w));
  }, []);

  const handleToggleTemperature = useCallback((t: string) => {
    tapLight();
    setSelectedTemperature((prev) => (prev === t ? null : t));
  }, []);

  const handleToggleVibe = useCallback((vibe: StyleAdvisorVibe) => {
    tapLight();
    setSelectedVibe((prev) => (prev === vibe ? null : vibe));
  }, []);

  const handleToggleComfort = useCallback(() => {
    tapLight();
    setComfortPriority((prev) => !prev);
  }, []);

  // Primary action: Style My Wardrobe
  const handleStyleMyWardrobe = useCallback(async () => {
    if (items.length === 0 || isStyling) return;
    tapMedium();
    setIsStyling(true);

    const chipContext: StyleAdvisorChipContext = {
      occasion: selectedOccasion || undefined,
      weather: selectedWeather ? selectedWeather.toLowerCase() : undefined,
      temperature: selectedTemperature ? selectedTemperature.toLowerCase() : undefined,
      vibe: selectedVibe || undefined,
      comfort: comfortPriority || undefined,
    };

    const initialLocks = lockedGarment ? [lockedGarment.id] : [];

    try {
      const state = await createStylingSession(
        prompt,
        chipContext,
        items,
        profile,
        undefined,
        initialLocks
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
  }, [
    items,
    isStyling,
    prompt,
    selectedOccasion,
    selectedWeather,
    selectedTemperature,
    selectedVibe,
    comfortPriority,
    lockedGarment,
    profile,
    showToast,
  ]);

  // Interactive session refinements (durable locked items preserved)
  const handleRefine = useCallback(
    async (type: StylingRefinementType, targetItemId?: string) => {
      if (!sessionState || isRefining) return;
      tapLight();
      setIsRefining(true);

      try {
        const nextState = await refineStylingSession(sessionState, type, targetItemId);
        setSessionState(nextState);
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

  // Legitimate user Save Look action
  const handleSaveLook = useCallback(
    async (outfit: StylingOption) => {
      if (!session?.user?.id || savedKeys.has(outfit.key)) return;
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
          name: `${outfit.label || 'Advisor'} look`,
          items: payload,
        });

        if (!result.ok) throw result.error;

        setSavedKeys((prev) => new Set([...prev, outfit.key]));

        await outfitFeedbackService.logFeedback(
          {
            userId: session.user.id,
            feedbackType: 'saved',
            occasion: selectedOccasion || sessionState?.intent.selectedOccasion || undefined,
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
    [session?.user?.id, savedKeys, selectedOccasion, sessionState?.intent, showToast]
  );

  // Hardened Mannequin Transfer Bridge (ZERO database writes)
  const handleOpenInMannequin = useCallback(
    async (look: StylingOption) => {
      if (!session?.user?.id || transferringKey) return;
      setTransferringKey(look.key);

      try {
        const tokenRes = await transientMannequinService.createToken({
          userId: session.user.id,
          itemIds: look.items.map((i) => i.id),
          source: 'style-advisor',
        });

        if (tokenRes.success && tokenRes.token) {
          router.push(`/(tabs)/wardrobe?tab=mannequin&transientToken=${tokenRes.token}` as any);
        } else {
          showToast('Could not transfer look to Mannequin. Please try again.', 'error');
        }
      } catch (err) {
        console.error('Failed to transfer look to Mannequin:', err);
        showToast('Could not transfer look to Mannequin. Please try again.', 'error');
      } finally {
        setTransferringKey(null);
      }
    },
    [session?.user?.id, transferringKey, router, showToast]
  );

  // Outfit Remix Handlers
  const handleOpenRemix = useCallback(
    (look: StylingOption, index: number) => {
      if (!sessionState) return;
      const initial = adaptStyleAdvisorLookToRemix(
        look,
        items,
        sessionState.intent,
        sessionState.lockedWardrobeItemIds
      );
      setRemixInitialState(initial);
      setRemixLookIndex(index);
      setRemixModalVisible(true);
    },
    [sessionState, items]
  );

  const handleApplyRemix = useCallback(
    (result: OutfitRemixResult) => {
      if (!sessionState || remixLookIndex < 0) return;
      const currentLook = sessionState.options[remixLookIndex];
      if (!currentLook) return;

      const updatedLook: StylingOption = {
        ...currentLook,
        items: result.items,
        key: result.outfitKey,
        score: result.score,
        headline: result.headline,
        label: result.label,
        whyThisWorks: result.whyThisWorks,
      };

      const nextOptions = [...sessionState.options];
      nextOptions[remixLookIndex] = updatedLook;
      setSessionState({
        ...sessionState,
        options: nextOptions,
      });
      showToast('Outfit updated.', 'success');
    },
    [sessionState, remixLookIndex, showToast]
  );

  const handleSaveRemix = useCallback(
    async (result: OutfitRemixResult) => {
      if (!sessionState || remixLookIndex < 0) return;
      const currentLook = sessionState.options[remixLookIndex];
      const remixedOption: StylingOption = {
        candidateId: result.outfitKey,
        items: result.items,
        key: result.outfitKey,
        score: result.score,
        headline: result.headline,
        label: result.label,
        whyThisWorks: result.whyThisWorks,
        intentMatch: currentLook?.intentMatch || 'Remixed match',
        isAiRanked: false,
        assessment: currentLook?.assessment || 'Appropriate for this occasion',
      };
      await handleSaveLook(remixedOption);
    },
    [sessionState, remixLookIndex, handleSaveLook]
  );

  const handleMannequinRemix = useCallback(
    async (result: OutfitRemixResult) => {
      const dummyOption: StylingOption = {
        candidateId: result.outfitKey,
        items: result.items,
        key: result.outfitKey,
        score: result.score,
        headline: result.headline,
        label: result.label,
        whyThisWorks: result.whyThisWorks,
        intentMatch: 'Match',
        isAiRanked: false,
        assessment: 'Appropriate for this occasion',
      };
      await handleOpenInMannequin(dummyOption);
    },
    [handleOpenInMannequin]
  );

  const canStyle = (prompt.trim().length > 0 || selectedOccasion !== null || lockedGarment !== null) && items.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* ── Quiet Luxury Header ── */}
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
          <View style={styles.headerSubBadge}>
            <Text style={[styles.headerSubText, { color: wt.actionSecondaryText }]}>JezSy Stylist</Text>
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
          {/* ── Natural Language Primary Input Box ── */}
          <View style={[styles.promptBox, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>What are you dressing for?</Text>
            <TextInput
              style={[
                styles.textInput,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              placeholder="Dinner somewhere nice, but we'll probably walk after. Keep it comfortable and use my navy blazer."
              placeholderTextColor={colors.secondaryText}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              numberOfLines={3}
              maxLength={400}
              editable={!isStyling && !isRefining}
              accessibilityLabel="Describe what you want to wear"
            />

            {/* ── Durable Locked Garment Banner (Style Around This Item) ── */}
            {lockedGarment && (
              <View style={[styles.lockedBanner, { backgroundColor: wt.accentGoldSubtle, borderColor: wt.cardBorder }]}>
                <View style={styles.lockedBannerLeft}>
                  <IconSymbol name="sparkles" size={14} color={wt.actionPrimary} />
                  <Text style={[styles.lockedBannerText, { color: colors.text }]} numberOfLines={1}>
                    Styling around:{' '}
                    <Text style={{ fontWeight: '700', color: wt.actionPrimary }}>
                      {lockedGarment.sub_category || lockedGarment.category || 'Selected Garment'}
                    </Text>
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleRemoveLock}
                  style={styles.lockedCloseBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Remove garment lock"
                >
                  <IconSymbol name="xmark" size={14} color={colors.secondaryText} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Helpful Context Chips (Single-select per group, multi across groups) ── */}
            <Text style={[styles.chipsHeading, { color: colors.secondaryText }]}>Helpful context (optional):</Text>

            {/* Occasion chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipScrollContent}>
              {OCCASION_CHIPS.map((occ) => {
                const active = selectedOccasion === occ;
                return (
                  <TouchableOpacity
                    key={occ}
                    style={[
                      styles.contextChip,
                      {
                        backgroundColor: active ? wt.actionPrimary : wt.cardSurfaceSubtle,
                        borderColor: active ? wt.actionPrimary : wt.cardBorder,
                      },
                    ]}
                    onPress={() => handleToggleOccasion(occ)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.contextChipText, { color: active ? wt.actionPrimaryText : colors.text }]}>
                      {occ}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Weather & Vibe chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipScrollContent}>
              {WEATHER_CHIPS.map((w) => {
                const active = selectedWeather === w;
                return (
                  <TouchableOpacity
                    key={w}
                    style={[
                      styles.contextChip,
                      {
                        backgroundColor: active ? wt.actionPrimary : wt.cardSurfaceSubtle,
                        borderColor: active ? wt.actionPrimary : wt.cardBorder,
                      },
                    ]}
                    onPress={() => handleToggleWeather(w)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.contextChipText, { color: active ? wt.actionPrimaryText : colors.text }]}>
                      {w}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {TEMPERATURE_CHIPS.map((t) => {
                const active = selectedTemperature === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.contextChip,
                      {
                        backgroundColor: active ? wt.actionPrimary : wt.cardSurfaceSubtle,
                        borderColor: active ? wt.actionPrimary : wt.cardBorder,
                      },
                    ]}
                    onPress={() => handleToggleTemperature(t)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.contextChipText, { color: active ? wt.actionPrimaryText : colors.text }]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {VIBE_CHIPS.map((vibe) => {
                const active = selectedVibe === vibe;
                const label = vibe.charAt(0).toUpperCase() + vibe.slice(1);
                return (
                  <TouchableOpacity
                    key={vibe}
                    style={[
                      styles.contextChip,
                      {
                        backgroundColor: active ? wt.actionPrimary : wt.cardSurfaceSubtle,
                        borderColor: active ? wt.actionPrimary : wt.cardBorder,
                      },
                    ]}
                    onPress={() => handleToggleVibe(vibe)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.contextChipText, { color: active ? wt.actionPrimaryText : colors.text }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[
                  styles.contextChip,
                  {
                    backgroundColor: comfortPriority ? wt.actionPrimary : wt.cardSurfaceSubtle,
                    borderColor: comfortPriority ? wt.actionPrimary : wt.cardBorder,
                  },
                ]}
                onPress={handleToggleComfort}
                accessibilityRole="button"
                accessibilityState={{ selected: comfortPriority }}
              >
                <Text style={[styles.contextChipText, { color: comfortPriority ? wt.actionPrimaryText : colors.text }]}>
                  Comfort Priority
                </Text>
              </TouchableOpacity>
            </ScrollView>

            {/* ── Primary Action Button ── */}
            <TouchableOpacity
              style={[
                styles.styleMeBtn,
                {
                  backgroundColor: canStyle ? wt.actionPrimary : wt.cardSurfaceSubtle,
                  opacity: canStyle ? 1 : 0.6,
                },
              ]}
              onPress={handleStyleMyWardrobe}
              disabled={!canStyle || isStyling}
              accessibilityRole="button"
              accessibilityLabel="Style My Wardrobe"
            >
              {isStyling ? (
                <View style={styles.btnLoadingRow}>
                  <ActivityIndicator size="small" color={wt.actionPrimaryText} />
                  <Text style={[styles.styleMeBtnText, { color: wt.actionPrimaryText }]}>
                    Styling from your wardrobe...
                  </Text>
                </View>
              ) : (
                <View style={styles.btnLoadingRow}>
                  <IconSymbol name="sparkles" size={16} color={canStyle ? wt.actionPrimaryText : colors.secondaryText} />
                  <Text style={[styles.styleMeBtnText, { color: canStyle ? wt.actionPrimaryText : colors.secondaryText }]}>
                    {sessionState ? 'Re-Style Looks ✨' : 'Style My Wardrobe ✨'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Body Content: Vertical Multi-Look Editorial Layout ── */}
          {loadingWardrobe ? (
            <ActivityIndicator size="large" color={wt.actionPrimary} style={{ marginTop: Spacing.xxxl }} />
          ) : items.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}>
              <IconSymbol name="hanger" size={36} color={wt.actionPrimary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Your Wardrobe is Empty</Text>
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                Add garments to your wardrobe first, and your Style Advisor will curate complete looks for you.
              </Text>
            </View>
          ) : sessionState?.error ? (
            <View style={[styles.emptyCard, { backgroundColor: wt.cardSurface, borderColor: '#EF4444' + '40' }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={32} color="#EF4444" />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Styling Constraint Issue</Text>
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                {sessionState.error}
              </Text>
            </View>
          ) : sessionState && sessionState.options.length > 0 ? (
            <View style={styles.editorialStream}>
              <View style={styles.resultsHeader}>
                <Text style={[styles.resultsTitle, { color: colors.text }]}>Curated Looks for You</Text>
                <Text style={[styles.resultsCount, { color: wt.actionSecondaryText }]}>
                  {sessionState.options.length} distinct looks
                </Text>
              </View>

              {sessionState.options.map((opt, idx) => (
                <StyleAdvisorLookCard
                  key={opt.key}
                  look={opt}
                  index={idx}
                  onSave={handleSaveLook}
                  onOpenMannequin={handleOpenInMannequin}
                  onRefine={handleRefine}
                  onRemix={(look) => handleOpenRemix(look, idx)}
                  onPlan={handlePlanLook}
                  isSaved={savedKeys.has(opt.key)}
                  isSaving={savingKey === opt.key}
                  isTransferring={transferringKey === opt.key}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <OutfitRemixModal
        visible={remixModalVisible}
        onClose={() => setRemixModalVisible(false)}
        initialState={remixInitialState}
        wardrobe={items}
        onApply={handleApplyRemix}
        onSave={handleSaveRemix}
        onOpenMannequin={handleMannequinRemix}
        saving={savingKey !== null}
      />

      <PlanOutfitModal
        visible={isPlanModalOpen}
        payload={planLaterPayload}
        authoritativeInventory={items}
        onClose={() => setIsPlanModalOpen(false)}
        onSuccess={() => {
          showToast('Outfit scheduled in planner!');
        }}
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
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    ...Type.subtitle,
    fontWeight: '700',
  },
  headerSubBadge: {
    marginTop: 2,
  },
  headerSubText: {
    ...Type.caption,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  promptBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  inputLabel: {
    ...Type.bodyStrong,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  textInput: {
    minHeight: 88,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    ...Type.body,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    marginBottom: Spacing.md,
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  lockedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
  },
  lockedBannerText: {
    ...Type.caption,
    fontSize: 12,
  },
  lockedCloseBtn: {
    padding: Spacing.xs,
  },
  chipsHeading: {
    ...Type.caption,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  chipRow: {
    marginBottom: Spacing.sm,
  },
  chipScrollContent: {
    gap: Spacing.xs,
  },
  contextChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  contextChipText: {
    ...Type.caption,
    fontWeight: '600',
    fontSize: 12,
  },
  styleMeBtn: {
    height: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  btnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  styleMeBtnText: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  emptyCard: {
    padding: Spacing.xxl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    ...Type.subtitle,
    fontWeight: '700',
    marginTop: Spacing.xs,
  },
  emptyText: {
    ...Type.body,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
  editorialStream: {
    marginTop: Spacing.md,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    paddingHorizontal: 2,
  },
  resultsTitle: {
    ...Type.subtitle,
    fontWeight: '700',
    fontSize: 18,
  },
  resultsCount: {
    ...Type.caption,
    fontWeight: '600',
  },
});
