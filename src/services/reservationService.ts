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
  reservation_items?: { count: number }[] | null;
};

const STATUS_BUCKET_MAP: Record<Exclude<StatusFilter, 'all'>, string[]> = {
  toPay: ['confirmed', 'approved', 'to pay', 'Confirmed', 'Approved', 'To Pay'],
  preparing: ['preparing', 'Preparing'],
  ready: ['to pickup', 'fitting', 'active', 'ready', 'To Pickup', 'Fitting', 'Active', 'Ready'],
  completed: ['completed', 'Completed'],
  cancelled: ['cancelled', 'Cancelled'],
};

export async function getMyReservationsPage(
  userId: string,
  offset = 0,
  filter: StatusFilter = 'all',
  limit = 20
): Promise<OffsetPageResult<CustomerReservation>> {
  let query = supabase
    .from('reservations')
    .select('*, reservation_items(count)')
    .eq('customer_id', userId)
    .eq('deleted', false);

  if (filter !== 'all') {
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
    .select('status')
    .eq('customer_id', userId)
    .eq('deleted', false);

  if (error) throw error;

  const counts: Record<string, number> = {
    all: (data || []).length,
    toPay: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
    cancelled: 0,
  };

  (data || []).forEach((r) => {
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

export const reservationService = {
  getMyReservationsPage,
  getMyReservationStatusCounts,
  getMyUnratedItems,
  reserve,
};
