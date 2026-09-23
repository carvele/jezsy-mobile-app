import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/src/context/AuthContext';
import { PlannedOutfit } from '@/src/types/planner';
import {
  getPlannedOutfitsRange,
  cancelPlannedOutfit,
} from '@/src/services/plannerService';
import { getWardrobeItemsPage, WardrobeItem } from '@/src/services/wardrobeService';
import {
  getTodayCalendarDate,
  formatDayDisplay,
  getWeekDates,
  resolveDeviceTimezone,
} from '@/src/utils/plannerDateTime';
import { WeekStrip } from '@/src/components/planner/WeekStrip';
import { PlannedOutfitCard } from '@/src/components/planner/PlannedOutfitCard';
import { PlannerCalendarModal } from '@/src/components/planner/PlannerCalendarModal';
import { ReschedulePlanModal } from '@/src/components/planner/ReschedulePlanModal';
import { EditPlanMetadataModal } from '@/src/components/planner/EditPlanMetadataModal';

export default function PlannerScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const { user } = useAuth();

  const resolvedTz = resolveDeviceTimezone();
  const todayDate = useMemo(() => {
    try {
      return getTodayCalendarDate(resolvedTz || 'Asia/Manila');
    } catch {
      return '2026-09-24';
    }
  }, [resolvedTz]);

  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [plans, setPlans] = useState<PlannedOutfit[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Authoritative inventory
  const [inventory, setInventory] = useState<WardrobeItem[]>([]);
  const [inventoryStatus, setInventoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Modals state
  const [isMonthModalOpen, setIsMonthModalOpen] = useState<boolean>(false);
  const [isSourceChooserOpen, setIsSourceChooserOpen] = useState<boolean>(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<PlannedOutfit | null>(null);
  const [editMetadataTarget, setEditMetadataTarget] = useState<PlannedOutfit | null>(null);

  // Current visible week range
  const currentWeek = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const weekStart = currentWeek[0];
  const weekEnd = currentWeek[6];

  // Fetch authoritative wardrobe inventory once for availability checks
  useEffect(() => {
    if (!user?.id) {
      setInventoryStatus('ready');
      return;
    }
    setInventoryStatus('loading');
    getWardrobeItemsPage(user.id, 0, {}, 300)
      .then((res) => {
        setInventory(res.items || []);
        setInventoryStatus('ready');
      })
      .catch(() => {
        setInventoryStatus('error');
      });
  }, [user?.id]);

  // Bounded server read: fetch plans for the visible week
  const fetchWeekPlans = useCallback(async () => {
    setIsLoadingPlans(true);
    setErrorMessage(null);

    const result = await getPlannedOutfitsRange(weekStart, weekEnd);
    setIsLoadingPlans(false);

    if (result.ok) {
      setPlans(result.data);
    } else {
      setErrorMessage('Unable to load planner looks. Please try again.');
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    fetchWeekPlans();
  }, [fetchWeekPlans]);

  // Filter plans for the selected date (excluding cancelled)
  const dayPlans = useMemo(() => {
    return plans.filter(
      (p) => p.planned_date === selectedDate && p.status !== 'cancelled'
    );
  }, [plans, selectedDate]);

  const dayDisplay = formatDayDisplay(selectedDate, todayDate);

  // Handle plan cancellation with OCC protection
  const handleCancelPlan = async (plan: PlannedOutfit) => {
    const result = await cancelPlannedOutfit(plan.id, plan.revision);
    if (result.ok) {
      // Optimistically update local week state without waiting
      setPlans((prev) =>
        prev.map((p) => (p.id === plan.id ? { ...p, status: 'cancelled' } : p))
      );
    } else {
      const err = result.error;
      const rawMessage = (err?.message || '') + ((err?.cause as any)?.message || '');
      const errCode = err?.code;
      const causeCode = (err?.cause as any)?.code;

      if (
        rawMessage.includes('OCC_CONFLICT') ||
        rawMessage.includes('OCC conflict') ||
        errCode === 'OCC_CONFLICT' ||
        errCode === 'P0001' ||
        causeCode === 'P0001'
      ) {
        fetchWeekPlans();
        Alert.alert(
          'Update Required',
          "This plan was modified on another device. We've refreshed the latest version. Please review before cancelling."
        );
      } else {
        Alert.alert('Notice', 'Unable to cancel this plan. Please check your connection and retry.');
      }
    }
  };

  // Re-fetch individual plan if needed
  const handleRefreshPlan = async (planId: string): Promise<PlannedOutfit | null> => {
    await fetchWeekPlans();
    return plans.find((p) => p.id === planId) || null;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Editorial Atelier Header */}
      <View style={[styles.header, { borderBottomColor: theme.hairline }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Wardrobe"
          onPress={() => router.back()}
          style={styles.headerIconButton}
          hitSlop={8}
        >
          <IconSymbol name="arrow.left" size={22} color={theme.text} />
        </Pressable>

        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Outfit Planner</Text>
          <Text style={[styles.headerSubtitle, { color: theme.secondaryText }]}>
            {dayDisplay.monthName} {dayDisplay.dayNumber} • {dayPlans.length} {dayPlans.length === 1 ? 'Look' : 'Looks'}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {selectedDate !== todayDate && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to Today"
              onPress={() => setSelectedDate(todayDate)}
              style={[styles.todayButton, { backgroundColor: theme.glass, borderColor: theme.border }]}
              hitSlop={8}
            >
              <Text style={[styles.todayButtonText, { color: theme.tint }]}>Today</Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open month calendar"
            onPress={() => setIsMonthModalOpen(true)}
            style={styles.headerIconButton}
            hitSlop={8}
          >
            <IconSymbol name="calendar" size={22} color={theme.text} />
          </Pressable>
        </View>
      </View>

      {/* Week Strip Bar */}
      <WeekStrip
        selectedDate={selectedDate}
        todayDate={todayDate}
        plans={plans}
        onSelectDate={setSelectedDate}
        onShiftWeek={(newCenterDate) => setSelectedDate(newCenterDate)}
      />

      {/* Main Selected Day Stream */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Selected Date Header */}
        <View style={styles.dayHeaderRow}>
          <View>
            <Text style={[styles.dayHeading, { color: theme.text }]}>
              {dayDisplay.isToday ? 'Today' : dayDisplay.dayName}
            </Text>
            <Text style={[styles.daySubheading, { color: theme.secondaryText }]}>
              {dayDisplay.fullDate}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Plan an outfit for this day"
            onPress={() => setIsSourceChooserOpen(true)}
            style={[styles.addPlanButton, { backgroundColor: theme.tint }]}
            hitSlop={8}
          >
            <IconSymbol name="plus" size={18} color={theme.onTint} />
            <Text style={[styles.addPlanButtonText, { color: theme.onTint }]}>Plan Look</Text>
          </Pressable>
        </View>

        {/* Loading Indicator */}
        {isLoadingPlans ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={theme.tint} />
            <Text style={[styles.loadingText, { color: theme.secondaryText }]}>Loading schedule...</Text>
          </View>
        ) : errorMessage ? (
          <View style={[styles.errorContainer, { backgroundColor: theme.glass }]}>
            <IconSymbol name="exclamationmark.circle" size={24} color={theme.error} />
            <Text style={[styles.errorText, { color: theme.text }]}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading planner"
              onPress={fetchWeekPlans}
              style={[styles.retryButton, { borderColor: theme.tint }]}
            >
              <Text style={[styles.retryButtonText, { color: theme.tint }]}>Retry</Text>
            </Pressable>
          </View>
        ) : dayPlans.length === 0 ? (
          /* Quiet Luxury Empty State */
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIconCircle, { backgroundColor: theme.glass }]}>
              <IconSymbol name="sparkles" size={28} color={theme.tint} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No Looks Planned</Text>
            <Text style={[styles.emptySubtitle, { color: theme.secondaryText }]}>
              Begin your styling curation for {dayDisplay.fullDate}.
            </Text>
            <Pressable
              testID="btn-empty-plan-look"
              accessibilityRole="button"
              accessibilityLabel="Plan an outfit"
              onPress={() => setIsSourceChooserOpen(true)}
              style={[styles.emptyCtaButton, { backgroundColor: theme.tint }]}
            >
              <IconSymbol name="plus" size={18} color={theme.onTint} style={{ marginRight: 6 }} />
              <Text style={[styles.emptyCtaText, { color: theme.onTint }]}>
                Plan an Outfit
              </Text>
            </Pressable>
          </View>
        ) : (
          /* Day Outfits Stream */
          <View style={styles.cardsStream}>
            {dayPlans.map((plan) => (
              <PlannedOutfitCard
                key={plan.id}
                plan={plan}
                inventoryStatus={inventoryStatus}
                authoritativeInventory={inventory}
                onReschedule={(target) => setRescheduleTarget(target)}
                onEditMetadata={(target) => setEditMetadataTarget(target)}
                onCancel={handleCancelPlan}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Month Calendar Exploration Modal */}
      <PlannerCalendarModal
        visible={isMonthModalOpen}
        selectedDate={selectedDate}
        todayDate={todayDate}
        onClose={() => setIsMonthModalOpen(false)}
        onSelectDate={(newDate) => {
          setSelectedDate(newDate);
          setIsMonthModalOpen(false);
        }}
      />

      {/* Reschedule Modal */}
      <ReschedulePlanModal
        visible={!!rescheduleTarget}
        plan={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onSuccess={(updated) => {
          setRescheduleTarget(null);
          fetchWeekPlans();
        }}
        onRefreshPlan={handleRefreshPlan}
      />

      {/* Edit Metadata Modal */}
      <EditPlanMetadataModal
        visible={!!editMetadataTarget}
        plan={editMetadataTarget}
        onClose={() => setEditMetadataTarget(null)}
        onSuccess={(updated) => {
          setEditMetadataTarget(null);
          fetchWeekPlans();
        }}
        onRefreshPlan={handleRefreshPlan}
      />

      {/* Outfit Source Chooser Modal */}
      <Modal
        visible={isSourceChooserOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsSourceChooserOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.sourceSheet, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
            <View style={styles.sourceSheetHeader}>
              <View>
                <Text style={[styles.sourceSheetTitle, { color: theme.text }]}>Plan Look</Text>
                <Text style={[styles.sourceSheetSubtitle, { color: theme.secondaryText }]}>
                  Choose a styling source for your planner
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close source chooser"
                onPress={() => setIsSourceChooserOpen(false)}
                style={styles.closeButton}
                hitSlop={8}
              >
                <IconSymbol name="xmark" size={24} color={theme.text} />
              </Pressable>
            </View>

            <View style={styles.sourceOptionsList}>
              <Pressable
                testID="chooser-saved-outfits"
                accessibilityRole="button"
                accessibilityLabel="Plan from Saved Outfits"
                onPress={() => {
                  setIsSourceChooserOpen(false);
                  router.push('/(tabs)/wardrobe?tab=outfits');
                }}
                style={[styles.sourceOptionRow, { borderColor: theme.border }]}
              >
                <View style={[styles.sourceOptionIcon, { backgroundColor: theme.glass }]}>
                  <IconSymbol name="bookmark" size={22} color={theme.tint} />
                </View>
                <View style={styles.sourceOptionInfo}>
                  <Text style={[styles.sourceOptionTitle, { color: theme.text }]}>
                    From Saved Outfits
                  </Text>
                  <Text style={[styles.sourceOptionDesc, { color: theme.secondaryText }]}>
                    Select an ensemble from your saved wardrobe looks
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={18} color={theme.secondaryText} />
              </Pressable>

              <Pressable
                testID="chooser-style-advisor"
                accessibilityRole="button"
                accessibilityLabel="Plan with Style Advisor"
                onPress={() => {
                  setIsSourceChooserOpen(false);
                  router.push('/style-advisor');
                }}
                style={[styles.sourceOptionRow, { borderColor: theme.border }]}
              >
                <View style={[styles.sourceOptionIcon, { backgroundColor: theme.glass }]}>
                  <IconSymbol name="sparkles" size={22} color={theme.tint} />
                </View>
                <View style={styles.sourceOptionInfo}>
                  <Text style={[styles.sourceOptionTitle, { color: theme.text }]}>
                    Style Advisor
                  </Text>
                  <Text style={[styles.sourceOptionDesc, { color: theme.secondaryText }]}>
                    Curate a tailored look for any occasion or weather
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={18} color={theme.secondaryText} />
              </Pressable>

              <Pressable
                testID="chooser-mannequin"
                accessibilityRole="button"
                accessibilityLabel="Plan with Mannequin Atelier"
                onPress={() => {
                  setIsSourceChooserOpen(false);
                  router.push('/(tabs)/wardrobe?tab=mannequin');
                }}
                style={[styles.sourceOptionRow, { borderColor: theme.border }]}
              >
                <View style={[styles.sourceOptionIcon, { backgroundColor: theme.glass }]}>
                  <IconSymbol name="figure.stand" size={22} color={theme.tint} />
                </View>
                <View style={styles.sourceOptionInfo}>
                  <Text style={[styles.sourceOptionTitle, { color: theme.text }]}>
                    Mannequin Atelier
                  </Text>
                  <Text style={[styles.sourceOptionDesc, { color: theme.secondaryText }]}>
                    Compose an outfit visually on the interactive canvas
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={18} color={theme.secondaryText} />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    ...Type.subtitle,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    ...Type.caption,
    fontSize: 11,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  todayButton: {
    minHeight: 32,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  todayButtonText: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  dayHeading: {
    ...Type.title,
    fontSize: 20,
    fontWeight: '700',
  },
  daySubheading: {
    ...Type.caption,
    fontSize: 13,
    marginTop: 2,
  },
  addPlanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    height: 38,
    borderRadius: Radius.pill,
    gap: 4,
  },
  addPlanButtonText: {
    ...Type.caption,
    fontSize: 12,
    fontWeight: '700',
  },
  loadingContainer: {
    paddingVertical: Spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...Type.caption,
    marginTop: Spacing.sm,
  },
  errorContainer: {
    padding: Spacing.xl,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
  },
  errorText: {
    ...Type.body,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 6,
  },
  retryButtonText: {
    ...Type.caption,
    fontWeight: '700',
  },
  emptyContainer: {
    paddingVertical: Spacing.xxxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    ...Type.subtitle,
    fontSize: 17,
    fontWeight: '700',
  },
  emptySubtitle: {
    ...Type.caption,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: Spacing.lg,
    maxWidth: 240,
  },
  emptyCtaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    height: 44,
    borderRadius: Radius.pill,
  },
  emptyCtaText: {
    ...Type.bodyStrong,
    fontSize: 14,
  },
  cardsStream: {
    gap: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sourceSheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
  },
  sourceSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  sourceSheetTitle: {
    ...Type.subtitle,
    fontSize: 18,
    fontWeight: '700',
  },
  sourceSheetSubtitle: {
    ...Type.caption,
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceOptionsList: {
    gap: Spacing.md,
  },
  sourceOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  sourceOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  sourceOptionInfo: {
    flex: 1,
  },
  sourceOptionTitle: {
    ...Type.bodyStrong,
    fontSize: 14,
  },
  sourceOptionDesc: {
    ...Type.caption,
    fontSize: 12,
    marginTop: 2,
  },
});
