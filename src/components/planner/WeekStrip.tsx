import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getWeekDates,
  formatDayDisplay,
  addCalendarDays,
} from '@/src/utils/plannerDateTime';
import { PlannedOutfit } from '@/src/types/planner';

export interface WeekStripProps {
  selectedDate: string; // YYYY-MM-DD
  todayDate: string; // YYYY-MM-DD
  plans: PlannedOutfit[];
  onSelectDate: (dateStr: string) => void;
  onShiftWeek?: (newCenterDate: string) => void;
}

export const WeekStrip: React.FC<WeekStripProps> = ({
  selectedDate,
  todayDate,
  plans,
  onSelectDate,
  onShiftWeek,
}) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const weekDates = React.useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  // Aggregate active plans by date: planned vs unconfirmed (cancelled is excluded)
  const plansByDate = React.useMemo(() => {
    const map = new Map<string, { planned: number; unconfirmed: number }>();
    for (const p of plans) {
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
  }, [plans]);

  const handlePrevWeek = () => {
    const newDate = addCalendarDays(selectedDate, -7);
    if (onShiftWeek) {
      onShiftWeek(newDate);
    } else {
      onSelectDate(newDate);
    }
  };

  const handleNextWeek = () => {
    const newDate = addCalendarDays(selectedDate, 7);
    if (onShiftWeek) {
      onShiftWeek(newDate);
    } else {
      onSelectDate(newDate);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderBottomColor: theme.hairline }]}>
      <View style={styles.stripRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          onPress={handlePrevWeek}
          style={styles.chevronButton}
          hitSlop={8}
        >
          <IconSymbol name="chevron.left" size={20} color={theme.text} />
        </Pressable>

        <View style={styles.daysRow}>
          {weekDates.map((dateStr) => {
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === todayDate;
            const dayInfo = formatDayDisplay(dateStr, todayDate);
            const counts = plansByDate.get(dateStr) || { planned: 0, unconfirmed: 0 };

            // Construct non-color-only accessible description
            const details: string[] = [];
            if (isToday) details.push('Today');
            if (counts.planned > 0) {
              details.push(`${counts.planned} ${counts.planned === 1 ? 'look' : 'looks'} scheduled`);
            }
            if (counts.unconfirmed > 0) {
              details.push(`${counts.unconfirmed} needs attention`);
            }
            if (counts.planned === 0 && counts.unconfirmed === 0) {
              details.push('no looks planned');
            }
            const a11yLabel = `${dayInfo.fullDate}. ${details.join(', ')}.`;

            return (
              <Pressable
                key={dateStr}
                testID={`week-day-${dateStr}`}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectDate(dateStr)}
                style={[
                  styles.dayCell,
                  isSelected && [styles.selectedCell, { backgroundColor: theme.tint }],
                  !isSelected && isToday && [styles.todayCell, { borderColor: theme.tint }],
                ]}
              >
                <Text
                  style={[
                    styles.dayNameText,
                    { color: isSelected ? theme.onTint : theme.secondaryText },
                  ]}
                >
                  {dayInfo.dayName}
                </Text>

                <Text
                  style={[
                    styles.dayNumberText,
                    { color: isSelected ? theme.onTint : theme.text },
                    isSelected && styles.boldText,
                  ]}
                >
                  {dayInfo.dayNumber}
                </Text>

                {/* Dot indicators: scheduled (tint/white) vs needs attention (warning amber) */}
                <View style={styles.indicatorContainer}>
                  {counts.planned > 0 && (
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: isSelected ? theme.onTint : theme.tint },
                      ]}
                    />
                  )}
                  {counts.unconfirmed > 0 && (
                    <View
                      style={[
                        styles.dot,
                        styles.unconfirmedDot,
                        { backgroundColor: isSelected ? theme.onTint : theme.warning },
                      ]}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          onPress={handleNextWeek}
          style={styles.chevronButton}
          hitSlop={8}
        >
          <IconSymbol name="chevron.right" size={20} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  chevronButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  dayCell: {
    minWidth: 44,
    minHeight: 52,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCell: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  todayCell: {
    borderWidth: 1.5,
  },
  dayNameText: {
    ...Type.caption,
    fontSize: 11,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  dayNumberText: {
    ...Type.bodyStrong,
    fontSize: 15,
  },
  boldText: {
    fontWeight: '700',
  },
  indicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 6,
    marginTop: 3,
    gap: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  unconfirmedDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
