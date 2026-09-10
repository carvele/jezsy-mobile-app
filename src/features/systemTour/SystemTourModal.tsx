import React, { useEffect, useState } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { useAuth } from '@/src/context/AuthContext';
import { TOUR_MODULE_IDS, TOUR_MODULES, TourModuleId } from './tourConfig';
import {
  dismissSystemTour,
  getTourProgress,
  markTourModuleStarted,
  neverShowSystemTourAgain,
  TourProgressSnapshot,
} from './tourProgress';
import { reportTourAnalyticsEvent } from './tourAnalytics';

interface SystemTourModalProps {
  visible: boolean;
  onClose: () => void;
  /** Profile's replay entry point: shows the hub without touching completion/dismissal state. */
  isReplay?: boolean;
}

export function SystemTourModal({ visible, onClose, isReplay = false }: SystemTourModalProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { user } = useAuth();
  // Reactive, not a module-level Dimensions.get() snapshot: a value read once
  // at module load can be stale by the time this modal actually shows (this
  // is the same class of bug useGridCardWidth's own comment documents, and
  // it produced an overflowing modal in practice -- the container rendered
  // wider than the real viewport).
  const { width: screenWidth } = useWindowDimensions();

  const [activeModule, setActiveModule] = useState<TourModuleId | null>(null);
  const [progress, setProgress] = useState<TourProgressSnapshot | null>(null);

  useEffect(() => {
    if (!visible || !user) return;
    let isCancelled = false;
    getTourProgress(user.id).then((snapshot) => {
      if (!isCancelled) setProgress(snapshot);
    });
    reportTourAnalyticsEvent(isReplay ? 'tour_replayed' : 'tour_introduced', {
      version: 0,
      source: isReplay ? 'profile_replay' : 'auto',
    });
    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, user]);

  const handleSkipForNow = async () => {
    if (!isReplay && user) {
      await dismissSystemTour(user.id);
    }
    onClose();
  };

  const handleDontShowAgain = async () => {
    if (!isReplay && user) {
      await neverShowSystemTourAgain(user.id);
    }
    onClose();
  };

  const selectPath = async (moduleId: TourModuleId) => {
    if (!isReplay && user) {
      await markTourModuleStarted(user.id, moduleId);
    }
    setActiveModule(moduleId);
  };

  const handleModuleAction = async () => {
    if (!activeModule) return;
    const moduleDef = TOUR_MODULES[activeModule];

    onClose();
    // small delay to allow modal to close before navigating
    setTimeout(() => {
      router.push(moduleDef.actionRoute as any);
      // Reset state for next time modal opens
      setActiveModule(null);
    }, 100);
  };

  const handleBackToMenu = () => {
    setActiveModule(null);
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
              width: Math.min(screenWidth - 32, 440),
              backgroundColor: isDark ? '#141418' : 'white',
              borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)',
            },
          ]}
        >
          {activeModule === null ? (
            // Welcome Hub: choose a learning path
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

                <Text style={[styles.questionText, { color: colors.text }]}>What would you like to learn first?</Text>

                <View style={styles.optionsContainer}>
                  {TOUR_MODULE_IDS.map((id) => {
                    const moduleDef = TOUR_MODULES[id];
                    const completed = !isReplay && progress?.[id]?.completed;
                    return (
                      <TouchableOpacity
                        key={id}
                        style={[
                          styles.optionCard,
                          {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                          },
                        ]}
                        onPress={() => selectPath(id)}
                      >
                        <View style={[styles.optionIcon, { backgroundColor: isDark ? 'rgba(201,169,110,0.15)' : 'rgba(138,109,59,0.1)' }]}>
                          <IconSymbol name={moduleDef.icon as any} size={20} color={colors.tint} />
                        </View>
                        <Text style={[styles.optionText, { color: colors.text }]}>{moduleDef.title}</Text>
                        <IconSymbol
                          name={completed ? 'checkmark.circle.fill' : 'chevron.right'}
                          size={16}
                          color={completed ? colors.tint : colors.icon}
                        />
                      </TouchableOpacity>
                    );
                  })}
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
            // Path primer: explains why the feature matters, then hands off
            // to contextual coachmarks on the real screen (see TourCoachmark).
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
                  <IconSymbol name={TOUR_MODULES[activeModule].icon as any} size={32} color={colors.tint} />
                </View>

                <Text style={[styles.title, { color: colors.text }]}>{TOUR_MODULES[activeModule].title}</Text>
                <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{TOUR_MODULES[activeModule].subtitle}</Text>

                <View style={styles.highlightsContainer}>
                  {TOUR_MODULES[activeModule].highlights.map((h, i) => (
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

                <Text style={[styles.hintText, { color: colors.secondaryText }]}>
                  We&apos;ll show quick tips right on the screen as you go.
                </Text>
              </ScrollView>

              <View style={[styles.footer, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                <PrimaryButton
                  label={TOUR_MODULES[activeModule].actionLabel}
                  onPress={handleModuleAction}
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
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.xs,
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
  hintText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  dontShowBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  dontShowText: {
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
