import { supabase } from '@/src/lib/supabase';
import { OffsetPageResult } from '@/src/types/pagination';
import { Database } from '@/src/types/database.types';
import { StatusFilter, statusBucket } from '@/src/utils/reservationStatus';
import { CreateReservationInput, ReservationResult } from '@/src/types/dto/reservation';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';

export type CustomerReservation = Database['public']['Tables']['reservations']['Row'] & {
  reservation_items?: { id?: string; product_id?: string; count?: number }[] | null;
  return_refund_requests?: {
    id: string;
    status: string;
    reason_category: string;
    details: string | null;
    photo_path: string | null;
    created_at: string;
    reviewed_at: string | null;
    resolution_notes: string | null;
  }[] | null;
  refund_request_status?: string | null;
  refund_request?: {
    id: string;
    status: string;
    reason_category: string;
    details: string | null;
    photo_path: string | null;
    created_at: string;
    reviewed_at: string | null;
    resolution_notes: string | null;
  } | null;
  totalRateableItems?: number;
  ratedItemCount?: number;
  isFullyRated?: boolean;
  hasUnratedItems?: boolean;
  reviewed?: boolean;
};

const STATUS_BUCKET_MAP: Record<Exclude<StatusFilter, 'all' | 'returnRefund'>, string[]> = {
  toPay: ['confirmed', 'approved', 'to pay', 'Confirmed', 'Approved', 'To Pay'],
  preparing: ['preparing', 'Preparing'],
  ready: ['to pickup', 'active', 'ready', 'To Pickup', 'Active', 'Ready'],
  unclaimed: ['unclaimed', 'Unclaimed'],
  completed: ['completed', 'Completed'],
  cancelled: ['cancelled', 'Cancelled'],
};

export async function getMyReservationsPage(
  userId: string,
  offset = 0,
  filter: StatusFilter = 'all',
  limit = 20
): Promise<OffsetPageResult<CustomerReservation>> {
  let refundResIds: string[] = [];
  if (filter === 'returnRefund') {
    try {
      const { data: reqs } = await supabase
        .from('return_refund_requests' as any)
        .select('reservation_id')
        .eq('customer_id', userId);
      if (reqs && reqs.length > 0) {
        refundResIds = Array.from(new Set(reqs.map((r: any) => r.reservation_id).filter(Boolean)));
      }
    } catch {
      // Graceful fallback if table is not yet migrated
    }
  }

  let query = supabase
    .from('reservations')
    .select('*, reservation_items(id, product_id)')
    .eq('customer_id', userId)
    .eq('deleted', false);

  if (filter === 'returnRefund') {
    if (refundResIds.length > 0) {
      query = query.or(
        `payment_status.in.("Refund Required","Refunded","refund required","refunded"),id.in.(${refundResIds.join(',')})`
      );
    } else {
      query = query.in('payment_status', ['Refund Required', 'Refunded', 'refund required', 'refunded']);
    }
  } else if (filter !== 'all') {
    const rawStatuses = STATUS_BUCKET_MAP[filter];
    if (rawStatuses && rawStatuses.length > 0) {
      query = query.in('status', rawStatuses);
    }
  }

  query = query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  const { data, error } = await query;
  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const items = raw.slice(0, limit) as CustomerReservation[];

  const resIds = items.map((r) => r.id);

  // 1. Batch load return_refund_requests
  if (resIds.length > 0) {
    try {
      const { data: refundReqs } = await supabase
        .from('return_refund_requests' as any)
        .select('id, reservation_id, status, reason_category, details, photo_path, created_at, reviewed_at, resolution_notes')
        .in('reservation_id', resIds)
        .order('created_at', { ascending: false });

      if (refundReqs && refundReqs.length > 0) {
        const activeRequestsByResId = new Map<string, any>();
        for (const req of refundReqs as any[]) {
          if (!activeRequestsByResId.has(req.reservation_id)) {
            activeRequestsByResId.set(req.reservation_id, req);
          }
        }
        items.forEach((reservation) => {
          const req = activeRequestsByResId.get(reservation.id);
          if (req) {
            reservation.refund_request = req;
            reservation.refund_request_status = req.status;
          }
        });
      }
    } catch {
      // Graceful fallback
    }
  }

  // 2. Batch load review completion status across all items
  const itemIds = items.flatMap((r) =>
    (r.reservation_items || []).map((i: any) => i.id).filter(Boolean)
  );

  if (itemIds.length > 0) {
    try {
      const { data: reviews } = await supabase
        .from('reviews')
        .select('reservation_item_id')
        .in('reservation_item_id', itemIds);

      const reviewedItemIds = new Set((reviews || []).map((rev) => rev.reservation_item_id));

      items.forEach((reservation) => {
        const resItems = reservation.reservation_items || [];
        const totalRateable = resItems.length;
        const ratedCount = resItems.filter((i: any) => reviewedItemIds.has(i.id)).length;
        reservation.totalRateableItems = totalRateable;
        reservation.ratedItemCount = ratedCount;
        reservation.isFullyRated = totalRateable > 0 && ratedCount === totalRateable;
        reservation.hasUnratedItems = totalRateable > 0 ? ratedCount < totalRateable : false;
        reservation.reviewed = reservation.isFullyRated;
      });
    } catch {
      // Graceful fallback
    }
  }

  return {
    items,
    hasMore,
    nextOffset: offset + items.length,
  };
}

export async function getMyReservationStatusCounts(
  userId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('reservations')
    .select('id, status, payment_status')
    .eq('customer_id', userId)
    .eq('deleted', false);

  if (error) throw error;

  const counts: Record<string, number> = {
    all: (data || []).length,
    toPay: 0,
    preparing: 0,
    ready: 0,
    unclaimed: 0,
    completed: 0,
    returnRefund: 0,
    cancelled: 0,
  };

  const refundResIds = new Set<string>();
  try {
    const { data: reqs } = await supabase
      .from('return_refund_requests' as any)
      .select('reservation_id')
      .eq('customer_id', userId);
    if (reqs) {
      reqs.forEach((r: any) => {
        if (r.reservation_id) refundResIds.add(r.reservation_id);
      });
    }
  } catch {
    // Graceful fallback
  }

  (data || []).forEach((r) => {
    const pStatus = (r.payment_status || '').toLowerCase().trim();
    if (pStatus === 'refund required' || pStatus === 'refunded' || refundResIds.has(r.id)) {
      counts.returnRefund += 1;
    }
    const bucket = statusBucket(r.status);
    if (counts[bucket] !== undefined) {
      counts[bucket] += 1;
    }
  });

  return counts;
}

export type UnratedItem = {
  reservationItemId: string;
  reservationId: string;
  displayId: string | null;
  productId: string;
  productName: string;
  imageUrl: string | null;
  size: string | null;
  color: string | null;
  completedDate: string | null;
  createdAt?: string | null;
};

/**
 * Items from Completed reservations the customer hasn't reviewed yet.
 * Keyed per reservation item, so every completed purchase item can be rated.
 */
export async function getMyUnratedItems(userId: string): Promise<UnratedItem[]> {
  const [itemsResult, reviewsResult] = await Promise.all([
    supabase
      .from('reservation_items')
      .select('id, reservation_id, product_id, product_name, image_url, size, color, created_at, reservations!inner(display_id, date, created_at, completed_at, customer_id, status, deleted)')
      .eq('reservations.customer_id', userId)
      .in('reservations.status', ['completed', 'Completed'])
      .eq('reservations.deleted', false),
    supabase
      .from('reviews')
      .select('reservation_item_id, product_id')
      .eq('user_id', userId),
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (reviewsResult.error) throw reviewsResult.error;

  const reviewedItemIds = new Set(
    (reviewsResult.data ?? [])
      .map((r: any) => r.reservation_item_id)
      .filter(Boolean)
  );
  const legacyReviewedProductIds = new Set(
    (reviewsResult.data ?? [])
      .filter((r: any) => !r.reservation_item_id)
      .map((r: any) => r.product_id)
      .filter(Boolean)
  );

  const unrated: UnratedItem[] = [];

  for (const row of (itemsResult.data ?? []) as any[]) {
    // If this specific reservation item was already reviewed, skip it
    if (row.id && reviewedItemIds.has(row.id)) continue;
    // For legacy rows lacking an item id, check legacy reviewed product
    if (!row.id && legacyReviewedProductIds.has(row.product_id)) continue;

    unrated.push({
      reservationItemId: row.id,
      reservationId: row.reservation_id,
      displayId: row.reservations?.display_id ?? null,
      productId: row.product_id,
      productName: row.product_name,
      imageUrl: row.image_url,
      size: row.size,
      color: row.color,
      completedDate: row.reservations?.completed_at ?? row.reservations?.date ?? null,
      createdAt: row.reservations?.created_at ?? row.created_at ?? null,
    });
  }

  unrated.sort((a, b) => {
    const timeB = new Date(b.completedDate || b.createdAt || 0).getTime();
    const timeA = new Date(a.completedDate || a.createdAt || 0).getTime();
    if (timeB !== timeA) return timeB - timeA;
    const createdB = new Date(b.createdAt || 0).getTime();
    const createdA = new Date(a.createdAt || 0).getTime();
    if (createdB !== createdA) return createdB - createdA;
    return (b.displayId || b.reservationId || '').localeCompare(a.displayId || a.reservationId || '');
  });

  return unrated;
}

export interface ReserveParams extends CreateReservationInput {
  idempotencyKey: string;
  customerId?: string | null;
  pickupTermsVersion?: string;
}

/**
 * Creates a reservation idempotently via the create_reservation_multi_idempotent RPC.
 * Normalizes only actual, evidenced database errors without stale string mappings.
 */
export async function reserve(input: ReserveParams): Promise<DomainResult<ReservationResult>> {
  try {
    const { data, error } = await supabase.rpc('create_reservation_multi_idempotent', {
      _idempotency_key: input.idempotencyKey,
      _items: input.items as any,
      _date: input.date as any,
      _appointment_time: input.appointmentTime as any,
      _receipt_path: input.receiptPath ?? undefined,
      _payment_option: input.paymentOption,
      _customer_id: input.customerId ?? undefined,
      _pickup_terms_version: input.pickupTermsVersion ?? undefined,
    });

    if (error) {
      throw error;
    }

    return domainOk(data as ReservationResult);
  } catch (err: any) {
    let code = 'ERR_RESERVATION_FAILED';
    const message: string = err?.message || 'Failed to create reservation';

    if (message.includes('Authentication required')) {
      code = 'ERR_AUTH_REQUIRED';
    } else if (message.includes('idempotency key is required')) {
      code = 'ERR_IDEMPOTENCY_REQUIRED';
    } else if (message.includes('Payment option must be deposit or full')) {
      code = 'ERR_INVALID_PAYMENT_OPTION';
    } else if (message.includes('contain at least one item')) {
      code = 'ERR_EMPTY_RESERVATION';
    } else if (message.includes('access required') || err?.code === '42501') {
      code = 'ERR_FORBIDDEN';
    } else if (message.includes('different reservation details')) {
      code = 'ERR_IDEMPOTENCY_CONFLICT';
    }

    const domainError = new DomainError({
      code,
      message,
      domain: 'reservation',
      context: {
        operation: 'reserve',
        idempotencyKey: input.idempotencyKey,
        itemCount: input.items?.length,
      },
      cause: err,
    });

    errorReporting.capture(domainError, {
      domain: 'reservation',
      operation: 'reserve',
    });

    return domainFail(domainError);
  }
}

/**
 * Self-service customer cancellation for unpaid reservations awaiting payment.
 */
export async function cancelCustomerReservation(
  reservationId: string,
  reason = 'Cancelled by customer'
): Promise<DomainResult<{ reservation_id: string; already_cancelled?: boolean }>> {
  try {
    const { data, error } = await supabase.rpc('cancel_customer_reservation', {
      _reservation_id: reservationId,
      _reason: reason,
    });
    if (error) {
      const domainError = new DomainError({
        code: 'CANCEL_RESERVATION_FAILED',
        message: error.message,
        domain: 'reservation',
        context: {
          operation: 'cancelCustomerReservation',
          reservationId,
        },
        cause: error,
      });
      errorReporting.capture(domainError, {
        domain: 'reservation',
        operation: 'cancelCustomerReservation',
      });
      return domainFail(domainError);
    }
    return domainOk(data as { reservation_id: string; already_cancelled?: boolean });
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'CANCEL_RESERVATION_EXCEPTION',
      message: err?.message || 'Failed to cancel reservation.',
      domain: 'reservation',
      context: {
        operation: 'cancelCustomerReservation',
        reservationId,
      },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'reservation',
      operation: 'cancelCustomerReservation',
    });
    return domainFail(domainError);
  }
}

/**
 * Submits a customer return or refund request for admin review.
 */
export async function requestCustomerRefund(
  reservationId: string,
  reasonCategory: string,
  details?: string,
  photoPath?: string
): Promise<DomainResult<{ request_id: string; status: string; submitted_at?: string }>> {
  try {
    const { data, error } = await supabase.rpc('request_customer_refund', {
      _reservation_id: reservationId,
      _reason_category: reasonCategory,
      _details: details || undefined,
      _photo_path: photoPath || undefined,
    });
    if (error) {
      const domainError = new DomainError({
        code: 'REQUEST_REFUND_FAILED',
        message: error.message,
        domain: 'reservation',
        context: {
          operation: 'requestCustomerRefund',
          reservationId,
          reasonCategory,
        },
        cause: error,
      });
      errorReporting.capture(domainError, {
        domain: 'reservation',
        operation: 'requestCustomerRefund',
      });
      return domainFail(domainError);
    }
    return domainOk(data as { request_id: string; status: string; submitted_at?: string });
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'REQUEST_REFUND_EXCEPTION',
      message: err?.message || 'Failed to submit refund request.',
      domain: 'reservation',
      context: {
        operation: 'requestCustomerRefund',
        reservationId,
      },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'reservation',
      operation: 'requestCustomerRefund',
    });
    return domainFail(domainError);
  }
}

/**
 * Fetches the active return/refund request for a reservation.
 */
export async function getActiveRefundRequest(reservationId: string) {
  try {
    const { data, error } = await supabase
      .from('return_refund_requests')
      .select('*')
      .eq('reservation_id', reservationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export type ChangeRequest = Database['public']['Tables']['reservation_change_requests']['Row'];

/** Latest customer change request (any status) for one reservation, or null. */
export async function getLatestChangeRequest(reservationId: string): Promise<ChangeRequest | null> {
  const { data, error } = await supabase
    .from('reservation_change_requests')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function runChangeRequestCommand(
  operation: string,
  call: () => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  reservationId: string
): Promise<DomainResult<{ request_id: string }>> {
  try {
    const { data, error } = await call();
    if (error) {
      const domainError = new DomainError({
        code: 'CHANGE_REQUEST_FAILED',
        message: error.message,
        domain: 'reservation',
        context: { operation, reservationId },
        cause: error,
      });
      errorReporting.capture(domainError, { domain: 'reservation', operation });
      return domainFail(domainError);
    }
    return domainOk(data as { request_id: string });
  } catch (err: any) {
    return domainFail(new DomainError({
      code: 'CHANGE_REQUEST_EXCEPTION',
      message: err?.message || 'Could not send your request.',
      domain: 'reservation',
      context: { operation, reservationId },
      cause: err,
    }));
  }
}

/** Asks the boutique to move a pre-Ready scheduled appointment; nothing moves until staff approve. */
export function requestRescheduleV2(reservationId: string, newDate: string, newTime: string, reason: string) {
  return runChangeRequestCommand('requestRescheduleV2', () => supabase.rpc('request_reschedule_v2', {
    _reservation_id: reservationId,
    _new_date: newDate,
    _new_time: newTime,
    _reason: reason,
  }), reservationId);
}

/**
 * Asks the boutique to cancel a Ready order. Nothing is cancelled or forfeited
 * until staff approve; approval applies the customer-fault forfeiture policy.
 */
export function requestReadyCancellation(reservationId: string, reason: string) {
  return runChangeRequestCommand('requestReadyCancellation', () => supabase.rpc('request_ready_cancellation', {
    _reservation_id: reservationId,
    _reason: reason,
  }), reservationId);
}

export const reservationService = {
  requestPickupExtension,
  getMyReservationsPage,
  getMyReservationStatusCounts,
  getMyUnratedItems,
  reserve,
  cancelCustomerReservation,
  requestRescheduleV2,
  requestReadyCancellation,
  getLatestChangeRequest,
  requestCustomerRefund,
  getActiveRefundRequest,
};

export async function requestPickupExtension(reservationId: string, reason: string): Promise<DomainResult<void>> {
  try {
    const { error } = await supabase.rpc('request_pickup_extension', { _reservation_id: reservationId, _reason: reason });
    if (error) return domainFail({ message: error.message, code: error.code } as any);
    return domainOk(undefined);
  } catch (err: any) {
    return domainFail(err);
  }
}
