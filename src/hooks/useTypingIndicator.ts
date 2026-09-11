import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '@/src/services/observability';

export interface UseTypingIndicatorOptions {
  conversationId?: string | null;
  userId?: string | null;
  throttleMs?: number;
  timeoutMs?: number;
}

export interface UseTypingIndicatorReturn {
  isOtherTyping: boolean;
  sendTyping: () => void;
}

/**
 * Ephemeral typing indicator hook over Supabase Realtime broadcast channels.
 * Automatically handles throttling, remote reset timeouts, error reporting,
 * and resilient channel recreation upon AppState resume.
 */
export function useTypingIndicator({
  conversationId,
  userId,
  throttleMs = 2000,
  timeoutMs = 4000,
}: UseTypingIndicatorOptions): UseTypingIndicatorReturn {
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [reconnectGen, setReconnectGen] = useState(0);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(0);
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
    setIsOtherTyping(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!conversationId) {
      channelRef.current = null;
      return;
    }

    const channel = supabase.channel(`typing:${conversationId}`);

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.sender_id === userId) return;
        setIsOtherTyping(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setIsOtherTyping(false);
        }, timeoutMs);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          errorReporting.capture(new Error(`Typing channel error: ${status}`), {
            domain: 'chat',
            operation: 'subscribeTyping',
            conversationId,
            status,
          });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsOtherTyping(false);
    };
  }, [conversationId, userId, timeoutMs, reconnectGen]);

  const sendTyping = useCallback(() => {
    if (!userId || !channelRef.current) return;
    const now = Date.now();
    if (now - lastSentRef.current < throttleMs) return;
    lastSentRef.current = now;

    channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { sender_id: userId },
    });
  }, [userId, throttleMs]);

  return {
    isOtherTyping,
    sendTyping,
  };
}
