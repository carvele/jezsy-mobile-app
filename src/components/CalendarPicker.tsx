import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { manilaCalendarDay, formatManilaDate, isSameManilaDay } from '@/src/utils/dateTime';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface Props {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  // Manila midnight date representing "today"
  minDate: Date;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function CalendarPicker({ selectedDate, onSelectDate, minDate }: Props) {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];

  // Store the currently viewed month (anchored to the 1st of the month, Manila time)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate);
    d.setUTCDate(1);
    return d;
  });

  const calendarDays = useMemo(() => {
    const year = viewMonth.getUTCFullYear();
    const month = viewMonth.getUTCMonth();
    
    // Day of the week for the 1st of the month
    const firstDay = new Date(Date.UTC(year, month, 1));
    const startOffset = firstDay.getUTCDay();
    
    // Number of days in the month
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    
    const days: (Date | null)[] = [];
    // Padding for previous month
    for (let i = 0; i < startOffset; i++) {
      days.push(null);
    }
    // Days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(Date.UTC(year, month, i)));
    }
    
    return days;
  }, [viewMonth]);

  const handlePrevMonth = () => {
    setViewMonth(prev => {
      const next = new Date(prev);
      next.setUTCMonth(next.getUTCMonth() - 1);
      return next;
    });
  };

  const handleNextMonth = () => {
    setViewMonth(prev => {
      const next = new Date(prev);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    });
  };

  // Only allow previous month if it contains or is after minDate's month
  const canGoPrev = viewMonth.getUTCFullYear() > minDate.getUTCFullYear() || 
    (viewMonth.getUTCFullYear() === minDate.getUTCFullYear() && viewMonth.getUTCMonth() > minDate.getUTCMonth());

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={handlePrevMonth} 
          disabled={!canGoPrev}
          style={[styles.navButton, !canGoPrev && { opacity: 0.3 }]}
        >
          <IconSymbol name="chevron.left" size={20} color={colors.text} />
        </TouchableOpacity>
        
        <Text style={[styles.monthLabel, { color: colors.text }]}>
          {MONTH_NAMES[viewMonth.getUTCMonth()]} {viewMonth.getUTCFullYear()}
        </Text>
        
        <TouchableOpacity onPress={handleNextMonth} style={styles.navButton}>
          <IconSymbol name="chevron.right" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekdays}>
        {WEEKDAYS.map(day => (
          <Text key={day} style={[styles.weekdayText, { color: colors.secondaryText }]}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {calendarDays.map((d, index) => {
          if (!d) {
            return <View key={`empty-${index}`} style={styles.dayCellContainer} />;
          }
          
          // Disable if the date is strictly before minDate
          const isPast = d < minDate;
          const isSelected = isSameManilaDay(d, selectedDate);
          
          return (
            <TouchableOpacity
              key={index}
              style={styles.dayCellContainer}
              disabled={isPast}
              onPress={() => onSelectDate(d)}
            >
              <View style={[
                styles.dayCell,
                isSelected && { backgroundColor: colors.tint }
              ]}>
                <Text style={[
                  styles.dayText,
                  { color: isPast ? colors.secondaryText : (isSelected ? colors.onTint : colors.text) },
                  isPast && { opacity: 0.5 },
                  isSelected && { fontWeight: '700' }
                ]}>
                  {d.getUTCDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  navButton: {
    padding: Spacing.xs,
  },
  weekdays: {
    flexDirection: 'row',
    marginBottom: Spacing.sm,
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCellContainer: {
    width: '14.28%', // 100 / 7
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCell: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
  },
  dayText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
