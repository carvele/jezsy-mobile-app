import { supabase } from '@/src/lib/supabase';

export async function fetchNotifications(userId: string) {
  const nowIso = new Date().toISOString();
  const [personalRes, announcementsRes, dismissalsRes] = await Promise.all([
    supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('announcements').select('*').or('expires_at.is.null,expires_at.gt.' + nowIso).order('created_at', { ascending: false }).limit(10),
    supabase.from('announcement_dismissals').select('announcement_id').eq('user_id', userId),
  ]);

  return { personalRes, announcementsRes, dismissalsRes };
}

export async function dismissAnnouncement(userId: string, announcementId: string) {
  return await supabase.from('announcement_dismissals').insert({ user_id: userId, announcement_id: announcementId });
}

