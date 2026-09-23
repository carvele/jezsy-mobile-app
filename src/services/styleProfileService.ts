import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserStyleProfileDto } from '../types/dto/styleProfile';
import { DEFAULT_STYLE_PROFILE } from '../utils/personalStyleEngine';
import { styleDnaSyncManager } from './styling/styleDnaSyncManager';

const STORAGE_KEY_PREFIX = 'jezsy_style_profile_';

/**
 * Manages user style preferences.
 * Uses persistent Style DNA sync manager under the hood with local fallback.
 */
export const styleProfileService = {
  /**
   * Retrieves a user's style profile, merging local compatibility state with persistent Style DNA.
   */
  async getProfile(userId: string): Promise<UserStyleProfileDto> {
    const cacheKey = `${STORAGE_KEY_PREFIX}${userId}`;
    let legacyProfile: UserStyleProfileDto | null = null;

    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        legacyProfile = JSON.parse(raw);
      }
    } catch {
      // Return default profile on read error
    }

    // Retrieve persistent Style DNA projection
    const styleDna = await styleDnaSyncManager.getProfile(userId);

    const initialProfile: UserStyleProfileDto = {
      userId,
      ...DEFAULT_STYLE_PROFILE,
      ...(legacyProfile || {}),
      // Clean legacy pass corruption: discard legacy avoided arrays if they came from unverified legacy passes
      avoidedColors: (styleDna.explicitPreferences?.avoidedColors as string[]) || [],
      avoidedPatterns: (styleDna.explicitPreferences?.avoidedPatterns as string[]) || [],
      preferredColors: (styleDna.explicitPreferences?.preferredColors as string[]) || legacyProfile?.preferredColors || [],
      preferredFits: (styleDna.explicitPreferences?.preferredFits as string[]) || legacyProfile?.preferredFits || ['Regular'],
      explicitPreferences: {
        ...(legacyProfile?.explicitPreferences || {}),
        ...(styleDna.explicitPreferences || {}),
      },
      styleDna,
    };

    return initialProfile;
  },

  /**
   * Saves or updates a user's style profile locally.
   */
  async saveProfile(profile: UserStyleProfileDto): Promise<void> {
    const cacheKey = `${STORAGE_KEY_PREFIX}${profile.userId}`;
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(profile));
    } catch {
      // Ignore cache write error
    }
  },

  /**
   * Retrieves the user's persistent Style DNA profile.
   */
  async getStyleDnaProfile(userId: string) {
    return styleDnaSyncManager.getProfile(userId);
  },

  /**
   * Records an explicit preference setting change.
   */
  async recordExplicitSetting(
    userId: string,
    key: any,
    value: unknown,
    action: any = 'set'
  ) {
    return styleDnaSyncManager.recordExplicitSetting(userId, key, value, action);
  },

  /**
   * Resets learned preferences to baseline while preserving explicit settings.
   */
  async recordLearningReset(userId: string) {
    return styleDnaSyncManager.resetLearnedPreferences(userId);
  },

  /**
   * Records explicit feedback (e.g., too formal, too casual).
   */
  async recordExplicitFeedback(
    userId: string,
    feedbackKind: any,
    aestheticTokens?: any
  ) {
    return styleDnaSyncManager.recordExplicitFeedback(userId, feedbackKind, aestheticTokens);
  },

  /**
   * Access to the Style DNA Sync Manager.
   */
  getSyncManager() {
    return styleDnaSyncManager;
  },
};
