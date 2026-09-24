import { PlannerSlot } from '../types/planner';

/**
 * Pure calendar date arithmetic and timezone resolution for the Outfit Planner.
 * Strictly avoids `new Date("YYYY-MM-DD")` and `toISOString().slice(0, 10)` to prevent
 * timezone offset shifts across local/UTC boundaries.
 */

export interface CalendarDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface DayDisplayInfo {
  dayName: string; // e.g. 'Mon'
  dayNumber: string; // e.g. '24'
  monthName: string; // e.g. 'Sep'
  fullDate: string; // e.g. 'Monday, September 24, 2026'
  isToday: boolean;
}

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * Determines whether a year is a leap year in the Gregorian calendar.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns number of days in a given 1-based month.
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

/**
 * Formats integer parts into ISO calendar string YYYY-MM-DD.
 */
export function formatCalendarDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses YYYY-MM-DD string into integer components without Date parsing.
 */
export function parseCalendarDate(dateStr: string): CalendarDateParts {
  const parts = (dateStr || '').trim().split('-');
  if (parts.length !== 3) {
    throw new Error(`Invalid calendar date string format: "${dateStr}". Expected YYYY-MM-DD.`);
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > getDaysInMonth(year, month)
  ) {
    throw new Error(`Invalid calendar date values: "${dateStr}".`);
  }

  return { year, month, day };
}

/**
 * Validates whether string is a valid YYYY-MM-DD calendar date.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  try {
    parseCalendarDate(dateStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `dateStr` is strictly before `todayDateStr`. Both are YYYY-MM-DD, which sorts chronologically
 * as plain strings, so no Date object (and no timezone) is involved.
 */
export function isPastCalendarDate(dateStr: string, todayDateStr: string): boolean {
  return isValidCalendarDate(dateStr) && isValidCalendarDate(todayDateStr) && dateStr < todayDateStr;
}

/**
 * Adds or subtracts calendar days using component arithmetic.
 */
export function addCalendarDays(dateStr: string, days: number): string {
  const parts = parseCalendarDate(dateStr);
  let { year, month, day } = parts;

  if (days === 0) return dateStr;

  let remaining = days;

  if (remaining > 0) {
    while (remaining > 0) {
      const daysInCurrentMonth = getDaysInMonth(year, month);
      const availableInMonth = daysInCurrentMonth - day;

      if (remaining <= availableInMonth) {
        day += remaining;
        remaining = 0;
      } else {
        remaining -= availableInMonth + 1;
        day = 1;
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    }
  } else {
    let toSubtract = -remaining;
    while (toSubtract > 0) {
      if (day > toSubtract) {
        day -= toSubtract;
        toSubtract = 0;
      } else {
        toSubtract -= day;
        month -= 1;
        if (month < 1) {
          month = 12;
          year -= 1;
        }
        day = getDaysInMonth(year, month);
      }
    }
  }

  return formatCalendarDate(year, month, day);
}

/**
 * Calculates day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 * using Tomohiko Sakamoto's algorithm.
 */
export function getDayOfWeek(dateStr: string): number {
  const { year, month, day } = parseCalendarDate(dateStr);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = year;
  if (month < 3) {
    y -= 1;
  }
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month - 1] + day) % 7;
}

/**
 * Returns the 7-day Monday–Sunday week dates containing centerDateStr.
 */
export function getWeekDates(centerDateStr: string): string[] {
  parseCalendarDate(centerDateStr);
  const dow = getDayOfWeek(centerDateStr); // 0 = Sun, 1 = Mon ... 6 = Sat
  // Convert so Monday = 0, Tuesday = 1, ..., Sunday = 6
  const mondayOffset = (dow + 6) % 7;
  const mondayStr = addCalendarDays(centerDateStr, -mondayOffset);

  const week: string[] = [];
  for (let i = 0; i < 7; i++) {
    week.push(addCalendarDays(mondayStr, i));
  }
  return week;
}

/**
 * Safely resolves device IANA timezone.
 * Returns null if unavailable or invalid. Never silently falls back to UTC.
 */
export function resolveDeviceTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || typeof tz !== 'string' || tz.trim() === '' || tz === 'undefined') {
      return null;
    }
    // Verify valid IANA name by attempting formatting
    new Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

/**
 * Validates if a timezone string is a valid IANA timezone identifier.
 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string' || timezone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves today's calendar date (YYYY-MM-DD) in the specified timezone.
 * Falls back to device timezone if valid, or throws if no valid timezone can be determined.
 */
export function getTodayCalendarDate(timezone?: string | null): string {
  const targetTz = timezone || resolveDeviceTimezone();
  if (!targetTz || !isValidTimezone(targetTz)) {
    throw new Error('A valid IANA timezone is required to resolve the current calendar date.');
  }

  const d = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(d);
  const yearPart = parts.find((p) => p.type === 'year')?.value;
  const monthPart = parts.find((p) => p.type === 'month')?.value;
  const dayPart = parts.find((p) => p.type === 'day')?.value;

  if (!yearPart || !monthPart || !dayPart) {
    throw new Error(`Failed to extract date components for timezone ${targetTz}`);
  }

  return formatCalendarDate(parseInt(yearPart, 10), parseInt(monthPart, 10), parseInt(dayPart, 10));
}

/**
 * Formats a calendar date string for user-facing display.
 */
export function formatDayDisplay(dateStr: string, todayDateStr?: string): DayDisplayInfo {
  const { year, month, day } = parseCalendarDate(dateStr);
  const dow = getDayOfWeek(dateStr);

  const dayName = DAY_NAMES_SHORT[dow];
  const dayNumber = String(day);
  const monthName = MONTH_NAMES_SHORT[month - 1];
  const fullDay = DAY_NAMES_FULL[dow];
  const fullMonth = MONTH_NAMES_FULL[month - 1];

  return {
    dayName,
    dayNumber,
    monthName,
    fullDate: `${fullDay}, ${fullMonth} ${day}, ${year}`,
    isToday: todayDateStr ? dateStr === todayDateStr : false,
  };
}

/**
 * Formats a planner slot enum into quiet-luxury display copy.
 */
export function formatSlotLabel(slot: PlannerSlot): string {
  switch (slot) {
    case 'all_day':
      return 'All Day';
    case 'day':
      return 'Daytime';
    case 'evening':
      return 'Evening';
    case 'workout':
      return 'Workout';
    default:
      return slot;
  }
}
