import { supabase } from '@/src/lib/supabase';
import { NotificationData } from '@/src/types/dto/notification';
import { OffsetPageResult } from '@/src/types/pagination';

export type NotificationItem = {
  id: string;
  user_id?: string;
  type: string;
  title: string;
  body: string;
  data?: NotificationData | null;
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
    .not('type', 'in', '(conversation,direct_chat)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit);

  if (error) throw error;

  const raw = (data ?? []) as any[];
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
        .map((a) => ({
          ...a,
          kind: 'announcement' as const,
          is_read: true,
          data: {
            entity_type: 'announcement' as const,
            entity_id: a.id,
            action: 'staff_broadcast' as const,
          },
        }));
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

export async function getUnreadNonChatNotificationsCount(userId: string): Promise<number> {
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)
    .not('type', 'in', '(conversation,direct_chat)');

  if (error) {
    console.error('Error fetching unread notification count:', error);
    return 0;
  }
  return count ?? 0;
}

export async function markNotificationAsRead(
  userId: string,
  notificationId: string
): Promise<void> {
  if (!userId || !notificationId) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  if (!userId) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
    .not('type', 'in', '(conversation,direct_chat)');

  if (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
}

export async function deleteNotification(
  userId: string,
  notificationId: string
): Promise<void> {
  if (!userId || !notificationId) return;
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}
