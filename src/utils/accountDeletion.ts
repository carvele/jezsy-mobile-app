import { supabase } from '../lib/supabase';

/**
 * Shared query/mutation surface for account_deletion_requests, used by both
 * the account-settings screen (file/withdraw) and the app-launch notice
 * (withdraw-by-continuing-to-use-the-app). One place, so the two can't drift.
 */

export async function getPendingDeletionRequest(userId: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('account_deletion_requests')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();
  return data ?? null;
}

export async function submitDeletionRequest(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('account_deletion_requests')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function withdrawDeletionRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('account_deletion_requests')
    .delete()
    .eq('id', requestId);
  if (error) throw error;
}
