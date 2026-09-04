import React, { useState, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, Dimensions, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Colors, Spacing, Radius, Type, Elevation } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Database } from '@/src/types/database.types';
import { Capsule, CapsuleCard } from '@/src/components/CapsuleCard';
import { GapAnalysis } from '@/src/components/GapAnalysis';
import { WardrobeStatsBar } from '@/src/components/WardrobeStatsBar';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';
import { generateOutfits, computeStats, GeneratedOutfit } from '@/src/utils/outfitGenerator';
import { ProductCardSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { FadeInView } from '@/src/components/FadeInView';
import { BrandEmptyState } from '@/src/components/BrandEmptyState';
import { FlourishDivider } from '@/src/components/BrandFlourish';
import { tapLight } from '@/src/utils/haptics';
import { useGridCardWidth } from '@/src/utils/layout';
import { useToast } from '@/src/context/ToastContext';
import { MannequinView } from '@/src/components/Mannequin/MannequinView';
import { MannequinOutfitPreview } from '@/src/components/Mannequin/MannequinOutfitPreview';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];
type SavedOutfit = Database['public']['Tables']['saved_outfits']['Row'];
const { width } = Dimensions.get('window');
const OUTFIT_CARD_WIDTH = width - 40;

type Tab = 'items' | 'outfits' | 'capsules' | 'mannequin';
type WearFilter = 'all' | 'never' | 'neglected';

const VALID_TABS: Tab[] = ['items', 'outfits', 'capsules', 'mannequin'];
const STORAGE_KEY = 'jezsy_wardrobe_active_tab';

function persistTab(tab: Tab) {
  AsyncStorage.setItem(STORAGE_KEY, tab).catch(() => {});
}

const GARMENT_TYPES = ['Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes', 'Accessory'];
const NEGLECT_MS = 60 * 86_400_000;

export default function WardrobeScreen() {
  const { cardWidth, columns } = useGridCardWidth();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const { session } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();

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

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [wearFilter, setWearFilter] = useState<WearFilter>('all');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnce = useRef(false);

  const fetchWardrobeData = useCallback(async (isRefresh = false) => {
    if (!session?.user?.id) {
      setLoading(false);
      return;
    }

    try {
      if (!isRefresh && !hasLoadedOnce.current) setLoading(true);
      const [itemsRes, outfitsRes, capsulesRes] = await Promise.allSettled([
        supabase
          .from('wardrobe_items')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('deleted', false)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('saved_outfits')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('deleted', false)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('capsules')
          .select('*, capsule_items(count)')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(50)
      ]);

      // Apply each result independently; a failure in capsules must not
      // hide successfully loaded items or outfits.
      if (itemsRes.status === 'fulfilled' && !itemsRes.value.error) {
        setItems(itemsRes.value.data || []);
      } else {
        console.error('Error fetching wardrobe items:', itemsRes.status === 'rejected' ? itemsRes.reason : itemsRes.value.error);
        showToast('Could not load your wardrobe items. Please try again.', 'error');
      }

      if (outfitsRes.status === 'fulfilled' && !outfitsRes.value.error) {
        setOutfits(outfitsRes.value.data || []);
      } else {
        console.error('Error fetching outfits:', outfitsRes.status === 'rejected' ? outfitsRes.reason : outfitsRes.value.error);
      }

      if (capsulesRes.status === 'fulfilled' && !capsulesRes.value.error) {
        const mappedCapsules = (capsulesRes.value.data || []).map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          target_count: c.target_count || 30,
          item_count: c.capsule_items?.[0]?.count || 0
        }));
        setCapsules(mappedCapsules);
      } else {
        console.error('Error fetching capsules:', capsulesRes.status === 'rejected' ? capsulesRes.reason : capsulesRes.value.error);
      }
    } catch (error) {
      console.error('Error fetching wardrobe data:', error);
      showToast('Could not load your wardrobe. Please try again.', 'error');
    } finally {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }, [session?.user?.id, showToast]);

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
  const suggestions = useMemo(() => generateOutfits(items), [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter && item.garment_type !== typeFilter) return false;

      if (wearFilter === 'never' && item.wear_count > 0) return false;
      if (wearFilter === 'neglected') {
        if (item.wear_count === 0) return false;
        const worn = item.last_worn_at ? new Date(item.last_worn_at).getTime() : 0;
        if (Date.now() - worn < NEGLECT_MS) return false;
      }

      if (!q) return true;
      return [item.garment_type, item.category, item.sub_category, ...(item.color_tags || [])]
        .some((f) => f?.toLowerCase().includes(q));
    });
  }, [items, search, typeFilter, wearFilter]);

  const handleSaveSuggestion = useCallback(async (outfit: GeneratedOutfit) => {
    if (!session?.user?.id) return;
    setSavingKey(outfit.key);
    try {
      // Matches the shape outfit-builder writes, so both sources render
      // identically on the outfit detail screen.
      const payload = outfit.items.map((i) => ({
        slot: (i.garment_type || 'accessory').toLowerCase(),
        product_id: i.product_id,
        wardrobe_item_id: i.id,
        image_url: i.image_url,
        name: i.garment_type || i.category || 'Item',
        color_tags: i.color_tags,
      }));

      const { error } = await supabase.from('saved_outfits').insert({
        user_id: session.user.id,
        name: `${outfit.label} look`,
        items: payload,
      });
      if (error) throw error;

      showToast('Outfit saved to your wardrobe.', 'success');
      fetchWardrobeData();
    } catch (err) {
      console.error('Error saving suggested outfit:', err);
      showToast('Could not save that outfit. Please try again.', 'error');
    } finally {
      setSavingKey(null);
    }
  }, [session?.user?.id, showToast, fetchWardrobeData]);

  const renderItem = useCallback(({ item, index }: { item: WardrobeItem; index: number }) => {
    return (
      <FadeInView index={index}>
      <TouchableOpacity
        style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border, width: cardWidth }]}
        onPress={() => router.push(`/wardrobe/item/${item.id}` as any)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${item.garment_type || item.category || 'Item'}, ${item.wear_count > 0 ? `worn ${item.wear_count} times` : 'never worn'}`}
      >
        <View>
          <Image
            source={{ uri: item.image_url || undefined }}
            style={[styles.itemImage, { backgroundColor: colors.surface }]}
            contentFit="cover"
          />
          <View style={[styles.wearBadge, { backgroundColor: item.wear_count > 0 ? 'rgba(0,0,0,0.6)' : colors.tint }]}>
            <Text style={[styles.wearBadgeText, { color: item.wear_count > 0 ? 'white' : colors.onTint }]}>
              {item.wear_count > 0 ? `Worn ${item.wear_count}x` : 'Never worn'}
            </Text>
          </View>
        </View>
        <View style={styles.itemInfo}>
          <Text style={[styles.itemCategory, { color: colors.secondaryText }]}>
            {item.garment_type || item.category || 'Clothing'}
          </Text>
        </View>
      </TouchableOpacity>
      </FadeInView>
    );
  }, [colors, router, cardWidth]);

  const renderOutfitItem = useCallback(({ item }: { item: SavedOutfit }) => {
    // items is a JSON array
    const outfitItems: any[] = Array.isArray(item.items) ? item.items : [];
    const isMannequinStyled = outfitItems.some((i) => typeof i.x === 'number');

    return (
      <TouchableOpacity
        style={[styles.outfitCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.8}
        onPress={() => router.push(`/wardrobe/outfit/${item.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name || 'Outfit'}, ${outfitItems.length} items`}
      >
        <View style={styles.outfitHeader}>
          <View>
            <Text style={[styles.outfitName, { color: colors.text }]}>{item.name}</Text>
            {isMannequinStyled && (
              <Text style={{ fontSize: 10, color: colors.tint, fontWeight: '700', marginTop: 1 }}>
                Styled on Mannequin ✨
              </Text>
            )}
          </View>
          <Text style={[styles.outfitCount, { color: colors.secondaryText }]}>{outfitItems.length} items</Text>
        </View>

        {isMannequinStyled ? (
          <View style={[styles.outfitMannequinThumb, { backgroundColor: outfitItems.find((i) => i.canvas_bg)?.canvas_bg || (theme === 'dark' ? '#1c1c1e' : '#FFFFFF'), borderColor: colors.border }]}>
            <MannequinOutfitPreview
              items={outfitItems}
              canvasWidth={OUTFIT_CARD_WIDTH - 32}
              canvasHeight={200}
              isDark={theme === 'dark'}
              backgroundColor={outfitItems.find((i) => i.canvas_bg)?.canvas_bg}
            />
          </View>
        ) : (
          <View style={styles.outfitGrid}>
            {outfitItems.slice(0, 4).map((i: any, index) => (
              <View key={index} style={[styles.outfitThumb, { borderColor: colors.border }]}>
                <Image source={{ uri: i.image_url }} style={styles.outfitThumbImg} contentFit="cover" />
              </View>
            ))}
            {outfitItems.length > 4 && (
              <View style={[styles.outfitMore, { backgroundColor: colors.surface }]}>
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

      <TouchableOpacity
        style={[styles.advisorCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/style-advisor' as any); }}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Open Style Advisor"
        accessibilityHint="Get an outfit recommendation for a chosen occasion"
      >
        <View style={[styles.advisorIcon, { backgroundColor: colors.tint }]}>
          <IconSymbol name="sparkles" size={20} color={colors.onTint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.advisorTitle, { color: colors.text }]}>Ask the Style Advisor</Text>
          <Text style={[styles.advisorSub, { color: colors.secondaryText }]}>Get a look styled for the occasion</Text>
        </View>
        <IconSymbol name="chevron.right" size={18} color={colors.secondaryText} />
      </TouchableOpacity>
    </View>
  );

  const outfitsHeader = suggestions.length > 0 ? (
    <View style={styles.suggestBlock}>
      <View style={styles.suggestHeader}>
        <IconSymbol name="sparkles" size={18} color={colors.tint} />
        <Text style={[styles.suggestTitle, { color: colors.text }]}>Suggested for you</Text>
      </View>
      <Text style={[styles.suggestSub, { color: colors.secondaryText }]}>
        Built from your own pieces and scored on colour harmony, favouring items you have not reached for.
      </Text>
      {suggestions.map((o, i) => (
        <FadeInView key={o.key} index={i}>
          <SuggestedOutfitCard outfit={o} onSave={handleSaveSuggestion} saving={savingKey === o.key} />
        </FadeInView>
      ))}
      <View style={styles.dividerWrap}>
        <FlourishDivider color={colors.tint} width={140} />
      </View>
      <Text style={[styles.savedHeading, { color: colors.text }]}>Saved outfits</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.tint }]}>Digital Wardrobe</Text>
        
        <View style={styles.headerRightActions}>
          {/* Mannequin Studio Button beside Add (+) Button */}
          <TouchableOpacity
            style={[
              styles.mannequinHeaderButton,
              activeTab === 'mannequin'
                ? { backgroundColor: colors.tint }
                : { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : '#F5EFE6', borderWidth: 1.5, borderColor: colors.tint }
            ]}
            onPress={() => {
              tapLight();
              setActiveTab(activeTab === 'mannequin' ? 'items' : 'mannequin');
            }}
            accessibilityRole="button"
            accessibilityLabel="Toggle Mannequin Studio"
          >
            <IconSymbol
              name="hanger"
              size={20}
              color={activeTab === 'mannequin' ? colors.onTint : colors.tint}
            />
          </TouchableOpacity>

          {/* Add (+) Button */}
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.tint }]}
            onPress={() =>
              activeTab === 'capsules'
                ? router.push('/wardrobe/create-capsule' as any)
                : activeTab === 'outfits'
                  ? router.push('/outfit-builder')
                  : router.push('/wardrobe/add-item')
            }
            accessibilityRole="button"
            accessibilityLabel={
              activeTab === 'capsules' ? 'Create capsule' : activeTab === 'outfits' ? 'Create outfit' : 'Add wardrobe item'
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
            { key: 'capsules' as Tab, label: 'Capsules' },
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

      {activeTab === 'mannequin' ? (
        <MannequinView wardrobeItems={items} onRefreshWardrobe={fetchWardrobeData} />
      ) : loading ? (
        // A skeleton grid keeps the layout stable while loading instead of
        // collapsing to a centred spinner and then jumping.
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }} scrollEnabled={false}>
          <View style={styles.skeletonRow}>
            <SkeletonList count={6}>
              <ProductCardSkeleton width={(width - 56) / 2} />
            </SkeletonList>
          </View>
        </ScrollView>
      ) : activeTab === 'items' ? (
        <FlatList
          data={visibleItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          key={`items-grid-${columns}`}
          numColumns={columns}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 120 }}
          ListHeaderComponent={itemsHeader}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
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
        outfits.length > 0 || suggestions.length > 0 ? (
          <FlatList
            key="outfits-list"
            data={outfits}
            renderItem={renderOutfitItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            initialNumToRender={4}
            ListHeaderComponent={outfitsHeader}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} colors={[colors.tint]} />
            }
            ListEmptyComponent={
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                No saved outfits yet -- save one of the suggestions above, or build your own.
              </Text>
            }
            ListFooterComponent={
              <TouchableOpacity
                style={[styles.createOutfitBtn, { backgroundColor: colors.tint }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/outfit-builder'); }}
                accessibilityRole="button"
                accessibilityLabel="Create new outfit"
              >
                <IconSymbol name="plus" size={20} color={colors.onTint} />
                <Text style={[styles.createOutfitBtnText, { color: colors.onTint }]}>Create New Outfit</Text>
              </TouchableOpacity>
            }
          />
        ) : (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]}>
            <BrandEmptyState
              icon="sparkles"
              title="No Saved Outfits"
              message="Add a few more items and suggestions will appear here automatically, or style a look yourself."
              actionLabel="Create First Outfit"
              onAction={() => router.push('/outfit-builder')}
            />
          </ScrollView>
        )
      ) : activeTab === 'capsules' ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]}>
          {capsules.length > 0 ? (
            <>
              {capsules.map((c) => (
                <CapsuleCard
                  key={c.id}
                  capsule={c}
                  onPress={() => router.push(`/wardrobe/capsule/${c.id}` as any)}
                />
              ))}
              <TouchableOpacity
                style={[styles.createOutfitBtn, { backgroundColor: colors.tint }]}
                onPress={() => router.push('/wardrobe/create-capsule' as any)}
              >
                <IconSymbol name="plus" size={20} color={colors.onTint} />
                <Text style={[styles.createOutfitBtnText, { color: colors.onTint }]}>Create New Capsule</Text>
              </TouchableOpacity>
            </>
          ) : (
            <BrandEmptyState
              icon="archivebox"
              title="No Capsules Yet"
              message="Build a focused capsule for a season, a trip, or a purpose -- fewer pieces, more looks."
              actionLabel="Create First Capsule"
              onAction={() => router.push('/wardrobe/create-capsule' as any)}
            />
          )}
        </ScrollView>
      ) : null}
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
  mannequinHeaderButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    ...Elevation.sm,
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
    paddingVertical: Spacing.md,
    paddingHorizontal: 6,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
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
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  skeletonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 16,
  },
  itemCard: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  itemImage: {
    width: '100%',
    height: 180,
  },
  wearBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 10,
  },
  wearBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  itemInfo: {
    padding: Spacing.md,
  },
  itemCategory: {
    ...Type.label,
    fontWeight: '600',
    textTransform: 'uppercase',
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
});
