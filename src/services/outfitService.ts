import { supabase } from '@/src/lib/supabase';
import {
  OutfitItemDto,
  SaveOutfitInput,
  SaveOutfitResult,
} from '@/src/types/dto/outfit';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';

export const outfitService = {
  /**
   * Saves a composed outfit to saved_outfits.
   */
  async saveOutfit(input: SaveOutfitInput): Promise<DomainResult<SaveOutfitResult>> {
    try {
      const { data, error } = await supabase
        .from('saved_outfits')
        .insert({
          user_id: input.userId,
          name: input.name,
          items: input.items as any,
        })
        .select('id')
        .single();

      if (error) {
        throw error;
      }

      return domainOk({ id: data?.id || '' });
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_OUTFIT_SAVE_FAILED',
        message: err?.message || 'Failed to save outfit',
        domain: 'outfit',
        context: {
          operation: 'saveOutfit',
          userId: input.userId,
          name: input.name,
        },
        cause: err,
      });

      errorReporting.capture(domainError, {
        domain: 'outfit',
        operation: 'saveOutfit',
      });

      return domainFail(domainError);
    }
  },

  /**
   * Relational mirror of outfit items for product-page lookups.
   * Best-effort: failure does not roll back the canonical saved outfit.
   */
  async saveOutfitItems(outfitId: string, items: OutfitItemDto[]): Promise<DomainResult<void>> {
    try {
      const { error } = await supabase.from('outfit_items').insert(
        items.map((item) => ({
          outfit_id: outfitId,
          product_id: item.product_id ?? null,
          slot: item.slot,
          image_url: item.image_url,
          name: item.name,
          color_tags: item.color_tags ?? null,
          owned: item.owned ?? false,
        }))
      );

      if (error) {
        throw error;
      }

      return domainOk(undefined);
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_OUTFIT_ITEMS_SAVE_FAILED',
        message: err?.message || 'Failed to save relational outfit items',
        domain: 'outfit',
        context: {
          operation: 'saveOutfitItems',
          outfitId,
        },
        cause: err,
      });

      errorReporting.capture(domainError, {
        domain: 'outfit',
        operation: 'saveOutfitItems',
      });

      return domainFail(domainError);
    }
  },
};
