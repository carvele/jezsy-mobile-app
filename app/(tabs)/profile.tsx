import React, { useCallback, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Linking from 'expo-linking';
import { useWishlist } from '@/src/context/WishlistContext';
import { useCart } from '@/src/context/CartContext';
import { useToast } from '@/src/context/ToastContext';
import { statusBucket } from '@/src/utils/reservationStatus';
import { getMyUnratedItems } from '@/src/services/reservationService';
import { SystemTourModal } from '@/src/features/systemTour/SystemTourModal';
import { useMessages } from '@/src/context/MessagesContext';
import { useSharedBottomInset } from '@/src/hooks/useFloatingTabBarMetrics';
import { ConfirmModal } from '@/src/components/ConfirmModal';

export default function ProfileScreen() {
  const bottomInset = useSharedBottomInset();
  const { showToast } = useToast();
  const { user, profile, signOut } = useAuth();
  const { getOrCreateConversation } = useMessages();
  const [showTour, setShowTour] = useState(false);
  const router = useRouter();
  const { wishlistIds } = useWishlist();
  const { itemCount } = useCart();
  // Summarized to the normal hold-to-purchase stages. Cancelled records
  // stay reachable from "View All".
  const [counts, setCounts] = useState({
    toPay: 0,
    preparing: 0,
    ready: 0,
    toRate: 0,
    activeTotal: 0,
  });

  const theme = useColorScheme();
  const colors = Colors[theme];

  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    let isMounted = true;

    const fetchReservations = async () => {
      const [resResult, unratedResult] = await Promise.all([
        supabase.from('reservations').select('status').eq('customer_id', user.id),
        getMyUnratedItems(user.id).catch((err) => {
          console.error('Error fetching items to rate:', err);
          return [];
        }),
      ]);
      const resData = resResult.data;

      if (resData && isMounted) {
        let toPay = 0;
        let preparing = 0;
        let ready = 0;

        // Shared with reservations.tsx and the admin dashboard so a status
        // only ever needs to be classified in one place.
        resData.forEach((r: any) => {
          const bucket = statusBucket(r.status);
          if (bucket === 'toPay') toPay++;
          else if (bucket === 'preparing') preparing++;
          else if (bucket === 'ready') ready++;
        });

        setCounts({
          toPay,
          preparing,
          ready,
          toRate: unratedResult.length,
          activeTotal: toPay + preparing + ready,
        });
      }
    };

    fetchReservations();
    return () => { isMounted = false; };
  }, [user?.id]));

  const handleShareProfile = async () => {
    // A profile has no shareable link without a username -- silently doing
    // nothing here reads as a broken button, so send the customer to set one.
    if (!profile?.username) {
      showToast('Add a username first to share your profile.', 'info');
      router.push('/profile/edit');
      return;
    }
    try {
      const url = Linking.createURL(`user/@${profile.username}`);
      await Share.share({ message: `Check out my digital wardrobe on JezSy! ${url}`, url });
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOutPress = () => {
    setShowSignOutModal(true);
  };

  const handleConfirmSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      setShowSignOutModal(false);
      await signOut();
      showToast('You have been signed out successfully.', 'success');
    } catch (error: any) {
      console.error('Error signing out:', error);
      showToast('Could not sign you out. Please try again.', 'error');
    } finally {
      setIsSigningOut(false);
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

  if (!user) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.tint }]}>Profile</Text>
          </View>

          {/* Guest Hero Card */}
          <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: 'column', alignItems: 'stretch', padding: Spacing.xl }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md }}>
              <View style={[styles.avatar, { backgroundColor: colors.tint + '20' }]}>
                <IconSymbol name="person.fill" size={32} color={colors.tint} />
              </View>
              <View style={styles.profileInfo}>
                <Text style={[styles.profileName, { color: colors.text, marginBottom: 2 }]}>
                  Welcome to JezSy
                </Text>
                <Text style={[styles.profileEmail, { color: colors.secondaryText }]}>
                  Guest Shopper
                </Text>
              </View>
            </View>

            <Text style={[Type.body, { color: colors.secondaryText, marginBottom: Spacing.lg, lineHeight: 20 }]}>
              Sign in or create an account to unlock boutique reservations, digital wardrobe management, and personalized fit styling.
            </Text>

            <TouchableOpacity
              style={{
                backgroundColor: colors.tint,
                paddingVertical: 12,
                borderRadius: Radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onPress={() => router.push('/(auth)/welcome')}
              accessibilityRole="button"
              accessibilityLabel="Sign in or register"
            >
              <Text style={{ color: colors.onTint, fontWeight: '600', fontSize: 15 }}>
                Sign In / Register
              </Text>
            </TouchableOpacity>
          </View>

          {/* Shopping (Available in Guest Mode) */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Shopping</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
              {renderSettingItem(
                'bag.fill',
                'My Bag',
                `${itemCount} item${itemCount !== 1 ? 's' : ''} in bag`,
                () => router.push('/cart'),
              )}
              {renderSettingItem(
                'heart.fill',
                'Wishlist',
                'Sign in to view your saved favorites',
                () => router.push('/(auth)/welcome'),
              )}
            </View>
          </View>

          {/* Member Privileges */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Member Privileges</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.surface, padding: Spacing.lg, gap: Spacing.md }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                <IconSymbol name="calendar" size={20} color={colors.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={[Type.subtitle, { color: colors.text, fontSize: 14 }]}>Boutique Reservations</Text>
                  <Text style={[Type.caption, { color: colors.secondaryText }]}>Reserve garments and pick up your order in-store.</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
                <IconSymbol name="cube.transparent" size={20} color={colors.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={[Type.subtitle, { color: colors.text, fontSize: 14 }]}>Digital Wardrobe & AI Stylist</Text>
                  <Text style={[Type.caption, { color: colors.secondaryText }]}>Digitize your closet and get automated outfit combinations.</Text>
                </View>
              </View>
            </View>
          </View>

          {/* App Preferences */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>App Preferences</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
              {renderSettingItem(
                'moon.fill',
                'Appearance',
                'Light, dark, or match device',
                () => router.push('/profile/appearance' as any),
              )}
            </View>
          </View>

          {/* Support & About */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Support & About</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
              {renderSettingItem(
                'sparkles',
                'App Tour & Feature Guide',
                'Digital wardrobe, AR try-on, and AI styling overview',
                () => setShowTour(true),
              )}
              {renderSettingItem(
                'questionmark.circle',
                'Help & FAQ',
                'Orders, pickup, payments, & returns',
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
        </ScrollView>
        <SystemTourModal visible={showTour} onClose={() => setShowTour(false)} isReplay={true} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.tint }]}>Profile</Text>
        </View>

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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg }}>
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
            <TouchableOpacity
              style={styles.orderStatus}
              onPress={() => router.push('/reservations/to-rate')}
              accessibilityRole="button"
              accessibilityLabel="View items to rate"
            >
              {/* Unlike a plain Completed count, this one is genuinely
                  actionable and clears as items get rated -- a real
                  notification, not a stuck one. */}
              <View style={{ position: 'relative' }}>
                <IconSymbol name="star" size={24} color={colors.icon} />
                {counts.toRate > 0 && (
                  <View style={[styles.statusBadgeBubble, { backgroundColor: colors.notification }]}>
                    <Text style={styles.statusBadgeText}>{counts.toRate}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.orderStatusText, { color: colors.secondaryText }]}>To rate</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Shopping & Wardrobe</Text>
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
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Account & Privacy</Text>
          <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
            {renderSettingItem(
              'gear',
              'Account Settings',
              'Email, password',
              () => router.push('/profile/account-settings' as any),
            )}
            {renderSettingItem(
              'lock.fill',
              'Privacy Settings',
              'Wardrobe and wishlist sharing',
              () => router.push('/profile/privacy-settings' as any),
            )}
            {renderSettingItem(
              'square.and.arrow.up',
              'Share My Profile',
              'Send link to friends',
              handleShareProfile,
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Legal</Text>
          <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
            {renderSettingItem(
              'doc.text',
              'Terms & Conditions',
              'Read the current terms of service',
              () => router.push('/legal/terms' as any),
            )}
            {renderSettingItem(
              'hand.raised.fill',
              'Privacy Policy',
              'How JezSy collects and uses your data',
              () => router.push('/legal/privacy' as any),
            )}
          </View>
        </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>App Preferences</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
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
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Support & About</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.surface }]}>
              {profile?.role !== 'staff' && profile?.role !== 'owner' && renderSettingItem(
                'bubble.left.and.bubble.right',
                'Message Boutique Support',
                'Chat directly with our boutique styling team',
                async () => {
                  try {
                    const conv = await getOrCreateConversation();
                    if (conv) router.push(`/messages/${conv.id}` as any);
                  } catch {
                    showToast('Could not open chat with staff.', 'error');
                  }
                },
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
                'Orders, pickup, payments, & returns',
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
          style={[styles.signOutButton, { backgroundColor: colors.card, borderColor: colors.border }, isSigningOut && { opacity: 0.6 }]}
          onPress={handleSignOutPress}
          disabled={isSigningOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out of your account"
        >
          <IconSymbol name="arrow.left" size={18} color={colors.error} style={{ marginRight: Spacing.sm }} />
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <ConfirmModal
        visible={showSignOutModal}
        title="Sign Out"
        message="Are you sure you want to sign out of your account?"
        confirmLabel="Sign Out"
        cancelLabel="Cancel"
        isDestructive={true}
        severity="LOW"
        isLoading={isSigningOut}
        onCancel={() => setShowSignOutModal(false)}
        onConfirm={handleConfirmSignOut}
      />

      <SystemTourModal visible={showTour} onClose={() => setShowTour(false)} isReplay={true} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.xl,
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

