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
  'Active',
  'Ready',
  'Completed',
  'Cancelled',
] as const;

/** Filter buckets, in the order they appear in the tab row. */
export const STATUS_FILTERS = [
  'all',
  'toPay',
  'preparing',
  'ready',
  'completed',
  'returnRefund',
  'cancelled',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Stored status to bucket. 'To Pickup' and 'Active' are legacy
 * pre-rename values the dashboard still reconciles, so they are mapped to
 * 'ready' / 'completed' rather than dropped.
 */
const BUCKET: Record<string, Exclude<StatusFilter, 'all' | 'returnRefund'>> = {
  confirmed: 'toPay',
  approved: 'toPay',
  'to pay': 'toPay',
  preparing: 'preparing',
  'to pickup': 'ready',
  active: 'completed',
  ready: 'ready',
  completed: 'completed',
  cancelled: 'cancelled',
};

/**
 * Unknown/null statuses fall into 'toPay' -- matching the admin dashboard's
 * own null-status fallback -- so a malformed row is never unreachable
 * instead of crashing the screen.
 */
export function statusBucket(status: string | null): Exclude<StatusFilter, 'all' | 'returnRefund'> {
  return BUCKET[(status || '').trim().toLowerCase()] ?? 'toPay';
}

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  toPay: 'To pay',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  returnRefund: 'Return / Refund',
  cancelled: 'Cancelled',
};

export const filterLabel = (filter: StatusFilter): string => FILTER_LABEL[filter];

const BADGE_LABEL: Record<Exclude<StatusFilter, 'all' | 'returnRefund'>, string> = {
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

export type CustomerDisplayBucket =
  | 'toPay'
  | 'paymentUnderReview'
  | 'paymentReceived'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'returnRefund'
  | 'cancelled';

export type CustomerBadgeColorType =
  | 'toPay'
  | 'paymentUnderReview'
  | 'paymentReceived'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface CustomerReservationDisplayInput {
  status: string | null;
  payment_status?: string | null;
  countdown?: boolean | null;
  payment_due_at?: string | null;
  refund_request_status?: string | null;
}

export interface CustomerReservationDisplayState {
  label: string;
  bucket: CustomerDisplayBucket;
  filterBucket: Exclude<StatusFilter, 'all' | 'returnRefund'>;
  badgeColorType: CustomerBadgeColorType;
  showCountdown: boolean;
  showToPayAction: boolean;
}

/**
 * Canonical customer-facing presentation helper.
 *
 * Reconciles status, payment_status, and countdown so customer presentations
 * never show contradictory UI (e.g. "To pay" or a ticking payment deadline
 * on a reservation that has already settled or is under review).
 *
 * Priority order fails safely:
 * 1. Cancelled / Refunded / Refund Required / Refund Under Review
 * 2. Completed
 * 3. Preparing / Ready / To Pickup
 * 4. Paid while backend status still To Pay -> 'Payment Received'
 * 5. Receipt submitted / under review -> 'Payment Under Review'
 * 6. Genuine unpaid To Pay -> 'To pay'
 */
export function getCustomerReservationDisplayState(
  reservation: CustomerReservationDisplayInput
): CustomerReservationDisplayState {
  const rawStatus = (reservation.status || '').trim().toLowerCase();
  const paymentStatus = (reservation.payment_status || '').trim().toLowerCase();
  const refundReqStatus = (reservation.refund_request_status || '').trim().toLowerCase();
  const countdown = reservation.countdown;
  const bucket = statusBucket(reservation.status);

  // 1. Cancelled / Refunded / Refund Required / Refund Under Review
  if (['submitted', 'under_review'].includes(refundReqStatus)) {
    return {
      label: 'Refund Under Review',
      bucket: 'returnRefund',
      filterBucket: 'cancelled',
      badgeColorType: 'paymentUnderReview',
      showCountdown: false,
      showToPayAction: false,
    };
  }
  if (paymentStatus === 'refund required' || refundReqStatus === 'approved') {
    return {
      label: 'Refund in Progress',
      bucket: 'returnRefund',
      filterBucket: 'cancelled',
      badgeColorType: 'cancelled',
      showCountdown: false,
      showToPayAction: false,
    };
  }
  if (paymentStatus === 'refunded') {
    return {
      label: 'Refunded',
      bucket: 'returnRefund',
      filterBucket: 'cancelled',
      badgeColorType: 'refunded',
      showCountdown: false,
      showToPayAction: false,
    };
  }
  if (paymentStatus === 'cancelled' || bucket === 'cancelled' || rawStatus === 'cancelled') {
    return {
      label: 'Cancelled',
      bucket: 'cancelled',
      filterBucket: 'cancelled',
      badgeColorType: 'cancelled',
      showCountdown: false,
      showToPayAction: false,
    };
  }

  // 2. Completed
  if (bucket === 'completed' || rawStatus === 'completed') {
    return {
      label: 'Completed',
      bucket: 'completed',
      filterBucket: 'completed',
      badgeColorType: 'completed',
      showCountdown: false,
      showToPayAction: false,
    };
  }

  // 3. Preparing / Ready / To Pickup
  if (bucket === 'ready') {
    return {
      label: 'Ready to collect',
      bucket: 'ready',
      filterBucket: 'ready',
      badgeColorType: 'ready',
      showCountdown: false,
      showToPayAction: false,
    };
  }
  if (bucket === 'preparing') {
    return {
      label: 'Preparing your item',
      bucket: 'preparing',
      filterBucket: 'preparing',
      badgeColorType: 'preparing',
      showCountdown: false,
      showToPayAction: false,
    };
  }

  // 4. Paid while backend status still To Pay
  if (bucket === 'toPay' && ['paid', 'deposit paid', 'partially paid'].includes(paymentStatus)) {
    return {
      label: 'Payment Received',
      bucket: 'paymentReceived',
      filterBucket: 'toPay',
      badgeColorType: 'paymentReceived',
      showCountdown: false,
      showToPayAction: false,
    };
  }

  // 5. Receipt submitted / under review
  if (bucket === 'toPay' && ['submitted', 'processing'].includes(paymentStatus)) {
    return {
      label: 'Payment Under Review',
      bucket: 'paymentUnderReview',
      filterBucket: 'toPay',
      badgeColorType: 'paymentUnderReview',
      showCountdown: countdown === true && Boolean(reservation.payment_due_at),
      showToPayAction: false,
    };
  }

  // 6. Payment Window Expired
  // If the deadline passed and payment wasn't submitted, it's expired.
  // The backend cron will sweep it shortly, but the frontend state must immediately
  // revoke payment controls to prevent contradictions.
  const isExpired = reservation.payment_due_at ? new Date(reservation.payment_due_at).getTime() < Date.now() : false;
  
  if (isExpired && bucket === 'toPay') {
    return {
      label: 'Expired',
      bucket: 'cancelled',
      filterBucket: 'cancelled',
      badgeColorType: 'cancelled',
      showCountdown: false,
      showToPayAction: false,
    };
  }

  // 7. Genuine unpaid To Pay
  return {
    label: 'To pay',
    bucket: 'toPay',
    filterBucket: 'toPay',
    badgeColorType: 'toPay',
    showCountdown: countdown !== false && Boolean(reservation.payment_due_at),
    showToPayAction: true,
  };
}

export type ReservationCardAction =
  | 'toPay'
  | 'cancelReservation'
  | 'returnRefund'
  | 'rate'
  | 'buyAgain'
  | 'viewRefund';

export interface ReservationActionInput {
  status: string | null;
  payment_status?: string | null;
  countdown?: boolean | null;
  payment_due_at?: string | null;
  completed_at?: string | null;
  date?: string | null;
  reviewed?: boolean;
  hasUnratedItems?: boolean;
  isFullyRated?: boolean;
  refund_request_status?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Checks whether a completed reservation is within the standard return request window.
 * Authoritative anchor is `completed_at`, with fallback to reservation `date` for legacy rows.
 */
export function isReturnEligible(
  reservation: { completed_at?: string | null; date?: string | null },
  windowDays = 7,
  referenceTime = Date.now()
): boolean {
  const anchorStr = reservation.completed_at || reservation.date;
  if (!anchorStr) return false;
  const anchorDate = new Date(anchorStr);
  if (Number.isNaN(anchorDate.getTime())) return false;

  const elapsedMs = referenceTime - anchorDate.getTime();
  if (elapsedMs < 0) return true; // Clock drift or future completion
  return elapsedMs <= windowDays * DAY_MS;
}

/**
 * Resolves customer-facing action buttons for a reservation card.
 *
 * Rules:
 * - Active awaiting payment -> ['toPay', 'cancelReservation']
 * - Active holds in progress (paid, under review, preparing, ready) -> []
 * - Completed + within return window + unrated -> ['returnRefund', 'rate']
 * - Completed + within return window + rated -> ['returnRefund']
 * - Completed + return window expired + unrated -> ['buyAgain', 'rate']
 * - Completed + return window expired + rated -> ['buyAgain']
 * - Return/refund request under review -> ['viewRefund'] (+ 'rate' if hasUnratedItems)
 * - Refund approved / liability required -> ['viewRefund']
 * - Refunded -> ['buyAgain']
 * - Cancelled -> []
 */
export function getReservationCardActions(
  reservation: ReservationActionInput,
  options: { windowDays?: number; referenceTime?: number } = {}
): ReservationCardAction[] {
  const displayState = getCustomerReservationDisplayState(reservation);
  const paymentStatus = (reservation.payment_status || '').toLowerCase().trim();
  const requestStatus = (reservation.refund_request_status || '').toLowerCase().trim();

  // Rate capability: if hasUnratedItems is provided, use it; otherwise fallback to !reviewed / !isFullyRated
  const canRate = reservation.hasUnratedItems !== undefined
    ? reservation.hasUnratedItems
    : (reservation.isFullyRated !== undefined ? !reservation.isFullyRated : !reservation.reviewed);

  // 1. Active return/refund request under operational review
  if (['submitted', 'under_review'].includes(requestStatus)) {
    const actions: ReservationCardAction[] = ['viewRefund'];
    if (canRate) actions.push('rate');
    return actions;
  }

  // 2. Approved refund liability / Refund in progress
  if (paymentStatus === 'refund required' || requestStatus === 'approved') {
    return ['viewRefund'];
  }

  // 3. Refund completed
  if (paymentStatus === 'refunded' || requestStatus === 'refunded') {
    return ['buyAgain'];
  }

  // 4. Unpaid To Pay: can pay or cancel
  if (displayState.showToPayAction) {
    return ['toPay', 'cancelReservation'];
  }

  // 5. Active holds in progress (paid, under review, preparing, ready)
  if (
    displayState.bucket === 'toPay' ||
    displayState.bucket === 'paymentUnderReview' ||
    displayState.bucket === 'paymentReceived' ||
    displayState.bucket === 'preparing' ||
    displayState.bucket === 'ready'
  ) {
    return [];
  }

  // 6. Completed reservation
  if (displayState.bucket === 'completed' || statusBucket(reservation.status) === 'completed') {
    const eligible = isReturnEligible(
      { completed_at: reservation.completed_at, date: reservation.date },
      options.windowDays ?? 7,
      options.referenceTime ?? Date.now()
    );

    const actions: ReservationCardAction[] = [];
    if (eligible) {
      actions.push('returnRefund');
    } else {
      actions.push('buyAgain');
    }

    if (canRate) {
      actions.push('rate');
    }

    return actions;
  }

  // Cancelled or unknown
  return [];
}
