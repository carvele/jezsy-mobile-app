import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface CreditItem {
  id: string;
  title: string;
  fileName: string;
  category: string;
  author: string;
  authorUrl?: string;
  license: string;
  licenseUrl?: string;
}

// AR Try-On 3D models sourced under CC BY 4.0 and other licenses require attribution per terms.
const CREDITS: CreditItem[] = [
  {
    id: 't-shirt',
    title: 'Classic T-Shirt',
    fileName: 't-shirt.glb',
    category: 'Tops',
    author: 'Hyperrealitystudio',
    authorUrl: 'https://sketchfab.com/Hyperrealitystudio',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'hoodie-and-jeans',
    title: 'Oversized Hoodie & Jeans',
    fileName: 'hoodie_and_jeans.glb',
    category: 'Outerwear',
    author: 'lizhiqiang',
    authorUrl: 'https://sketchfab.com/lizhiqiang89',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'basic-shoulder-bag',
    title: 'Coach Girly Pop / Basic Shoulder Bag',
    fileName: 'basic_shoulder_bag.glb (also bag.glb)',
    category: 'Accessories',
    author: 'Hall1tsija',
    authorUrl: 'https://sketchfab.com/Hall1tsija',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'pearl-necklace',
    title: '3 Layered Pearl Necklace',
    fileName: 'pearl_necklace.glb (also necklace.glb)',
    category: 'Accessories',
    author: 'C.U.V',
    authorUrl: 'https://sketchfab.com/C.U.V',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'straight-leg-jeans',
    title: 'Straight-Leg Jeans',
    fileName: 'straight_leg_jeans_fixed.glb',
    category: 'Bottoms',
    author: 'Sketchfab Community / JezSy Atelier',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'tailored-blazer',
    title: 'Tailored Blazer / Long-Sleeve Shirt',
    fileName: 'Long-sleeve1.glb (also long_sleeve.glb)',
    category: 'Outerwear',
    author: 'Sketchfab 3D Fashion',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'peasant-dress',
    title: 'Paisley Print Midi Dress / Peasant Dress',
    fileName: 'peasant_dress_v4.glb (v1-v4)',
    category: 'Dresses',
    author: 'JezSy 3D Studio / Sketchfab',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'athletic-swimsuit',
    title: 'Athletic Swimsuit',
    fileName: 'navy_blue_tight-fitting_athletic_swimsuit.glb',
    category: 'Activewear',
    author: 'Sketchfab 3D Apparel',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'raglan-tee',
    title: 'Raglan Tee 4K',
    fileName: 'REGLAN TEE_4k_Pd5.glb',
    category: 'Tops',
    author: '3D Apparel Design',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'scott-shirt',
    title: 'Scott Character Alt Shirt',
    fileName: 'shirt_scott_alt_2_-_character_clothes_free.glb',
    category: 'Tops',
    author: 'Character Clothes Asset',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'female-shorts',
    title: 'Denim Shorts / Female Short Jeans',
    fileName: 'female_short_jeans.glb',
    category: 'Bottoms',
    author: '3D Fashion Studio',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'pastel-pink-blazer',
    title: 'Pastel Pink Pattern Blazer',
    fileName: 'pastel_pink_blazer_with_patterns_with_bones.glb',
    category: 'Outerwear',
    author: 'Rigged Fashion Lab',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'activewear-tee',
    title: 'Activewear Tee / Cotton T-Shirt',
    fileName: 'Untitled.glb',
    category: 'Activewear',
    author: 'JezSy AR Studio',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'earrings',
    title: 'Drop Earrings',
    fileName: 'earrings.glb',
    category: 'Accessories',
    author: '3D Jewelry Atelier',
    authorUrl: 'https://sketchfab.com',
    license: 'CC BY 4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'celestial-ballgown',
    title: 'Celestial Ballgown',
    fileName: 'Meshy_AI_Celestial_Ballgown_0820080208_texture.glb',
    category: 'Generative 3D',
    author: 'Meshy AI 3D Generative Studio',
    authorUrl: 'https://www.meshy.ai',
    license: 'Meshy Creative License',
    licenseUrl: 'https://www.meshy.ai/terms',
  },
  {
    id: 'meshy-white-dress',
    title: 'White Dress',
    fileName: 'Meshy_AI_White_Dress_0326030516_generate.glb',
    category: 'Generative 3D',
    author: 'Meshy AI 3D Generative Studio',
    authorUrl: 'https://www.meshy.ai',
    license: 'Meshy Creative License',
    licenseUrl: 'https://www.meshy.ai/terms',
  },
  {
    id: 'meshy-plain-white-tee',
    title: 'Plain White Tee',
    fileName: 'Meshy_AI_Plain_White_Tee_0412052108_texture.glb',
    category: 'Generative 3D',
    author: 'Meshy AI 3D Generative Studio',
    authorUrl: 'https://www.meshy.ai',
    license: 'Meshy Creative License',
    licenseUrl: 'https://www.meshy.ai/terms',
  },
  {
    id: 'test-rigged-model',
    title: 'Rigged Calibration Model',
    fileName: 'Testing1.glb / test-model.glb',
    category: 'AR Calibration',
    author: 'JezSy Calibration Rig',
    authorUrl: 'https://jezsy.com',
    license: 'Proprietary / Internal Asset',
    licenseUrl: 'https://jezsy.com',
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
            All 3D GLB garment and accessory models used in the JezSy AR Try-On experience are cataloged below with respective creator attribution and licenses.
          </Text>
          <View style={[styles.countBadge, { backgroundColor: `${colors.tint}20`, borderColor: `${colors.tint}40` }]}>
            <Text style={[styles.countText, { color: colors.tint }]}>{CREDITS.length} Models Attributed</Text>
          </View>
        </View>

        {CREDITS.map((item) => (
          <View key={item.id} style={[styles.creditCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.titleRow}>
              <Text style={[styles.creditTitle, { color: colors.text }]}>&quot;{item.title}&quot;</Text>
              {item.category ? (
                <View style={[styles.categoryBadge, { backgroundColor: `${colors.tint}18` }]}>
                  <Text style={[styles.categoryText, { color: colors.tint }]}>{item.category}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.fileRow}>
              <Text style={[styles.fileLabel, { color: colors.secondaryText }]}>File:</Text>
              <Text style={[styles.fileName, { color: colors.secondaryText }]} numberOfLines={1}>
                {item.fileName}
              </Text>
            </View>

            <Text style={[styles.creditLine, { color: colors.secondaryText }]}>
              by{' '}
              {item.authorUrl ? (
                <Text style={{ color: colors.tint }} onPress={() => Linking.openURL(item.authorUrl!)}>
                  {item.author}
                </Text>
              ) : (
                <Text style={{ color: colors.text, fontWeight: '600' }}>{item.author}</Text>
              )}
            </Text>

            <Text style={[styles.creditLine, { color: colors.secondaryText }]}>
              Licensed under{' '}
              {item.licenseUrl ? (
                <Text style={{ color: colors.tint }} onPress={() => Linking.openURL(item.licenseUrl!)}>
                  {item.license}
                </Text>
              ) : (
                <Text style={{ color: colors.text, fontWeight: '600' }}>{item.license}</Text>
              )}
            </Text>
          </View>
        ))}

        <Text style={[styles.versionText, { color: colors.secondaryText }]}>
          JezSy v{Constants.expoConfig?.version ?? '—'}
        </Text>
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
  countBadge: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  fileLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fileName: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },
  creditTitle: {
    ...Type.headline,
    fontSize: 15,
    flex: 1,
  },
  creditLine: {
    ...Type.body,
    fontSize: 13,
  },
  versionText: {
    ...Type.caption,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
});
