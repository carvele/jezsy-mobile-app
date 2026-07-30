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

// Day label for chat date separators. Compares calendar days rather than
// elapsed hours, so a message sent at 11pm reads "Yesterday" at 1am and not
// "Today".
export function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: daysAgo > 1 && daysAgo < 7 ? 'long' : undefined,
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
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
