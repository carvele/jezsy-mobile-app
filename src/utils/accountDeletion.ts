import { supabase } from '../lib/supabase';
import { statusBucket } from './reservationStatus';

export interface UnsettledBalanceResult {
  hasUnsettledBalance: boolean;
  totalBalance: number;
  unsettledCount: number;
}

/**
  * Calculate any outstanding balance owed by the user across active/unsettled reservations.
  */
export async function getUserUnsettledBalance(userId: string): Promise<UnsettledBalanceResult> {
  const { data: reservations, error } = await supabase
    .from('reservations')
    .select('id, status, payment_status, payment_type, rental_price, deposit, balance_settled_at, deleted')
    .eq('customer_id', userId)
    .eq('deleted', false);

  if (error) {
    console.error('Error checking user balance:', error);
    throw error;
  }

  if (!reservations || reservations.length === 0) {
    return { hasUnsettledBalance: false, totalBalance: 0, unsettledCount: 0 };
  }

  let totalBalance = 0;
  let unsettledCount = 0;

  for (const r of reservations) {
    const bucket = statusBucket(r.status);
    if (bucket === 'cancelled') continue;

    // If balance has been officially settled by staff, 0 outstanding for this row
    if (r.balance_settled_at) continue;

    const rentalPrice = Number(r.rental_price || 0);
    const deposit = Number(r.deposit || 0);
    const paymentStatus = (r.payment_status || '').toLowerCase();
    const paymentType = (r.payment_type || '').toLowerCase();

    let rowBalance = 0;

    if (bucket === 'completed') {
      if (paymentType === 'deposit' && paymentStatus === 'paid') {
        rowBalance = Math.max(0, rentalPrice - deposit);
      }
    } else if (bucket === 'toPay' || paymentStatus === 'pending') {
      rowBalance = paymentType === 'deposit' ? (deposit > 0 ? deposit : rentalPrice / 2) : rentalPrice;
    } else {
      if (paymentType === 'deposit') {
        rowBalance = Math.max(0, rentalPrice - deposit);
      } else if (paymentStatus !== 'paid') {
        rowBalance = rentalPrice;
      }
    }

    if (rowBalance > 0) {
      totalBalance += rowBalance;
      unsettledCount += 1;
    }
  }

  totalBalance = Math.round(totalBalance * 100) / 100;

  return {
    hasUnsettledBalance: totalBalance > 0,
    totalBalance,
    unsettledCount,
  };
}

export type DeletionRequestStatus = 'pending' | 'auth_revocation_pending';

export async function getPendingDeletionRequest(
  userId: string,
): Promise<{ id: string; status: DeletionRequestStatus } | null> {
  const { data } = await supabase
    .from('account_deletion_requests')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['pending', 'auth_revocation_pending'])
    .maybeSingle();
  if (!data || (data.status !== 'pending' && data.status !== 'auth_revocation_pending')) return null;
  return { id: data.id, status: data.status as DeletionRequestStatus };
}

export async function submitDeletionRequest(userId: string, reason?: string): Promise<string> {
  const balanceCheck = await getUserUnsettledBalance(userId);
  if (balanceCheck.hasUnsettledBalance) {
    throw new Error(
      `You cannot request account deletion while you have an unsettled balance of ₱${balanceCheck.totalBalance.toFixed(
        2
      )}. Please settle all remaining balances before requesting account deletion.`
    );
  }

  const { data, error } = await supabase
    .rpc('request_account_deletion', { _reason: reason || 'Requested by customer' });
  if (error) throw error;
  return data;
}

export async function withdrawDeletionRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('account_deletion_requests')
    .delete()
    .eq('id', requestId);
  if (error) throw error;
}
