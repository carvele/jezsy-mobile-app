import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PrimaryButton } from './PrimaryButton';
import { markHintSeen } from '@/src/utils/firstUseHints';
import { useAuth } from '@/src/context/AuthContext';

interface SystemTourModalProps {
  visible: boolean;
  onClose: () => void;
  isReplay?: boolean;
}

type PrimerId = 'discover' | 'ar' | 'wardrobe' | 'concierge';

interface PrimerDefinition {
  id: PrimerId;
  icon: string;
  title: string;
  subtitle: string;
  highlights: {
    icon: string;
    title: string;
    description: string;
  }[];
  actionRoute: string;
  actionLabel: string;
  hintKey: string;
}

const PRIMERS: Record<PrimerId, PrimerDefinition> = {
  discover: {
    id: 'discover',
    icon: 'magnifyingglass',
    title: 'Discover Styles',
    subtitle: 'Explore our curated catalog of luxury fashion.',
    highlights: [
      {
        icon: 'house.fill',
        title: 'Curated Collections',
        description: 'Explore trending haute couture, premium rentals, and seasonal edits.',
      },
      {
        icon: 'slider.horizontal.3',
        title: 'Smart Filters',
        description: 'Find garments tailored to your measurements and palette.',
      },
    ],
    actionRoute: '/(tabs)/explore',
    actionLabel: 'Browse Catalog',
    hintKey: 'discover_primer:v1',
  },
  ar: {
    id: 'ar',
    icon: 'cube.fill',
    title: 'AR Fitting Room',
    subtitle: 'Experience how luxury garments look and fit before reserving.',
    highlights: [
      {
        icon: 'camera.fill',
        title: 'Real-Time Body Fitting',
        description: 'Use your camera for live pose tracking and 3D simulations.',
      },
      {
        icon: 'figure.stand',
        title: 'Calibrated Body Scan',
        description: 'Get tailored sizing recommendations based on your unique shape.',
      },
    ],
    actionRoute: '/(tabs)/explore',
    actionLabel: 'Browse Catalog',
    hintKey: 'ar_primer:v1',
  },
  wardrobe: {
    id: 'wardrobe',
    icon: 'tshirt',
    title: 'Digital Wardrobe',
    subtitle: 'Turn your physical closet into an intelligent digital wardrobe powered by AI.',
    highlights: [
      {
        icon: 'plus',
        title: 'Auto Background Removal',
        description: 'Snap photos of your clothes; AI crops and catalogs each item instantly.',
      },
      {
        icon: 'square.grid.2x2.fill',
        title: 'Outfit Builder',
        description: 'Generate daily outfit pairings from your wardrobe and wishlist.',
      },
    ],
    actionRoute: '/(tabs)/wardrobe',
    actionLabel: 'Go to Digital Wardrobe',
    hintKey: 'wardrobe_primer:v1',
  },
  concierge: {
    id: 'concierge',
    icon: 'sparkles',
    title: 'Concierge & Support',
    subtitle: 'Get help with reservations, styling, and returns.',
    highlights: [
      {
        icon: 'message.fill',
        title: 'Direct Chat',
        description: 'Chat directly with our luxury styling and support team.',
      },
      {
        icon: 'bell.fill',
        title: 'Instant Updates',
        description: 'Receive notifications about your reservations and wishlist items.',
      },
    ],
    actionRoute: '/(tabs)/messages',
    actionLabel: 'Message Concierge',
    hintKey: 'concierge_primer:v1',
  }
};

const SCREEN_WIDTH = Dimensions.get('window').width;

export function SystemTourModal({ visible, onClose, isReplay = false }: SystemTourModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { user } = useAuth();

  const [activePrimer, setActivePrimer] = useState<PrimerId | null>(null);

  const handleSkipForNow = async () => {
    if (!isReplay && user) {
      await markHintSeen(user.id, 'welcome:v1');
    }
    onClose();
  };

  const handleDontShowAgain = async () => {
    if (!isReplay && user) {
      await markHintSeen(user.id, 'welcome:v1');
    }
    onClose();
  };

  const selectPath = async (primerId: PrimerId) => {
    if (!isReplay && user) {
      await markHintSeen(user.id, 'welcome:v1');
    }
    // If they choose discover, it skips the primer and routes straight to catalog.
    if (primerId === 'discover') {
      onClose();
      router.push('/(tabs)/explore' as any);
      return;
    }
    setActivePrimer(primerId);
  };

  const handlePrimerAction = async () => {
    if (!activePrimer) return;
    const primer = PRIMERS[activePrimer];
    
    if (!isReplay && user) {
      await markHintSeen(user.id, primer.hintKey);
    }
    
    onClose();
    // small delay to allow modal to close before navigating
    setTimeout(() => {
      router.push(primer.actionRoute as any);
      // Reset state for next time modal opens
      setActivePrimer(null);
    }, 100);
  };
  
  const handleBackToMenu = () => {
    setActivePrimer(null);
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalContainer,
            {
              backgroundColor: isDark ? '#141418' : 'white',
              borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)',
            },
          ]}
        >
          {activePrimer === null ? (
            // Welcome & Intent Screen
            <>
              <View style={styles.headerBar}>
                <Text style={[styles.badgeText, { color: colors.tint }]}>JEZSY DISCOVERY</Text>
                {!isReplay && (
                  <TouchableOpacity
                    onPress={handleSkipForNow}
                    style={styles.skipBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Skip for now"
                  >
                    <Text style={[styles.skipText, { color: colors.secondaryText }]}>Skip</Text>
                  </TouchableOpacity>
                )}
                {isReplay && (
                  <TouchableOpacity
                    onPress={onClose}
                    style={styles.skipBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                  >
                    <IconSymbol name="xmark" size={20} color={colors.icon} />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: colors.text, marginTop: Spacing.md }]}>Welcome to JezSy</Text>
                <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Your personal luxury fashion destination.</Text>
                
                <Text style={[styles.questionText, { color: colors.text }]}>What would you like to do first?</Text>

                <View style={styles.optionsContainer}>
                  <TouchableOpacity 
                    style={[styles.optionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}
                    onPress={() => selectPath('discover')}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(138,109,59,0.1)' }]}>
                      <IconSymbol name="magnifyingglass" size={20} color={colors.tint} />
                    </View>
                    <Text style={[styles.optionText, { color: colors.text }]}>Discover styles</Text>
                    <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.optionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}
                    onPress={() => selectPath('ar')}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(138,109,59,0.1)' }]}>
                      <IconSymbol name="cube.fill" size={20} color={colors.tint} />
                    </View>
                    <Text style={[styles.optionText, { color: colors.text }]}>Try something on</Text>
                    <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.optionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}
                    onPress={() => selectPath('wardrobe')}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(138,109,59,0.1)' }]}>
                      <IconSymbol name="tshirt" size={20} color={colors.tint} />
                    </View>
                    <Text style={[styles.optionText, { color: colors.text }]}>Explore my wardrobe</Text>
                    <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.optionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}
                    onPress={() => selectPath('concierge')}
                  >
                    <View style={[styles.optionIcon, { backgroundColor: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(138,109,59,0.1)' }]}>
                      <IconSymbol name="message.fill" size={20} color={colors.tint} />
                    </View>
                    <Text style={[styles.optionText, { color: colors.text }]}>Get help</Text>
                    <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                  </TouchableOpacity>
                </View>
              </ScrollView>
              
              {!isReplay && (
                <View style={[styles.footer, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                  <TouchableOpacity
                    onPress={handleDontShowAgain}
                    style={styles.dontShowBtn}
                  >
                    <Text style={[styles.dontShowText, { color: colors.secondaryText }]}>Don&apos;t show again</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            // Path-Specific Primer Screen
            <>
              <View style={styles.headerBar}>
                <TouchableOpacity onPress={handleBackToMenu} style={styles.backBtn}>
                  <IconSymbol name="arrow.left" size={20} color={colors.icon} />
                  <Text style={[styles.backText, { color: colors.secondaryText }]}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={styles.skipBtn}>
                  <IconSymbol name="xmark" size={20} color={colors.icon} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                <View style={[styles.iconCircle, { backgroundColor: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(138,109,59,0.1)' }]}>
                  <IconSymbol name={PRIMERS[activePrimer].icon as any} size={32} color={colors.tint} />
                </View>

                <Text style={[styles.title, { color: colors.text }]}>{PRIMERS[activePrimer].title}</Text>
                <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{PRIMERS[activePrimer].subtitle}</Text>

                <View style={styles.highlightsContainer}>
                  {PRIMERS[activePrimer].highlights.map((h, i) => (
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

              <View style={[styles.footer, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                <PrimaryButton
                  label={PRIMERS[activePrimer].actionLabel}
                  onPress={handlePrimerAction}
                  dark={isDark}
                />
              </View>
            </>
          )}
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
    boxShadow: '0px 16px 32px rgba(0, 0, 0, 0.4)',
    elevation: 24,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    height: 60,
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
    fontSize: 14,
    fontWeight: '600',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.xs,
    marginLeft: -Spacing.xs,
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
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
  questionText: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    alignSelf: 'flex-start',
  },
  optionsContainer: {
    width: '100%',
    gap: Spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: 14,
    borderWidth: 1,
  },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
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
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  dontShowBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  dontShowText: {
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
