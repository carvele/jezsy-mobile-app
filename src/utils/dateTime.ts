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
