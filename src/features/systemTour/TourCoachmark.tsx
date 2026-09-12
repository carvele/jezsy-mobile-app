import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useFloatingTabBarMetrics } from '@/src/hooks/useFloatingTabBarMetrics';
import { TOUR_MODULE_IDS, TOUR_MODULES, TourModuleId, TourStep } from './tourConfig';
import { markTourStepComplete } from './tourProgress';
import { readModuleProgress, TourModuleProgress } from './tourStorage';
import { clearTourReplay, completeTourReplayStep, getActiveTourReplay, subscribeTourEvent } from './tourEvents';

interface PendingStep {
  moduleId: TourModuleId;
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
}

/**
 * Drives the coachmark sequence for whichever tour module(s) are currently
 * in-progress and have a step on this screen. A screen may host steps for
 * more than one module (e.g. Explore hosts both Discover's browse/search
 * steps and the AR module's "find an AR item" step).
 *
 * Progress is nonlinear (see TourModuleProgress.completedStepIds): a user
 * can satisfy a later step's real-world action before an earlier step's
 * coachmark was ever dismissed (e.g. opening a product before triggering
 * search). So this subscribes to *every* not-yet-completed step on this
 * screen concurrently, not just the one currently displayed - otherwise an
 * out-of-order action would fire into a pub/sub nobody's listening to at
 * that moment. Only the single recommended-next step is ever shown via
 * <TourCoachmarkBanner>, so this stays visually one-at-a-time.
 */
export function useTourCoachmark(screenName: string) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [pendingSteps, setPendingSteps] = useState<PendingStep[]>([]);
  const [dismissedModules, setDismissedModules] = useState<Set<TourModuleId>>(new Set());

  const refresh = React.useCallback(async () => {
    if (!userId) {
      setPendingSteps([]);
      return;
    }
    const next: PendingStep[] = [];
    // A module being replayed (Profile's Replay Tour) never has stored
    // progress to read -- see tourEvents.ts's startTourReplay -- so its
    // steps are sourced from the in-memory replay session instead, entirely
    // bypassing progress.started/completed for that one module.
    const replay = getActiveTourReplay();
    for (const moduleId of TOUR_MODULE_IDS) {
      if (dismissedModules.has(moduleId)) continue;
      const moduleDef = TOUR_MODULES[moduleId];
      if (replay?.moduleId === moduleId) {
        moduleDef.steps.forEach((step, stepIndex) => {
          if (step.screen === screenName && !replay.completedStepIds.has(step.id)) {
            next.push({ moduleId, step, stepIndex, totalSteps: moduleDef.steps.length });
          }
        });
        continue;
      }
      const progress: TourModuleProgress = await readModuleProgress(userId, moduleId);
      if (!progress.started || progress.completed || progress.version !== moduleDef.version) continue;
      moduleDef.steps.forEach((step, stepIndex) => {
        if (step.screen === screenName && !progress.completedStepIds.includes(step.id)) {
          next.push({ moduleId, step, stepIndex, totalSteps: moduleDef.steps.length });
        }
      });
    }
    setPendingSteps(next);
  }, [userId, screenName, dismissedModules]);

  // Focus, not mount: a tab screen (or a pushed screen navigated back into)
  // usually stays mounted between visits, so a mount-only effect would miss
  // a replay session started while this screen was already alive in the
  // background.
  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh])
  );

  const advanceTo = async (moduleId: TourModuleId, stepId: string) => {
    if (getActiveTourReplay()?.moduleId === moduleId) {
      completeTourReplayStep(moduleId, stepId);
      refresh();
      return;
    }
    if (!userId) return;
    await markTourStepComplete(userId, moduleId, stepId);
    refresh();
  };

  // One subscription per not-yet-completed step on this screen, so an
  // out-of-order completion is caught regardless of which step is displayed.
  useEffect(() => {
    const unsubscribes = pendingSteps.flatMap((p) => {
      const completion = p.step.completion;
      if (completion.type === 'next') return [];
      const eventName = completion.type === 'interaction' ? completion.event : completion.route;
      return [subscribeTourEvent(eventName, () => advanceTo(p.moduleId, p.step.id))];
    });
    return () => unsubscribes.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSteps]);

  // Displayed step: the recommended next one per module (in config order),
  // preferring the first module by TOUR_MODULE_IDS order that has a pending
  // step on this screen.
  const active = useMemo(() => {
    for (const moduleId of TOUR_MODULE_IDS) {
      const moduleSteps = pendingSteps.filter((p) => p.moduleId === moduleId);
      if (moduleSteps.length === 0) continue;
      const earliest = moduleSteps.reduce((a, b) => (a.stepIndex < b.stepIndex ? a : b));
      return earliest;
    }
    return null;
  }, [pendingSteps]);

  const advance = () => {
    if (!active) return;
    advanceTo(active.moduleId, active.step.id);
  };

  const dismiss = () => {
    if (!active) return;
    if (getActiveTourReplay()?.moduleId === active.moduleId) {
      clearTourReplay();
    }
    setDismissedModules((prev) => new Set(prev).add(active.moduleId));
  };

  return {
    step: active?.step ?? null,
    stepNumber: active ? active.stepIndex + 1 : 0,
    totalSteps: active?.totalSteps ?? 0,
    advance,
    dismiss,
  };
}

interface TourCoachmarkBannerProps {
  title: string;
  description: string;
  stepNumber: number;
  totalSteps: number;
  onNext?: () => void;
  onDismiss: () => void;
  /**
   * Whether this screen has the floating pill tab bar (app/(tabs)/_layout.tsx)
   * docked above the true screen bottom. Defaults to true since 3 of the 4
   * screens hosting this banner are tab screens; the one that isn't
   * (app/ar-tryon/[id].tsx, a full-screen camera route) passes false.
   * Without this, the card renders underneath the floating bar instead of
   * above it -- its own content becomes unreadable, hidden behind the bar.
   */
  aboveTabBar?: boolean;
}

/**
 * A lightweight, bottom-anchored contextual coachmark - not a full spotlight
 * overlay. It teaches in place on the real screen without requiring precise
 * measurement of arbitrary target elements across every layout.
 */
export function TourCoachmarkBanner({
  title,
  description,
  stepNumber,
  totalSteps,
  onNext,
  onDismiss,
  aboveTabBar = true,
}: TourCoachmarkBannerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];
  const { clearance } = useFloatingTabBarMetrics();

  return (
    <SafeAreaView
      style={[styles.wrapper, aboveTabBar ? { bottom: clearance } : undefined]}
      edges={['bottom']}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: isDark ? '#1c1c22' : 'white',
            borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)',
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.progressText, { color: colors.tint }]}>
            {stepNumber} of {totalSteps}
          </Text>
          <TouchableOpacity onPress={onDismiss} hitSlop={14} accessibilityRole="button" accessibilityLabel="Dismiss tip">
            <IconSymbol name="xmark" size={16} color={colors.icon} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.description, { color: colors.secondaryText }]}>{description}</Text>
        {onNext && (
          <TouchableOpacity
            style={[styles.nextBtn, { backgroundColor: colors.tint }]}
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel="Next tip"
          >
            <Text style={[styles.nextBtnText, { color: colors.onTint }]}>Got it</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.md,
    boxShadow: '0px 8px 20px rgba(0, 0, 0, 0.25)',
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  progressText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
  nextBtn: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xxl,
    borderRadius: 10,
  },
  nextBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
