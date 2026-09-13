import * as SecureStore from 'expo-secure-store';

// Android's Keystore-backed SecureStore caps a single value at ~2048 bytes.
// Chunk oversized values across multiple keys instead of falling back to
// AsyncStorage, which is unencrypted.
const SECURE_STORE_LIMIT = 2000;

/**
 * Ensures key satisfies SecureStore requirements:
 * Only alphanumeric characters, '.', '-', and '_' are permitted.
 * Any disallowed characters (such as colons) are replaced with '_'.
 */
export function sanitizeSecureKey(key: string): string {
  if (!key) throw new Error('SecureStore key cannot be empty');
  return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

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
  try {
    const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
    if (!countStr) return null;
    const count = parseInt(countStr, 10);
    if (isNaN(count) || count <= 0) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}_c${i}`)),
    );
    return parts.some((p) => p == null) ? null : parts.join('');
  } catch {
    return null;
  }
}

async function deleteChunked(key: string) {
  try {
    const countStr = await SecureStore.getItemAsync(`${key}_chunks`);
    if (!countStr) return;
    const count = parseInt(countStr, 10);
    if (isNaN(count) || count <= 0) return;
    await Promise.all([
      SecureStore.deleteItemAsync(`${key}_chunks`).catch(() => {}),
      ...Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}_c${i}`).catch(() => {})),
    ]);
  } catch {
    // Silently ignore if chunks cannot be read or deleted
  }
}

export async function setSecureValue(key: string, value: string): Promise<void> {
  const safeKey = sanitizeSecureKey(key);
  try {
    if (value.length > 2048) {
      await SecureStore.deleteItemAsync(safeKey).catch(() => {});
      await deleteChunked(safeKey);
      await setChunked(safeKey, value);
    } else {
      await deleteChunked(safeKey);
      await SecureStore.setItemAsync(safeKey, value);
    }
  } catch (err) {
    console.warn(`[secureStorage] setSecureValue failed for key "${safeKey}":`, err);
  }
}

export async function getSecureValue(key: string): Promise<string | null> {
  const safeKey = sanitizeSecureKey(key);
  try {
    return (await SecureStore.getItemAsync(safeKey)) ?? (await getChunked(safeKey));
  } catch (err) {
    console.warn(`[secureStorage] getSecureValue failed for key "${safeKey}":`, err);
    return null;
  }
}

export async function deleteSecureValue(key: string): Promise<void> {
  const safeKey = sanitizeSecureKey(key);
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(safeKey).catch(() => {}),
      deleteChunked(safeKey),
    ]);
  } catch (err) {
    console.warn(`[secureStorage] deleteSecureValue failed for key "${safeKey}":`, err);
  }
}
