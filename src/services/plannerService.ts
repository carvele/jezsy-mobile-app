import { supabase } from '@/src/lib/supabase';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';
import {
  PlannedOutfit,
  CreatePlannedOutfitInput,
  UpdatePlannedOutfitMetadataInput,
  ReschedulePlannedOutfitInput,
  ConfirmWearResult,
} from '@/src/types/planner';
import { styleDnaSyncManager } from './styling/styleDnaSyncManager';
import {
  resolveEffectiveGarmentBucket,
  resolveAccessorySubtype,
} from '../utils/garmentSemanticClassifier';

/**
 * Creates a new planned outfit via canonical RPC create_planned_outfit.
 */
export async function createPlannedOutfit(
  input: CreatePlannedOutfitInput
): Promise<DomainResult<PlannedOutfit>> {
  try {
    const { data, error } = await supabase.rpc('create_planned_outfit' as any, {
      p_planned_date: input.plannedDate,
      p_slot: input.slot || 'all_day',
      p_plan_timezone: input.planTimezone,
      p_items: input.items,
      p_occasion: input.occasion || null,
      p_climate_context: input.climateContext || [],
      p_notes: input.notes || null,
      p_saved_outfit_id: input.savedOutfitId || null,
      p_source_type: input.sourceType || 'manual',
      p_source_ref_id: input.sourceRefId || null,
    });

    if (error) throw error;
    return domainOk(data as PlannedOutfit);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_CREATE_PLAN_FAILED',
      message: err?.message || 'Failed to create planned outfit',
      domain: 'wardrobe',
      context: { operation: 'createPlannedOutfit', input },
      cause: err,
    });
    errorReporting.capture(domainError, { domain: 'wardrobe', operation: 'createPlannedOutfit' });
    return domainFail(domainError);
  }
}

/**
 * Updates metadata (slot, notes, climate_context) of an existing plan via OCC.
 */
export async function updatePlannedOutfitMetadata(
  input: UpdatePlannedOutfitMetadataInput
): Promise<DomainResult<PlannedOutfit>> {
  try {
    const { data, error } = await supabase.rpc('update_planned_outfit_metadata' as any, {
      p_plan_id: input.planId,
      p_expected_revision: input.expectedRevision,
      p_slot: input.slot || null,
      p_notes: input.notes ?? null,
      p_climate_context: input.climateContext || null,
    });

    if (error) throw error;
    return domainOk(data as PlannedOutfit);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_UPDATE_PLAN_METADATA_FAILED',
      message: err?.message || 'Failed to update planned outfit metadata',
      domain: 'wardrobe',
      context: { operation: 'updatePlannedOutfitMetadata', input },
      cause: err,
    });
    errorReporting.capture(domainError, { domain: 'wardrobe', operation: 'updatePlannedOutfitMetadata' });
    return domainFail(domainError);
  }
}

/**
 * Reschedules a plan to a new date and/or slot via canonical RPC.
 */
export async function reschedulePlannedOutfit(
  input: ReschedulePlannedOutfitInput
): Promise<DomainResult<PlannedOutfit>> {
  try {
    const { data, error } = await supabase.rpc('reschedule_planned_outfit' as any, {
      p_plan_id: input.planId,
      p_expected_revision: input.expectedRevision,
      p_new_date: input.newDate,
      p_new_slot: input.newSlot || null,
    });

    if (error) throw error;
    return domainOk(data as PlannedOutfit);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_RESCHEDULE_PLAN_FAILED',
      message: err?.message || 'Failed to reschedule planned outfit',
      domain: 'wardrobe',
      context: { operation: 'reschedulePlannedOutfit', input },
      cause: err,
    });
    errorReporting.capture(domainError, { domain: 'wardrobe', operation: 'reschedulePlannedOutfit' });
    return domainFail(domainError);
  }
}

/**
 * Confirms a plan as worn via canonical RPC confirm_planned_outfit_worn.
 * On success, synchronously sets worn state and passes active worn tokens
 * to the Phase G Style DNA offline queue with effective wear chronology.
 */
export async function confirmPlannedOutfitWorn(
  userId: string,
  planId: string,
  expectedRevision: number
): Promise<DomainResult<ConfirmWearResult>> {
  try {
    const { data, error } = await supabase.rpc('confirm_planned_outfit_worn' as any, {
      p_plan_id: planId,
      p_expected_revision: expectedRevision,
    });

    if (error) throw error;

    const result = data as ConfirmWearResult;

    if (userId && result?.item_ids && result.item_ids.length > 0) {
      try {
        const wornItems = (result.worn_items || []) as any[];
        const palette = Array.from(
          new Set(wornItems.flatMap((i) => i.color_tags || []).filter(Boolean))
        );
        const silhouettes = Array.from(
          new Set(
            wornItems
              .map((i) => i.ai_attributes?.fit || i.ai_attributes?.silhouette || i.silhouette)
              .filter(Boolean)
          )
        );
        const formality = result.occasion ? [result.occasion] : [];
        const accessories = wornItems
          .filter((i) => resolveEffectiveGarmentBucket(i as any) === 'Accessory')
          .map((i) => resolveAccessorySubtype(i as any) || i.name || '')
          .filter(Boolean);

        styleDnaSyncManager.recordWearOutfit(
          userId,
          result.saved_outfit_id || null,
          result.item_ids,
          {
            palette,
            silhouettes,
            formality,
            accessories,
          },
          result.effective_wear_at
        ).catch(() => {});
      } catch {
        // Non-blocking telemetry
      }
    }

    return domainOk(result);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_CONFIRM_PLAN_WORN_FAILED',
      message: err?.message || 'Failed to confirm planned outfit as worn',
      domain: 'wardrobe',
      context: { operation: 'confirmPlannedOutfitWorn', planId, expectedRevision },
      cause: err,
    });
    errorReporting.capture(domainError, { domain: 'wardrobe', operation: 'confirmPlannedOutfitWorn' });
    return domainFail(domainError);
  }
}

/**
 * Marks a plan as explicitly skipped via canonical RPC.
 */
export async function skipPlannedOutfit(
  planId: string,
  expectedRevision: number
): Promise<DomainResult<PlannedOutfit>> {
  try {
    const { data, error } = await supabase.rpc('skip_planned_outfit' as any, {
      p_plan_id: planId,
      p_expected_revision: expectedRevision,
    });

    if (error) throw error;
    return domainOk(data as PlannedOutfit);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_SKIP_PLAN_FAILED',
      message: err?.message || 'Failed to skip planned outfit',
      domain: 'wardrobe',
      context: { operation: 'skipPlannedOutfit', planId, expectedRevision },
      cause: err,
    });
    errorReporting.capture(domainError, { domain: 'wardrobe', operation: 'skipPlannedOutfit' });
    return domainFail(domainError);
  }
}

/**
 * Marks a plan as cancelled (soft delete preserving history) via canonical RPC.
 */
export async function cancelPlannedOutfit(
  planId: string,
  expectedRevision: number
): Promise<DomainResult<PlannedOutfit>> {
  try {
    const { data, error } = await supabase.rpc('cancel_planned_outfit' as any, {
      p_plan_id: planId,
      p_expected_revision: expectedRevision,
    });

    if (error) throw error;
    return domainOk(data as PlannedOutfit);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_CANCEL_PLAN_FAILED',
      message: err?.message || 'Failed to cancel planned outfit',
      domain: 'wardrobe',
      context: { operation: 'cancelPlannedOutfit', planId, expectedRevision },
      cause: err,
    });
    errorReporting.capture(domainError, { domain: 'wardrobe', operation: 'cancelPlannedOutfit' });
    return domainFail(domainError);
  }
}

/**
 * Retrieves planned outfits in a calendar date range.
 * Lazily reconciles overdue plans (>= Day + 2) to 'unconfirmed'.
 */
export async function getPlannedOutfitsRange(
  startDate: string,
  endDate: string
): Promise<DomainResult<PlannedOutfit[]>> {
  try {
    const { data, error } = await supabase.rpc('get_planned_outfits_range' as any, {
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) throw error;
    return domainOk((data || []) as PlannedOutfit[]);
  } catch (err: any) {
    const domainError = new DomainError({
      code: err?.code || 'ERR_GET_PLANNED_OUTFITS_FAILED',
      message: err?.message || 'Failed to retrieve planned outfits range',
      domain: 'wardrobe',
      context: { operation: 'getPlannedOutfitsRange', startDate, endDate },
      cause: err,
    });
    errorReporting.capture(domainError, { domain: 'wardrobe', operation: 'getPlannedOutfitsRange' });
    return domainFail(domainError);
  }
}
