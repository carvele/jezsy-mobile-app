import AsyncStorage from '@react-native-async-storage/async-storage';

let mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage[key] || null),
    setItem: jest.fn(async (key: string, val: string) => {
      mockStorage[key] = String(val);
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockStorage[key];
    }),
    getAllKeys: jest.fn(async () => Object.keys(mockStorage)),
    clear: jest.fn(async () => {
      mockStorage = {};
    }),
  },
}));
import {
  transientMannequinService,
  isValidPayloadSchema,
  TransientMannequinPayload,
} from '../transientMannequinService';

describe('transientMannequinService', () => {
  const userId = 'user_abc_123';
  const itemIds = ['garment_1', 'garment_2', 'garment_3'];

  beforeEach(async () => {
    transientMannequinService._resetMemoryStore();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('Token Creation & Validation Schema', () => {
    it('creates an opaque token prefixed with tr_ and saves to AsyncStorage', async () => {
      const res = await transientMannequinService.createToken({
        userId,
        itemIds,
        source: 'style-advisor',
      });

      expect(res.success).toBe(true);
      expect(res.token).toMatch(/^tr_[0-9a-f-]+$/);

      const raw = await AsyncStorage.getItem(`@jezsy_transient_mannequin_${res.token}`);
      expect(raw).toBeTruthy();
      const parsed: TransientMannequinPayload = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(parsed.userId).toBe(userId);
      expect(parsed.itemIds).toEqual(itemIds);
      expect(parsed.source).toBe('style-advisor');
      expect(parsed.expiresAt).toBeGreaterThan(parsed.createdAt);
    });

    it('deduplicates item IDs and rejects empty item sets', async () => {
      const resDup = await transientMannequinService.createToken({
        userId,
        itemIds: ['item_1', 'item_1', 'item_2'],
        source: 'passive-outfits',
      });
      expect(resDup.success).toBe(true);

      const resEmpty = await transientMannequinService.createToken({
        userId,
        itemIds: [],
        source: 'style-advisor',
      });
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.error).toBe('EMPTY_ITEM_IDS');

      const resInvalidUser = await transientMannequinService.createToken({
        userId: '   ',
        itemIds,
        source: 'style-advisor',
      });
      expect(resInvalidUser.success).toBe(false);
      expect(resInvalidUser.error).toBe('INVALID_USER_ID');
    });

    it('rejects invalid payload schema across all fields', () => {
      const now = Date.now();
      expect(isValidPayloadSchema(null)).toBe(false);
      expect(isValidPayloadSchema({})).toBe(false);
      expect(isValidPayloadSchema({ version: 2, userId, itemIds, createdAt: now, expiresAt: now + 1000, source: 'style-advisor' })).toBe(false);
      expect(isValidPayloadSchema({ version: 1, userId: '', itemIds, createdAt: now, expiresAt: now + 1000, source: 'style-advisor' })).toBe(false);
      expect(isValidPayloadSchema({ version: 1, userId, itemIds: [], createdAt: now, expiresAt: now + 1000, source: 'style-advisor' })).toBe(false);
      expect(isValidPayloadSchema({ version: 1, userId, itemIds: [''], createdAt: now, expiresAt: now + 1000, source: 'style-advisor' })).toBe(false);
      expect(isValidPayloadSchema({ version: 1, userId, itemIds, createdAt: NaN, expiresAt: now + 1000, source: 'style-advisor' })).toBe(false);
      expect(isValidPayloadSchema({ version: 1, userId, itemIds, createdAt: now, expiresAt: now - 1000, source: 'style-advisor' })).toBe(false);
      expect(isValidPayloadSchema({ version: 1, userId, itemIds, createdAt: now, expiresAt: now + 1000, source: 'invalid-source' as any })).toBe(false);
    });
  });

  describe('Consume-Once & Lifecycle Semantics', () => {
    it('consumes token successfully once and deletes from memory and storage', async () => {
      const { token } = await transientMannequinService.createToken({
        userId,
        itemIds,
        source: 'style-advisor',
      });

      const firstConsume = await transientMannequinService.consumeToken(token!, userId);
      expect(firstConsume.valid).toBe(true);
      expect(firstConsume.itemIds).toEqual(itemIds);

      // Second consumption must fail as CONSUMED / NOT_FOUND
      const secondConsume = await transientMannequinService.consumeToken(token!, userId);
      expect(secondConsume.valid).toBe(false);
      expect(secondConsume.error).toBe('NOT_FOUND');

      // Storage must be purged
      const raw = await AsyncStorage.getItem(`@jezsy_transient_mannequin_${token}`);
      expect(raw).toBeNull();
    });

    it('rejects unauthorized access WITHOUT deleting the legitimate owner token', async () => {
      const { token } = await transientMannequinService.createToken({
        userId: 'owner_user_456',
        itemIds,
        source: 'style-advisor',
      });

      // Wrong user tries to consume
      const wrongUserConsume = await transientMannequinService.consumeToken(token!, 'intruder_user_999');
      expect(wrongUserConsume.valid).toBe(false);
      expect(wrongUserConsume.error).toBe('UNAUTHORIZED');

      // Legitimate owner should STILL be able to consume the token
      const ownerConsume = await transientMannequinService.consumeToken(token!, 'owner_user_456');
      expect(ownerConsume.valid).toBe(true);
      expect(ownerConsume.itemIds).toEqual(itemIds);
    });

    it('rejects and purges expired tokens', async () => {
      const { token } = await transientMannequinService.createToken({
        userId,
        itemIds,
        source: 'style-advisor',
      });

      // Advance time beyond 5-minute TTL
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);

      const res = await transientMannequinService.consumeToken(token!, userId);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('EXPIRED');

      // Token purged
      const raw = await AsyncStorage.getItem(`@jezsy_transient_mannequin_${token}`);
      expect(raw).toBeNull();

      jest.restoreAllMocks();
    });

    it('recovers payload from AsyncStorage if in-memory store was cleared (process death simulation)', async () => {
      const { token } = await transientMannequinService.createToken({
        userId,
        itemIds,
        source: 'passive-outfits',
      });

      // Simulate process death / memory dump
      transientMannequinService._resetMemoryStore();

      const res = await transientMannequinService.consumeToken(token!, userId);
      expect(res.valid).toBe(true);
      expect(res.itemIds).toEqual(itemIds);
    });

    it('rejects concurrent double consumption within same tick', async () => {
      const { token } = await transientMannequinService.createToken({
        userId,
        itemIds,
        source: 'style-advisor',
      });

      const [res1, res2] = await Promise.all([
        transientMannequinService.consumeToken(token!, userId),
        transientMannequinService.consumeToken(token!, userId),
      ]);

      const successCount = (res1.valid ? 1 : 0) + (res2.valid ? 1 : 0);
      expect(successCount).toBe(1);
    });
  });

  describe('Storage Failure & Sweep Modes', () => {
    it('fails closed and does not leave orphan in memory on AsyncStorage.setItem failure', async () => {
      jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('Disk full'));

      const res = await transientMannequinService.createToken({
        userId,
        itemIds,
        source: 'style-advisor',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('STORAGE_WRITE_FAILURE');

      // Verify no orphan tokens in memory
      transientMannequinService._resetMemoryStore();
      jest.restoreAllMocks();
    });

    it('returns STORAGE_ERROR if AsyncStorage.getItem throws', async () => {
      transientMannequinService._resetMemoryStore();
      jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('Corrupt storage'));

      const res = await transientMannequinService.consumeToken('tr_some_token', userId);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('STORAGE_ERROR');

      jest.restoreAllMocks();
    });

    it('fails closed and returns STORAGE_ERROR if AsyncStorage.removeItem fails during consumeToken', async () => {
      const { token } = await transientMannequinService.createToken({
        userId,
        itemIds,
        source: 'style-advisor',
      });

      // Simulate disk write error during token invalidation
      jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('Read-only filesystem'));

      const res = await transientMannequinService.consumeToken(token!, userId);
      // Strict invariant: if persistent token invalidation fails, MUST fail closed!
      expect(res.valid).toBe(false);
      expect(res.error).toBe('STORAGE_ERROR');
      expect(res.itemIds).toBeUndefined();

      jest.restoreAllMocks();
    });

    it('sweeps expired keys cleanly from AsyncStorage', async () => {
      const now = Date.now();
      const expiredPayload: TransientMannequinPayload = {
        version: 1,
        userId,
        itemIds,
        createdAt: now - 10 * 60 * 1000,
        expiresAt: now - 5 * 60 * 1000,
        source: 'style-advisor',
      };
      const validPayload: TransientMannequinPayload = {
        version: 1,
        userId,
        itemIds,
        createdAt: now,
        expiresAt: now + 5 * 60 * 1000,
        source: 'style-advisor',
      };

      await AsyncStorage.setItem('@jezsy_transient_mannequin_expired_1', JSON.stringify(expiredPayload));
      await AsyncStorage.setItem('@jezsy_transient_mannequin_valid_1', JSON.stringify(validPayload));
      await AsyncStorage.setItem('@jezsy_transient_mannequin_malformed_1', '{ bad json');

      const swept = await transientMannequinService.sweepExpiredKeys();
      expect(swept).toBe(2); // 1 expired + 1 malformed

      const survivingValid = await AsyncStorage.getItem('@jezsy_transient_mannequin_valid_1');
      expect(survivingValid).toBeTruthy();
    });
  });
});
