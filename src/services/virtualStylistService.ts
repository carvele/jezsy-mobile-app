import { supabase } from '@/src/lib/supabase';
import { recommendSize, UserMeasurements } from '@/src/utils/sizeRecommender';
import { colorRecommendationService, ColorRecommendation, PersonalizationMode } from './colorRecommendationService';
import { Database } from '@/src/types/database.types';

export type InventoryVariant = Database['public']['Tables']['inventory']['Row'];

export type SizeRecommendation = {
  size: string;
  userMeasurements: UserMeasurements;
  fitPreference: string;
} | null;

export type StylistRecommendation = {
  sizeRecommendation: SizeRecommendation;
  topColorRecommendation: ColorRecommendation | null; // best color overall
  resolvedColorRecommendation: ColorRecommendation | null; // color matching the resolved SKU
  resolvedVariant: InventoryVariant | null;
  personalizationMode: PersonalizationMode;
};

/**
 * Recommends a size for this product from the user's stored measurements
 * and fit preference. Thin wrapper over recommendSize (src/utils/sizeRecommender.ts)
 * -- that scoring engine already exists and is live in app/product/[id].tsx;
 * this just gives it a productId-based, reusable entry point instead of
 * re-fetching profile/measurements/product inline at every call site.
 */
export async function getRecommendedSize(userId: string, productId: string): Promise<SizeRecommendation> {
  const [{ data: profile }, { data: metrics }, { data: product }] = await Promise.all([
    supabase.from('profiles').select('fit_preference').eq('id', userId).maybeSingle(),
    supabase.from('user_measurements').select('measurements').eq('user_id', userId).maybeSingle(),
    supabase.from('products').select('measurements, category, category_id, name').eq('id', productId).maybeSingle(),
  ]);

  if (!metrics?.measurements || !product?.measurements) return null;

  const fitPreference = profile?.fit_preference || 'regular';
  const categoryName = product.category || product.category_id || product.name || '';
  const size = recommendSize(
    metrics.measurements as UserMeasurements,
    product.measurements as any,
    fitPreference,
    categoryName
  );
  if (!size) return null;

  return { size, userMeasurements: metrics.measurements as UserMeasurements, fitPreference };
}

/**
 * Combines size and color recommendations, and separates the best color
 * overall from the highest-ranked color that actually exists in the
 * recommended size -- so the UI never claims "size Medium in Navy" when
 * Medium is out of stock in Navy.
 */
export async function getStylistRecommendation(
  userId: string,
  productId: string,
  context?: { occasion?: string }
): Promise<StylistRecommendation> {
  const [sizeRecommendation, { recommendations: rankedColors, personalizationMode }] = await Promise.all([
    getRecommendedSize(userId, productId),
    colorRecommendationService.getRecommendedColors(userId, productId, context),
  ]);

  const topColorRecommendation = rankedColors[0] ?? null;

  const resolvedColorRecommendation = sizeRecommendation
    ? rankedColors.find((color) =>
        color.sellableVariants.some((v) => v.size === sizeRecommendation.size)
      ) ?? null
    : null;

  const resolvedVariant = sizeRecommendation
    ? resolvedColorRecommendation?.sellableVariants.find((v) => v.size === sizeRecommendation.size) ?? null
    : null;

  return {
    sizeRecommendation,
    topColorRecommendation,
    resolvedColorRecommendation,
    resolvedVariant,
    personalizationMode,
  };
}

export const virtualStylistService = { getRecommendedSize, getStylistRecommendation };
