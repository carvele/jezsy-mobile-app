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
import {
  parseCalendarDate,
  formatCalendarDate,
  getDaysInMonth,
  getDayOfWeek,
  formatDayDisplay,
  isPastCalendarDate,
} from '@/src/utils/plannerDateTime';
import { getPlannedOutfitsRange } from '@/src/services/plannerService';
import { PlannedOutfit } from '@/src/types/planner';

export interface PlannerCalendarModalProps {
  visible: boolean;
  selectedDate: string; // YYYY-MM-DD
  todayDate: string; // YYYY-MM-DD
  onClose: () => void;
  onSelectDate: (dateStr: string) => void;
  /** Scheduling pickers set this so days before today cannot be chosen; the browsing planner leaves it off. */
  disablePastDates?: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const PlannerCalendarModal: React.FC<PlannerCalendarModalProps> = ({
  visible,
  selectedDate,
  todayDate,
  onClose,
  onSelectDate,
  disablePastDates = false,
}) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const initialParts = React.useMemo(() => {
    try {
      return parseCalendarDate(selectedDate);
    } catch {
      return { year: 2026, month: 9, day: 24 };
    }
  }, [selectedDate]);

  const [activeYear, setActiveYear] = useState<number>(initialParts.year);
  const [activeMonth, setActiveMonth] = useState<number>(initialParts.month);
  const [monthPlans, setMonthPlans] = useState<PlannedOutfit[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Synchronize when modal opens
  useEffect(() => {
    if (visible) {
      try {
        const parts = parseCalendarDate(selectedDate);
        setActiveYear(parts.year);
        setActiveMonth(parts.month);
      } catch {}
    }
  }, [visible, selectedDate]);

  // Bounded query for the active month
  useEffect(() => {
    if (!visible) return;

    let isMounted = true;
    setIsLoading(true);

    const daysCount = getDaysInMonth(activeYear, activeMonth);
    const startDate = formatCalendarDate(activeYear, activeMonth, 1);
    const endDate = formatCalendarDate(activeYear, activeMonth, daysCount);

    getPlannedOutfitsRange(startDate, endDate)
      .then((res) => {
        if (!isMounted) return;
        if (res.ok) {
          setMonthPlans(res.data);
        } else {
          setMonthPlans([]);
        }
      })
      .catch(() => {
        if (isMounted) setMonthPlans([]);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [visible, activeYear, activeMonth]);

  const plansByDate = React.useMemo(() => {
    const map = new Map<string, { planned: number; unconfirmed: number }>();
    for (const p of monthPlans) {
      if (p.status === 'cancelled') continue;
      const entry = map.get(p.planned_date) || { planned: 0, unconfirmed: 0 };
      if (p.status === 'planned') {
        entry.planned += 1;
      } else if (p.status === 'unconfirmed') {
        entry.unconfirmed += 1;
      }
      map.set(p.planned_date, entry);
    }
    return map;
  }, [monthPlans]);

  // With past dates disabled there is nothing to pick before the current month.
  const todayParts = React.useMemo(() => {
    try {
      return parseCalendarDate(todayDate);
    } catch {
      return null;
    }
  }, [todayDate]);
  const canGoPrev =
    !disablePastDates ||
    !todayParts ||
    activeYear > todayParts.year ||
    (activeYear === todayParts.year && activeMonth > todayParts.month);

  const handlePrevMonth = () => {
    if (!canGoPrev) return;
    if (activeMonth === 1) {
      setActiveMonth(12);
      setActiveYear((y) => y - 1);
    } else {
      setActiveMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (activeMonth === 12) {
      setActiveMonth(1);
      setActiveYear((y) => y + 1);
    } else {
      setActiveMonth((m) => m + 1);
    }
  };

  // Build grid cells for the active month
  const gridCells = React.useMemo(() => {
    const totalDays = getDaysInMonth(activeYear, activeMonth);
    const firstDateStr = formatCalendarDate(activeYear, activeMonth, 1);
    const firstDow = getDayOfWeek(firstDateStr); // 0 = Sun, 1 = Mon ... 6 = Sat
    const startPadding = (firstDow + 6) % 7; // Mon = 0, Sun = 6

    const cells: { dayNumber: number | null; dateStr: string | null }[] = [];
    for (let i = 0; i < startPadding; i++) {
      cells.push({ dayNumber: null, dateStr: null });
    }
    for (let day = 1; day <= totalDays; day++) {
      cells.push({
        dayNumber: day,
        dateStr: formatCalendarDate(activeYear, activeMonth, day),
      });
    }
    return cells;
  }, [activeYear, activeMonth]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>
              {MONTH_NAMES[activeMonth - 1]} {activeYear}
            </Text>
            <View style={styles.headerControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                onPress={handlePrevMonth}
                disabled={!canGoPrev}
                accessibilityState={{ disabled: !canGoPrev }}
                style={[styles.navButton, !canGoPrev && { opacity: 0.3 }]}
                hitSlop={8}
              >
                <IconSymbol name="chevron.left" size={20} color={theme.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                onPress={handleNextMonth}
                style={styles.navButton}
                hitSlop={8}
              >
                <IconSymbol name="chevron.right" size={20} color={theme.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close calendar"
                onPress={onClose}
                style={[styles.navButton, { marginLeft: Spacing.sm }]}
                hitSlop={8}
              >
                <IconSymbol name="xmark" size={22} color={theme.secondaryText} />
              </Pressable>
            </View>
          </View>

          {/* Weekday labels */}
          <View style={styles.weekdaysRow}>
            {WEEKDAY_HEADERS.map((header, idx) => (
              <View key={idx} style={styles.weekdayCell}>
                <Text style={[styles.weekdayText, { color: theme.secondaryText }]}>{header}</Text>
              </View>
            ))}
          </View>

          {/* Days Grid */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={theme.tint} />
            </View>
          ) : (
            <View style={styles.gridContainer}>
              {gridCells.map((cell, idx) => {
                if (!cell.dateStr || cell.dayNumber === null) {
                  return <View key={idx} style={styles.emptyDayCell} />;
                }

                const isSelected = cell.dateStr === selectedDate;
                const isToday = cell.dateStr === todayDate;
                const isPast = disablePastDates && isPastCalendarDate(cell.dateStr, todayDate);
                const counts = plansByDate.get(cell.dateStr) || { planned: 0, unconfirmed: 0 };
                const dayDisplay = formatDayDisplay(cell.dateStr, todayDate);

                const details: string[] = [];
                if (isToday) details.push('Today');
                if (counts.planned > 0) details.push(`${counts.planned} scheduled`);
                if (counts.unconfirmed > 0) details.push(`${counts.unconfirmed} needs attention`);

                if (isPast) details.push('Past date, unavailable');

                const a11yLabel = `${dayDisplay.fullDate}. ${details.join(', ')}.`;

                return (
                  <Pressable
                    key={cell.dateStr}
                    accessibilityRole="button"
                    accessibilityLabel={a11yLabel}
                    accessibilityState={{ selected: isSelected, disabled: isPast }}
                    disabled={isPast}
                    onPress={() => {
                      onSelectDate(cell.dateStr!);
                      onClose();
                    }}
                    style={[
                      styles.gridDayCell,
                      isPast && { opacity: 0.35 },
                      isSelected && [styles.selectedGridCell, { backgroundColor: theme.tint }],
                      !isSelected && isToday && [styles.todayGridCell, { borderColor: theme.tint }],
                    ]}
                  >
                    <Text
                      style={[
                        styles.gridDayText,
                        { color: isSelected ? theme.onTint : theme.text },
                        isSelected && styles.boldText,
                      ]}
                    >
                      {cell.dayNumber}
                    </Text>

                    <View style={styles.cellDotsRow}>
                      {counts.planned > 0 && (
                        <View
                          style={[
                            styles.cellDot,
                            { backgroundColor: isSelected ? theme.onTint : theme.tint },
                          ]}
                        />
                      )}
                      {counts.unconfirmed > 0 && (
                        <View
                          style={[
                            styles.cellDot,
                            { backgroundColor: isSelected ? theme.onTint : theme.warning },
                          ]}
                        />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  headerTitle: {
    ...Type.subtitle,
    fontSize: 17,
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdaysRow: {
    flexDirection: 'row',
    marginBottom: Spacing.xs,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  weekdayText: {
    ...Type.caption,
    fontSize: 12,
    fontWeight: '600',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  loadingContainer: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDayCell: {
    width: `${100 / 7}%`,
    height: 44,
  },
  gridDayCell: {
    width: `${100 / 7}%`,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    paddingVertical: 2,
  },
  selectedGridCell: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  todayGridCell: {
    borderWidth: 1.5,
  },
  gridDayText: {
    ...Type.body,
    fontSize: 14,
  },
  boldText: {
    fontWeight: '700',
  },
  cellDotsRow: {
    flexDirection: 'row',
    height: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    marginTop: 2,
  },
  cellDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
