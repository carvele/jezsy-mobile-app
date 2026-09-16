import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { OutfitFeedbackInput } from '../types/dto/styleProfile';
import { WardrobeItem } from './wardrobeService';
import { styleProfileService } from './styleProfileService';
import { updateProfileFromFeedback } from '../utils/personalStyleEngine';

const LOCAL_PASSED_KEY = 'jezsy_wardrobe_passed_suggestions_';

export const outfitFeedbackService = {
  /**
   * Logs a feedback event (like, dislike, save, reject, worn, rate) and automatically updates the style profile
   */
  async logFeedback(
    input: OutfitFeedbackInput,
    items: WardrobeItem[] = []
  ): Promise<void> {
    const itemIds = input.wardrobeItemIds || items.map((i) => i.id);

    // 1. If rejected or passed, record in local storage for instant filtering
    if (input.feedbackType === 'rejected' || input.feedbackType === 'disliked') {
      try {
        const cacheKey = `${LOCAL_PASSED_KEY}${input.userId}`;
        const existingRaw = await AsyncStorage.getItem(cacheKey);
        const existingIds: string[] = existingRaw ? JSON.parse(existingRaw) : [];
        const outfitSignature = itemIds.sort().join('_');
        if (!existingIds.includes(outfitSignature)) {
          existingIds.push(outfitSignature);
          await AsyncStorage.setItem(cacheKey, JSON.stringify(existingIds.slice(-50)));
        }
      } catch {
        // Ignore local storage error
      }
    }

    // 2. Persist feedback event in Supabase outfit_feedback table
    try {
      await (supabase as any).from('outfit_feedback').insert({
        user_id: input.userId,
        outfit_id: input.outfitId || null,
        feedback_type: input.feedbackType,
        rating: input.rating || null,
        occasion: input.occasion || null,
        wardrobe_item_ids: itemIds,
        context: input.context || {},
      });
    } catch (err) {
      console.warn('Could not persist outfit feedback to Supabase (offline or network error):', err);
    }

    // 3. Update personal style profile weights
    if (items.length > 0) {
      try {
        const currentProfile = await styleProfileService.getProfile(input.userId);
        const updated = updateProfileFromFeedback(
          currentProfile,
          input.feedbackType,
          items,
          input.occasion
        );
        await styleProfileService.saveProfile(updated);
      } catch (err) {
        console.warn('Failed to update style profile from feedback:', err);
      }
    }
  },

  /**
   * Checks if an outfit signature has been passed by the user
   */
  async isOutfitPassed(userId: string, itemIds: string[]): Promise<boolean> {
    try {
      const cacheKey = `${LOCAL_PASSED_KEY}${userId}`;
      const existingRaw = await AsyncStorage.getItem(cacheKey);
      if (!existingRaw) return false;
      const passedList: string[] = JSON.parse(existingRaw);
      const signature = itemIds.sort().join('_');
      return passedList.includes(signature);
    } catch {
      return false;
    }
  },
};
