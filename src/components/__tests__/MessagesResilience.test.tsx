import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { MessagesProvider, useMessages } from '@/src/context/MessagesContext';
import { ErrorRetryState } from '../ErrorRetryState';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'test-user-123' } },
    profile: { role: 'customer' },
  }),
}));

jest.mock('@/src/hooks/usePresence', () => ({
  usePresence: () => ({}),
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    }),
    removeChannel: jest.fn(),
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function TestInboxConsumer() {
  const { conversations, loading, error, refreshConversations } = useMessages();

  if (loading) {
    return <Text testID="loading-state">Loading...</Text>;
  }

  if (error && conversations.length === 0) {
    return (
      <ErrorRetryState
        title="Unable to load messages"
        message={error}
        onRetry={refreshConversations}
      />
    );
  }

  return (
    <Text testID="conversation-count">{`Conversations: ${conversations.length}`}</Text>
  );
}

describe('Inbox Resilience (HCI-003, HCI-008)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders ErrorRetryState when conversations fail to load, and recovers on retry', async () => {
    // 1. Initial load fails
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({
            data: null,
            error: new Error('Failed to connect to messages server'),
          }),
        }),
      }),
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(
        <MessagesProvider>
          <TestInboxConsumer />
        </MessagesProvider>
      );
    });

    const instance = root!.root;
    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Unable to load messages');
    expect(texts).toContain('Failed to connect to messages server');

    // 2. Recovery on retry
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({
            data: [
              {
                id: 'conv-1',
                customer_id: 'test-user-123',
                last_message: 'Hello!',
                last_message_time: new Date().toISOString(),
                unread_customer: 0,
                unread_staff: 0,
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const retryBtn = instance.findByType(TouchableOpacity);
    await ReactTestRenderer.act(async () => {
      retryBtn.props.onPress();
    });

    const recoveredCount = instance.findByProps({ testID: 'conversation-count' });
    expect(recoveredCount.props.children).toBe('Conversations: 1');
  });
});
