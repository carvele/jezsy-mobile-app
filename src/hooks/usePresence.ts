import { useState, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '@/src/services/observability';

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
  // Realtime tenants on a mostly-idle project (like this one outside active
  // testing) cold-start their replication connection on the first subscribe
  // after going idle -- confirmed live via Supabase's own realtime_logs
  // ("Tenant ... is initializing", ~4s) racing this channel's subscribe and
  // losing, producing a CHANNEL_ERROR that would otherwise just sit reported
  // instead of self-healing once the tenant is warm.
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_PRESENCE_RETRIES = 3;

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

    const channel = supabase.channel('presence:online', {
      config: { presence: { key: userId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ user_id: string; role: string }>();
        const next: Record<string, string> = {};
        for (const presences of Object.values(state)) {
          const p = presences[0];
          if (p) next[p.user_id] = p.role;
        }
        setOnlineUsers(next);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          retryCountRef.current = 0;
          try {
            await channel.track({
              user_id: userId,
              role: role || 'customer',
              online_at: new Date().toISOString(),
            });
          } catch (err) {
            errorReporting.capture(err instanceof Error ? err : new Error(String(err)), {
              domain: 'messages',
              operation: 'trackPresence',
            });
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          errorReporting.capture(new Error(`Presence channel error: ${status}`), {
            domain: 'messages',
            operation: 'subscribePresence',
            status,
          });
          if (retryCountRef.current < MAX_PRESENCE_RETRIES) {
            retryCountRef.current += 1;
            const delayMs = 1500 * retryCountRef.current;
            retryTimerRef.current = setTimeout(() => {
              setReconnectGen((prev) => prev + 1);
            }, delayMs);
          }
        }
      });

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [userId, role, reconnectGen]);

  return onlineUsers;
}
