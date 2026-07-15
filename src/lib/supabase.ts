import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { Database } from '@/src/types/database.types';

import AsyncStorage from '@react-native-async-storage/async-storage';

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    try {
      const minimalSessionStr = await SecureStore.getItemAsync(key);
      if (!minimalSessionStr) {
        // Fallback check in AsyncStorage
        return await AsyncStorage.getItem(key);
      }
      
      const minimalSession = JSON.parse(minimalSessionStr);
      // Retrieve the user object from AsyncStorage
      const userStr = await AsyncStorage.getItem(`${key}_user`);
      if (userStr) {
        minimalSession.user = JSON.parse(userStr);
      }
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
        // Extract user and store in AsyncStorage
        const user = session.user;
        await AsyncStorage.setItem(`${key}_user`, JSON.stringify(user));
        
        // Remove user from session to keep it small for SecureStore
        const { user: _, ...minimalSession } = session;
        const minimalSessionStr = JSON.stringify(minimalSession);
        
        if (minimalSessionStr.length > 2048) {
          console.warn('Session tokens exceed 2048 bytes, storing in AsyncStorage');
          await AsyncStorage.setItem(key, minimalSessionStr);
          await SecureStore.deleteItemAsync(key);
        } else {
          await SecureStore.setItemAsync(key, minimalSessionStr);
          await AsyncStorage.removeItem(key); // Clean up fallback
        }
      } else {
        if (value.length > 2048) {
          await AsyncStorage.setItem(key, value);
          await SecureStore.deleteItemAsync(key);
        } else {
          await SecureStore.setItemAsync(key, value);
          await AsyncStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error('Error in ExpoSecureStoreAdapter.setItem:', e);
      // Fallback
      if (value.length > 2048) {
        await AsyncStorage.setItem(key, value);
      } else {
        await SecureStore.setItemAsync(key, value);
      }
    }
  },
  removeItem: async (key: string) => {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(key),
        AsyncStorage.removeItem(key),
        AsyncStorage.removeItem(`${key}_user`),
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

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? (typeof window !== 'undefined' ? window.localStorage : undefined) : ExpoSecureStoreAdapter as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
