import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PlannedOutfit, PlannerSlot } from '@/src/types/planner';
import {
  getTodayCalendarDate,
  addCalendarDays,
  formatDayDisplay,
  formatSlotLabel,
  resolveDeviceTimezone,
} from '@/src/utils/plannerDateTime';
import { reschedulePlannedOutfit } from '@/src/services/plannerService';
import { PlannerCalendarModal } from './PlannerCalendarModal';

export interface ReschedulePlanModalProps {
  visible: boolean;
  plan: PlannedOutfit | null;
  onClose: () => void;
  onSuccess: (updatedPlan: PlannedOutfit) => void;
  onRefreshPlan?: (planId: string) => Promise<PlannedOutfit | null>;
}

const SLOTS: PlannerSlot[] = ['all_day', 'day', 'evening', 'workout'];

export const ReschedulePlanModal: React.FC<ReschedulePlanModalProps> = ({
  visible,
  plan,
  onClose,
  onSuccess,
  onRefreshPlan,
}) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const resolvedTz = resolveDeviceTimezone();
  const todayDateStr = React.useMemo(() => {
    try {
      return getTodayCalendarDate(resolvedTz || 'Asia/Manila');
    } catch {
      return '2026-09-24';
    }
  }, [resolvedTz]);

  const [selectedDate, setSelectedDate] = useState<string>(todayDateStr);
  const [selectedSlot, setSelectedSlot] = useState<PlannerSlot>('all_day');
  const [currentRevision, setCurrentRevision] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (visible && plan) {
      setSelectedDate(plan.planned_date);
      setSelectedSlot(plan.slot);
      setCurrentRevision(plan.revision);
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [visible, plan]);

  if (!plan) return null;

  const tomorrowDateStr = addCalendarDays(todayDateStr, 1);
  const isTodaySelected = selectedDate === todayDateStr;
  const isTomorrowSelected = selectedDate === tomorrowDateStr;
  const dayDisplay = formatDayDisplay(selectedDate, todayDateStr);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await reschedulePlannedOutfit({
      planId: plan.id,
      expectedRevision: currentRevision,
      newDate: selectedDate,
      newSlot: selectedSlot,
    });

    setIsSubmitting(false);

    if (result.ok) {
      onSuccess(result.data);
      onClose();
    } else {
      const err = result.error;
      const rawMessage = (err?.message || '') + ((err?.cause as any)?.message || '');
      const errCode = err?.code;
      const causeCode = (err?.cause as any)?.code;

      if (
        rawMessage.includes('OCC_CONFLICT') ||
        rawMessage.includes('OCC conflict') ||
        errCode === 'P0001' ||
        causeCode === 'P0001'
      ) {
        // Stale revision: refresh latest plan
        if (onRefreshPlan) {
          const fresh = await onRefreshPlan(plan.id);
          if (fresh) {
            setCurrentRevision(fresh.revision);
          }
        }
        setErrorMessage(
          "This plan changed on another device. We've refreshed the latest version. Please confirm and tap Save."
        );
      } else if (
        errCode === 'P0004' ||
        errCode === '23505' ||
        causeCode === 'P0004' ||
        causeCode === '23505' ||
        rawMessage.includes('Slot collision') ||
        rawMessage.includes('already planned')
      ) {
        setErrorMessage(
          'You already have an outfit planned for this time. Choose another time or day.'
        );
      } else {
        setErrorMessage('Unable to reschedule this outfit. Please check your connection and retry.');
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.sheetCard, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.headerTitle, { color: theme.text }]}>Reschedule Look</Text>
              <Text style={[styles.headerSubtitle, { color: theme.secondaryText }]}>
                Select a new date or day part for this ensemble
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close reschedule modal"
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={8}
            >
              <IconSymbol name="xmark" size={24} color={theme.text} />
            </Pressable>
          </View>

          {/* Date Selector */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>NEW DATE</Text>
            <View style={styles.datePillsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reschedule to Today"
                accessibilityState={{ selected: isTodaySelected }}
                onPress={() => setSelectedDate(todayDateStr)}
                style={[
                  styles.pillButton,
                  isTodaySelected && [styles.pillActive, { backgroundColor: theme.tint }],
                  !isTodaySelected && { borderColor: theme.border },
                ]}
              >
                <Text style={[styles.pillText, { color: isTodaySelected ? theme.onTint : theme.text }]}>
                  Today
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reschedule to Tomorrow"
                accessibilityState={{ selected: isTomorrowSelected }}
                onPress={() => setSelectedDate(tomorrowDateStr)}
                style={[
                  styles.pillButton,
                  isTomorrowSelected && [styles.pillActive, { backgroundColor: theme.tint }],
                  !isTomorrowSelected && { borderColor: theme.border },
                ]}
              >
                <Text style={[styles.pillText, { color: isTomorrowSelected ? theme.onTint : theme.text }]}>
                  Tomorrow
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Pick specific date, currently ${dayDisplay.fullDate}`}
                onPress={() => setIsDatePickerOpen(true)}
                style={[
                  styles.pillButton,
                  !isTodaySelected && !isTomorrowSelected && [styles.pillActive, { backgroundColor: theme.tint }],
                  isTodaySelected || isTomorrowSelected ? { borderColor: theme.border } : null,
                ]}
              >
                <IconSymbol
                  name="calendar"
                  size={14}
                  color={!isTodaySelected && !isTomorrowSelected ? theme.onTint : theme.text}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[
                    styles.pillText,
                    { color: !isTodaySelected && !isTomorrowSelected ? theme.onTint : theme.text },
                  ]}
                >
                  {!isTodaySelected && !isTomorrowSelected ? `${dayDisplay.monthName} ${dayDisplay.dayNumber}` : 'Pick Date'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Slot Selector */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>DAY PART</Text>
            <View style={styles.slotsGrid}>
              {SLOTS.map((slot) => {
                const isSelected = selectedSlot === slot;
                return (
                  <Pressable
                    key={slot}
                    testID={`slot-chip-${slot}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Slot: ${formatSlotLabel(slot)}`}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setSelectedSlot(slot)}
                    style={[
                      styles.slotPill,
                      isSelected && [styles.slotPillActive, { backgroundColor: theme.tint }],
                      !isSelected && { borderColor: theme.border },
                    ]}
                  >
                    <Text style={[styles.slotPillText, { color: isSelected ? theme.onTint : theme.text }]}>
                      {formatSlotLabel(slot)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Error message */}
          {errorMessage ? (
            <View testID="reschedule-error-banner" style={[styles.errorBox, { backgroundColor: theme.glass, borderColor: theme.error }]}>
              <IconSymbol name="info.circle.fill" size={18} color={theme.error} style={{ marginRight: 6 }} />
              <Text style={[styles.errorText, { color: theme.error }]}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Submit Button */}
          <View style={[styles.footer, { borderTopColor: theme.hairline }]}>
            <Pressable
              testID="btn-confirm-reschedule"
              accessibilityRole="button"
              accessibilityLabel="Confirm reschedule"
              disabled={isSubmitting || (selectedDate === plan.planned_date && selectedSlot === plan.slot)}
              onPress={handleSubmit}
              style={[
                styles.submitButton,
                { backgroundColor: theme.tint },
                (isSubmitting || (selectedDate === plan.planned_date && selectedSlot === plan.slot)) &&
                  styles.disabledButton,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={theme.onTint} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.onTint }]}>
                  Save Changes
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      <PlannerCalendarModal
        visible={isDatePickerOpen}
        selectedDate={selectedDate}
        todayDate={todayDateStr}
        onClose={() => setIsDatePickerOpen(false)}
        onSelectDate={(newDate) => {
          setSelectedDate(newDate);
          setIsDatePickerOpen(false);
        }}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  headerTitle: {
    ...Type.subtitle,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
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
  section: {
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  datePillsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  pillButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    borderWidth: 0,
  },
  pillText: {
    ...Type.caption,
    fontSize: 13,
    fontWeight: '600',
  },
  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  slotPill: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotPillActive: {
    borderWidth: 0,
  },
  slotPillText: {
    ...Type.caption,
    fontSize: 13,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  errorText: {
    ...Type.caption,
    fontSize: 12,
    flex: 1,
  },
  footer: {
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitButton: {
    minHeight: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  submitButtonText: {
    ...Type.bodyStrong,
    fontSize: 15,
  },
});
