import { supabase } from '@/src/lib/supabase';
import { OffsetPageResult } from '@/src/types/pagination';

export type NotificationItem = {
  id: string;
  user_id?: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  created_at: string;
  is_read?: boolean | null;
  kind: 'personal' | 'announcement';
};

export async function getNotificationsPage(
  userId: string,
  offset = 0,
  limit = 30
): Promise<OffsetPageResult<NotificationItem>> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const pageItems = raw.slice(0, limit);

  let activeAnnouncements: NotificationItem[] = [];
  if (offset === 0) {
    const nowIso = new Date().toISOString();
    const [announcementsRes, dismissalsRes] = await Promise.all([
      supabase
        .from('announcements')
        .select('*')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(10),
      supabase
        .from('announcement_dismissals')
        .select('announcement_id')
        .eq('user_id', userId),
    ]);

    if (!announcementsRes.error && !dismissalsRes.error) {
      const dismissedIds = new Set((dismissalsRes.data || []).map((d) => d.announcement_id));
      activeAnnouncements = (announcementsRes.data || [])
        .filter((a) => !dismissedIds.has(a.id))
        .map((a) => ({ ...a, kind: 'announcement' as const, is_read: true }));
    }
  }

  const personal: NotificationItem[] = pageItems.map((n) => ({
    ...n,
    kind: 'personal' as const,
  }));

  const combined = offset === 0
    ? [...personal, ...activeAnnouncements].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    : personal;

  return {
    items: combined,
    hasMore,
    nextOffset: offset + personal.length,
  };
}
