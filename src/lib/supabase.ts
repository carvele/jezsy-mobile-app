import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { Database } from '@/src/types/database.types';
import { setSecureValue, getSecureValue, deleteSecureValue } from '@/src/utils/secureStorage';

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      const minimalSessionStr = await getSecureValue(key);
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
        deleteSecureValue(key),
        SecureStore.deleteItemAsync(`${key}_user`),
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
