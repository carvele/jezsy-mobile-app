import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { DEFAULT_STYLE_PROFILE } from '../utils/personalStyleEngine';

const STORAGE_KEY_PREFIX = 'jezsy_style_profile_';

/**
 * Manages user style preferences.
 * Uses local-first AsyncStorage persistence to ensure fast, reliable style preference
 * storage without incurring unnecessary remote database round-trips or 404s on
 * unexposed remote tables.
 */
export const styleProfileService = {
  /**
   * Retrieves a user's style profile from local persistent storage
   */
  async getProfile(userId: string): Promise<UserStyleProfileDto> {
    const cacheKey = `${STORAGE_KEY_PREFIX}${userId}`;

    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // Return default profile on read error
    }

    const initialProfile: UserStyleProfileDto = {
      userId,
      ...DEFAULT_STYLE_PROFILE,
    };
    return initialProfile;
  },

  /**
   * Saves or updates a user's style profile locally
   */
  async saveProfile(profile: UserStyleProfileDto): Promise<void> {
    const cacheKey = `${STORAGE_KEY_PREFIX}${profile.userId}`;
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(profile));
    } catch {
      // Ignore cache write error
    }
  },
};
