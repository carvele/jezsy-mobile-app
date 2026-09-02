import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, LayoutAnimation, Platform, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

// Enable LayoutAnimation on Android (Legacy Architecture only)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental && !(globalThis as any).nativeFabricUIManager) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    id: '1',
    category: 'Reservations & Booking',
    question: 'How does boutique rental work?',
    answer: 'Browse our curated collection in Explore or Wardrobe, pick your garment and size, select your rental dates and pickup/fitting slot, and pay the initial reservation deposit. You can collect your outfit in-store or schedule a fitting session.',
  },
  {
    id: '2',
    category: 'Reservations & Booking',
    question: 'Can I try on an outfit before finalizing?',
    answer: 'Yes! When creating a reservation, select an in-store Fitting appointment slot. Our boutique stylists will assist you with fitting, styling, and any minor adjustments.',
  },
  {
    id: '3',
    category: 'Payments & Pricing',
    question: 'What are the deposit and balance payment terms?',
    answer: 'An initial reservation deposit is paid upon booking to hold your item. The remaining balance is settled in-store upon pickup or fitting completion.',
  },
  {
    id: '4',
    category: 'Payments & Pricing',
    question: 'How are late returns and damage fees calculated?',
    answer: 'Garments must be returned by the scheduled end date. Overdue returns incur a late fee of ₱500 per day. All items are inspected upon return; minor wear is covered, while significant damage or loss is assessed individually.',
  },
  {
    id: '5',
    category: 'Virtual Try-On & Sizing',
    question: 'How does the AR Virtual Try-On work?',
    answer: 'Open any product tagged with "AR Try-On" and tap Virtual Try-On. Stand about 2 meters from your camera in a well-lit area. Our pose detection system overlays the 3D garment model onto your posture.',
  },
  {
    id: '6',
    category: 'Virtual Try-On & Sizing',
    question: 'What if an outfit doesn\'t fit when I receive it?',
    answer: 'Contact the boutique owner directly through the in-app Messages tab or visit our store. We offer immediate size exchanges subject to stock availability.',
  },
  {
    id: '7',
    category: 'Account & Security',
    question: 'How do I submit an account deletion request?',
    answer: 'Go to Profile > Account Settings > Request Account Deletion. Note that all outstanding reservation balances must be settled before account deletion can be requested.',
  },
];

export default function FAQScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>('1');

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(prev => (prev === id ? null : id));
  };

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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Help & FAQ</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="questionmark.circle.fill" size={32} color={colors.tint} />
          <Text style={[styles.heroTitle, { color: colors.text }]}>Frequently Asked Questions</Text>
          <Text style={[styles.heroSubtitle, { color: colors.secondaryText }]}>
            Everything you need to know about renting, fitting, payments, and returns.
          </Text>
        </View>

        {FAQ_ITEMS.map((item) => {
          const isExpanded = expandedId === item.id;
          return (
            <View
              key={item.id}
              style={[
                styles.accordionCard,
                { backgroundColor: colors.card, borderColor: isExpanded ? colors.tint : colors.border },
              ]}
            >
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => toggleExpand(item.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={item.question}
                accessibilityState={{ expanded: isExpanded }}
              >
                <View style={styles.headerLeft}>
                  <Text style={[styles.categoryBadge, { color: colors.tint }]}>{item.category}</Text>
                  <Text style={[styles.questionText, { color: colors.text }]}>{item.question}</Text>
                </View>
                <IconSymbol
                  name={isExpanded ? 'chevron.up' : 'chevron.down'}
                  size={18}
                  color={colors.secondaryText}
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={[styles.accordionBody, { borderTopColor: colors.border }]}>
                  <Text style={[styles.answerText, { color: colors.secondaryText }]}>{item.answer}</Text>
                </View>
              )}
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.contactCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push('/(tabs)/messages' as any)}
          activeOpacity={0.8}
        >
          <IconSymbol name="bubble.left.and.bubble.right" size={24} color={colors.tint} />
          <View style={styles.contactTextWrap}>
            <Text style={[styles.contactTitle, { color: colors.text }]}>Still have questions?</Text>
            <Text style={[styles.contactSub, { color: colors.secondaryText }]}>Chat directly with our boutique specialist</Text>
          </View>
          <IconSymbol name="chevron.right" size={16} color={colors.secondaryText} />
        </TouchableOpacity>
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
  accordionCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  headerLeft: {
    flex: 1,
    paddingRight: Spacing.md,
  },
  categoryBadge: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  questionText: {
    ...Type.headline,
    fontSize: 15,
    lineHeight: 20,
  },
  accordionBody: {
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  answerText: {
    ...Type.body,
    fontSize: 14,
    lineHeight: 21,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginTop: Spacing.lg,
    gap: Spacing.md,
  },
  contactTextWrap: {
    flex: 1,
  },
  contactTitle: {
    ...Type.headline,
    fontSize: 15,
  },
  contactSub: {
    ...Type.body,
    fontSize: 12,
    marginTop: 2,
  },
});
