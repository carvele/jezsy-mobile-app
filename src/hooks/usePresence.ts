import { useState, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/src/lib/supabase';

export interface UsePresenceOptions {
  userId?: string | null;
  role?: string | null;
}

/**
 * Tracks this user as online on the 'presence:online' Realtime channel
 * and maintains a synced map of online users (user_id -> role).
 * Hardened with error reporting, subscription status handling, and
 * resilient channel recreation on AppState foreground resumption.
 */
export function usePresence(
  userId?: string | null,
  role?: string | null
): Record<string, string> {
  const [onlineUsers, setOnlineUsers] = useState<Record<string, string>>({});
  const [reconnectGen, setReconnectGen] = useState(0);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // AppState listener to trigger complete channel recreation on resume
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const wasBackground = /inactive|background/.test(appStateRef.current);
      if (wasBackground && nextAppState === 'active') {
        setReconnectGen((prev) => prev + 1);
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setOnlineUsers({});
      return;
    }

    let isCleanedUp = false;

    const channel = supabase.channel('presence:online', {
      config: { presence: { key: userId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        if (isCleanedUp) return;
        const state = channel.presenceState<{ user_id: string; role: string }>();
        const next: Record<string, string> = {};
        for (const presences of Object.values(state)) {
          const p = presences[0];
          if (p) next[p.user_id] = p.role;
        }
        setOnlineUsers(next);
      })
      .subscribe(async (status) => {
        if (isCleanedUp) return;
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              user_id: userId,
              role: role || 'customer',
              online_at: new Date().toISOString(),
            });
          } catch (err) {
            if (!isCleanedUp) {
              console.warn('[usePresence] Failed to track presence:', err);
            }
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // CHANNEL_ERROR and TIMED_OUT occur transiently during network hops, sleep/resume,
          // browser tracking prevention interventions, or socket teardowns.
          console.warn(`[usePresence] Channel status: ${status}`);
        }
      });

    return () => {
      isCleanedUp = true;
      supabase.removeChannel(channel);
    };
  }, [userId, role, reconnectGen]);

  return onlineUsers;
}
