import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BrandEmptyState } from '@/src/components/BrandEmptyState';

export default function NotFoundScreen() {
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];

  return (
    <>
      <Stack.Screen options={{ title: 'Page Not Found', headerShown: false }} />
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <BrandEmptyState
            icon="magnifyingglass"
            title="Page Not Found"
            message="The link you followed doesn't exist or has moved."
            actionLabel="Go to Home"
            onAction={() => router.replace('/(tabs)')}
          />
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
