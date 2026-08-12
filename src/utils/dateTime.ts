export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function formatTimeValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}:00`;
}

// Philippine Standard Time is a fixed UTC+8 with no DST, so the offset can be
// applied arithmetically instead of relying on Intl timezone data in Hermes.
const STORE_UTC_OFFSET_MINUTES = 8 * 60;

// reservations.appointment_time is timestamptz, shared with the admin dashboard.
// Normalise whatever comes back to the "HH:MM:SS" wall clock the UI works in.
export function toStoreTimeValue(value: string | null | undefined): string | null {
  if (!value) return null;

  const plain = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (plain) {
    return `${plain[1].padStart(2, '0')}:${plain[2]}:${plain[3] ?? '00'}`;
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;

  const shifted = new Date(parsed.getTime() + STORE_UTC_OFFSET_MINUTES * 60 * 1000);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');

  return `${hours}:${minutes}:00`;
}

// Same reasoning as toStoreTimeValue above: PST has no DST, so the offset is
// applied arithmetically rather than depending on Intl timezone data.
//
// Returns a Date shifted so its UTC getters (getUTCFullYear/getUTCMonth/
// getUTCDate/getUTCDay) read as the Asia/Manila wall clock for the given
// instant. Never call the *local* getters on the result -- that would
// reapply the device's own offset on top of this one.
function toManilaWallClock(date: Date): Date {
  return new Date(date.getTime() + STORE_UTC_OFFSET_MINUTES * 60 * 1000);
}

// A reservation date is a calendar day, not a precise instant, so this
// collapses to Manila midnight of that day -- stable to compare/format via
// UTC getters no matter what timezone the device itself is set to. Without
// this, generateManilaDates()/the date strip below anchored "today" to the
// device's local calendar day: a customer whose phone is set to a
// non-Philippine timezone could see a "today" one calendar day off from what
// the boutique's store_hours means by today, or a day-of-week that silently
// disagreed with the server's own Asia/Manila-anchored checks.
export function manilaCalendarDay(date: Date): Date {
  const m = toManilaWallClock(date);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()));
}

/** "YYYY-MM-DD" for the Asia/Manila calendar day containing this instant. */
export function formatManilaDate(date: Date): string {
  const d = manilaCalendarDay(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 0 (Sun) - 6 (Sat) for the Asia/Manila calendar day containing this instant. */
export function manilaDayOfWeek(date: Date): number {
  return manilaCalendarDay(date).getUTCDay();
}

/** True when both instants fall on the same Asia/Manila calendar day. */
export function isSameManilaDay(a: Date, b: Date): boolean {
  return manilaCalendarDay(a).getTime() === manilaCalendarDay(b).getTime();
}

const MANILA_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short weekday label ("Mon") for the Asia/Manila calendar day. */
export function manilaWeekdayLabel(date: Date): string {
  return MANILA_WEEKDAY_LABELS[manilaDayOfWeek(date)];
}

/** The Asia/Manila calendar-day number (1-31), for display. */
export function manilaDayNumber(date: Date): number {
  return manilaCalendarDay(date).getUTCDate();
}

/**
 * The next `count` Asia/Manila calendar days starting today, as Date objects
 * anchored to Manila midnight -- read them with the manila*() helpers above,
 * not the local Date getters.
 *
 * Single source of truth for the reservation and reschedule date strips,
 * which used to be two independently hand-rolled copies (reserve/[id].tsx
 * and reservations/[id].tsx) both keyed off the device's local "today"
 * rather than the boutique's -- exactly the "rules copied instead of
 * shared" drift this codebase has already been bitten by elsewhere.
 */
export function generateManilaDates(count: number): Date[] {
  const today = manilaCalendarDay(new Date());
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + i)));
  }
  return dates;
}

export function isSameCalendarDay(a: string, b: string): boolean {
  const dateA = new Date(a);
  const dateB = new Date(b);
  if (Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) return false;

  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

// A separator starts a new group when the calendar day changes or when more
// than an hour has passed, which is roughly how Messenger breaks a thread up.
// Without the gap rule a long same-day conversation gets one label at the very
// top and nothing after it.
const GROUP_GAP_MS = 60 * 60 * 1000;

export function shouldStartMessageGroup(
  previousIso: string | null | undefined,
  iso: string,
): boolean {
  if (!previousIso) return true;
  if (!isSameCalendarDay(previousIso, iso)) return true;

  const previous = new Date(previousIso).getTime();
  const current = new Date(iso).getTime();
  if (Number.isNaN(previous) || Number.isNaN(current)) return true;

  return current - previous > GROUP_GAP_MS;
}

// Separator label: time alone for today, "WED AT 10:43 AM" within the past
// week, "JUL 22 AT 10:43 AM" beyond it. Calendar days rather than elapsed hours
// decide which, so an 11pm message reads as yesterday at 1am rather than today.
//
// The time comes from toLocaleTimeString rather than a hand-built 24h string, so
// it matches formatTimeLabel and the device's own 12/24-hour setting.
export function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `YESTERDAY AT ${time}`;

  if (daysAgo > 1 && daysAgo < 7) {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
    return `${weekday.toUpperCase()} AT ${time}`;
  }

  const datePart = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });

  return `${datePart.toUpperCase()} AT ${time}`;
}

export function formatTimeLabel(time: string | null | undefined): string {
  if (!time) return 'N/A';

  const normalised = toStoreTimeValue(time);
  if (!normalised) return time;

  const match = normalised.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return time;

  const hours24 = Number(match[1]);
  const minutes = match[2];
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;

  return `${hours12}:${minutes} ${period}`;
}
