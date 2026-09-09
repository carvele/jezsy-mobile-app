import { supabase } from '@/src/lib/supabase';
import { OffsetPageResult } from '@/src/types/pagination';

export type UserProfile = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
};

export type Connection = {
  id: string;
  user_id_1: string;
  user_id_2: string;
  status: string;
  action_user_id: string;
  other_user: UserProfile;
};

export async function getConnectionsPage(
  userId: string,
  offset = 0,
  limit = 50
): Promise<OffsetPageResult<Connection>> {
  const { data, error } = await supabase
    .from('connections')
    .select('id, user_id_1, user_id_2, status, action_user_id, created_at')
    .or(`user_id_1.eq.${userId},user_id_2.eq.${userId}`)
    .neq('status', 'blocked')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

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

  const otherUserIds = pageItems.map((conn) =>
    conn.user_id_1 === userId ? conn.user_id_2 : conn.user_id_1
  );
  const { data: profiles, error: profileErr } = await supabase.rpc('get_public_profiles', {
    p_user_ids: otherUserIds,
  });

  if (profileErr) throw profileErr;

  const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));

  const formatted: Connection[] = pageItems.map((conn) => {
    const otherUserId = conn.user_id_1 === userId ? conn.user_id_2 : conn.user_id_1;
    const profile = profileById.get(otherUserId);
    return {
      id: conn.id,
      user_id_1: conn.user_id_1,
      user_id_2: conn.user_id_2,
      status: conn.status,
      action_user_id: conn.action_user_id,
      other_user: profile || {
        id: otherUserId,
        username: 'Unknown',
        first_name: '',
        last_name: '',
      },
    };
  });

  return {
    items: formatted,
    hasMore,
    nextOffset: offset + formatted.length,
  };
}
