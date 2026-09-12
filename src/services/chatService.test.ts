import {
  getConversationMessagesPage,
  getDirectChatsPage,
  getOrCreateDirectChat,
  markDirectMessageRead,
  sendDirectMessage,
  getDirectMessagesPage,
  resolveTargetUser,
  toggleReaction,
  chatService,
} from './chatService';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

describe('chatService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getConversationMessagesPage', () => {
    test('fetches initial page with sentinel limit 31 and extracts nextCursor when overflow exists', async () => {
      const mockRows = Array.from({ length: 31 }, (_, i) => ({
        id: `msg-${31 - i}`,
        conversation_id: 'conv-1',
        text: `Message ${31 - i}`,
        created_at: new Date(1700000000000 + (31 - i) * 1000).toISOString(),
        delivered_at: null,
        edited_at: null,
        image_url: null,
        is_auto_response: false,
        reactions: {},
        read_at: null,
        sender_id: 'user-1',
        sender_name: 'Alice',
        sender_role: 'customer',
        sender_type: 'user',
        context_label: null,
        context_ref: null,
        context_type: null,
      }));

      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await getConversationMessagesPage('conv-1', undefined, 30);

      expect(supabase.from).toHaveBeenCalledWith('messages');
      expect(mockQuery.select).toHaveBeenCalledWith('*');
      expect(mockQuery.eq).toHaveBeenCalledWith('conversation_id', 'conv-1');
      expect(mockQuery.or).not.toHaveBeenCalled();
      expect(mockQuery.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
      expect(mockQuery.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
      expect(mockQuery.limit).toHaveBeenCalledWith(31);

      expect(result.hasMore).toBe(true);
      expect(result.items.length).toBe(30);
      expect(result.items[0].id).toBe('msg-31');
      expect(result.nextCursor).toEqual({
        createdAt: mockRows[29].created_at,
        id: 'msg-2',
      });
    });

    test('returns hasMore: false and undefined nextCursor when dataset is within limit', async () => {
      const mockRows = [
        {
          id: 'msg-1',
          conversation_id: 'conv-1',
          text: 'Hello',
          created_at: '2026-09-10T00:00:00.000Z',
          delivered_at: null,
          edited_at: null,
          image_url: null,
          is_auto_response: false,
          reactions: {},
          read_at: null,
          sender_id: 'user-1',
          sender_name: 'Alice',
          sender_role: 'customer',
          sender_type: 'user',
          context_label: null,
          context_ref: null,
          context_type: null,
        },
      ];

      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await getConversationMessagesPage('conv-1', undefined, 30);

      expect(result.hasMore).toBe(false);
      expect(result.items.length).toBe(1);
      expect(result.nextCursor).toBeUndefined();
    });

    test('applies composite cursor filter for older messages', async () => {
      const cursor = {
        createdAt: '2026-09-10T00:05:00.000Z',
        id: 'msg-50',
      };

      const mockRows = [
        {
          id: 'msg-49',
          conversation_id: 'conv-1',
          text: 'Older message',
          created_at: '2026-09-10T00:04:00.000Z',
          delivered_at: null,
          edited_at: null,
          image_url: null,
          is_auto_response: false,
          reactions: {},
          read_at: null,
          sender_id: 'user-1',
          sender_name: 'Alice',
          sender_role: 'customer',
          sender_type: 'user',
          context_label: null,
          context_ref: null,
          context_type: null,
        },
      ];

      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await getConversationMessagesPage('conv-1', cursor, 20);

      const expectedFilter = `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
      expect(mockQuery.or).toHaveBeenCalledWith(expectedFilter);
      expect(mockQuery.limit).toHaveBeenCalledWith(21);
      expect(result.hasMore).toBe(false);
      expect(result.items.length).toBe(1);
    });

    test('throws when supabase returns an error', async () => {
      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
      };

      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      await expect(getConversationMessagesPage('conv-1')).rejects.toThrow('DB error');
    });
  });

  describe('getDirectChatsPage', () => {
    test('calls get_direct_chat_summaries with limit + 1 and hydrates profiles', async () => {
      const mockChats = [
        { chat_id: 'chat-1', other_user_id: 'user-2', updated_at: '2026-09-10T00:00:00Z' },
      ];
      const mockProfiles = [
        {
          id: 'user-2',
          first_name: 'Bob',
          last_name: 'Jones',
          username: 'bobjones',
          wardrobe_privacy: 'public',
        },
      ];

      (supabase.rpc as jest.Mock).mockImplementation((rpcName: string) => {
        if (rpcName === 'get_direct_chat_summaries') {
          return Promise.resolve({ data: mockChats, error: null });
        }
        if (rpcName === 'get_public_profiles') {
          return Promise.resolve({ data: mockProfiles, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await getDirectChatsPage(0, 30);

      expect(supabase.rpc).toHaveBeenCalledWith('get_direct_chat_summaries', {
        p_limit: 31,
        p_offset: 0,
      });
      expect(supabase.rpc).toHaveBeenCalledWith('get_public_profiles', {
        p_user_ids: ['user-2'],
      });
      expect(result.items.length).toBe(1);
      expect(result.items[0].other_user?.first_name).toBe('Bob');
      expect(result.hasMore).toBe(false);
      expect(result.nextOffset).toBe(1);
    });
  });

  describe('getOrCreateDirectChat', () => {
    test('successfully returns chat UUID on RPC success', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: 'chat-uuid-123',
        error: null,
      });

      const result = await getOrCreateDirectChat('user-456');

      expect(supabase.rpc).toHaveBeenCalledWith('get_or_create_direct_chat', {
        other_user_id: 'user-456',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('chat-uuid-123');
      }
    });

    test('returns DomainError on RPC failure', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: new Error('Database error'),
      });

      const result = await getOrCreateDirectChat('user-456');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_CHAT_INIT_FAILED');
        expect(result.error.domain).toBe('chat');
      }
    });
  });

  describe('markDirectMessageRead', () => {
    test('calls mark_direct_message_read and returns ok', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await markDirectMessageRead('msg-999');

      expect(supabase.rpc).toHaveBeenCalledWith('mark_direct_message_read', {
        p_message_id: 'msg-999',
      });
      expect(result.ok).toBe(true);
    });

    test('returns DomainError on RPC error', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: new Error('Permission denied'),
      });

      const result = await markDirectMessageRead('msg-999');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_MARK_READ_FAILED');
      }
    });
  });

  describe('sendDirectMessage', () => {
    test('fails immediately with ERR_INVALID_CONTENT on empty string', async () => {
      const result = await sendDirectMessage('chat-1', '   ', 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_INVALID_CONTENT');
      }
      expect(supabase.from).not.toHaveBeenCalled();
    });

    test('inserts direct message and returns confirmed row', async () => {
      const mockRow = {
        id: 'msg-101',
        chat_id: 'chat-1',
        sender_id: 'user-1',
        content: 'Hello friend',
        created_at: '2026-09-12T00:00:00Z',
        read_at: null,
      };

      const mockQuery: any = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRow, error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await sendDirectMessage('chat-1', '  Hello friend  ', 'user-1');

      expect(supabase.from).toHaveBeenCalledWith('direct_messages');
      expect(mockQuery.insert).toHaveBeenCalledWith({
        chat_id: 'chat-1',
        sender_id: 'user-1',
        content: 'Hello friend',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('msg-101');
      }
    });

    test('returns DomainError on insert failure', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: new Error('Insert failed') }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await sendDirectMessage('chat-1', 'Hello', 'user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_DIRECT_MESSAGE_SEND_FAILED');
      }
    });
  });

  describe('getDirectMessagesPage', () => {
    test('fetches direct messages ordered descending with default limit 50', async () => {
      const mockRows = [
        { id: 'm-2', content: 'Second', created_at: '2026-09-12T01:00:00Z' },
        { id: 'm-1', content: 'First', created_at: '2026-09-12T00:00:00Z' },
      ];

      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await getDirectMessagesPage('chat-1');

      expect(supabase.from).toHaveBeenCalledWith('direct_messages');
      expect(mockQuery.select).toHaveBeenCalledWith('*');
      expect(mockQuery.eq).toHaveBeenCalledWith('chat_id', 'chat-1');
      expect(mockQuery.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockQuery.limit).toHaveBeenCalledWith(50);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.length).toBe(2);
      }
    });

    test('returns DomainError on query error', async () => {
      const mockQuery: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: null, error: new Error('DB timeout') }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await getDirectMessagesPage('chat-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_DIRECT_MESSAGES_FETCH_FAILED');
      }
    });
  });

  describe('resolveTargetUser', () => {
    test('resolves @username to UUID then fetches public profile', async () => {
      (supabase.rpc as jest.Mock).mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'resolve_username') {
          expect(args).toEqual({ p_username: 'janedoe' });
          return Promise.resolve({ data: 'uuid-janedoe', error: null });
        }
        if (rpcName === 'get_public_profiles') {
          expect(args).toEqual({ p_user_ids: ['uuid-janedoe'] });
          return Promise.resolve({
            data: [
              {
                id: 'uuid-janedoe',
                first_name: 'Jane',
                last_name: 'Doe',
                username: 'janedoe',
                wardrobe_privacy: 'public',
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await resolveTargetUser('@JaneDoe');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('uuid-janedoe');
        expect(result.data.first_name).toBe('Jane');
      }
    });

    test('resolves raw UUID directly without resolve_username call', async () => {
      (supabase.rpc as jest.Mock).mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'get_public_profiles') {
          expect(args).toEqual({ p_user_ids: ['raw-uuid-123'] });
          return Promise.resolve({
            data: [
              {
                id: 'raw-uuid-123',
                first_name: 'Bob',
                last_name: 'Smith',
                username: 'bobsmith',
                wardrobe_privacy: 'connections',
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await resolveTargetUser('raw-uuid-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('raw-uuid-123');
      }
    });

    test('returns ERR_USER_NOT_FOUND when username resolution returns empty or error', async () => {
      (supabase.rpc as jest.Mock).mockImplementation((rpcName: string) => {
        if (rpcName === 'resolve_username') {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await resolveTargetUser('@nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_USER_NOT_FOUND');
      }
    });
  });

  describe('toggleReaction', () => {
    test('calls merge_message_reaction with exact live parameters', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { 'user-1': '❤️' },
        error: null,
      });

      const result = await toggleReaction('msg-1', '❤️');

      expect(supabase.rpc).toHaveBeenCalledWith('merge_message_reaction', {
        p_message_id: 'msg-1',
        p_emoji: '❤️',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ 'user-1': '❤️' });
      }
    });

    test('returns DomainError on RPC error', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: new Error('RPC failure'),
      });

      const result = await toggleReaction('msg-1', '❤️');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ERR_REACTION_FAILED');
      }
    });
  });

  describe('chatService domain export', () => {
    test('exports all domain functions on chatService singleton', () => {
      expect(chatService.getDirectChatsPage).toBe(getDirectChatsPage);
      expect(chatService.getConversationMessagesPage).toBe(getConversationMessagesPage);
      expect(chatService.getOrCreateDirectChat).toBe(getOrCreateDirectChat);
      expect(chatService.markDirectMessageRead).toBe(markDirectMessageRead);
      expect(chatService.sendDirectMessage).toBe(sendDirectMessage);
      expect(chatService.getDirectMessagesPage).toBe(getDirectMessagesPage);
      expect(chatService.resolveTargetUser).toBe(resolveTargetUser);
      expect(chatService.toggleReaction).toBe(toggleReaction);
    });
  });
});

