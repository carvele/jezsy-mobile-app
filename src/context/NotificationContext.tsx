import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from './AuthContext';
import {
  getUnreadNonChatNotificationsCount,
  markNotificationAsRead as markNotificationAsReadService,
  markAllNotificationsAsRead as markAllNotificationsAsReadService,
} from '@/src/services/notificationService';

interface NotificationContextType {
  unreadNonChatCount: number;
  loading: boolean;
  refreshUnreadCount: () => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [unreadNonChatCount, setUnreadNonChatCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUnreadCount = useCallback(async () => {
    if (!userId) {
      setUnreadNonChatCount(0);
      setLoading(false);
      return;
    }
    try {
      const count = await getUnreadNonChatNotificationsCount(userId);
      setUnreadNonChatCount(count);
    } catch (err) {
      console.error('[NotificationContext] Failed to fetch unread count:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const markAsRead = useCallback(async (notificationId: string) => {
    if (!userId || !notificationId) return;
    setUnreadNonChatCount((prev) => Math.max(0, prev - 1));
    try {
      await markNotificationAsReadService(userId, notificationId);
    } catch (err) {
      console.error('[NotificationContext] Failed to mark as read:', err);
      refreshUnreadCount();
    }
  }, [userId, refreshUnreadCount]);

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    setUnreadNonChatCount(0);
    try {
      await markAllNotificationsAsReadService(userId);
    } catch (err) {
      console.error('[NotificationContext] Failed to mark all as read:', err);
      refreshUnreadCount();
    }
  }, [userId, refreshUnreadCount]);

  useEffect(() => {
    if (!userId) {
      setUnreadNonChatCount(0);
      setLoading(false);
      return;
    }

    refreshUnreadCount();

    // Supabase Realtime channel for notifications scoped to the current user
    const channel = supabase
      .channel(`notifications-user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          refreshUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refreshUnreadCount]);

  const value = useMemo(
    () => ({
      unreadNonChatCount,
      loading,
      refreshUnreadCount,
      markAsRead,
      markAllAsRead,
    }),
    [unreadNonChatCount, loading, refreshUnreadCount, markAsRead, markAllAsRead]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
