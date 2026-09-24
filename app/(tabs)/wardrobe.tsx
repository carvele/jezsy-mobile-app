import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, Dimensions, RefreshControl, ActivityIndicator, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Colors, Spacing, Radius, Type, Elevation, WardrobeTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { outfitService } from '@/src/services';
import { outfitFeedbackService } from '@/src/services/outfitFeedbackService';
import { localExposureService, LocalExposureHistory } from '@/src/services/styling/localExposureService';
import { useAuth } from '@/src/context/AuthContext';
import { Image } from 'expo-image';
import { CapsuleCard } from '@/src/components/CapsuleCard';
import {
  getWardrobeItemsPage,
  getWardrobeOutfitsPage,
  getWardrobeCapsulesPage,
  WardrobeItem,
  SavedOutfit,
  Capsule,
} from '@/src/services/wardrobeService';
import { GapAnalysis } from '@/src/components/GapAnalysis';
import { WardrobeStatsBar } from '@/src/components/WardrobeStatsBar';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';
import { generateOutfits, computeStats, GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { ProductCardSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { FadeInView } from '@/src/components/FadeInView';
import { BrandEmptyState } from '@/src/components/BrandEmptyState';
import { tapLight } from '@/src/utils/haptics';
import { useWardrobeGridCardWidth, WARDROBE_GRID_COLUMN_GAP, WARDROBE_GRID_GUTTER } from '@/src/utils/layout';
import { useToast } from '@/src/context/ToastContext';
import { MannequinView } from '@/src/components/Mannequin/MannequinView';
import { MannequinOutfitPreview } from '@/src/components/Mannequin/MannequinOutfitPreview';
import { useTourCoachmark, TourCoachmarkBanner } from '@/src/features/systemTour/TourCoachmark';
import { useSharedBottomInset } from '@/src/hooks/useFloatingTabBarMetrics';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';
import { transientMannequinService } from '@/src/services/styling/transientMannequinService';
import { OutfitRemixModal } from '@/src/components/styling/OutfitRemixModal';
import { adaptPassiveOutfitToRemix } from '@/src/services/styling/outfitRemixService';
import { OutfitRemixState, OutfitRemixResult } from '@/src/types/outfitRemix';

const { width } = Dimensions.get('window');
const OUTFIT_CARD_WIDTH = width - 40;
// Saved outfits scroll horizontally, so their cards are narrower than the
// suggestion cards above them -- wide enough to read, narrow enough that the
// next card peeks in to hint there's more to scroll to.
const SAVED_OUTFIT_CARD_WIDTH = Math.min(width * 0.74, 300);

type Tab = 'items' | 'outfits' | 'capsules' | 'mannequin';

const VALID_TABS: Tab[] = ['items', 'outfits', 'capsules', 'mannequin'];
const STORAGE_KEY = 'jezsy_wardrobe_active_tab';

function persistTab(tab: Tab) {
  AsyncStorage.setItem(STORAGE_KEY, tab).catch(() => {});
}

const GARMENT_TYPES = ['Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes', 'Accessory'];

type WearFilter = 'all' | 'never' | 'neglected';

export default function WardrobeScreen() {
  const bottomInset = useSharedBottomInset();
  const { cardWidth, columns } = useWardrobeGridCardWidth();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const wt = WardrobeTokens.theme[theme];
  const { showToast } = useToast();
  const { session } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; loadOutfit?: string; transientToken?: string }>();
  const tourCoachmark = useTourCoachmark('wardrobe');



  const initialTab = useMemo<Tab>(() => {
    // Explicit URL param takes priority (e.g. /wardrobe?tab=mannequin)
    if (params.tab && VALID_TABS.includes(params.tab as Tab)) {
      return params.tab as Tab;
    }
    return 'items';
  }, [params.tab]);

  const [activeTab, setActiveTabState] = useState<Tab>(initialTab);
  React.useEffect(() => {
    if (params.tab) return;
    // Restore the last-used tab so it survives Expo Router unmounting this
    // screen on tab navigation.
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved: string | null) => {
        if (saved && VALID_TABS.includes(saved as Tab)) {
          setActiveTabState(saved as Tab);
        }
      })
      .catch(() => {});
  }, [params.tab]);


  const setActiveTab = useCallback((tab: Tab) => {
    persistTab(tab);
    setActiveTabState(tab);
  }, []);

  React.useEffect(() => {
    if (params.tab && VALID_TABS.includes(params.tab as Tab)) {
      setActiveTab(params.tab as Tab);
    }
  }, [params.tab, setActiveTab]);

  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<SavedOutfit[]>([]);
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemsOffset, setItemsOffset] = useState(0);
  const [hasMoreItems, setHasMoreItems] = useState(false);
  const [loadingMoreItems, setLoadingMoreItems] = useState(false);

  const [outfitsOffset, setOutfitsOffset] = useState(0);
  const [hasMoreOutfits, setHasMoreOutfits] = useState(false);
  const [loadingMoreOutfits, setLoadingMoreOutfits] = useState(false);

  const [capsulesOffset, setCapsulesOffset] = useState(0);
  const [hasMoreCapsules, setHasMoreCapsules] = useState(false);
  const [loadingMoreCapsules, setLoadingMoreCapsules] = useState(false);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [wearFilter, setWearFilter] = useState<WearFilter>('all');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createOutfitSheetVisible, setCreateOutfitSheetVisible] = useState(false);
  const hasLoadedOnce = useRef(false);

  const fetchWardrobeData = useCallback(async (isRefresh = false) => {
    if (!session?.user?.id) {
      setLoading(false);
      return;
    }

    try {
      if (!isRefresh && !hasLoadedOnce.current) setLoading(true);
      const [itemsRes, outfitsRes, capsulesRes] = await Promise.allSettled([
        getWardrobeItemsPage(session.user.id, 0, { garmentType: typeFilter, search, wearFilter }, 50),
        getWardrobeOutfitsPage(session.user.id, 0, 25),
        getWardrobeCapsulesPage(session.user.id, 0, 25),
      ]);

      if (itemsRes.status === 'fulfilled') {
        setItems(itemsRes.value.items);
        setItemsOffset(itemsRes.value.nextOffset);
        setHasMoreItems(itemsRes.value.hasMore);
      } else {
        console.error('Error fetching wardrobe items:', itemsRes.reason);
        showToast('Could not load your wardrobe items. Please try again.', 'error');
      }

      if (outfitsRes.status === 'fulfilled') {
        setOutfits(outfitsRes.value.items);
        setOutfitsOffset(outfitsRes.value.nextOffset);
        setHasMoreOutfits(outfitsRes.value.hasMore);
      } else {
        console.error('Error fetching outfits:', outfitsRes.reason);
      }

      if (capsulesRes.status === 'fulfilled') {
        setCapsules(capsulesRes.value.items);
        setCapsulesOffset(capsulesRes.value.nextOffset);
        setHasMoreCapsules(capsulesRes.value.hasMore);
      } else {
        console.error('Error fetching capsules:', capsulesRes.reason);
      }
    } catch (error) {
      console.error('Error fetching wardrobe data:', error);
      showToast('Could not load your wardrobe. Please try again.', 'error');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }, [session?.user?.id, typeFilter, search, wearFilter, showToast]);

  const fetchItemsFiltered = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const res = await getWardrobeItemsPage(
        session.user.id,
        0,
        { garmentType: typeFilter, search, wearFilter },
        50
      );
      setItems(res.items);
      setItemsOffset(res.nextOffset);
      setHasMoreItems(res.hasMore);
    } catch (err) {
      console.error('Error filtering wardrobe items:', err);
    }
  }, [session?.user?.id, typeFilter, search, wearFilter]);

  useEffect(() => {
    if (!hasLoadedOnce.current) return;
    const timer = setTimeout(() => {
      fetchItemsFiltered();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchItemsFiltered]);

  const loadMoreItems = useCallback(async () => {
    if (!session?.user?.id || loadingMoreItems || !hasMoreItems || loading) return;
    setLoadingMoreItems(true);
    try {
      const res = await getWardrobeItemsPage(
        session.user.id,
        itemsOffset,
        { garmentType: typeFilter, search, wearFilter },
        50
      );
      setItems((prev) => {
        const existing = new Set(prev.map((i) => i.id));
        const novel = res.items.filter((i) => !existing.has(i.id));
        return [...prev, ...novel];
      });
      setItemsOffset(res.nextOffset);
      setHasMoreItems(res.hasMore);
    } catch (err) {
      console.error('Error loading more wardrobe items:', err);
    } finally {
      setLoadingMoreItems(false);
    }
  }, [session?.user?.id, itemsOffset, typeFilter, search, wearFilter, loadingMoreItems, hasMoreItems, loading]);

  const loadMoreOutfits = useCallback(async () => {
    if (!session?.user?.id || loadingMoreOutfits || !hasMoreOutfits || loading) return;
    setLoadingMoreOutfits(true);
    try {
      const res = await getWardrobeOutfitsPage(session.user.id, outfitsOffset, 25);
      setOutfits((prev) => {
        const existing = new Set(prev.map((o) => o.id));
        const novel = res.items.filter((o) => !existing.has(o.id));
        return [...prev, ...novel];
      });
      setOutfitsOffset(res.nextOffset);
      setHasMoreOutfits(res.hasMore);
    } catch (err) {
      console.error('Error loading more outfits:', err);
    } finally {
      setLoadingMoreOutfits(false);
    }
  }, [session?.user?.id, outfitsOffset, loadingMoreOutfits, hasMoreOutfits, loading]);

  const loadMoreCapsules = useCallback(async () => {
    if (!session?.user?.id || loadingMoreCapsules || !hasMoreCapsules || loading) return;
    setLoadingMoreCapsules(true);
    try {
      const res = await getWardrobeCapsulesPage(session.user.id, capsulesOffset, 25);
      setCapsules((prev) => {
        const existing = new Set(prev.map((c) => c.id));
        const novel = res.items.filter((c) => !existing.has(c.id));
        return [...prev, ...novel];
      });
      setCapsulesOffset(res.nextOffset);
      setHasMoreCapsules(res.hasMore);
    } catch (err) {
      console.error('Error loading more capsules:', err);
    } finally {
      setLoadingMoreCapsules(false);
    }
  }, [session?.user?.id, capsulesOffset, loadingMoreCapsules, hasMoreCapsules, loading]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchWardrobeData(true);
    setRefreshing(false);
  }, [fetchWardrobeData]);

  // useFocusEffect covers both the initial mount and re-focusing after
  // returning from item/outfit/capsule detail screens, so changes there
  // (log a wear, delete an item, add a capsule) show up immediately.
  useFocusEffect(
    useCallback(() => {
      fetchWardrobeData();
    }, [fetchWardrobeData])
  );

  const stats = useMemo(() => computeStats(items), [items]);
  // Pulled from a larger pool than what's shown, so "Pass" on one of the
  // visible 3 can reveal the next-best candidate instead of just shrinking the list.
  const suggestionPool = useMemo(() => generateOutfits(items, 20), [items]);
  const [exposureHistory, setExposureHistory] = useState<LocalExposureHistory | null>(null);
  const presentedKeysRef = useRef<Set<string>>(new Set());
  const SUGGESTION_DISPLAY_LIMIT = 3;

  // Outfit Remix state for Suggested for You
  const [remixModalVisible, setRemixModalVisible] = useState(false);
  const [remixInitialState, setRemixInitialState] = useState<OutfitRemixState | null>(null);
  const [remixTargetOutfitKey, setRemixTargetOutfitKey] = useState<string | null>(null);
  const [remixedDrafts, setRemixedDrafts] = useState<Map<string, GeneratedOutfit>>(new Map());

  // Load exposure history from localExposureService (with non-destructive legacy migration)
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    localExposureService.getExposureHistory(userId)
      .then(setExposureHistory)
      .catch(() => {});
  }, [session?.user?.id]);

  // Dynamic suggestion ranking using cooldowns and exposure decay penalties
  const suggestions = useMemo(() => {
    if (!suggestionPool || suggestionPool.length === 0) return [];
    if (!exposureHistory) {
      return suggestionPool.slice(0, SUGGESTION_DISPLAY_LIMIT);
    }
    const available = suggestionPool.filter(
      (o) => !localExposureService.isOutfitCooldownActive(o.key, exposureHistory)
    );
    const scored = available.map((o) => {
      const itemIds = o.items.map((i) => i.id);
      const penalty = localExposureService.calculateExposurePenalty(o.key, itemIds, exposureHistory);
      return {
        ...o,
        effectiveScore: o.score - penalty,
      };
    });
    scored.sort((a, b) => b.effectiveScore - a.effectiveScore);
    return scored.slice(0, SUGGESTION_DISPLAY_LIMIT);
  }, [suggestionPool, exposureHistory]);

  // Idempotent presentation logging: candidate selected into active Suggested for You set = presented/viewed
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || suggestions.length === 0) return;
    for (const o of suggestions) {
      if ((o as any).isRemixedDraft) continue; // Phase E: Zero presentation exposure for remixed drafts
      if (!presentedKeysRef.current.has(o.key)) {
        presentedKeysRef.current.add(o.key);
        const itemIds = o.items.map((i) => i.id);
        localExposureService.logPresentation(userId, o.key, itemIds).catch(() => {});
      }
    }
  }, [session?.user?.id, suggestions]);

  // Passive candidate cache synchronization with deterministic fingerprint
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || items.length === 0) return;
    const fingerprint = localExposureService.computeWardrobeGenerationFingerprint(items);
    localExposureService.getPassiveCache(userId, fingerprint).then((cached) => {
      if (!cached && suggestionPool.length > 0) {
        localExposureService.setPassiveCache(userId, {
          userId,
          schemaVersion: 1,
          createdAt: Date.now(),
          expiresAt: Date.now() + 4 * 60 * 60 * 1000,
          wardrobeFingerprint: fingerprint,
          candidateSummaries: suggestionPool.map((o) => ({
            key: o.key,
            itemIds: o.items.map((i) => i.id),
            score: o.score,
            label: o.label,
            headline: (o as any).headline,
            reason: o.reason,
            assessment: o.assessment,
            whyThisWorks: (o as any).whyThisWorks,
            isAiRanked: (o as any).isAiRanked,
          })),
        }).catch(() => {});
      }
    }).catch(() => {});
  }, [session?.user?.id, items, suggestionPool]);

  const handlePassSuggestion = useCallback((outfit: GeneratedOutfit) => {
    const userId = session?.user?.id;
    if (!userId) return;

    // Phase E: Strictly DO NOT log exposure interaction for remixed drafts
    if (!(outfit as any).isRemixedDraft) {
      const itemIds = outfit.items.map((i) => i.id);
      localExposureService.logInteraction(userId, outfit.key, 'passed', itemIds).then(() => {
        localExposureService.getExposureHistory(userId).then(setExposureHistory).catch(() => {});
      }).catch(() => {});
    }

    outfitFeedbackService.logFeedback(
      {
        userId,
        feedbackType: 'rejected',
      },
      outfit.items as any
    ).catch(() => {});
  }, [session?.user?.id]);

  const handleSaveSuggestion = useCallback(async (outfit: GeneratedOutfit) => {
    if (!session?.user?.id) return;
    setSavingKey(outfit.key);
    try {
      // Matches the shape outfit-builder writes, so both sources render
      // identically on the outfit detail screen.
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
        name: `${outfit.label} look`,
        items: payload,
      });
      if (!result.ok) throw result.error;

      // Log feedback event
      outfitFeedbackService.logFeedback(
        {
          userId: session.user.id,
          feedbackType: 'saved',
        },
        outfit.items as any
      ).catch(() => {});

      // Phase E: Strictly DO NOT log exposure interaction for remixed drafts
      if (!(outfit as any).isRemixedDraft) {
        const itemIds = outfit.items.map((i) => i.id);
        localExposureService.logInteraction(session.user.id, outfit.key, 'saved', itemIds).then(() => {
          localExposureService.getExposureHistory(session.user.id).then(setExposureHistory).catch(() => {});
        }).catch(() => {});
      }

      showToast('Outfit saved to your wardrobe.', 'success');
      fetchWardrobeData();
    } catch (err) {
      console.error('Error saving suggested outfit:', err);
      showToast('Could not save that outfit. Please try again.', 'error');
    } finally {
      setSavingKey(null);
    }
  }, [session?.user?.id, showToast, fetchWardrobeData]);

  const handleOpenInMannequin = useCallback(async (outfit: GeneratedOutfit) => {
    if (!session?.user?.id || !outfit?.items || outfit.items.length === 0) return;

    const res = await transientMannequinService.createToken({
      userId: session.user.id,
      itemIds: outfit.items.map((i) => i.id),
      source: 'passive-outfits',
    });

    if (res.success && res.token) {
      router.replace({
        pathname: '/(tabs)/wardrobe',
        params: {
          tab: 'mannequin',
          transientToken: res.token,
        },
      });
    } else {
      showToast('Could not open in Mannequin. Please try again.', 'error');
    }
  }, [session?.user?.id, router, showToast]);

  // Outfit Remix Handlers for Suggested for You
  const handleOpenRemix = useCallback((outfit: GeneratedOutfit) => {
    const initial = adaptPassiveOutfitToRemix(outfit, items);
    setRemixInitialState(initial);
    setRemixTargetOutfitKey(outfit.key);
    setRemixModalVisible(true);
  }, [items]);

  const handleApplyRemix = useCallback((result: OutfitRemixResult) => {
    if (!remixTargetOutfitKey) return;
    const remixedOutfit: GeneratedOutfit = {
      key: result.outfitKey,
      items: result.items as any,
      score: result.score,
      label: result.label,
      headline: result.headline,
      reason: result.whyThisWorks?.summary || 'Remixed combination',
      whyThisWorks: result.whyThisWorks as any,
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      isRemixedDraft: true,
    } as any;

    setRemixedDrafts((prev) => new Map(prev).set(remixTargetOutfitKey, remixedOutfit));
    showToast('Outfit updated in feed.', 'success');
  }, [remixTargetOutfitKey, showToast]);

  const handleSaveRemix = useCallback((result: OutfitRemixResult) => {
    const remixedOutfit: GeneratedOutfit = {
      key: result.outfitKey,
      items: result.items as any,
      score: result.score,
      label: result.label,
      headline: result.headline,
      reason: result.whyThisWorks?.summary || 'Remixed combination',
      whyThisWorks: result.whyThisWorks as any,
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      isRemixedDraft: true,
    } as any;
    handleSaveSuggestion(remixedOutfit);
  }, [handleSaveSuggestion]);

  const handleMannequinRemix = useCallback((result: OutfitRemixResult) => {
    const remixedOutfit: GeneratedOutfit = {
      key: result.outfitKey,
      items: result.items as any,
      score: result.score,
      label: result.label,
      headline: result.headline,
      reason: result.whyThisWorks?.summary || 'Remixed combination',
      whyThisWorks: result.whyThisWorks as any,
      isAiRanked: false,
      assessment: 'Appropriate for this occasion',
      isRemixedDraft: true,
    } as any;
    handleOpenInMannequin(remixedOutfit);
  }, [handleOpenInMannequin]);

  const renderItem = useCallback(({ item, index }: { item: WardrobeItem; index: number }) => {
    // Use the computed effective bucket so a stale garment_type column never shows wrong info.
    const displayLabel = item.sub_category || resolveEffectiveGarmentBucket(item) || item.category || 'Clothing';
    const subLabel = item.sub_category && item.category && item.category !== item.sub_category ? item.category : (item.color_tags?.[0] || '');
    const isNew = !item.wear_count || item.wear_count <= 0;
    return (
      <FadeInView index={index}>
      <TouchableOpacity
        style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border, width: cardWidth }]}
        onPress={() => router.push(`/wardrobe/item/${item.id}` as any)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${displayLabel}, ${!isNew ? `worn ${item.wear_count} times` : 'never worn'}`}
      >
        <View style={[styles.imageWrap, { backgroundColor: colors.surface }]}>
          {item.image_url ? (
            <Image
              source={{ uri: item.image_url }}
              style={styles.itemImage}
              contentFit="contain"
              transition={200}
            />
          ) : (
            <View style={styles.placeholderContainer}>
              <IconSymbol name="hanger" size={32} color={colors.secondaryText} />
            </View>
          )}
          <View style={[
            styles.wearBadge,
            isNew
              ? { backgroundColor: colors.tint }
              : styles.wearBadgeWorn
          ]}>
            <Text style={[
              styles.wearBadgeText,
              { color: isNew ? colors.onTint : '#FFFFFF' }
            ]}>
              {isNew ? 'New' : `${item.wear_count}x worn`}
            </Text>
          </View>
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemCategory, { color: colors.text }]} numberOfLines={1}>
            {displayLabel}
          </Text>
          {subLabel ? (
            <Text style={[styles.itemSubLabel, { color: colors.secondaryText }]} numberOfLines={1}>
              {subLabel}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      </FadeInView>
    );
  }, [colors, router, cardWidth]);

  const renderOutfitItem = useCallback(({ item }: { item: SavedOutfit }) => {
    // items is a JSON array
    const outfitItems: any[] = Array.isArray(item.items) ? item.items : [];
    const isMannequinStyled = outfitItems.some((i) => typeof i.x === 'number');

    const thumbSize = (SAVED_OUTFIT_CARD_WIDTH - 32 - 24) / 4; // 4 thumbs max visible, minus padding/gaps

    return (
      <TouchableOpacity
        style={[styles.outfitCard, { width: SAVED_OUTFIT_CARD_WIDTH, backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.8}
        onPress={() => router.push(`/wardrobe/outfit/${item.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name || 'Outfit'}, ${outfitItems.length} items`}
      >
        <View style={styles.outfitHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.outfitName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
            {isMannequinStyled && (
              <Text style={{ fontSize: 10, color: colors.tint, fontWeight: '700', marginTop: 1 }}>
                Styled on Mannequin 
              </Text>
            )}
          </View>
          <Text style={[styles.outfitCount, { color: colors.secondaryText }]}>{outfitItems.length} items</Text>
        </View>

        {isMannequinStyled ? (
          <View style={[styles.outfitMannequinThumb, { backgroundColor: outfitItems.find((i) => i.canvas_bg)?.canvas_bg || (theme === 'dark' ? '#1c1c1e' : '#FFFFFF'), borderColor: colors.border }]}>
            <MannequinOutfitPreview
              items={outfitItems}
              canvasWidth={SAVED_OUTFIT_CARD_WIDTH - 32}
              canvasHeight={200}
              isDark={theme === 'dark'}
              backgroundColor={outfitItems.find((i) => i.canvas_bg)?.canvas_bg}
            />
          </View>
        ) : (
          <View style={styles.outfitGrid}>
            {outfitItems.slice(0, 4).map((i: any, index) => (
              <View key={index} style={[styles.outfitThumb, { width: thumbSize, borderColor: colors.border }]}>
                <Image source={{ uri: i.image_url }} style={styles.outfitThumbImg} contentFit="cover" />
              </View>
            ))}
            {outfitItems.length > 4 && (
              <View style={[styles.outfitMore, { width: thumbSize, backgroundColor: colors.surface }]}>
                <Text style={[styles.outfitMoreText, { color: colors.text }]}>+{outfitItems.length - 4}</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  }, [colors, router, theme]);

  // Search, stats and gap analysis scroll with the grid rather than eating
  // fixed height above it.
  const itemsHeader = (
    <View>
      <WardrobeStatsBar stats={stats} active={wearFilter} onSelect={setWearFilter} />

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={18} color={colors.secondaryText} />
        <TextInput keyboardAppearance={theme}
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search your wardrobe"
          placeholderTextColor={colors.secondaryText}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          accessibilityLabel="Search your wardrobe"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search">
            <IconSymbol name="xmark" size={16} color={colors.secondaryText} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={{ gap: Spacing.sm }}>
        {GARMENT_TYPES.map((type) => {
          const active = typeFilter === type;
          return (
            <TouchableOpacity
              key={type}
              style={[styles.chip, { backgroundColor: active ? colors.tint : colors.card, borderColor: active ? colors.tint : colors.border }]}
              onPress={() => { tapLight(); setTypeFilter(active ? null : type); }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, { color: active ? colors.onTint : colors.secondaryText }]}>{type}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <GapAnalysis items={items} />
    </View>
  );


  if (!session?.user?.id) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.tint }]}>Digital Wardrobe</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.xl, alignItems: 'center', justifyContent: 'center', flexGrow: 1 }}>
          <View style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: colors.tint + '15',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: Spacing.xl,
          }}>
            <IconSymbol name="hanger" size={40} color={colors.tint} />
          </View>
          <Text style={[Type.title, { color: colors.text, textAlign: 'center', marginBottom: Spacing.sm }]}>
            Build Your Digital Wardrobe
          </Text>
          <Text style={[Type.body, { color: colors.secondaryText, textAlign: 'center', marginBottom: Spacing.xxl, lineHeight: 22, maxWidth: 320 }]}>
            Digitize your personal clothing, create outfit combinations on a 3D mannequin, and receive AI-curated pairings with boutique pieces.
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: colors.tint,
              paddingVertical: 14,
              paddingHorizontal: Spacing.xxl,
              borderRadius: Radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              maxWidth: 280,
            }}
            onPress={() => router.push('/(auth)/welcome')}
            accessibilityRole="button"
            accessibilityLabel="Sign in or register to use wardrobe"
          >
            <Text style={{ color: colors.onTint, fontWeight: '600', fontSize: 16 }}>
              Sign In / Register
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.tint }]}>Digital Wardrobe</Text>
        
        <View style={styles.headerRightActions}>
          {/* Planner Calendar Button */}
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
            onPress={() => {
              tapLight();
              router.push('/planner' as any);
            }}
            accessibilityRole="button"
            accessibilityLabel="Open Outfit Planner"
          >
            <IconSymbol name="calendar" size={18} color={colors.tint} />
          </TouchableOpacity>

          {/* Add (+) Button */}
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.tint }]}
            onPress={() =>
              activeTab === 'capsules'
                ? router.push('/wardrobe/create-capsule' as any)
                : activeTab === 'outfits'
                  ? setCreateOutfitSheetVisible(true)
                  : router.push('/wardrobe/add-item')
            }
            accessibilityRole="button"
            accessibilityLabel={
              activeTab === 'capsules' ? 'Create collection' : activeTab === 'outfits' ? 'Create outfit' : 'Add wardrobe item'
            }
          >
            <IconSymbol name="plus" size={20} color={colors.onTint} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.tabRow, { borderColor: colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScrollContainer}
        >
          {([
            { key: 'items' as Tab, label: 'Items' },
            { key: 'outfits' as Tab, label: 'Outfits' },
            { key: 'capsules' as Tab, label: 'Collections' },
            { key: 'mannequin' as Tab, label: 'Mannequin', icon: 'sparkles' },
          ]).map((tabItem) => {
            const isSelected = activeTab === tabItem.key;
            return (
              <TouchableOpacity
                key={tabItem.key}
                style={[
                  styles.tab,
                  isSelected && { borderBottomColor: colors.tint, borderBottomWidth: 2.5 }
                ]}
                onPress={() => {
                  tapLight();
                  setActiveTab(tabItem.key);
                }}
                accessibilityRole="tab"
                accessibilityLabel={`${tabItem.label} tab`}
                accessibilityState={{ selected: isSelected }}
              >
                <View style={styles.tabInner}>
                  {tabItem.icon && (
                    <IconSymbol
                      name={tabItem.icon as any}
                      size={13}
                      color={isSelected ? colors.tint : colors.secondaryText}
                      style={{ marginRight: Spacing.xs }}
                    />
                  )}
                  <Text
                    style={[
                      styles.tabText,
                      {
                        color: isSelected ? colors.tint : colors.secondaryText,
                        fontWeight: isSelected ? '700' : '600',
                      }
                    ]}
                  >
                    {tabItem.label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Kept mounted (hidden via display:none rather than unmounted) when
          another tab is active, so switching tabs doesn't discard an
          in-progress mannequin styling session. */}
      <View style={{ flex: 1, display: activeTab === 'mannequin' ? 'flex' : 'none' }}>
        <MannequinView
          wardrobeItems={items}
          isWardrobeLoaded={!loading}
          onRefreshWardrobe={fetchWardrobeData}
          initialLoadOutfitId={params.loadOutfit}
          initialTransientToken={params.transientToken}
          bottomInset={bottomInset}
        />
      </View>

      {activeTab === 'mannequin' ? null : loading ? (
        // A skeleton grid keeps the layout stable while loading instead of
        // collapsing to a centred spinner and then jumping.
        <ScrollView contentContainerStyle={{ paddingHorizontal: WARDROBE_GRID_GUTTER, paddingTop: Spacing.lg }} scrollEnabled={false}>
          <View style={[styles.skeletonRow, { gap: WARDROBE_GRID_COLUMN_GAP }]}>
            <SkeletonList count={6}>
              <ProductCardSkeleton width={typeof cardWidth === 'number' ? cardWidth : 104} />
            </SkeletonList>
          </View>
        </ScrollView>
      ) : activeTab === 'items' ? (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          key={`items-grid-${columns}`}
          numColumns={columns}
          columnWrapperStyle={[styles.columnWrapper, { gap: WARDROBE_GRID_COLUMN_GAP, justifyContent: 'flex-start' }]}
          contentContainerStyle={{ paddingHorizontal: WARDROBE_GRID_GUTTER, paddingTop: Spacing.lg, paddingBottom: bottomInset }}
          ListHeaderComponent={itemsHeader}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={loadMoreItems}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMoreItems ? (
              <ActivityIndicator color={colors.tint} style={{ marginVertical: Spacing.md }} />
            ) : null
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} colors={[colors.tint]} />
          }
          ListEmptyComponent={
            items.length === 0 ? (
              <BrandEmptyState
                icon="hanger"
                title="Your Wardrobe Awaits"
                message="Start building your digital wardrobe by adding garments from your collection."
                actionLabel="Add a Garment"
                onAction={() => router.push('/wardrobe/add-item')}
              />
            ) : (
              <BrandEmptyState
                icon="magnifyingglass"
                title="No Matches Found"
                message="Try adjusting your search or filters to find what you're looking for."
              />
            )
          }
        />
      ) : activeTab === 'outfits' ? (
        outfits.length > 0 || suggestions.length > 0 || items.length >= 2 ? (
          <ScrollView
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} colors={[colors.tint]} />
            }
          >
            {/* Outfit Planner Banner */}
            <TouchableOpacity
              style={[styles.plannerBanner, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}
              onPress={() => {
                tapLight();
                router.push('/planner' as any);
              }}
              accessibilityRole="button"
              accessibilityLabel="Outfit Planner — Schedule your week, plan upcoming looks"
            >
              <View style={[styles.plannerBannerIcon, { backgroundColor: colors.glass }]}>
                <IconSymbol name="calendar" size={20} color={colors.tint} />
              </View>
              <View style={styles.plannerBannerContent}>
                <Text style={[styles.plannerBannerTitle, { color: colors.text }]}>Outfit Planner</Text>
                <Text style={[styles.plannerBannerSubtitle, { color: colors.secondaryText }]}>
                  Schedule your week, plan upcoming looks.
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={16} color={colors.secondaryText} />
            </TouchableOpacity>

            {/* 1. Creation Fork at the TOP */}
            <View style={styles.createOutfitRowTop}>
              <TouchableOpacity
                style={[styles.createChoice, { backgroundColor: wt.actionPrimary }]}
                onPress={() => { tapLight(); router.push('/style-advisor' as any); }}
                accessibilityRole="button"
                accessibilityLabel="Style It For Me — JeZsy picks a look from your wardrobe"
              >
                <IconSymbol name="sparkles" size={16} color={wt.actionPrimaryText} />
                <Text style={[styles.createChoiceText, { color: wt.actionPrimaryText }]}>Style It For Me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createChoice, { backgroundColor: wt.cardSurface, borderWidth: 1, borderColor: wt.cardBorder }]}
                onPress={() => { tapLight(); setActiveTab('mannequin'); }}
                accessibilityRole="button"
                accessibilityLabel="Build outfit yourself on the mannequin"
              >
                <IconSymbol name="person.fill" size={16} color={wt.actionSecondaryText} />
                <Text style={[styles.createChoiceText, { color: wt.actionSecondaryText }]}>Build Yourself</Text>
              </TouchableOpacity>
            </View>

            {/* 2. Saved Outfits in the MIDDLE */}
            <View style={styles.savedSection}>
              <Text style={[styles.savedHeading, { color: colors.text }]}>Saved Outfits</Text>
              {outfits.length > 0 ? (
                <FlatList
                  key="saved-outfits-row"
                  horizontal
                  data={outfits}
                  renderItem={renderOutfitItem}
                  keyExtractor={(item) => item.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.savedOutfitsRow}
                  snapToInterval={SAVED_OUTFIT_CARD_WIDTH + Spacing.lg}
                  decelerationRate="fast"
                  initialNumToRender={4}
                  onEndReached={loadMoreOutfits}
                  onEndReachedThreshold={0.5}
                  ListFooterComponent={
                    loadingMoreOutfits ? (
                      <ActivityIndicator color={colors.tint} style={{ marginHorizontal: Spacing.lg }} />
                    ) : null
                  }
                />
              ) : (
                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                  No saved outfits yet — save one of the suggestions below, or build your own.
                </Text>
              )}
            </View>

            {/* 3. Suggested for You discovery section at the BOTTOM */}
            <View style={styles.suggestBlock}>
              <View style={styles.suggestHeader}>
                <IconSymbol name="sparkles" size={18} color={wt.actionPrimary} />
                <Text style={[styles.suggestTitle, { color: colors.text }]}>Suggested for You</Text>
              </View>
              <Text style={[styles.suggestSub, { color: colors.secondaryText }]}>
                Curated looks composed from your wardrobe and scored for color and style harmony.
              </Text>
              {suggestions.length > 0 ? (
                suggestions.map((o, i) => {
                  const displayOutfit = remixedDrafts.get(o.key) || o;
                  return (
                    <FadeInView key={o.key} index={i}>
                      <SuggestedOutfitCard
                        outfit={displayOutfit}
                        onSave={handleSaveSuggestion}
                        onPass={handlePassSuggestion}
                        onOpenMannequin={handleOpenInMannequin}
                        onRemix={handleOpenRemix}
                        saving={savingKey === o.key}
                        variant="atelier"
                      />
                    </FadeInView>
                  );
                })
              ) : (
                <View style={[styles.exhaustedBox, { backgroundColor: wt.cardSurfaceSubtle, borderColor: wt.cardBorder }]}>
                  <Text style={[styles.exhaustedTitle, { color: colors.text }]}>All Caught Up</Text>
                  <Text style={[styles.exhaustedSub, { color: colors.secondaryText }]}>
                    You’ve reviewed all current suggestions. Add new garments or check back as cooldowns refresh.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
            <BrandEmptyState
              icon="sparkles"
              title="No Saved Outfits"
              message="Add a few more items and suggestions will appear here automatically, or style a look yourself."
              actionLabel="Create First Outfit"
              onAction={() => setCreateOutfitSheetVisible(true)}
            />
          </ScrollView>
        )
      ) : activeTab === 'capsules' ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
          {capsules.length > 0 ? (
            <>
              {capsules.map((c) => (
                <CapsuleCard
                  key={c.id}
                  capsule={c}
                  onPress={() => router.push(`/wardrobe/capsule/${c.id}` as any)}
                />
              ))}
              {hasMoreCapsules && (
                <TouchableOpacity
                  style={[
                    styles.createOutfitBtn,
                    {
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      marginBottom: Spacing.md,
                    },
                  ]}
                  onPress={loadMoreCapsules}
                  disabled={loadingMoreCapsules}
                >
                  {loadingMoreCapsules ? (
                    <ActivityIndicator size="small" color={colors.tint} />
                  ) : (
                    <Text style={[styles.createOutfitBtnText, { color: colors.text }]}>Load More Collections</Text>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.createOutfitBtn, { backgroundColor: colors.tint }]}
                onPress={() => router.push('/wardrobe/create-capsule' as any)}
              >
                <IconSymbol name="plus" size={20} color={colors.onTint} />
                <Text style={[styles.createOutfitBtnText, { color: colors.onTint }]}>Create New Collection</Text>
              </TouchableOpacity>
            </>
          ) : (
            <BrandEmptyState
              icon="archivebox"
              title="No Collections Yet"
              message="Build a focused collection for a season, a trip, or a purpose -- fewer pieces, more looks."
              actionLabel="Create First Collection"
              onAction={() => router.push('/wardrobe/create-capsule' as any)}
            />
          )}
        </ScrollView>
      ) : null}

      {tourCoachmark.step && (
        <TourCoachmarkBanner
          title={tourCoachmark.step.title}
          description={tourCoachmark.step.description}
          stepNumber={tourCoachmark.stepNumber}
          totalSteps={tourCoachmark.totalSteps}
          onNext={tourCoachmark.step.completion.type === 'next' ? tourCoachmark.advance : undefined}
          onDismiss={tourCoachmark.dismiss}
        />
      )}

      {/* ── Create Outfit Choice Sheet ── */}
      <Modal
        visible={createOutfitSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateOutfitSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setCreateOutfitSheetVisible(false)}
        >
          <View style={[styles.sheetCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Create Outfit</Text>
            <Text style={[styles.sheetSub, { color: colors.secondaryText }]}>
              Choose how you want to put your look together
            </Text>

            <TouchableOpacity
              style={[styles.sheetOption, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => {
                tapLight();
                setCreateOutfitSheetVisible(false);
                setActiveTab('mannequin');
              }}
              accessibilityRole="button"
              accessibilityLabel="Build Yourself"
            >
              <View style={[styles.sheetOptionIcon, { backgroundColor: colors.tint + '18' }]}>
                <IconSymbol name="person.fill" size={20} color={colors.tint} />
              </View>
              <View style={styles.sheetOptionTextWrap}>
                <Text style={[styles.sheetOptionTitle, { color: colors.text }]}>Build Yourself</Text>
                <Text style={[styles.sheetOptionDesc, { color: colors.secondaryText }]}>
                  Compose garments on the 2D mannequin canvas
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetOption, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => {
                tapLight();
                setCreateOutfitSheetVisible(false);
                router.push('/style-advisor' as any);
              }}
              accessibilityRole="button"
              accessibilityLabel="Style It For Me"
            >
              <View style={[styles.sheetOptionIcon, { backgroundColor: colors.tint + '18' }]}>
                <IconSymbol name="sparkles" size={20} color={colors.tint} />
              </View>
              <View style={styles.sheetOptionTextWrap}>
                <Text style={[styles.sheetOptionTitle, { color: colors.text }]}>Style It For Me</Text>
                <Text style={[styles.sheetOptionDesc, { color: colors.secondaryText }]}>
                  JeZsy AI styles a personalized look from your wardrobe
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetCancelBtn, { borderColor: colors.border }]}
              onPress={() => setCreateOutfitSheetVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.sheetCancelText, { color: colors.secondaryText }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addButton: {
    // 44pt keeps the primary add action at the minimum comfortable target.
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    ...Elevation.sm,
  },
  headerTitle: {
    ...Type.display,
  },
  tabRow: {
    borderBottomWidth: 1,
  },
  tabScrollContainer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    justifyContent: 'space-between',
    minWidth: '100%',
  },
  tab: {
    // HIG/Material minimum touch target is 44pt; keep at least that.
    minHeight: 44,
    paddingVertical: Spacing.md,
    paddingHorizontal: 6,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabText: {
    ...Type.bodyStrong,
    fontSize: 15,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  chipRow: {
    marginBottom: Spacing.lg,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: Spacing.xxl,
  },
  listContent: {
    padding: Spacing.xl,
    paddingBottom: 100,
  },
  savedOutfitsRow: {
    gap: Spacing.lg,
    paddingRight: Spacing.lg,
    paddingBottom: Spacing.sm,
    // react-native-web's FlatList content container can default to
    // flexWrap: 'wrap' even with horizontal set, unlike ScrollView --
    // without this override, cards silently stack into a single vertical
    // column at narrow (mobile) viewport widths instead of scrolling
    // sideways in one row.
    flexWrap: 'nowrap',
  },
  columnWrapper: {
    justifyContent: 'flex-start',
    gap: WARDROBE_GRID_COLUMN_GAP,
    marginBottom: 0,
  },
  skeletonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: WARDROBE_GRID_COLUMN_GAP,
  },
  itemCard: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: Spacing.sm,
    ...Elevation.sm,
  },
  imageWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    borderTopLeftRadius: Radius.md,
    borderTopRightRadius: Radius.md,
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wearBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  wearBadgeWorn: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  wearBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  itemInfo: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 1,
  },
  itemCategory: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  itemSubLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'capitalize',
    lineHeight: 14,
  },
  suggestBlock: {
    marginBottom: Spacing.sm,
  },
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 6,
  },
  suggestTitle: {
    ...Type.subtitle,
  },
  suggestSub: {
    ...Type.body,
    marginBottom: Spacing.lg,
  },
  savedHeading: {
    ...Type.subtitle,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dividerWrap: {
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    ...Type.bodyStrong,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
  },
  outfitCard: {
    width: OUTFIT_CARD_WIDTH,
    borderRadius: 16,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderWidth: 1,
  },
  outfitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  outfitName: {
    ...Type.subtitle,
  },
  outfitCount: {
    fontSize: 14,
  },
  outfitGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  outfitMannequinThumb: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outfitThumb: {
    width: (OUTFIT_CARD_WIDTH - 32 - 32) / 5, // 5 items max visible, minus padding/gaps
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
  },
  outfitThumbImg: {
    width: '100%',
    height: '100%',
  },
  outfitMore: {
    width: (OUTFIT_CARD_WIDTH - 32 - 32) / 5,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  outfitMoreText: {
    fontWeight: '700',
  },
  plannerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  plannerBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plannerBannerContent: {
    flex: 1,
  },
  plannerBannerTitle: {
    ...Type.bodyStrong,
    fontSize: 14,
  },
  plannerBannerSubtitle: {
    ...Type.caption,
    fontSize: 12,
    marginTop: 2,
  },
  createOutfitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    borderRadius: 16,
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  createOutfitBtnText: {
    ...Type.bodyLargeStrong,
  },
  advisorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: Spacing.xxl,
  },
  advisorIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  advisorTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  advisorSub: {
    fontSize: 12,
    marginTop: 2,
  },
  createOutfitRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  createChoice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: Radius.lg,
  },
  createChoiceText: {
    ...Type.bodyStrong,
    fontSize: 14,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    padding: Spacing.xl,
    // Safe bottom clearance: 36pt on iPhone notch, 20pt on Android, flat on web.
    paddingBottom: Platform.OS === 'ios' ? 36 : Platform.OS === 'android' ? 20 : Spacing.xl,
    // Cap width on desktop so the sheet doesn't span the full viewport.
    maxWidth: Platform.OS === 'web' ? 600 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' as const : undefined,
    width: '100%',
  },
  sheetTitle: {
    ...Type.subtitle,
    fontSize: 18,
    marginBottom: 4,
  },
  sheetSub: {
    ...Type.body,
    fontSize: 13,
    marginBottom: Spacing.lg,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  sheetOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionTextWrap: {
    flex: 1,
  },
  sheetOptionTitle: {
    ...Type.bodyStrong,
    fontSize: 15,
  },
  sheetOptionDesc: {
    ...Type.caption,
    fontSize: 12,
    marginTop: 2,
  },
  sheetCancelBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  sheetCancelText: {
    ...Type.bodyStrong,
    fontSize: 14,
  },
  createOutfitRowTop: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  savedSection: {
    marginBottom: Spacing.xl,
  },
  exhaustedBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  exhaustedTitle: {
    ...Type.bodyStrong,
    fontSize: 16,
    marginBottom: Spacing.xs,
  },
  exhaustedSub: {
    ...Type.body,
    fontSize: 13,
    textAlign: 'center',
  },
});
