import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveAuthReturnTarget,
  getAuthReturnTarget,
  consumeAuthReturnTarget,
  clearAuthReturnTarget,
  savePendingEntryTarget,
  getPendingEntryTarget,
  consumePendingEntryTarget,
  sanitizeAuthReturnTarget,
  sanitizePendingEntryTarget,
  AUTH_RETURN_STORAGE_KEY,
  PENDING_ENTRY_STORAGE_KEY,
  AUTH_RETURN_TTL_MS,
  PENDING_ENTRY_TTL_MS,
} from '../authReturnTarget';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] || null),
      setItem: jest.fn(async (key: string, val: string) => { store[key] = val; }),
      removeItem: jest.fn(async (key: string) => { delete store[key]; }),
      clear: jest.fn(async () => { store = {}; }),
    },
  };
});

describe('authReturnTarget', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('sanitizeAuthReturnTarget', () => {
    it('accepts valid internal routes with allowlisted params and actions', () => {
      const target = sanitizeAuthReturnTarget({
        pathname: '/reserve/[id]',
        params: { id: 'prod-123', size: 'M', color: 'Blue', unknownParam: 'discardMe' },
        action: 'reserve',
      });

      expect(target).toEqual({
        pathname: '/reserve/[id]',
        params: { id: 'prod-123', size: 'M', color: 'Blue' },
        action: 'reserve',
        createdAt: expect.any(Number),
      });
    });

    it('rejects targets missing mandatory path params', () => {
      const target = sanitizeAuthReturnTarget({
        pathname: '/product/[id]',
        params: {},
        action: 'wishlist',
      });

      expect(target).toBeNull();
    });

    it('rejects un-allowlisted routes', () => {
      const target = sanitizeAuthReturnTarget({
        pathname: '/admin/settings',
        params: { id: '1' },
        action: 'generic',
      });

      expect(target).toBeNull();
    });

    it('defaults invalid action to generic', () => {
      const target = sanitizeAuthReturnTarget({
        pathname: '/product/[id]',
        params: { id: 'p1' },
        action: 'invalid_action' as any,
      });

      expect(target?.action).toBe('generic');
    });
  });

  describe('sanitizePendingEntryTarget', () => {
    it('allows valid public product routes', () => {
      const target = sanitizePendingEntryTarget('/product/cotton-tee-123');
      expect(target).toEqual({
        pathname: '/product/[id]',
        params: { id: 'cotton-tee-123' },
        createdAt: expect.any(Number),
      });
    });

    it('allows public product reviews with params', () => {
      const target = sanitizePendingEntryTarget('/product/reviews', {
        productId: 'prod-999',
        name: 'Silk Blouse',
        extraInjection: 'malicious',
      });

      expect(target).toEqual({
        pathname: '/product/reviews',
        params: { productId: 'prod-999', name: 'Silk Blouse' },
        createdAt: expect.any(Number),
      });
    });

    it('allows explore and home tabs', () => {
      expect(sanitizePendingEntryTarget('/explore')?.pathname).toBe('/explore');
      expect(sanitizePendingEntryTarget('/')?.pathname).toBe('/(tabs)');
      expect(sanitizePendingEntryTarget('/(tabs)')?.pathname).toBe('/(tabs)');
    });

    it('strictly rejects private routes', () => {
      expect(sanitizePendingEntryTarget('/reserve/prod-123')).toBeNull();
      expect(sanitizePendingEntryTarget('/payment/pay-123')).toBeNull();
      expect(sanitizePendingEntryTarget('/messages')).toBeNull();
      expect(sanitizePendingEntryTarget('/admin/inventory')).toBeNull();
      expect(sanitizePendingEntryTarget('/profile')).toBeNull();
      expect(sanitizePendingEntryTarget('/account')).toBeNull();
    });

    it('rejects path traversal and protocol injections', () => {
      expect(sanitizePendingEntryTarget('/product/../secret')).toBeNull();
      expect(sanitizePendingEntryTarget('https://evil.com')).toBeNull();
      expect(sanitizePendingEntryTarget('//evil.com')).toBeNull();
    });
  });

  describe('AuthReturnTarget Storage & Lifecycle', () => {
    it('persists and retrieves return target within 15-min TTL', async () => {
      const now = 1000000;
      await saveAuthReturnTarget({
        pathname: '/product/[id]',
        params: { id: 'prod-1' },
        action: 'wishlist',
        createdAt: now,
      });

      const target = await getAuthReturnTarget(now + 5 * 60 * 1000); // 5 mins later
      expect(target).not.toBeNull();
      expect(target?.params.id).toBe('prod-1');
    });

    it('discards and removes return target after 15-min TTL', async () => {
      const now = 1000000;
      await saveAuthReturnTarget({
        pathname: '/product/[id]',
        params: { id: 'prod-1' },
        action: 'wishlist',
        createdAt: now,
      });

      const target = await getAuthReturnTarget(now + AUTH_RETURN_TTL_MS + 1000); // Expired
      expect(target).toBeNull();
      expect(await AsyncStorage.getItem(AUTH_RETURN_STORAGE_KEY)).toBeNull();
    });

    it('atomically consumes target and clears storage', async () => {
      const now = 1000000;
      await saveAuthReturnTarget({
        pathname: '/product/[id]',
        params: { id: 'prod-1' },
        action: 'reserve',
        createdAt: now,
      });

      const target = await consumeAuthReturnTarget(now);
      expect(target?.action).toBe('reserve');
      expect(await getAuthReturnTarget(now)).toBeNull();
    });

    it('clears target on clearAuthReturnTarget', async () => {
      await saveAuthReturnTarget({
        pathname: '/product/[id]',
        params: { id: 'prod-1' },
        action: 'generic',
      });
      await clearAuthReturnTarget();
      expect(await getAuthReturnTarget()).toBeNull();
    });
  });

  describe('PendingEntryTarget Storage & Lifecycle', () => {
    it('persists and retrieves pending deep-link within 24 hours', async () => {
      const now = 1000000;
      const ok = await savePendingEntryTarget('/product/silk-tee');
      expect(ok).toBe(true);

      const target = await getPendingEntryTarget(now + 20 * 60 * 60 * 1000); // 20h later
      expect(target).not.toBeNull();
      expect(target?.params.id).toBe('silk-tee');
    });

    it('rejects invalid path and does not write storage', async () => {
      const ok = await savePendingEntryTarget('/admin/sensitive');
      expect(ok).toBe(false);
      expect(await AsyncStorage.getItem(PENDING_ENTRY_STORAGE_KEY)).toBeNull();
    });

    it('discards and clears pending target after 24 hours', async () => {
      const now = 1000000;
      await AsyncStorage.setItem(
        PENDING_ENTRY_STORAGE_KEY,
        JSON.stringify({
          pathname: '/product/[id]',
          params: { id: 'silk-tee' },
          createdAt: now,
        }),
      );

      const target = await getPendingEntryTarget(now + PENDING_ENTRY_TTL_MS + 1000);
      expect(target).toBeNull();
      expect(await AsyncStorage.getItem(PENDING_ENTRY_STORAGE_KEY)).toBeNull();
    });

    it('atomically consumes pending entry and clears storage', async () => {
      const now = 1000000;
      await AsyncStorage.setItem(
        PENDING_ENTRY_STORAGE_KEY,
        JSON.stringify({
          pathname: '/explore',
          params: {},
          createdAt: now,
        }),
      );

      const target = await consumePendingEntryTarget(now);
      expect(target?.pathname).toBe('/explore');
      expect(await getPendingEntryTarget(now)).toBeNull();
    });
  });
});
