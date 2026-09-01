import React from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Same class of bug as app/payment-return.tsx: Linking.createURL('auth/callback')
// in (auth)/welcome.tsx is meant to be caught by WebBrowser.openAuthSessionAsync's
// in-app browser session, which already extracts the tokens and calls setSession()
// there. But Android also delivers that deep link to the OS as a normal intent, and
// with no route at this path expo-router showed "Unmatched Route" right after a
// successful sign-in. This screen only needs to exist so that lands somewhere valid --
// app/_layout.tsx's redirect effect already watches `session` and routes to (tabs) or
// (auth) once AuthContext's listener picks up the session welcome.tsx set.
export default function AuthCallbackScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.title, { color: colors.text }]}>Signing you in…</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xxl },
  title: { ...Type.bodyLargeStrong, marginTop: Spacing.lg },
});
