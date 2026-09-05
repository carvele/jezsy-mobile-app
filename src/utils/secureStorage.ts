import * as SecureStore from 'expo-secure-store';

// Android's Keystore-backed SecureStore caps a single value at ~2048 bytes.
// Chunk oversized values across multiple keys instead of falling back to
// AsyncStorage, which is unencrypted.
const SECURE_STORE_LIMIT = 2000;

async function setChunked(key: string, value: string) {
  const count = Math.ceil(value.length / SECURE_STORE_LIMIT);
  await SecureStore.setItemAsync(`${key}_chunks`, String(count));
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      SecureStore.setItemAsync(`${key}_c${i}`, value.slice(i * SECURE_STORE_LIMIT, (i + 1) * SECURE_STORE_LIMIT)),
    ),
  );
}

async function getChunked(key: string): Promise<string | null> {
  const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
  if (!countStr) return null;
  const count = parseInt(countStr, 10);
  const parts = await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}_c${i}`)),
  );
  return parts.some((p) => p == null) ? null : parts.join('');
}

async function deleteChunked(key: string) {
  const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
  if (!countStr) return;
  const count = parseInt(countStr, 10);
  await Promise.all([
    SecureStore.deleteItemAsync(`${key}_chunks`),
    ...Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}_c${i}`)),
  ]);
}

export async function setSecureValue(key: string, value: string) {
  if (value.length > 2048) {
    await SecureStore.deleteItemAsync(key);
    await deleteChunked(key);
    await setChunked(key, value);
  } else {
    await deleteChunked(key);
    await SecureStore.setItemAsync(key, value);
  }
}

export async function getSecureValue(key: string): Promise<string | null> {
  return (await SecureStore.getItemAsync(key)) ?? (await getChunked(key));
}

export async function deleteSecureValue(key: string) {
  await Promise.all([
    SecureStore.deleteItemAsync(key),
    deleteChunked(key),
  ]);
}
