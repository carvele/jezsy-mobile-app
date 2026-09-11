import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ProductCard } from '@/src/components/ProductCard';
import { chatService } from '@/src/services';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<any>(null);
  const [connection, setConnection] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'wardrobe' | 'wishlist'>('wardrobe');
  const [wardrobe, setWardrobe] = useState<any[]>([]);
  const [wishlist, setWishlist] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [wardrobeLoading, setWardrobeLoading] = useState(true);
  const [wishlistLoading, setWishlistLoading] = useState(true);
  const [wardrobeAccessDenied, setWardrobeAccessDenied] = useState(false);
  const [wishlistAccessDenied, setWishlistAccessDenied] = useState(false);

  const loadWardrobe = useCallback(async (targetId: string, wardrobePrivacy: string, status?: string) => {
    const isOwner = user?.id === targetId;
    if (!isOwner) {
      if (wardrobePrivacy === 'private') {
        setWardrobeAccessDenied(true);
        setWardrobeLoading(false);
        return;
      }
      if (wardrobePrivacy === 'connections' && status !== 'accepted') {
        setWardrobeAccessDenied(true);
        setWardrobeLoading(false);
        return;
      }
    }
    try {
      setWardrobeLoading(true);
      setWardrobeAccessDenied(false);
      const { data, error } = await supabase
        .from('wardrobe_items')
        .select('*, product:products(*)')
        .eq('user_id', targetId)
        .eq('deleted', false)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setWardrobe(data || []);
    } catch (err: any) {
      console.log('Error loading wardrobe:', err.message);
    } finally {
      setWardrobeLoading(false);
    }
  }, [user?.id]);

  const loadWishlist = useCallback(async (targetId: string, status?: string) => {
    const isOwner = user?.id === targetId;
    let wishlistPrivacy = 'private';
    if (!isOwner) {
      try {
        const { data, error } = await supabase.rpc('get_wishlist_privacy', {
          p_user_id: targetId,
        });
        if (!error && data) {
          wishlistPrivacy = data;
        }
      } catch {
        wishlistPrivacy = 'private';
      }

      if (wishlistPrivacy === 'private') {
        setWishlistAccessDenied(true);
        setWishlistLoading(false);
        return;
      }
      if (wishlistPrivacy === 'connections' && status !== 'accepted') {
        setWishlistAccessDenied(true);
        setWishlistLoading(false);
        return;
      }
    }

    try {
      setWishlistLoading(true);
      setWishlistAccessDenied(false);
      const { data, error } = await supabase
        .from('wishlists')
        .select('*, product:products(*)')
        .eq('user_id', targetId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWishlist(data || []);
    } catch (err: any) {
      console.log('Error loading wishlist:', err.message);
    } finally {
      setWishlistLoading(false);
    }
  }, [user?.id]);

  const loadProfileAndConnection = useCallback(async () => {
    try {
      if (!id) throw new Error('User not found');

      const profileRes = await chatService.resolveTargetUser(id);
      if (!profileRes.ok) {
        throw new Error(profileRes.error.message);
      }
      const profileData = profileRes.data;
      const targetId = profileData.id;
      setProfile(profileData);

      // Load Connection
      const u1 = user!.id < targetId! ? user!.id : targetId!;
      const u2 = user!.id < targetId! ? targetId! : user!.id;
      const { data: connData } = await supabase
        .from('connections')
        .select('*')
        .eq('user_id_1', u1)
        .eq('user_id_2', u2)
        .maybeSingle();

      setConnection(connData || null);

      // Check if blocked
      if (connData?.status === 'blocked') {
        setWardrobeAccessDenied(true);
        setWishlistAccessDenied(true);
        setWardrobeLoading(false);
        setWishlistLoading(false);
      } else {
        await Promise.all([
          loadWardrobe(targetId!, profileData.wardrobe_privacy as string, connData?.status),
          loadWishlist(targetId!, connData?.status),
        ]);
      }
    } catch (err: any) {
      console.log('Error loading profile:', err.message);
      showToast('User not found', 'error');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, user, router, showToast, loadWardrobe, loadWishlist]);

  useEffect(() => {
    if (id && user) {
      loadProfileAndConnection();
    }
  }, [id, user, loadProfileAndConnection]);

  const handleConnect = async () => {
    try {
      const u1 = user!.id < profile.id ? user!.id : profile.id;
      const u2 = user!.id < profile.id ? profile.id : user!.id;
      const { error } = await supabase
        .from('connections')
        .upsert({ user_id_1: u1, user_id_2: u2, status: 'pending', action_user_id: user!.id }, { onConflict: 'user_id_1,user_id_2' });
      if (error) throw error;
      showToast('Connection request sent', 'success');
      loadProfileAndConnection();
    } catch {
      showToast('Failed to send request', 'error');
    }
  };

  const renderWardrobeItem = ({ item }: { item: any }) => {
    if (item.product) {
      return (
        <View style={styles.cardContainer}>
          <ProductCard product={item.product} />
        </View>
      );
    }

    return (
      <View style={styles.cardContainer}>
        <View style={[styles.customCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.customCardImage} contentFit="cover" />
          ) : (
            <View style={[styles.customCardImage, styles.customCardPlaceholder, { backgroundColor: colors.surface }]}>
              <IconSymbol name="hanger" size={28} color={colors.secondaryText} />
            </View>
          )}
          <View style={styles.customCardInfo}>
            <Text style={[styles.customCardTitle, { color: colors.text }]} numberOfLines={1}>
              {item.garment_type || item.category || 'Wardrobe Item'}
            </Text>
            <Text style={[styles.customCardSub, { color: colors.secondaryText }]}>
              {item.wear_count > 0 ? `Worn ${item.wear_count}x` : 'Never worn'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderWishlistItem = ({ item }: { item: any }) => {
    if (!item.product) return null;
    return (
      <View style={styles.cardContainer}>
        <ProductCard product={item.product} />
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </SafeAreaView>
    );
  }

  if (!profile) return null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>@{profile.username}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.profileInfo}>
        <View style={[styles.avatar, { backgroundColor: colors.card }]}>
          <Text style={[styles.avatarText, { color: colors.text }]}>
            {(profile.first_name?.[0] || profile.username?.[0] || '?').toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.name, { color: colors.text }]}>
          {profile.first_name} {profile.last_name}
        </Text>
        
        {connection?.status !== 'accepted' && profile.id !== user?.id && (
          <TouchableOpacity 
            style={[
              styles.connectButton, 
              { backgroundColor: connection?.status === 'pending' ? colors.card : colors.tint }
            ]}
            onPress={handleConnect}
            disabled={connection?.status === 'pending'}
          >
            <Text style={[
              styles.connectButtonText, 
              { color: connection?.status === 'pending' ? colors.text : '#fff' }
            ]}>
              {connection?.status === 'pending' ? 'Pending' : 'Connect'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'wardrobe' && { borderBottomColor: colors.tint }]}
          onPress={() => setActiveTab('wardrobe')}
        >
          <Text style={[
            styles.tabText,
            { color: activeTab === 'wardrobe' ? colors.tint : colors.secondaryText },
            activeTab === 'wardrobe' && { fontWeight: '600' }
          ]}>
            Wardrobe
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'wishlist' && { borderBottomColor: colors.tint }]}
          onPress={() => setActiveTab('wishlist')}
        >
          <Text style={[
            styles.tabText,
            { color: activeTab === 'wishlist' ? colors.tint : colors.secondaryText },
            activeTab === 'wishlist' && { fontWeight: '600' }
          ]}>
            Wishlist
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.collectionSection}>
        {activeTab === 'wardrobe' ? (
          wardrobeLoading ? (
            <ActivityIndicator color={colors.tint} style={{ marginTop: Spacing.xl }} />
          ) : wardrobeAccessDenied ? (
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              This user&apos;s wardrobe is private.
            </Text>
          ) : wardrobe.length > 0 ? (
            <FlatList
              data={wardrobe}
              keyExtractor={item => item.id}
              numColumns={2}
              contentContainerStyle={styles.listContent}
              renderItem={renderWardrobeItem}
            />
          ) : (
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              No items in wardrobe.
            </Text>
          )
        ) : (
          wishlistLoading ? (
            <ActivityIndicator color={colors.tint} style={{ marginTop: Spacing.xl }} />
          ) : wishlistAccessDenied ? (
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              This user&apos;s wishlist is private.
            </Text>
          ) : wishlist.length > 0 ? (
            <FlatList
              data={wishlist}
              keyExtractor={item => item.id}
              numColumns={2}
              contentContainerStyle={styles.listContent}
              renderItem={renderWishlistItem}
            />
          ) : (
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              No items in wishlist.
            </Text>
          )
        )}
      </View>
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
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: Spacing.xs,
  },
  title: {
    ...Type.title,
  },
  profileInfo: {
    alignItems: 'center',
    padding: Spacing.xl,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  avatarText: {
    ...Type.headline,
  },
  name: {
    ...Type.title,
    marginBottom: Spacing.md,
  },
  connectButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  connectButtonText: {
    ...Type.bodyLargeStrong,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    ...Type.bodyLargeStrong,
  },
  collectionSection: {
    flex: 1,
  },
  listContent: {
    padding: Spacing.xs,
  },
  cardContainer: {
    flex: 1,
    padding: Spacing.xs,
    maxWidth: '50%',
  },
  customCard: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
  },
  customCardImage: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  customCardPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  customCardInfo: {
    padding: Spacing.sm,
  },
  customCardTitle: {
    ...Type.bodyStrong,
    fontSize: 14,
  },
  customCardSub: {
    ...Type.caption,
    marginTop: 2,
  },
  emptyText: {
    ...Type.body,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});
