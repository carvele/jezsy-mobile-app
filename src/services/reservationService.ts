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
};

/**
 * Items from Completed reservations the customer hasn't reviewed yet, one
 * row per distinct product -- a multi-item reservation can be partially
 * rated, so this checks per product, not per reservation.
 */
export async function getMyUnratedItems(userId: string): Promise<UnratedItem[]> {
  const [itemsResult, reviewsResult] = await Promise.all([
    supabase
      .from('reservation_items')
      .select('id, reservation_id, product_id, product_name, image_url, size, color, reservations!inner(display_id, date, customer_id, status, deleted)')
      .eq('reservations.customer_id', userId)
      .eq('reservations.status', 'Completed')
      .eq('reservations.deleted', false),
    supabase
      .from('reviews')
      .select('product_id')
      .eq('user_id', userId),
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (reviewsResult.error) throw reviewsResult.error;

  const reviewedProductIds = new Set((reviewsResult.data ?? []).map((r) => r.product_id));
  const seenProductIds = new Set<string>();
  const unrated: UnratedItem[] = [];

  for (const row of (itemsResult.data ?? []) as any[]) {
    if (reviewedProductIds.has(row.product_id) || seenProductIds.has(row.product_id)) continue;
    seenProductIds.add(row.product_id);
    unrated.push({
      reservationItemId: row.id,
      reservationId: row.reservation_id,
      displayId: row.reservations?.display_id ?? null,
      productId: row.product_id,
      productName: row.product_name,
      imageUrl: row.image_url,
      size: row.size,
      color: row.color,
      completedDate: row.reservations?.date ?? null,
    });
  }

  return unrated;
}

export interface ReserveParams extends CreateReservationInput {
  idempotencyKey: string;
  customerId?: string | null;
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
      _date: input.date,
      _appointment_time: input.appointmentTime,
      _receipt_path: input.receiptPath ?? undefined,
      _payment_option: input.paymentOption,
      _customer_id: input.customerId ?? undefined,
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
    const { data, error } = await (supabase.rpc as any)('cancel_customer_reservation', {
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
    const { data, error } = await (supabase.rpc as any)('request_customer_refund', {
      _reservation_id: reservationId,
      _reason_category: reasonCategory,
      _details: details || null,
      _photo_path: photoPath || null,
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
      .from('return_refund_requests' as any)
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

export const reservationService = {
  getMyReservationsPage,
  getMyReservationStatusCounts,
  getMyUnratedItems,
  reserve,
  cancelCustomerReservation,
  requestCustomerRefund,
  getActiveRefundRequest,
};
