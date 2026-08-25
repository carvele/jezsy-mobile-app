import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PrimaryButton } from './PrimaryButton';

interface SystemTourModalProps {
  visible: boolean;
  onClose: () => void;
}

interface TourStep {
  id: string;
  badge: string;
  icon: string;
  title: string;
  subtitle: string;
  highlights: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
  actionRoute?: string;
  actionLabel?: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    badge: 'STEP 1 OF 4 • DISCOVER',
    icon: 'sparkles',
    title: 'Welcome to JezSy Atelier',
    subtitle: 'Your personal luxury fashion destination with virtual styling and instant reservations.',
    highlights: [
      {
        icon: 'house.fill',
        title: 'Curated Collections',
        description: 'Explore trending haute couture, premium rentals, and seasonal edits.',
      },
      {
        icon: 'magnifyingglass',
        title: 'Smart Size & Color Filters',
        description: 'Find garments tailored specifically to your body measurements and palette.',
      },
    ],
    actionRoute: '/(tabs)/explore',
    actionLabel: 'Browse Explore Catalog',
  },
  {
    id: 'wardrobe',
    badge: 'STEP 2 OF 4 • DIGITAL WARDROBE',
    icon: 'tshirt',
    title: 'Digitize & Style Outfits',
    subtitle: 'Turn your physical closet into an intelligent digital wardrobe powered by AI.',
    highlights: [
      {
        icon: 'plus',
        title: 'Auto Background Removal',
        description: 'Snap photos of your clothes; AI crops and catalogs each item instantly.',
      },
      {
        icon: 'square.grid.2x2.fill',
        title: 'AI Capsule Wardrobes',
        description: 'Build cohesive 30-piece capsule collections and generate daily outfit pairings.',
      },
      {
        icon: 'flame.fill',
        title: 'Wear & Streak Tracking',
        description: 'Log what you wear to earn streak badges and revive neglected pieces.',
      },
    ],
    actionRoute: '/(tabs)/wardrobe',
    actionLabel: 'Go to Digital Wardrobe',
  },
  {
    id: 'ar_tryon',
    badge: 'STEP 3 OF 4 • AR FITTING ROOM',
    icon: 'cube.fill',
    title: '3D AR Virtual Try-On',
    subtitle: 'Experience how luxury garments look and fit on you before reserving or ordering.',
    highlights: [
      {
        icon: 'camera.fill',
        title: 'Real-Time Body Fitting',
        description: 'Use your camera for live pose tracking and 3D garment drape simulations.',
      },
      {
        icon: 'checkmark.circle.fill',
        title: 'Perfect Fit Guarantee',
        description: 'Calibrate your sizing with our interactive body silhouette guide.',
      },
    ],
  },
  {
    id: 'advisor_inbox',
    badge: 'STEP 4 OF 4 • CONCIERGE & SUPPORT',
    icon: 'envelope.fill',
    title: 'Style Advisor & Concierge',
    subtitle: 'Get automated AI styling recommendations or chat live with boutique consultants.',
    highlights: [
      {
        icon: 'sparkles',
        title: 'Ask the Style Advisor',
        description: 'Tell AI your upcoming occasion to get head-to-toe look recommendations.',
      },
      {
        icon: 'envelope.fill',
        title: 'Direct Boutique Chat',
        description: 'Message support directly for order adjustments, sizing advice, and custom fittings.',
      },
    ],
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function SystemTourModal({ visible, onClose }: SystemTourModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isDark = theme === 'dark';
  const router = useRouter();

  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const step = TOUR_STEPS[currentStepIndex];
  const isLastStep = currentStepIndex === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onClose();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleActionClick = (route?: string) => {
    onClose();
    if (route) {
      router.push(route as any);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalContainer,
            {
              backgroundColor: isDark ? '#141418' : '#ffffff',
              borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)',
            },
          ]}
        >
          {/* Header Bar */}
          <View style={styles.headerBar}>
            <Text style={[styles.badgeText, { color: colors.tint }]}>{step.badge}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.skipBtn}
              accessibilityRole="button"
              accessibilityLabel="Skip tutorial"
            >
              <Text style={[styles.skipText, { color: colors.secondaryText }]}>Skip</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Step Icon */}
            <View style={[styles.iconCircle, { backgroundColor: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(138,109,59,0.1)' }]}>
              <IconSymbol name={step.icon as any} size={32} color={colors.tint} />
            </View>

            {/* Title & Subtitle */}
            <Text style={[styles.title, { color: colors.text }]}>{step.title}</Text>
            <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{step.subtitle}</Text>

            {/* Feature Highlights */}
            <View style={styles.highlightsContainer}>
              {step.highlights.map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.highlightCard,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    },
                  ]}
                >
                  <View style={[styles.highlightIconBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                    <IconSymbol name={h.icon as any} size={18} color={colors.tint} />
                  </View>
                  <View style={styles.highlightTextContainer}>
                    <Text style={[styles.highlightTitle, { color: colors.text }]}>{h.title}</Text>
                    <Text style={[styles.highlightDescription, { color: colors.secondaryText }]}>
                      {h.description}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Footer Controls */}
          <View style={[styles.footer, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
            {/* Step Dots */}
            <View style={styles.dotsContainer}>
              {TOUR_STEPS.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        i === currentStepIndex
                          ? colors.tint
                          : isDark
                          ? 'rgba(255,255,255,0.2)'
                          : 'rgba(0,0,0,0.15)',
                      width: i === currentStepIndex ? 22 : 6,
                    },
                  ]}
                />
              ))}
            </View>

            {/* Buttons Row */}
            <View style={styles.buttonsRow}>
              {currentStepIndex > 0 && (
                <TouchableOpacity
                  onPress={handlePrevious}
                  style={[styles.prevBtn, { borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }]}
                  accessibilityRole="button"
                  accessibilityLabel="Previous tutorial step"
                >
                  <Text style={[styles.prevBtnText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>
              )}

              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={isLastStep ? 'Get Started' : 'Next Step →'}
                  onPress={handleNext}
                  dark={isDark}
                />
              </View>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalContainer: {
    width: Math.min(SCREEN_WIDTH - 32, 440),
    maxHeight: '88%',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 24,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  skipBtn: {
    padding: Spacing.xs,
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
    alignItems: 'center',
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  highlightsContainer: {
    width: '100%',
    gap: Spacing.sm,
  },
  highlightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    gap: Spacing.md,
  },
  highlightIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  highlightTextContainer: {
    flex: 1,
  },
  highlightTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  highlightDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  prevBtn: {
    height: 54,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prevBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
