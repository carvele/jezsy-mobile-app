import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, FlatList, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Database } from '@/src/types/database.types';
import { Capsule, CapsuleCard } from '@/src/components/CapsuleCard';
import { GapAnalysis } from '@/src/components/GapAnalysis';

type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];
type SavedOutfit = Database['public']['Tables']['saved_outfits']['Row'];
const { width } = Dimensions.get('window');
const OUTFIT_CARD_WIDTH = width - 40;

type Tab = 'items' | 'outfits' | 'capsules';

export default function WardrobeScreen() {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const { session } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('items');

  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<SavedOutfit[]>([]);
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWardrobeData = useCallback(async () => {
    if (!session?.user?.id) return;
    
    try {
      setLoading(true);
      const [itemsRes, outfitsRes, capsulesRes] = await Promise.all([
        supabase
          .from('wardrobe_items')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('deleted', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('saved_outfits')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('deleted', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('capsules')
          .select('*, capsule_items(count)')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (outfitsRes.error) throw outfitsRes.error;
      if (capsulesRes.error) throw capsulesRes.error;

      setItems(itemsRes.data || []);
      setOutfits(outfitsRes.data || []);
      
      const mappedCapsules = (capsulesRes.data || []).map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        target_count: c.target_count || 30,
        item_count: c.capsule_items?.[0]?.count || 0
      }));
      setCapsules(mappedCapsules);
    } catch (error) {
      console.error('Error fetching wardrobe data:', error);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    fetchWardrobeData();
  }, [fetchWardrobeData]);

  // Re-fetch when focusing screen to pick up new outfits
  // Since we don't have useFocusEffect readily imported, we can add a listener or just rely on navigating back, but router.back() might not trigger useEffect.
  // Actually, we can just rely on the effect and manual refresh.

  const renderItem = useCallback(({ item }: { item: WardrobeItem }) => {
    return (
      <TouchableOpacity 
        style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => item.product_id ? router.push(`/product/${item.product_id}`) : null}
        activeOpacity={0.8}
      >
        <Image 
          source={{ uri: item.image_url || 'https://via.placeholder.com/300' }} 
          style={styles.itemImage} 
          contentFit="cover"
        />
        <View style={styles.itemInfo}>
          <Text style={[styles.itemCategory, { color: colors.secondaryText }]}>
            {item.category || 'Clothing'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [colors, router]);

  const renderOutfitItem = useCallback(({ item }: { item: SavedOutfit }) => {
    // items is a JSON array
    const outfitItems: any[] = Array.isArray(item.items) ? item.items : [];
    
    return (
      <TouchableOpacity 
        style={[styles.outfitCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.8}
      >
        <View style={styles.outfitHeader}>
          <Text style={[styles.outfitName, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.outfitCount, { color: colors.secondaryText }]}>{outfitItems.length} items</Text>
        </View>
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
      </TouchableOpacity>
    );
  }, [colors]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.tint }]}>Digital Wardrobe</Text>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: colors.tint }]}
          onPress={() => router.push('/wardrobe/add-item')}
          accessibilityRole="button"
          accessibilityLabel="Add wardrobe item"
        >
          <IconSymbol name="plus" size={20} color="#0D0D0D" />
        </TouchableOpacity>
      </View>

      <View style={[styles.tabRow, { borderColor: colors.border }]}>
        {(['items', 'outfits', 'capsules'] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && { borderBottomColor: colors.tint, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? colors.tint : colors.secondaryText }]}>
              {tab === 'items' ? 'My Items' : tab === 'outfits' ? 'Saved Outfits' : 'Capsules'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : activeTab === 'items' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          <GapAnalysis items={items} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 }}>
            {items.length > 0 ? items.map(item => (
              <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>
            )) : (
              <View style={styles.emptyState}>
                <IconSymbol name="hanger" size={48} color={colors.secondaryText} />
                <Text style={[styles.emptyText, { color: colors.secondaryText }]}>Your wardrobe is empty.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      ) : activeTab === 'outfits' ? (
        outfits.length > 0 ? (
          <FlatList
            data={outfits}
            renderItem={renderOutfitItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            initialNumToRender={4}
            ListFooterComponent={
              <TouchableOpacity 
                style={[styles.createOutfitBtn, { backgroundColor: colors.tint }]}
                onPress={() => router.push('/outfit-builder')}
              >
                <IconSymbol name="plus" size={20} color="#0D0D0D" />
                <Text style={styles.createOutfitBtnText}>Create New Outfit</Text>
              </TouchableOpacity>
            }
          />
        ) : (
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 100 }]}>
            <View style={styles.emptyState}>
              <View style={[styles.iconContainer, { backgroundColor: colors.card }]}>
                <IconSymbol name="sparkles" size={56} color={colors.icon} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No Saved Outfits</Text>
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                Mix and match your wardrobe items to build the perfect outfit for any occasion.
              </Text>
              
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: colors.tint }]}
                onPress={() => router.push('/outfit-builder')}
              >
                <Text style={styles.actionButtonText}>Create First Outfit</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          {capsules.length > 0 ? (
            capsules.map(capsule => (
              <CapsuleCard key={capsule.id} capsule={capsule} onPress={() => {}} />
            ))
          ) : (
            <View style={styles.emptyState}>
              <IconSymbol name="archivebox" size={48} color={colors.secondaryText} />
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No capsules yet.</Text>
            </View>
          )}
        </ScrollView>
      )}
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
  },
  tab: {
    marginRight: 24,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 24,
  },
  listContent: {
    padding: 20,
    paddingBottom: 100,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  itemCard: {
    width: (width - 56) / 2,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  itemImage: {
    width: '100%',
    height: 180,
    backgroundColor: '#2A2A2A',
  },
  itemInfo: {
    padding: 12,
  },
  itemCategory: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  actionButton: {
    height: 56,
    paddingHorizontal: 32,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#C9A96E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  actionButtonText: {
    color: '#0D0D0D', // Dark text on gold background
    fontSize: 16,
    fontWeight: '700',
  },
  outfitCard: {
    width: OUTFIT_CARD_WIDTH,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  outfitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  outfitName: {
    fontSize: 18,
    fontWeight: '700',
  },
  outfitCount: {
    fontSize: 14,
  },
  outfitGrid: {
    flexDirection: 'row',
    gap: 8,
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
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outfitMoreText: {
    fontWeight: '700',
  },
  createOutfitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginTop: 8,
    gap: 8,
  },
  createOutfitBtnText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  }
});
