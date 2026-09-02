import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface CreditItem {
  id: string;
  title: string;
  author: string;
  authorUrl: string;
  license: string;
  licenseUrl: string;
}

// AR Try-On 3D models sourced under CC BY 4.0 require attribution per license terms.
const CREDITS: CreditItem[] = [
  {
    id: 't-shirt',
    title: 'T-shirt',
    author: 'Hyperrealitystudio',
    authorUrl: 'https://sketchfab.com/Hyperrealitystudio',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'hoodie-and-jeans',
    title: 'Hoodie and Jeans',
    author: 'lizhiqiang',
    authorUrl: 'https://sketchfab.com/lizhiqiang89',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
];

export default function CreditsScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Credits & Licenses</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="cube.fill" size={32} color={colors.tint} />
          <Text style={[styles.heroTitle, { color: colors.text }]}>3D Model Attribution</Text>
          <Text style={[styles.heroSubtitle, { color: colors.secondaryText }]}>
            Some AR Try-On garment models are sourced from Sketchfab under Creative Commons licenses that require attribution.
          </Text>
        </View>

        {CREDITS.map((item) => (
          <View key={item.id} style={[styles.creditCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.creditTitle, { color: colors.text }]}>&quot;{item.title}&quot;</Text>
            <Text style={[styles.creditLine, { color: colors.secondaryText }]}>
              by{' '}
              <Text style={{ color: colors.tint }} onPress={() => Linking.openURL(item.authorUrl)}>
                {item.author}
              </Text>
            </Text>
            <Text style={[styles.creditLine, { color: colors.secondaryText }]}>
              Licensed under{' '}
              <Text style={{ color: colors.tint }} onPress={() => Linking.openURL(item.licenseUrl)}>
                {item.license}
              </Text>
            </Text>
          </View>
        ))}
      </ScrollView>
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...Type.headline,
    fontSize: 18,
  },
  content: {
    padding: Spacing.xl,
    paddingBottom: 60,
  },
  heroCard: {
    padding: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: Spacing.xxl,
    gap: Spacing.xs,
  },
  heroTitle: {
    ...Type.title,
    fontSize: 20,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  heroSubtitle: {
    ...Type.body,
    fontSize: 13,
    textAlign: 'center',
  },
  creditCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  creditTitle: {
    ...Type.headline,
    fontSize: 15,
    marginBottom: 2,
  },
  creditLine: {
    ...Type.body,
    fontSize: 13,
  },
});
