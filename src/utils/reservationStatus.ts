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
 * First, the admin stores one value and shows staff another. `Confirmed` is
 * stored when staff approve a reservation, but it means "approved, not yet
 * paid", so the dashboard displays it as "To Pay". This app used to render the
 * stored value raw, telling a customer with a running payment deadline that
 * their reservation was "Confirmed".
 *
 * Second, `To Pickup` -- written when staff mark a reservation paid -- matched
 * no filter tab here at all, so a customer whose item was sitting ready for
 * collection could only find it under "All".
 *
 * Statuses are compared case-insensitively: the create RPC writes 'Pending',
 * the dashboard writes title case, and older rows are inconsistent.
 */

/** Every status either side writes, in lifecycle order. */
export const RESERVATION_STATUSES = [
  'Pending',
  'Request Approval',
  'Confirmed',
  'Approved',
  'To Pay',
  'To Pickup',
  'Fitting',
  'Active',
  'Completed',
  'Cancelled',
] as const;

/** Filter buckets, in the order they appear in the tab row. */
export const STATUS_FILTERS = ['all', 'pending', 'toPay', 'ready', 'completed', 'cancelled'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Stored status to bucket. 'To Pay', 'Fitting' and 'Active' are legacy values
 * the dashboard still reconciles, so they are mapped rather than dropped.
 */
const BUCKET: Record<string, Exclude<StatusFilter, 'all'>> = {
  pending: 'pending',
  'request approval': 'pending',
  confirmed: 'toPay',
  approved: 'toPay',
  'to pay': 'toPay',
  'to pickup': 'ready',
  fitting: 'ready',
  active: 'ready',
  completed: 'completed',
  cancelled: 'cancelled',
};

/** Unknown statuses fall into 'pending' so a reservation is never unreachable. */
export function statusBucket(status: string | null): Exclude<StatusFilter, 'all'> {
  return BUCKET[(status || 'pending').trim().toLowerCase()] ?? 'pending';
}

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  pending: 'Pending',
  toPay: 'To pay',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const filterLabel = (filter: StatusFilter): string => FILTER_LABEL[filter];

const BADGE_LABEL: Record<Exclude<StatusFilter, 'all'>, string> = {
  pending: 'Awaiting approval',
  toPay: 'To pay',
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

/** Payment is owed once staff approve and until it lands. */
export const isAwaitingPayment = (status: string | null): boolean =>
  statusBucket(status) === 'toPay';

/**
 * Reschedulable states, deliberately matching what reschedule_reservation
 * actually accepts -- it raises on anything outside ('pending', 'confirmed').
 *
 * The dashboard's CAN_RESCHEDULE_STATUSES also includes 'To Pickup', so staff
 * can move an appointment in a state the customer cannot. Widening this to
 * 'ready' without also changing the RPC would just offer a button the server
 * then rejects, so the gap is recorded here rather than papered over.
 */
export const canReschedule = (status: string | null): boolean =>
  ['pending', 'toPay', 'ready'].includes(statusBucket(status));
