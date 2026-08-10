import { cacheProductCatalog, getCachedCatalog } from './offlineSync';

// Mock AsyncStorage for node environment unit testing
jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] || null),
    setItem: jest.fn(async (key: string, val: string) => { store[key] = val; }),
    removeItem: jest.fn(async (key: string) => { delete store[key]; }),
    clear: jest.fn(async () => { store = {}; }),
    multiSet: jest.fn(async (kvPairs: [string, string][]) => {
      kvPairs.forEach(([k, v]) => { store[k] = v; });
    }),
    multiGet: jest.fn(async (keys: string[]) => {
      return keys.map((k) => [k, store[k] || null]);
    }),
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

describe('OfflineSync Service', () => {
  test('caches and retrieves product catalog within TTL', async () => {
    const products = [
      { id: '1', name: 'Silk Shirt', price: 1200, sale_price: null, on_sale: false, image_url: null, category: 'Tops', stock: 5 },
    ];

    await cacheProductCatalog(products);
    const cached = await getCachedCatalog();

    expect(cached).not.toBeNull();
    expect(cached?.length).toBe(1);
    expect(cached?.[0].name).toBe('Silk Shirt');
  });
});
