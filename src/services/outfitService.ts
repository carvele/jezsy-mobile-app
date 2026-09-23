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
import { styleDnaSyncManager } from './styling/styleDnaSyncManager';

/** Order-independent identity of an outfit's contents, for duplicate detection. */
export function outfitSignature(items: OutfitItemDto[]): string {
  return (items ?? [])
    .map((i) => i.wardrobe_item_id || i.product_id || i.name || '')
    .filter(Boolean)
    .sort()
    .join('|');
}

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

      const savedId = data?.id || '';
      if (savedId && input.userId) {
        try {
          const palette = Array.from(new Set(input.items.flatMap((i) => i.color_tags || [])));
          const accessories = input.items
            .filter((i) => i.slot === 'accessory')
            .map((i) => i.name)
            .filter(Boolean);
          styleDnaSyncManager.recordSaveLook(
            input.userId,
            savedId,
            { palette, accessories },
            (input as any).preferenceActionId || null
          ).catch(() => {});
        } catch {
          // Best effort Style DNA recording
        }
      }

      return domainOk({ id: savedId });
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
   * Saves an outfit unless the user already has a live look containing exactly the same items, in which case
   * that look is reused. Keeps repeated taps (Send to Mannequin, Save) from filling My Looks with duplicates.
   */
  async saveOutfitOnce(
    input: SaveOutfitInput
  ): Promise<DomainResult<SaveOutfitResult & { reused: boolean }>> {
    try {
      const wanted = outfitSignature(input.items);
      const { data, error } = await supabase
        .from('saved_outfits')
        .select('id, items')
        .eq('user_id', input.userId)
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        const match = (data as { id: string; items: unknown }[]).find(
          (row) => Array.isArray(row.items) && outfitSignature(row.items as OutfitItemDto[]) === wanted
        );
        if (match) return domainOk({ id: match.id, reused: true });
      }
    } catch {
      // A failed lookup must not block saving; worst case is one duplicate, which the user can delete.
    }

    const saved = await outfitService.saveOutfit(input);
    return saved.ok ? domainOk({ id: saved.data.id, reused: false }) : saved;
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
