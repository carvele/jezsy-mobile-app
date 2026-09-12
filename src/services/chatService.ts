import { supabase } from '@/src/lib/supabase';
import { CursorPageResult, MessageCursor, OffsetPageResult } from '@/src/types/pagination';
import { Database } from '@/src/types/database.types';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';

export type MessageRow = Database['public']['Tables']['messages']['Row'] & {
  _status?: 'sending' | 'failed';
};

export type DirectMessageRow = Database['public']['Tables']['direct_messages']['Row'] & {
  _status?: 'sending' | 'failed';
};

export interface PublicProfile {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  wardrobe_privacy: string;
}

export type DirectChatSummary = {
  id: string;
  other_user: PublicProfile | null;
  updated_at: string;
};

export async function getDirectChatsPage(
  offset = 0,
  limit = 30
): Promise<OffsetPageResult<DirectChatSummary>> {
  const { data, error } = await supabase.rpc('get_direct_chat_summaries', {
    p_limit: limit + 1,
    p_offset: offset,
  });

  if (error) throw error;

  const raw = data ?? [];
  const hasMore = raw.length > limit;
  const pageItems = raw.slice(0, limit);

  if (pageItems.length === 0) {
    return {
      items: [],
      hasMore: false,
      nextOffset: offset,
    };
  }

  const otherUserIds = pageItems.map((p) => p.other_user_id);
  const { data: profiles, error: profileErr } = await supabase.rpc('get_public_profiles', {
    p_user_ids: otherUserIds,
  });

  if (profileErr) throw profileErr;

  const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));

  const formatted: DirectChatSummary[] = pageItems.map((p) => ({
    id: p.chat_id,
    other_user: profileById.get(p.other_user_id) || null,
    updated_at: p.updated_at,
  }));

  return {
    items: formatted,
    hasMore,
    nextOffset: offset + formatted.length,
  };
}

export async function getConversationMessagesPage(
  conversationId: string,
  cursor?: MessageCursor,
  limit = 30
): Promise<CursorPageResult<MessageRow, MessageCursor>> {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId);

  if (cursor) {
    const filter = `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
    query = query.or(filter);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (error) throw error;

  const raw = (data ?? []) as MessageRow[];
  const hasMore = raw.length > limit;
  const items = raw.slice(0, limit);

  const lastItem = items[items.length - 1];
  const nextCursor: MessageCursor | undefined =
    hasMore && lastItem && lastItem.created_at
      ? { createdAt: lastItem.created_at, id: lastItem.id }
      : undefined;

  return {
    items,
    hasMore,
    nextCursor,
  };
}

/**
 * Idempotently initializes or resolves an existing direct chat with another user.
 * Invokes live stored procedure get_or_create_direct_chat.
 */
export async function getOrCreateDirectChat(
  otherUserId: string
): Promise<DomainResult<string>> {
  try {
    const { data, error } = await supabase.rpc('get_or_create_direct_chat', {
      other_user_id: otherUserId,
    });

    if (error) throw error;
    return domainOk(data as string);
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'ERR_CHAT_INIT_FAILED',
      message: err?.message || 'Failed to initialize direct chat',
      domain: 'chat',
      context: { operation: 'getOrCreateDirectChat', otherUserId },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'chat',
      operation: 'getOrCreateDirectChat',
    });
    return domainFail(domainError);
  }
}

/**
 * Updates read_at timestamp for a direct message via stored procedure mark_direct_message_read.
 */
export async function markDirectMessageRead(
  messageId: string
): Promise<DomainResult<void>> {
  try {
    const { error } = await supabase.rpc('mark_direct_message_read', {
      p_message_id: messageId,
    });

    if (error) throw error;
    return domainOk(undefined);
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'ERR_MARK_READ_FAILED',
      message: err?.message || 'Failed to mark message as read',
      domain: 'chat',
      context: { operation: 'markDirectMessageRead', messageId },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'chat',
      operation: 'markDirectMessageRead',
    });
    return domainFail(domainError);
  }
}

/**
 * Inserts a new message into direct_messages table.
 */
export async function sendDirectMessage(
  chatId: string,
  content: string,
  senderId: string
): Promise<DomainResult<DirectMessageRow>> {
  try {
    const trimmed = content.trim();
    if (!trimmed) {
      const err = new DomainError({
        code: 'ERR_INVALID_CONTENT',
        message: 'Message content cannot be empty',
        domain: 'chat',
        context: { operation: 'sendDirectMessage', chatId },
      });
      return domainFail(err);
    }

    const { data, error } = await supabase
      .from('direct_messages')
      .insert({ chat_id: chatId, sender_id: senderId, content: trimmed })
      .select()
      .single();

    if (error) throw error;
    return domainOk(data as DirectMessageRow);
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'ERR_DIRECT_MESSAGE_SEND_FAILED',
      message: err?.message || 'Failed to send direct message',
      domain: 'chat',
      context: { operation: 'sendDirectMessage', chatId },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'chat',
      operation: 'sendDirectMessage',
    });
    return domainFail(domainError);
  }
}

/**
 * Fetches recent messages for a direct chat thread ordered descending by creation date.
 */
export async function getDirectMessagesPage(
  chatId: string,
  limit = 50
): Promise<DomainResult<DirectMessageRow[]>> {
  try {
    const { data, error } = await supabase
      .from('direct_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return domainOk((data ?? []) as DirectMessageRow[]);
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'ERR_DIRECT_MESSAGES_FETCH_FAILED',
      message: err?.message || 'Failed to load direct messages',
      domain: 'chat',
      context: { operation: 'getDirectMessagesPage', chatId, limit },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'chat',
      operation: 'getDirectMessagesPage',
    });
    return domainFail(domainError);
  }
}

/**
 * Resolves a public user profile from an '@username' handle or raw UUID.
 */
export async function resolveTargetUser(
  idOrUsername: string
): Promise<DomainResult<PublicProfile>> {
  try {
    let targetId = idOrUsername;

    if (idOrUsername.startsWith('@')) {
      const username = idOrUsername.substring(1).toLowerCase();
      const { data: resolvedId, error: resolveErr } = await supabase.rpc(
        'resolve_username',
        { p_username: username }
      );
      if (resolveErr || !resolvedId) {
        throw new Error('User not found');
      }
      targetId = resolvedId;
    }

    const { data: profiles, error: profileErr } = await supabase.rpc(
      'get_public_profiles',
      { p_user_ids: [targetId] }
    );

    if (profileErr || !profiles?.[0]) {
      throw profileErr || new Error('User not found');
    }

    return domainOk(profiles[0] as PublicProfile);
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'ERR_USER_NOT_FOUND',
      message: err?.message || 'User not found',
      domain: 'chat',
      context: { operation: 'resolveTargetUser', idOrUsername },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'chat',
      operation: 'resolveTargetUser',
    });
    return domainFail(domainError);
  }
}

/**
 * Merges or toggles an emoji reaction on a support message via merge_message_reaction.
 * Requires explicit caller-provided userId to ensure p_user_id is never undefined.
 */
export async function toggleReaction(
  messageId: string,
  emoji: string,
  _userId?: string
): Promise<DomainResult<Record<string, string>>> {
  try {
    const { data, error } = await supabase.rpc('merge_message_reaction', {
      p_message_id: messageId,
      p_emoji: emoji,
    });

    if (error) throw error;
    return domainOk((data ?? {}) as Record<string, string>);
  } catch (err: any) {
    const domainError = new DomainError({
      code: 'ERR_REACTION_FAILED',
      message: err?.message || 'Failed to toggle reaction',
      domain: 'chat',
      context: { operation: 'toggleReaction', messageId },
      cause: err,
    });
    errorReporting.capture(domainError, {
      domain: 'chat',
      operation: 'toggleReaction',
    });
    return domainFail(domainError);
  }
}

export const chatService = {
  getDirectChatsPage,
  getConversationMessagesPage,
  getOrCreateDirectChat,
  markDirectMessageRead,
  sendDirectMessage,
  getDirectMessagesPage,
  resolveTargetUser,
  toggleReaction,
};

