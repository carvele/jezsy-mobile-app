import { supabase } from '@/src/lib/supabase';
import { OffsetPageResult } from '@/src/types/pagination';

export type DirectChatSummary = {
  id: string;
  other_user: any;
  updated_at: string;
};

export async function getDirectChatsPage(
  offset = 0,
  limit = 30
): Promise<OffsetPageResult<DirectChatSummary>> {
  const { data, error } = await supabase.rpc('get_direct_chat_summaries', {
    p_limit: limit + 1,
    p_offset: offset,
  });

  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const pageItems = raw.slice(0, limit);

  if (pageItems.length === 0) {
    return {
      items: [],
      hasMore: false,
      nextOffset: offset,
    };
  }

  const otherUserIds = pageItems.map((p) => p.other_user_id);
  const { data: profiles, error: profileErr } = await supabase.rpc('get_public_profiles', {
    p_user_ids: otherUserIds,
  });

  if (profileErr) throw profileErr;

  const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));

  const formatted: DirectChatSummary[] = pageItems.map((p) => ({
    id: p.chat_id,
    other_user: profileById.get(p.other_user_id) || null,
    updated_at: p.updated_at,
  }));

  return {
    items: formatted,
    hasMore,
    nextOffset: offset + formatted.length,
  };
}
