import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  sanitizeSecureKey,
  setSecureValue,
  getSecureValue,
  deleteSecureValue,
} from './secureStorage';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
    __store: store,
    __clearStore: () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
  };
});

describe('secureStorage', () => {
  const mockStore = SecureStore as unknown as {
    __store: Record<string, string>;
    __clearStore: () => void;
    getItemAsync: jest.Mock;
    setItemAsync: jest.Mock;
    deleteItemAsync: jest.Mock;
  };

  beforeEach(() => {
    Platform.OS = 'android';
    mockStore.__clearStore();
    jest.clearAllMocks();
  });

  describe('sanitizeSecureKey', () => {
    test('preserves valid characters (alphanumeric, dot, dash, underscore)', () => {
      expect(sanitizeSecureKey('valid_key-123.test')).toBe('valid_key-123.test');
    });

    test('replaces invalid characters such as colons with underscores', () => {
      expect(sanitizeSecureKey('jezsy_profile_cache:user-123')).toBe('jezsy_profile_cache_user-123');
      expect(sanitizeSecureKey('key with spaces/slashes:colons')).toBe('key_with_spaces_slashes_colons');
    });

    test('throws when key is empty', () => {
      expect(() => sanitizeSecureKey('')).toThrow('SecureStore key cannot be empty');
    });
  });

  describe('setSecureValue and getSecureValue (native)', () => {
    test('stores and retrieves small values directly with sanitized key', async () => {
      await setSecureValue('cache:user_1', 'hello world');
      expect(mockStore.setItemAsync).toHaveBeenCalledWith('cache_user_1', 'hello world');

      const retrieved = await getSecureValue('cache:user_1');
      expect(retrieved).toBe('hello world');
    });

    test('chunks values exceeding 2048 bytes and reassembles them', async () => {
      const largeValue = 'A'.repeat(5000);
      await setSecureValue('large_key', largeValue);

      // Should have deleted old key/chunks and set chunks
      expect(mockStore.setItemAsync).toHaveBeenCalledWith('large_key_chunks', '3');
      expect(mockStore.setItemAsync).toHaveBeenCalledWith('large_key_c0', 'A'.repeat(2000));
      expect(mockStore.setItemAsync).toHaveBeenCalledWith('large_key_c1', 'A'.repeat(2000));
      expect(mockStore.setItemAsync).toHaveBeenCalledWith('large_key_c2', 'A'.repeat(1000));

      const retrieved = await getSecureValue('large_key');
      expect(retrieved).toBe(largeValue);
    });

    test('handles storage exceptions gracefully without throwing', async () => {
      mockStore.getItemAsync.mockRejectedValueOnce(new Error('Tracking prevention blocked access'));
      const result = await getSecureValue('some_key');
      expect(result).toBeNull();

      mockStore.setItemAsync.mockRejectedValueOnce(new Error('Storage quota exceeded'));
      await expect(setSecureValue('some_key', 'value')).resolves.not.toThrow();
    });
  });

  describe('deleteSecureValue (native)', () => {
    test('deletes direct key and any chunk keys for chunked data', async () => {
      const largeValue = 'B'.repeat(3000);
      await setSecureValue('to_delete', largeValue);
      await deleteSecureValue('to_delete');

      expect(mockStore.deleteItemAsync).toHaveBeenCalledWith('to_delete');
      expect(mockStore.deleteItemAsync).toHaveBeenCalledWith('to_delete_chunks');
      expect(mockStore.deleteItemAsync).toHaveBeenCalledWith('to_delete_c0');
      expect(mockStore.deleteItemAsync).toHaveBeenCalledWith('to_delete_c1');
    });

    test('handles deletion errors gracefully without throwing', async () => {
      mockStore.deleteItemAsync.mockRejectedValueOnce(new Error('Storage unavailable'));
      await expect(deleteSecureValue('to_delete')).resolves.not.toThrow();
    });
  });

  describe('web environment (Platform.OS = web)', () => {
    let webStorageMock: Record<string, string>;

    beforeEach(() => {
      Platform.OS = 'web';
      webStorageMock = {};
      (global as any).window = {
        localStorage: {
          getItem: jest.fn((k: string) => webStorageMock[k] ?? null),
          setItem: jest.fn((k: string, v: string) => {
            webStorageMock[k] = v;
          }),
          removeItem: jest.fn((k: string) => {
            delete webStorageMock[k];
          }),
        },
      };
    });

    afterEach(() => {
      delete (global as any).window;
    });

    test('reads and writes to localStorage on web without calling SecureStore', async () => {
      await setSecureValue('web_cache:user_1', 'web_val');
      expect(mockStore.setItemAsync).not.toHaveBeenCalled();
      expect(webStorageMock['web_cache_user_1']).toBe('web_val');

      const retrieved = await getSecureValue('web_cache:user_1');
      expect(retrieved).toBe('web_val');
      expect(mockStore.getItemAsync).not.toHaveBeenCalled();

      await deleteSecureValue('web_cache:user_1');
      expect(webStorageMock['web_cache_user_1']).toBeUndefined();
      expect(mockStore.deleteItemAsync).not.toHaveBeenCalled();
    });

    test('falls back to in-memory store if window.localStorage is unavailable', async () => {
      delete (global as any).window;
      await setSecureValue('mem_key', 'mem_val');
      const retrieved = await getSecureValue('mem_key');
      expect(retrieved).toBe('mem_val');
      expect(mockStore.setItemAsync).not.toHaveBeenCalled();

      await deleteSecureValue('mem_key');
      const afterDelete = await getSecureValue('mem_key');
      expect(afterDelete).toBeNull();
    });
  });
});
