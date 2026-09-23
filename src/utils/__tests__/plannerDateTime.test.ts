import {
  isLeapYear,
  getDaysInMonth,
  formatCalendarDate,
  parseCalendarDate,
  isValidCalendarDate,
  addCalendarDays,
  getDayOfWeek,
  getWeekDates,
  resolveDeviceTimezone,
  isValidTimezone,
  getTodayCalendarDate,
  formatDayDisplay,
  formatSlotLabel,
} from '../plannerDateTime';

describe('plannerDateTime utility', () => {
  describe('leap years and days in month', () => {
    it('correctly identifies leap years', () => {
      expect(isLeapYear(2024)).toBe(true);
      expect(isLeapYear(2026)).toBe(false);
      expect(isLeapYear(2000)).toBe(true);
      expect(isLeapYear(1900)).toBe(false);
    });

    it('returns correct days in month', () => {
      expect(getDaysInMonth(2024, 2)).toBe(29);
      expect(getDaysInMonth(2026, 2)).toBe(28);
      expect(getDaysInMonth(2026, 1)).toBe(31);
      expect(getDaysInMonth(2026, 4)).toBe(30);
      expect(getDaysInMonth(2026, 13)).toBe(0);
    });
  });

  describe('parsing and formatting', () => {
    it('formats year, month, day to YYYY-MM-DD', () => {
      expect(formatCalendarDate(2026, 9, 24)).toBe('2026-09-24');
      expect(formatCalendarDate(2026, 1, 5)).toBe('2026-01-05');
    });

    it('parses valid calendar date strings', () => {
      expect(parseCalendarDate('2026-09-24')).toEqual({ year: 2026, month: 9, day: 24 });
      expect(isValidCalendarDate('2026-09-24')).toBe(true);
    });

    it('rejects invalid calendar date strings', () => {
      expect(() => parseCalendarDate('2026-02-30')).toThrow();
      expect(() => parseCalendarDate('invalid-date')).toThrow();
      expect(isValidCalendarDate('2026-02-30')).toBe(false);
      expect(isValidCalendarDate('2026-13-01')).toBe(false);
    });

    it('computes day of week accurately (0=Sun..6=Sat)', () => {
      // 2026-09-24 is a Thursday (4)
      expect(getDayOfWeek('2026-09-24')).toBe(4);
      // 2026-09-20 is a Sunday (0)
      expect(getDayOfWeek('2026-09-20')).toBe(0);
    });
  });

  describe('calendar day arithmetic', () => {
    it('adds days within the same month', () => {
      expect(addCalendarDays('2026-09-10', 5)).toBe('2026-09-15');
    });

    it('adds days across month boundaries', () => {
      expect(addCalendarDays('2026-09-28', 5)).toBe('2026-10-03');
    });

    it('adds days across year boundaries', () => {
      expect(addCalendarDays('2026-12-30', 3)).toBe('2027-01-02');
    });

    it('subtracts days within the same month', () => {
      expect(addCalendarDays('2026-09-15', -5)).toBe('2026-09-10');
    });

    it('subtracts days across month and year boundaries', () => {
      expect(addCalendarDays('2026-03-02', -3)).toBe('2026-02-27');
      expect(addCalendarDays('2024-03-02', -3)).toBe('2024-02-28'); // leap year 2024
      expect(addCalendarDays('2026-01-02', -3)).toBe('2025-12-30');
    });

    it('handles zero increment', () => {
      expect(addCalendarDays('2026-09-24', 0)).toBe('2026-09-24');
    });
  });

  describe('week dates generation', () => {
    it('generates 7-day Monday to Sunday range containing target date', () => {
      // 2026-09-24 is Thursday
      const week = getWeekDates('2026-09-24');
      expect(week).toHaveLength(7);
      expect(week[0]).toBe('2026-09-21'); // Monday
      expect(week[1]).toBe('2026-09-22'); // Tuesday
      expect(week[2]).toBe('2026-09-23'); // Wednesday
      expect(week[3]).toBe('2026-09-24'); // Thursday
      expect(week[4]).toBe('2026-09-25'); // Friday
      expect(week[5]).toBe('2026-09-26'); // Saturday
      expect(week[6]).toBe('2026-09-27'); // Sunday
    });

    it('generates week across month boundary', () => {
      // 2026-10-01 is Thursday
      const week = getWeekDates('2026-10-01');
      expect(week).toHaveLength(7);
      expect(week[0]).toBe('2026-09-28'); // Monday
      expect(week[6]).toBe('2026-10-04'); // Sunday
    });
  });

  describe('timezone validation and resolution', () => {
    it('validates standard IANA timezones', () => {
      expect(isValidTimezone('Asia/Manila')).toBe(true);
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
      expect(isValidTimezone('Invalid/Zone')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });

    it('resolves valid device timezone', () => {
      const tz = resolveDeviceTimezone();
      expect(typeof tz === 'string' || tz === null).toBe(true);
      if (tz) {
        expect(isValidTimezone(tz)).toBe(true);
      }
    });

    it('does NOT silently persist UTC if device timezone resolution fails', () => {
      const originalIntl = Intl.DateTimeFormat;
      try {
        // Mock Intl to simulate unavailable timezone
        (Intl as any).DateTimeFormat = function () {
          return {
            resolvedOptions: () => ({ timeZone: '' }),
            format: () => '',
          };
        };

        const resolved = resolveDeviceTimezone();
        expect(resolved).toBeNull();
        expect(resolved).not.toBe('UTC');
      } finally {
        (Intl as any).DateTimeFormat = originalIntl;
      }
    });

    it('getTodayCalendarDate throws if given an invalid timezone', () => {
      expect(() => getTodayCalendarDate('Invalid/Timezone')).toThrow();
    });

    it('getTodayCalendarDate succeeds with valid timezone', () => {
      const todayManila = getTodayCalendarDate('Asia/Manila');
      expect(isValidCalendarDate(todayManila)).toBe(true);
    });
  });

  describe('display helpers', () => {
    it('formats day display info correctly', () => {
      const display = formatDayDisplay('2026-09-24', '2026-09-24');
      expect(display.dayName).toBe('Thu');
      expect(display.dayNumber).toBe('24');
      expect(display.monthName).toBe('Sep');
      expect(display.fullDate).toBe('Thursday, September 24, 2026');
      expect(display.isToday).toBe(true);
    });

    it('formats slot labels into quiet-luxury copy', () => {
      expect(formatSlotLabel('all_day')).toBe('All Day');
      expect(formatSlotLabel('day')).toBe('Daytime');
      expect(formatSlotLabel('evening')).toBe('Evening');
      expect(formatSlotLabel('workout')).toBe('Workout');
    });
  });
});
