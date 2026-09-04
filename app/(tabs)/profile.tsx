import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useRouter } from 'expo-router';
import { useWishlist } from '@/src/context/WishlistContext';
import { useCart } from '@/src/context/CartContext';
import { StreakBadge } from '@/src/components/StreakBadge';
import { useToast } from '@/src/context/ToastContext';
import { statusBucket } from '@/src/utils/reservationStatus';
import { SystemTourModal } from '@/src/components/SystemTourModal';
export default function ProfileScreen() {
  const { showToast } = useToast();
  const { user, profile, signOut } = useAuth();
  const [showTour, setShowTour] = useState(false);
  const router = useRouter();
  const { wishlistIds } = useWishlist();
  const { itemCount } = useCart();
  // Summarized to 4 tiles: Pending, To pay, Preparing, Ready. Completed and
  // Cancelled reservations are done and stay reachable from "View All"
  // rather than cluttering the at-a-glance summary.
  const [counts, setCounts] = useState({
    pending: 0,
    toPay: 0,
    preparing: 0,
    ready: 0,
    activeTotal: 0,
  });

  const theme = useColorScheme();
  const colors = Colors[theme];

  useEffect(() => {
    if (!user?.id) return;
    let isMounted = true;

    const fetchReservations = async () => {
      const { data: resData } = await supabase
        .from('reservations')
        .select('status')
        .eq('customer_id', user.id);

      if (resData && isMounted) {
        let pending = 0;
        let toPay = 0;
        let preparing = 0;
        let ready = 0;

        // Shared with reservations.tsx and the admin dashboard so a status
        // only ever needs to be classified in one place.
        resData.forEach((r: any) => {
          const bucket = statusBucket(r.status);
          if (bucket === 'pending') pending++;
          else if (bucket === 'toPay') toPay++;
          else if (bucket === 'preparing') preparing++;
          else if (bucket === 'ready') ready++;
        });

        setCounts({
          pending,
          toPay,
          preparing,
          ready,
          activeTotal: pending + toPay + preparing + ready,
        });
      }
    };

    fetchReservations();
    return () => { isMounted = false; };
  }, [user?.id]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error: any) {
      // Raw Supabase errors ("AuthApiError: ...") are not customer copy, and
      // sign-out has no failure the customer can act on differently.
      console.error('Error signing out:', error);
      showToast('Could not sign you out. Please try again.', 'error');
    }
  };

  const renderSettingItem = (icon: any, title: string, subtitle?: string, onPress?: () => void) => (
    <TouchableOpacity
      style={[styles.settingItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle ? `${subtitle}. Opens ${title}.` : `Opens ${title}.`}
    >
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
            <Text style={[styles.avatarText, { color: colors.onTint }]}>
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
          <TouchableOpacity
            style={[styles.editButton, { borderColor: colors.border }]}
            onPress={() => router.push('/profile/edit')}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            accessibilityHint="Opens your profile details."
          >
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg}}>
            <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>My Reservations</Text>
            <TouchableOpacity
              onPress={() => router.push('/reservations')}
              accessibilityRole="button"
              accessibilityLabel="View all reservations"
            >
              <Text style={[Type.body, { color: colors.tint }]}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.ordersContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=pending')}
              accessibilityRole="button"
              accessibilityLabel="View pending reservations"
            >
              <View style={{ position: 'relative' }}>
                <IconSymbol name="clock.arrow.circlepath" size={24} color={colors.icon} />
                {counts.pending > 0 && (
                  <View style={[styles.statusBadgeBubble, { backgroundColor: colors.notification }]}>
                    <Text style={styles.statusBadgeText}>{counts.pending}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>Pending</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=toPay')}
              accessibilityRole="button"
              accessibilityLabel="View reservations awaiting payment"
            >
              <View style={{ position: 'relative' }}>
                <IconSymbol name="creditcard" size={24} color={colors.icon} />
                {counts.toPay > 0 && (
                  <View style={[styles.statusBadgeBubble, { backgroundColor: colors.notification }]}>
                    <Text style={styles.statusBadgeText}>{counts.toPay}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>To pay</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=preparing')}
              accessibilityRole="button"
              accessibilityLabel="View reservations being prepared"
            >
              <View style={{ position: 'relative' }}>
                <IconSymbol name="bag.fill" size={24} color={colors.icon} />
                {counts.preparing > 0 && (
                  <View style={[styles.statusBadgeBubble, { backgroundColor: colors.notification }]}>
                    <Text style={styles.statusBadgeText}>{counts.preparing}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>Preparing</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations?status=ready')}
              accessibilityRole="button"
              accessibilityLabel="View reservations ready to collect"
            >
              <View style={{ position: 'relative' }}>
                <IconSymbol name="checkmark.circle" size={24} color={colors.icon} />
                {counts.ready > 0 && (
                  <View style={[styles.statusBadgeBubble, { backgroundColor: colors.notification }]}>
                    <Text style={styles.statusBadgeText}>{counts.ready}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>Ready</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Settings</Text>
          <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
            {renderSettingItem(
              'bag.fill',
              'My Bag',
              `${itemCount} item${itemCount !== 1 ? 's' : ''} ready to reserve`,
              () => router.push('/cart'),
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
            {renderSettingItem(
              'gear',
              'Account Settings',
              'Email, password',
              () => router.push('/profile/account-settings' as any),
            )}
            {renderSettingItem(
              'lock.fill',
              'Privacy Settings',
              'Wardrobe sharing',
              () => router.push('/profile/privacy-settings' as any),
            )}
            {renderSettingItem(
              'moon.fill',
              'Appearance',
              'Light, dark, or match device',
              () => router.push('/profile/appearance' as any),
            )}
            {renderSettingItem(
              'bell',
              'Notifications',
              'Push notification preferences',
              () => router.push('/profile/notifications-settings' as any),
            )}
            {renderSettingItem(
              'sparkles',
              'App Tour & Feature Guide',
              'Digital wardrobe, AR try-on, and AI styling overview',
              () => setShowTour(true),
            )}
            {renderSettingItem(
              'questionmark.circle',
              'Help & FAQ',
              'Rentals, fittings, payments, & returns',
              () => router.push('/profile/faq' as any),
            )}
            {renderSettingItem(
              'cube.fill',
              'Credits & Licenses',
              '3D model attribution',
              () => router.push('/profile/credits' as any),
            )}
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.signOutButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out of your account"
        >
          <IconSymbol name="arrow.left" size={18} color={colors.error} style={{ marginRight: Spacing.sm }} />
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <SystemTourModal visible={showTour} onClose={() => setShowTour(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.xl,
    paddingBottom: 120,
  },
  header: {
    marginBottom: Spacing.xxl,
  },
  headerTitle: {
    ...Type.display,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xxxl,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.lg,
  },
  avatarText: {
    ...Type.headline,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    ...Type.subtitle,
    marginBottom: Spacing.xs,
  },
  profileEmail: {
    ...Type.body,
  },
  editButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    marginBottom: Spacing.xxxl,
  },
  sectionTitle: {
    ...Type.subtitle,
    marginBottom: Spacing.lg,
  },
  ordersContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  orderStatus: {
    alignItems: 'center',
  },
  orderStatusText: {
    ...Type.caption,
    marginTop: Spacing.sm,
  },
  statusBadgeBubble: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#ef4444',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
    zIndex: 10,
  },
  statusBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '800',
  },
  settingsGroup: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.lg,
  },
  settingTextContainer: {
    flex: 1,
  },
  settingTitle: {
    ...Type.bodyLarge,
    marginBottom: Spacing.xs,
  },
  settingSubtitle: {
    ...Type.caption,
  },
  signOutButton: {
    marginTop: Spacing.lg,
    height: 56,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  signOutText: {
    ...Type.bodyLargeStrong,
  },
});

