import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMessages } from '@/src/context/MessagesContext';
import { useAuth } from '@/src/context/AuthContext';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { unreadCount } = useMessages();
  const { session, isPasswordRecovery } = useAuth();
  const insets = useSafeAreaInsets();

  // The bar floats, so its offset has to clear whatever the system puts below
  // it. That is a gesture pill on some devices and a three-button navigation bar
  // on others -- the previous hardcoded 20 on Android sat behind the buttons on
  // the latter. A small floor keeps it off the very edge where the inset is 0.
  const barBottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 10) + 8;

  // Defence in depth. The root layout's redirect effect was the single
  // enforcement point, and effects run after mount, so a deep link straight
  // into a tab rendered an authenticated screen for a frame before bouncing.
  // Declared after the hooks above so hook order stays stable.
  if (isPasswordRecovery) {
    return <Redirect href="/(auth)/reset-password" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarShowLabel: true,
        // Not Type.caption: that is 12/500 and these labels are 600. Navigator
        // config rather than app styles, and no slot matches exactly, so the
        // literals stay rather than lightening every tab label to fit one.
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
        // Badge sized to sit on a 58pt pill rather than a full-width bar, where
        // the default overflowed the rounded edge.
        // Not Type.label either: same size, but label carries the tracking that
        // makes uppercase eyebrows legible, and this is a number in a circle.
        tabBarBadgeStyle: {
          fontSize: 11,
          lineHeight: 14,
          minWidth: 18,
          height: 18,
          borderRadius: 9,
        },
        tabBarStyle: {
          position: 'absolute',
          bottom: barBottom,
          left: 16,
          right: 16,
          height: 62,
          backgroundColor: isDark ? 'rgba(13,13,13,0.88)' : 'rgba(255,255,255,0.92)',
          borderRadius: 31,
          borderTopWidth: 0,
          borderWidth: isDark ? 1 : 0.5,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          paddingBottom: 0,
          paddingTop: 0,
          // Shadow
          ...(Platform.OS === 'ios'
            ? {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: isDark ? 0.5 : 0.15,
                shadowRadius: 24,
              }
            : {
                elevation: 12,
              }),
        },
        tabBarItemStyle: {
          paddingTop: 8,
          paddingBottom: 8,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="magnifyingglass" color={color} />,
        }}
      />
      <Tabs.Screen
        name="wardrobe"
        options={{
          title: 'Wardrobe',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="tshirt" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="envelope.fill" color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
