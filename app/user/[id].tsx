import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
  const [wardrobe, setWardrobe] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [wardrobeLoading, setWardrobeLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  const loadWardrobe = async (targetId: string, privacy: string, status?: string) => {
    if (privacy === 'private') {
      setAccessDenied(true);
      setWardrobeLoading(false);
      return;
    }
    if (privacy === 'connections' && status !== 'accepted') {
      setAccessDenied(true);
      setWardrobeLoading(false);
      return;
    }
    try {
      setWardrobeLoading(true);
      const { data, error } = await supabase
        .from('wishlists')
        .select('*, product:products(*)')
        .eq('user_id', targetId);
      
      if (error) throw error;
      setWardrobe(data || []);
    } catch (err: any) {
      console.log('Error loading wardrobe:', err.message);
    } finally {
      setWardrobeLoading(false);
    }
  };

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
        setAccessDenied(true);
      } else {
        loadWardrobe(targetId!, profileData.wardrobe_privacy as string, connData?.status);
      }
    } catch (err: any) {
      console.log('Error loading profile:', err.message);
      showToast('User not found', 'error');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, user, router, showToast]);

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

      <View style={styles.wardrobeSection}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Wardrobe</Text>
        {wardrobeLoading ? (
          <ActivityIndicator color={colors.tint} style={{ marginTop: Spacing.xl }} />
        ) : accessDenied ? (
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            This user&apos;s wardrobe is private.
          </Text>
        ) : wardrobe.length > 0 ? (
          <FlatList
            data={wardrobe}
            keyExtractor={item => item.id}
            numColumns={2}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.cardContainer}>
                <ProductCard product={item.product} />
              </View>
            )}
          />
        ) : (
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            No items in wardrobe.
          </Text>
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
  wardrobeSection: {
    flex: 1,
  },
  sectionTitle: {
    ...Type.title,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  listContent: {
    padding: Spacing.xs,
  },
  cardContainer: {
    flex: 1,
    padding: Spacing.xs,
    maxWidth: '50%',
  },
  emptyText: {
    ...Type.body,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});
