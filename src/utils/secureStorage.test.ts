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

  describe('setSecureValue and getSecureValue', () => {
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

  describe('deleteSecureValue', () => {
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
});
