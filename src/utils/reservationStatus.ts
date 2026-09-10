/**
 * Reservation status, as the customer sees it.
 *
 * The admin dashboard has its own copy of this vocabulary
 * (admin-dashboard/src/utils/reservationStatus.js). The two must agree, and
 * for a while they did not: `reservations.status` is free text with no CHECK
 * constraint, so nothing stopped the two codebases drifting apart.
 *
 * Two things caused the drift, and both are handled here.
 *
 * Confirmed and Approved are legacy aliases for the active payment window.
 * New reservations enter To Pay immediately without administrator approval.
 *
 * Second, `To Pickup` -- written when staff mark a reservation paid -- matched
 * no filter tab here at all, so a customer whose item was sitting ready for
 * collection could only find it under "All".
 *
 * Statuses are compared case-insensitively -- the dashboard writes title
 * case, and older rows are inconsistent.
 */

/**
 * Every status either side writes, in lifecycle order. 'Pending' and
 * 'Request Approval' are retired (dropped from the reservations_status_check
 * constraint in 20260911110000) -- no live writer produced either, and their
 * filter tab and bucket were dropped along with them; a null/unknown status
 * now falls into 'toPay' (see statusBucket) rather than a dead-end tab.
 */
export const RESERVATION_STATUSES = [
  'Confirmed',
  'Approved',
  'To Pay',
  'Preparing',
  'To Pickup',
  'Fitting',
  'Active',
  'Ready',
  'Completed',
  'Cancelled',
] as const;

/** Filter buckets, in the order they appear in the tab row. */
export const STATUS_FILTERS = ['all', 'toPay', 'preparing', 'ready', 'completed', 'cancelled'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Stored status to bucket. 'To Pickup', 'Fitting' and 'Active' are legacy
 * pre-rename values the dashboard still reconciles, so they are mapped to
 * 'ready' rather than dropped.
 */
const BUCKET: Record<string, Exclude<StatusFilter, 'all'>> = {
  confirmed: 'toPay',
  approved: 'toPay',
  'to pay': 'toPay',
  preparing: 'preparing',
  'to pickup': 'ready',
  fitting: 'ready',
  active: 'ready',
  ready: 'ready',
  completed: 'completed',
  cancelled: 'cancelled',
};

/**
 * Unknown/null statuses fall into 'toPay' -- matching the admin dashboard's
 * own null-status fallback -- so a malformed row is never unreachable
 * instead of crashing the screen.
 */
export function statusBucket(status: string | null): Exclude<StatusFilter, 'all'> {
  return BUCKET[(status || '').trim().toLowerCase()] ?? 'toPay';
}

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  toPay: 'To pay',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const filterLabel = (filter: StatusFilter): string => FILTER_LABEL[filter];

const BADGE_LABEL: Record<Exclude<StatusFilter, 'all'>, string> = {
  toPay: 'To pay',
  preparing: 'Preparing your item',
  ready: 'Ready to collect',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * What the badge says. Derived from the bucket rather than the stored string so
 * a customer never reads a staff-facing value -- and so 'Confirmed' reads as
 * "To pay", matching what the shop sees on the same reservation.
 */
export const statusLabel = (status: string | null): string => BADGE_LABEL[statusBucket(status)];

/** Payment is owed while an automatic reservation hold is active. */
export const isAwaitingPayment = (status: string | null): boolean =>
  statusBucket(status) === 'toPay';

/**
 * Reschedulable states, matching what request_reschedule actually accepts
 * server-side (confirmed/approved/to pay/preparing/to pickup/fitting/ready)
 * -- kept in sync so this never offers a button the server then rejects.
 */
export const canReschedule = (status: string | null): boolean =>
  ['toPay', 'preparing', 'ready'].includes(statusBucket(status));

const HOUR_MS = 60 * 60 * 1000;

/**
 * Compact payment-deadline label for the reservation list card -- the detail
 * screen already has its own full-sentence countdown, but the list showed no
 * urgency at all, so every "To pay" card looked the same whether the window
 * closes in 20 hours or 20 minutes. Mirrors admin-dashboard's own
 * formatPaymentDeadline so staff and customer read the same urgency language.
 */
export const formatPaymentDeadline = (
  dueAt: string | null
): { label: string; urgent: boolean } | null => {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const remaining = due.getTime() - Date.now();
  if (remaining <= 0) return { label: 'Overdue', urgent: true };

  const minutes = Math.ceil(remaining / 60000);
  if (minutes < 60) return { label: `${minutes}m left`, urgent: true };

  const hours = Math.ceil(remaining / HOUR_MS);
  return { label: `${hours}h left`, urgent: remaining < HOUR_MS };
};
