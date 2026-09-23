import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

export type TransientTransferSource = 'style-advisor' | 'passive-outfits' | 'saved-outfits';

export interface TransientMannequinPayload {
  version: 1;
  userId: string;
  itemIds: string[];
  createdAt: number;
  expiresAt: number;
  source: TransientTransferSource;
}

export type TokenErrorCode =
  | 'EXPIRED'
  | 'UNAUTHORIZED'
  | 'MALFORMED'
  | 'CONSUMED'
  | 'NOT_FOUND'
  | 'STORAGE_ERROR';

export interface TokenValidationResult {
  valid: boolean;
  itemIds?: string[];
  error?: TokenErrorCode;
}

export interface CreateTokenParams {
  userId: string;
  itemIds: string[];
  source: TransientTransferSource;
}

const STORAGE_PREFIX = '@jezsy_transient_mannequin_';
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory store & concurrency lock
const memoryStore = new Map<string, TransientMannequinPayload>();
const tokensBeingConsumed = new Set<string>();

/**
 * Validates payload schema completely according to contract item 6:
 * - version === 1
 * - userId is non-empty string
 * - itemIds is non-empty string[]
 * - all itemIds valid strings
 * - createdAt finite
 * - expiresAt finite
 * - expiresAt >= createdAt
 * - source in {'style-advisor','passive-outfits'}
 */
export function isValidPayloadSchema(payload: unknown): payload is TransientMannequinPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;

  if (p.version !== 1) return false;
  if (typeof p.userId !== 'string' || p.userId.trim().length === 0) return false;
  if (!Array.isArray(p.itemIds) || p.itemIds.length === 0) return false;
  if (!p.itemIds.every((id) => typeof id === 'string' && id.trim().length > 0)) return false;

  if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) return false;
  if (typeof p.expiresAt !== 'number' || !Number.isFinite(p.expiresAt)) return false;
  if (p.expiresAt < p.createdAt) return false;

  if (p.source !== 'style-advisor' && p.source !== 'passive-outfits' && p.source !== 'saved-outfits') return false;

  return true;
}

export class TransientMannequinService {
  /**
   * Creates and persists a transient mannequin token.
   * Atomically persists to AsyncStorage BEFORE publishing to memory map.
   * Never leaves orphan in-memory payload on storage failure.
   */
  async createToken(params: CreateTokenParams): Promise<{ success: boolean; token?: string; error?: string }> {
    // 1. Input validation
    if (!params.userId || typeof params.userId !== 'string' || params.userId.trim().length === 0) {
      return { success: false, error: 'INVALID_USER_ID' };
    }

    if (!Array.isArray(params.itemIds) || params.itemIds.length === 0) {
      return { success: false, error: 'EMPTY_ITEM_IDS' };
    }

    const uniqueItemIds = Array.from(
      new Set(params.itemIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))
    );

    if (uniqueItemIds.length === 0) {
      return { success: false, error: 'NO_VALID_ITEM_IDS' };
    }

    if (params.source !== 'style-advisor' && params.source !== 'passive-outfits') {
      return { success: false, error: 'INVALID_SOURCE' };
    }

    // 2. Generate cryptographically secure token
    const token = `tr_${randomUUID()}`;
    const now = Date.now();
    const payload: TransientMannequinPayload = {
      version: 1,
      userId: params.userId.trim(),
      itemIds: uniqueItemIds,
      createdAt: now,
      expiresAt: now + TOKEN_TTL_MS,
      source: params.source,
    };

    // 3. Atomically persist to AsyncStorage BEFORE publishing to memory map
    const storageKey = `${STORAGE_PREFIX}${token}`;
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Storage write failed: do NOT publish to memory, fail closed
      return { success: false, error: 'STORAGE_WRITE_FAILURE' };
    }

    // 4. Publish to in-memory map
    memoryStore.set(token, payload);

    return { success: true, token };
  }

  /**
   * Consumes a transient token once with strict user isolation and concurrency guard.
   */
  async consumeToken(token: string, currentUserId: string): Promise<TokenValidationResult> {
    const cleanToken = (token || '').trim();
    if (!cleanToken) {
      return { valid: false, error: 'MALFORMED' };
    }

    // 1. In-process concurrency guard
    if (tokensBeingConsumed.has(cleanToken)) {
      return { valid: false, error: 'CONSUMED' };
    }
    tokensBeingConsumed.add(cleanToken);

    try {
      // 2. Retrieve payload from memory or AsyncStorage
      let payload = memoryStore.get(cleanToken);
      const storageKey = `${STORAGE_PREFIX}${cleanToken}`;

      if (!payload) {
        try {
          const raw = await AsyncStorage.getItem(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (isValidPayloadSchema(parsed)) {
              payload = parsed;
            } else {
              // Malformed in storage: purge immediately
              await this.purgeToken(cleanToken);
              return { valid: false, error: 'MALFORMED' };
            }
          }
        } catch {
          return { valid: false, error: 'STORAGE_ERROR' };
        }
      }

      if (!payload) {
        return { valid: false, error: 'NOT_FOUND' };
      }

      // 3. Complete schema validation
      if (!isValidPayloadSchema(payload)) {
        await this.purgeToken(cleanToken);
        return { valid: false, error: 'MALFORMED' };
      }

      // 4. User isolation check: DO NOT DELETE token if user does not match
      if (payload.userId !== (currentUserId || '').trim()) {
        return { valid: false, error: 'UNAUTHORIZED' };
      }

      // 5. TTL Check
      if (Date.now() > payload.expiresAt) {
        await this.purgeToken(cleanToken);
        return { valid: false, error: 'EXPIRED' };
      }

      // 6. Valid: consume once by purging from storage & memory immediately.
      // Fail closed if persistent storage deletion fails to prevent token resurrection across process restarts.
      try {
        await this.purgeToken(cleanToken, true);
      } catch {
        return { valid: false, error: 'STORAGE_ERROR' };
      }

      return {
        valid: true,
        itemIds: payload.itemIds,
      };
    } finally {
      tokensBeingConsumed.delete(cleanToken);
    }
  }

  /**
   * Purges a token from both memory and AsyncStorage.
   * When throwOnStorageError is true, throws on storage removal failure to enforce fail-closed consume-once semantics.
   */
  async purgeToken(token: string, throwOnStorageError: boolean = false): Promise<void> {
    memoryStore.delete(token);
    try {
      await AsyncStorage.removeItem(`${STORAGE_PREFIX}${token}`);
    } catch (err) {
      if (throwOnStorageError) {
        throw err;
      }
    }
  }

  /**
   * Sweeps expired keys from AsyncStorage.
   */
  async sweepExpiredKeys(): Promise<number> {
    let sweptCount = 0;
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const transientKeys = allKeys.filter((k) => k.startsWith(STORAGE_PREFIX));
      const now = Date.now();

      for (const key of transientKeys) {
        try {
          const raw = await AsyncStorage.getItem(key);
          if (!raw) {
            await AsyncStorage.removeItem(key);
            sweptCount++;
            continue;
          }
          const parsed = JSON.parse(raw);
          if (!isValidPayloadSchema(parsed) || parsed.expiresAt < now) {
            await AsyncStorage.removeItem(key);
            const token = key.replace(STORAGE_PREFIX, '');
            memoryStore.delete(token);
            sweptCount++;
          }
        } catch {
          await AsyncStorage.removeItem(key);
          sweptCount++;
        }
      }
    } catch {
      // Ignore sweep errors
    }
    return sweptCount;
  }

  /**
   * Test-only helper to clear in-memory store and concurrency lock.
   */
  _resetMemoryStore(): void {
    memoryStore.clear();
    tokensBeingConsumed.clear();
  }
}

export const transientMannequinService = new TransientMannequinService();
