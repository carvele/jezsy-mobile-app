import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { useRouter } from 'expo-router';
import { useWishlist } from '@/src/context/WishlistContext';
import { StreakBadge } from '@/src/components/StreakBadge';

type Profile = Database['public']['Tables']['profiles']['Row'];

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const router = useRouter();
  const { wishlistIds } = useWishlist();
  
  const theme = useColorScheme() ?? 'light';
  const colors = Colors[theme];

  useEffect(() => {
    if (user) {
      const fetchProfile = async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
          
        if (!error && data) {
          setProfile(data);
        }
      };
      
      fetchProfile();
    }
  }, [user]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error: any) {
      Alert.alert('Sign Out Failed', error.message);
    }
  };

  const renderSettingItem = (icon: any, title: string, subtitle?: string, onPress?: () => void) => (
    <TouchableOpacity style={[styles.settingItem, { borderBottomColor: colors.border }]} onPress={onPress}>
      <View style={[styles.settingIconContainer, { backgroundColor: colors.card }]}>
        <IconSymbol name={icon} size={20} color={colors.tint} />
      </View>
      <View style={styles.settingTextContainer}>
        <Text style={[styles.settingTitle, { color: colors.text }]}>{title}</Text>
        {subtitle && <Text style={[styles.settingSubtitle, { color: colors.secondaryText }]}>{subtitle}</Text>}
      </View>
      <IconSymbol name="chevron.right" size={20} color={colors.icon} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.tint }]}>Profile</Text>
        </View>
        
        <StreakBadge />

        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.tint }]}>
            <Text style={styles.avatarText}>
              {profile?.first_name ? profile.first_name[0].toUpperCase() : (user?.email?.[0].toUpperCase() || 'J')}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>
              {profile?.first_name
                ? `${profile.first_name} ${profile.last_name || ''}`.trim()
                : (user?.email?.split('@')[0] || 'JezSy Customer')}
            </Text>
            <Text style={[styles.profileEmail, { color: colors.secondaryText }]}>
              {user?.email || ''}
            </Text>
          </View>
          <TouchableOpacity style={[styles.editButton, { borderColor: colors.border }]} onPress={() => router.push('/(auth)/profile-setup')}>
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>My Reservations</Text>
            <TouchableOpacity onPress={() => router.push('/reservations')}>
              <Text style={{color: colors.tint, fontSize: 14}}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.ordersContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=pending')}
              accessibilityRole="button"
              accessibilityLabel="View pending reservations"
            >
              <IconSymbol name="clock.arrow.circlepath" size={24} color={colors.icon} />
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>Pending</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=confirmed')}
              accessibilityRole="button"
              accessibilityLabel="View confirmed reservations"
            >
              <IconSymbol name="checkmark.circle" size={24} color={colors.icon} />
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>Confirmed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=completed')}
              accessibilityRole="button"
              accessibilityLabel="View completed reservations"
            >
              <IconSymbol name="star" size={24} color={colors.icon} />
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>Completed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=cancelled')}
              accessibilityRole="button"
              accessibilityLabel="View cancelled reservations"
            >
              <IconSymbol name="xmark.circle" size={24} color={colors.icon} />
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>Cancelled</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Settings</Text>
          <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
            {renderSettingItem(
              'bag.fill',
              'My Orders',
              'Track your purchases',
              () => router.push('/orders' as any),
            )}
            {renderSettingItem(
              'heart.fill',
              'Wishlist',
              `${wishlistIds.size} saved item${wishlistIds.size !== 1 ? 's' : ''}`,
              () => router.push('/wishlist'),
            )}
            {renderSettingItem(
              'ruler.fill',
              'Sizing & Measurements',
              'Height, Weight, Fit preferences',
              () => router.push('/profile/measurements'),
            )}
            {renderSettingItem('gear', 'Account Settings', 'Coming soon', () =>
              Alert.alert('Account Settings', 'Account settings are coming in a future update.'))}
            {renderSettingItem('bell', 'Notifications', 'Coming soon', () =>
              Alert.alert('Notifications', 'Notification preferences are coming in a future update.'))}
            {renderSettingItem('questionmark.circle', 'Help Center', 'Message us in your Inbox', () => router.push('/(tabs)/messages'))}
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.signOutButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out of your account"
        >
          <IconSymbol name="arrow.left" size={18} color="#F72585" style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 32,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0D0D0D',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
  },
  editButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  ordersContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  orderStatus: {
    alignItems: 'center',
  },
  orderStatusText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
  },
  settingsGroup: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  settingSubtitle: {
    fontSize: 13,
  },
  signOutButton: {
    marginTop: 16,
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  signOutText: {
    color: '#F72585', // Using notification color for destructive action
    fontSize: 16,
    fontWeight: '700',
  },
});

