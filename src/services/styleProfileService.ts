import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { DEFAULT_STYLE_PROFILE } from '../utils/personalStyleEngine';

const STORAGE_KEY_PREFIX = 'jezsy_style_profile_';

// Track if public.user_style_profiles is present in PostgREST schema cache
let isRemoteTableUnavailable = false;

export const styleProfileService = {
  /**
   * Retrieves a user's style profile, with local AsyncStorage caching for offline speed
   */
  async getProfile(userId: string): Promise<UserStyleProfileDto> {
    const cacheKey = `${STORAGE_KEY_PREFIX}${userId}`;

    // 1. Try local cache first
    let cachedProfile: UserStyleProfileDto | null = null;
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        cachedProfile = JSON.parse(raw);
      }
    } catch {
      // Ignore cache read error
    }

    // If remote table was already identified as absent/unmigrated in PostgREST schema cache, skip network 404
    if (isRemoteTableUnavailable && cachedProfile) {
      return cachedProfile;
    }

    // 2. Fetch from Supabase if table is available
    if (!isRemoteTableUnavailable) {
      try {
        const { data, error } = await (supabase as any)
          .from('user_style_profiles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) {
          // PGRST205 or 404 means table is not registered in PostgREST schema cache
          if (error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'))) {
            isRemoteTableUnavailable = true;
            if (__DEV__) {
              console.info(
                '[styleProfileService] user_style_profiles table not in PostgREST schema cache; using client storage.'
              );
            }
          }
        } else if (data) {
          const remoteProfile: UserStyleProfileDto = {
            userId: data.user_id,
            preferredGarmentTypes: data.preferred_garment_types || [],
            preferredFits: data.preferred_fits || [],
            preferredOccasions: data.preferred_occasions || [],
            avoidedPatterns: data.avoided_patterns || [],
            avoidedColors: data.avoided_colors || [],
            preferredColors: data.preferred_colors || [],
            styleKeywords: data.style_keywords || [],
            explicitPreferences: data.explicit_preferences || {},
            preferenceWeights: data.preference_weights || DEFAULT_STYLE_PROFILE.preferenceWeights,
            feedbackCount: data.feedback_count || 0,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          };
          await AsyncStorage.setItem(cacheKey, JSON.stringify(remoteProfile));
          return remoteProfile;
        }
      } catch (err: any) {
        // Network or fetch failure
        if (err?.code === 'PGRST205' || err?.status === 404) {
          isRemoteTableUnavailable = true;
        }
      }
    }

    if (cachedProfile) {
      return cachedProfile;
    }

    // Return default profile
    const initialProfile: UserStyleProfileDto = {
      userId,
      ...DEFAULT_STYLE_PROFILE,
    };
    return initialProfile;
  },

  /**
   * Saves or updates a user's style profile locally and in Supabase
   */
  async saveProfile(profile: UserStyleProfileDto): Promise<void> {
    const cacheKey = `${STORAGE_KEY_PREFIX}${profile.userId}`;
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(profile));
    } catch {
      // Ignore cache write error
    }

    if (!isRemoteTableUnavailable) {
      try {
        await (supabase as any).from('user_style_profiles').upsert({
          user_id: profile.userId,
          preferred_garment_types: profile.preferredGarmentTypes,
          preferred_fits: profile.preferredFits,
          preferred_occasions: profile.preferredOccasions,
          avoided_patterns: profile.avoidedPatterns,
          avoided_colors: profile.avoidedColors,
          preferred_colors: profile.preferredColors,
          style_keywords: profile.styleKeywords,
          explicit_preferences: profile.explicitPreferences,
          preference_weights: profile.preferenceWeights,
          feedback_count: profile.feedbackCount,
          updated_at: new Date().toISOString(),
        });
      } catch (err: any) {
        if (err?.code === 'PGRST205' || err?.status === 404) {
          isRemoteTableUnavailable = true;
        }
      }
    }
  },
};
