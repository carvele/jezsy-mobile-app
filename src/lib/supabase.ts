import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { Database } from '@/src/types/database.types';

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

async function setSecureValue(key: string, value: string) {
  if (value.length > 2048) {
    await SecureStore.deleteItemAsync(key);
    await setChunked(key, value);
  } else {
    await deleteChunked(key);
    await SecureStore.setItemAsync(key, value);
  }
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      const minimalSessionStr = (await SecureStore.getItemAsync(key)) ?? (await getChunked(key));
      if (!minimalSessionStr) return null;

      // Only session values are split with a companion `_user` entry; other
      // keys (e.g. the PKCE code verifier) pass through unchanged.
      const userStr = await SecureStore.getItemAsync(`${key}_user`);
      if (!userStr) return minimalSessionStr;

      const minimalSession = JSON.parse(minimalSessionStr);
      minimalSession.user = JSON.parse(userStr);
      return JSON.stringify(minimalSession);
    } catch (e) {
      console.error('Error in ExpoSecureStoreAdapter.getItem:', e);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      const session = JSON.parse(value);
      if (session && session.access_token && session.user) {
        // Persist only the fields the app actually reads back off a restored
        // session (id/email/user_metadata), not the full Supabase user object
        // -- phone, app_metadata, identities, etc are unused PII at rest.
        const { id, email, user_metadata } = session.user;
        await SecureStore.setItemAsync(`${key}_user`, JSON.stringify({ id, email, user_metadata }));

        const { user: _, ...minimalSession } = session;
        await setSecureValue(key, JSON.stringify(minimalSession));
      } else {
        await setSecureValue(key, value);
      }
    } catch (e) {
      console.error('Error in ExpoSecureStoreAdapter.setItem:', e);
      await setSecureValue(key, value).catch(() => {});
    }
  },
  removeItem: async (key: string) => {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(key),
        SecureStore.deleteItemAsync(`${key}_user`),
        deleteChunked(key),
      ]);
    } catch (e) {
      console.error('Error in ExpoSecureStoreAdapter.removeItem:', e);
    }
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.');
}

// Only detect session in URL when there's actually an auth callback in the URL
// (e.g. after email confirmation or OAuth). Setting this unconditionally to `true`
// caused Supabase to fire onAuthStateChange on EVERY in-app tab navigation on web
// (Home → Wardrobe, etc.) because the URL pathname changed, triggering syncProfile
// and a full auth re-check that would briefly unmount the wardrobe screen.
const hasAuthCallbackInUrl =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  (window.location.hash.includes('access_token') ||
    window.location.hash.includes('error=') ||
    window.location.search.includes('code=') ||
    window.location.search.includes('token='));

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? (typeof window !== 'undefined' ? window.localStorage : undefined) : ExpoSecureStoreAdapter as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: hasAuthCallbackInUrl,
  },
});
