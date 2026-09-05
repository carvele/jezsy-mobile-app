import { Tabs } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Platform, View, useWindowDimensions } from 'react-native';
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
  const { isLoading } = useAuth();

  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  // Responsive horizontal constraints:
  // - Wide screens (tablet, desktop web > 540px): constrain & center the pill to max 500px.
  // - Compact screens (< 360px): use 10px margins for tab breathing room.
  // - Standard mobile: 16px margins.
  const isWide = windowWidth > 540;
  const isCompact = windowWidth < 360;
  const horizontalMargin = isWide ? Math.max(16, (windowWidth - 500) / 2) : isCompact ? 10 : 16;

  // The bar floats, so its offset clears the system gesture pill or 3-button nav.
  const barBottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 10) + 8;
  const barHeight = isCompact ? 64 : 68;
  const iconSize = isCompact ? 20 : 22;

  const screenOptions = React.useMemo(() => ({
    tabBarActiveTintColor: colors.tint,
    tabBarInactiveTintColor: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.38)',
    headerShown: false,
    tabBarButton: HapticTab,
    tabBarShowLabel: true,
    tabBarLabelStyle: {
      fontSize: isCompact ? 10 : 11,
      fontWeight: '600' as const,
      letterSpacing: 0.2,
      lineHeight: isCompact ? 12 : 14,
      marginTop: 2,
      marginBottom: 2,
    },
    tabBarBadgeStyle: {
      fontSize: 10,
      lineHeight: 12,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      top: -2,
    },
    tabBarStyle: {
      position: 'absolute' as const,
      bottom: barBottom,
      left: horizontalMargin,
      right: horizontalMargin,
      height: barHeight,
      backgroundColor: isDark ? '#121212' : 'white',
      borderRadius: barHeight / 2,
      borderTopWidth: 0,
      borderWidth: isDark ? 1 : 0.5,
      borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)',
      paddingBottom: 0,
      paddingTop: 0,
      ...(Platform.OS === 'ios'
        ? {
            shadowColor: 'black',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: isDark ? 0.6 : 0.15,
            shadowRadius: 24,
          }
        : Platform.OS === 'web'
        ? {
            // @ts-ignore
            boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
          }
        : {
            elevation: 12,
          }),
    },
    tabBarItemStyle: {
      paddingTop: 6,
      paddingBottom: 6,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
  }), [colors.tint, isDark, barBottom, horizontalMargin, barHeight, isCompact]);

  // While auth is still initializing from storage/network, render a branded loading spinner
  // instead of null to prevent white-screen flashes.
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={iconSize} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color }) => <IconSymbol size={iconSize} name="magnifyingglass" color={color} />,
        }}
      />
      <Tabs.Screen
        name="wardrobe"
        options={{
          title: 'Wardrobe',
          tabBarIcon: ({ color }) => <IconSymbol size={iconSize} name="tshirt" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color }) => <IconSymbol size={iconSize} name="envelope.fill" color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconSymbol size={iconSize} name="person.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
