import {
  getNotificationsPage,
  getUnreadNonChatNotificationsCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
} from '@/src/services/notificationService';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNotificationsPage', () => {
    it('queries notifications filtering out conversation and direct_chat types', async () => {
      const mockRange = jest.fn().mockResolvedValue({
        data: [
          {
            id: 'notif-1',
            user_id: 'u-1',
            type: 'reservation',
            title: 'Ready for pickup',
            body: 'Your item is ready',
            created_at: '2026-09-14T00:00:00Z',
            is_read: false,
          },
        ],
        error: null,
      });

      const mockOrder2 = jest.fn().mockReturnValue({ range: mockRange });
      const mockOrder1 = jest.fn().mockReturnValue({ order: mockOrder2 });
      const mockNot = jest.fn().mockReturnValue({ order: mockOrder1 });
      const mockEq = jest.fn().mockReturnValue({ not: mockNot });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'notifications') {
          return { select: mockSelect };
        }
        if (table === 'announcements') {
          return {
            select: jest.fn().mockReturnValue({
              or: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  order: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'announcement_dismissals') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          };
        }
        return {};
      });

      const result = await getNotificationsPage('u-1', 0, 30);

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(mockEq).toHaveBeenCalledWith('user_id', 'u-1');
      expect(mockNot).toHaveBeenCalledWith('type', 'in', '(conversation,direct_chat)');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].kind).toBe('personal');
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getUnreadNonChatNotificationsCount', () => {
    it('returns 0 if userId is empty', async () => {
      const count = await getUnreadNonChatNotificationsCount('');
      expect(count).toBe(0);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('queries exact head count excluding chat notification types', async () => {
      const mockNot = jest.fn().mockResolvedValue({ count: 4, error: null });
      const mockEqRead = jest.fn().mockReturnValue({ not: mockNot });
      const mockEqUser = jest.fn().mockReturnValue({ eq: mockEqRead });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEqUser });

      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const count = await getUnreadNonChatNotificationsCount('user-uuid');

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(mockSelect).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      expect(mockEqUser).toHaveBeenCalledWith('user_id', 'user-uuid');
      expect(mockEqRead).toHaveBeenCalledWith('is_read', false);
      expect(mockNot).toHaveBeenCalledWith('type', 'in', '(conversation,direct_chat)');
      expect(count).toBe(4);
    });
  });

  describe('markNotificationAsRead', () => {
    it('updates is_read for specific notification row', async () => {
      const mockEqUser = jest.fn().mockResolvedValue({ error: null });
      const mockEqId = jest.fn().mockReturnValue({ eq: mockEqUser });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEqId });

      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await markNotificationAsRead('user-1', 'notif-1');

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(mockUpdate).toHaveBeenCalledWith({ is_read: true });
      expect(mockEqId).toHaveBeenCalledWith('id', 'notif-1');
      expect(mockEqUser).toHaveBeenCalledWith('user_id', 'user-1');
    });
  });

  describe('markAllNotificationsAsRead', () => {
    it('marks all unread personal notifications as read, excluding chat types', async () => {
      const mockNot = jest.fn().mockResolvedValue({ error: null });
      const mockEqRead = jest.fn().mockReturnValue({ not: mockNot });
      const mockEqUser = jest.fn().mockReturnValue({ eq: mockEqRead });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEqUser });

      (supabase.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await markAllNotificationsAsRead('user-1');

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(mockUpdate).toHaveBeenCalledWith({ is_read: true });
      expect(mockEqUser).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockEqRead).toHaveBeenCalledWith('is_read', false);
      expect(mockNot).toHaveBeenCalledWith('type', 'in', '(conversation,direct_chat)');
    });
  });

  describe('deleteNotification', () => {
    it('deletes specific notification for the user', async () => {
      const mockEqUser = jest.fn().mockResolvedValue({ error: null });
      const mockEqId = jest.fn().mockReturnValue({ eq: mockEqUser });
      const mockDelete = jest.fn().mockReturnValue({ eq: mockEqId });

      (supabase.from as jest.Mock).mockReturnValue({ delete: mockDelete });

      await deleteNotification('user-1', 'notif-1');

      expect(supabase.from).toHaveBeenCalledWith('notifications');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEqId).toHaveBeenCalledWith('id', 'notif-1');
      expect(mockEqUser).toHaveBeenCalledWith('user_id', 'user-1');
    });

    it('throws error when supabase delete returns an error', async () => {
      const mockEqUser = jest.fn().mockResolvedValue({ error: new Error('Delete error') });
      const mockEqId = jest.fn().mockReturnValue({ eq: mockEqUser });
      const mockDelete = jest.fn().mockReturnValue({ eq: mockEqId });

      (supabase.from as jest.Mock).mockReturnValue({ delete: mockDelete });

      await expect(deleteNotification('user-1', 'notif-1')).rejects.toThrow('Delete error');
    });
  });
});
