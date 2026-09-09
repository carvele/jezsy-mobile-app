import { getConversationMessagesPage, getDirectChatsPage } from './chatService';
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
        { id: 'user-2', display_name: 'Bob', avatar_url: null },
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
      expect(result.items[0].other_user.display_name).toBe('Bob');
      expect(result.hasMore).toBe(false);
      expect(result.nextOffset).toBe(1);
    });
  });
});
