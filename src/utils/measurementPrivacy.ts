/**
 * GDPR/BIPA compliant privacy utilities for biometric measurement data.
 */

import { supabase } from '../lib/supabase';
import type { EstimatedMeasurements } from './measurementCalculator';

export type SanitizedMeasurements = Omit<EstimatedMeasurements, 'overallConfidence'> & {
  scan_confidence: number;
  per_field_confidence: Record<string, number>; // Legacy column, fill with dummy or map from uncertainty
};

/**
 * Strips out any internal raw data or metadata that shouldn't persist.
 * Restructures confidence metrics for the DB schema.
 */
export function sanitizeForStorage(measurements: EstimatedMeasurements): SanitizedMeasurements {
  const { overallConfidence, ...numericalMeasurements } = measurements;
  
  // Map uncertainty back to a 0-1 confidence scale for legacy DB column
  const per_field_confidence: Record<string, number> = {};
  for (const [key, estimate] of Object.entries(numericalMeasurements)) {
    // 3cm uncertainty -> ~0.9 confidence. 12cm uncertainty -> ~0.3 confidence.
    per_field_confidence[key] = Math.max(0.1, 1.0 - ((estimate.uncertaintyCm - 2) / 10));
  }

  return {
    ...numericalMeasurements,
    scan_confidence: overallConfidence,
    per_field_confidence,
  };
}

/**
 * Permanently deletes all body measurement data for the current user.
 * Satisfies GDPR "Right to Erasure" (Article 17) for biometric data.
 */
export async function deleteAllMeasurementData(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_measurements')
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete measurement data: ${error.message}`);
  }
}

/**
 * Exports all body measurement data for the current user.
 * Satisfies GDPR "Right to Data Portability" (Article 20).
 */
export async function exportMeasurementData(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('user_measurements')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to export measurement data: ${error.message}`);
  }
  
  if (!data) {
    return JSON.stringify({ message: "No measurement data found." }, null, 2);
  }

  return JSON.stringify(data, null, 2);
}
