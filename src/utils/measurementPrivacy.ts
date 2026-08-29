/**
 * GDPR/BIPA compliant privacy utilities and validation for biometric measurement data.
 */

import { supabase } from '../lib/supabase';
import type { EstimatedMeasurements } from './measurementCalculator';

export type SanitizedMeasurements = Omit<EstimatedMeasurements, 'overallConfidence'> & {
  scan_confidence: number;
  per_field_confidence: Record<string, number>; // Legacy column, fill with dummy or map from uncertainty
};

export const HUMAN_MEASUREMENT_LIMITS_CM: Record<string, { min: number; max: number; label: string }> = {
  height: { min: 100, max: 250, label: 'Height' },
  weight: { min: 25, max: 250, label: 'Weight' },
  bust: { min: 50, max: 180, label: 'Bust circumference' },
  waist: { min: 40, max: 160, label: 'Waist circumference' },
  hips: { min: 50, max: 180, label: 'Hips circumference' },
  inseam: { min: 40, max: 120, label: 'Inseam length' },
  shoulderWidth: { min: 25, max: 65, label: 'Shoulder width' },
  armLength: { min: 35, max: 95, label: 'Arm length' },
  torsoLength: { min: 25, max: 70, label: 'Torso length' },
  legLength: { min: 50, max: 130, label: 'Leg length' },
};

/**
 * Validates whether entered values in cm are within plausible human ranges.
 * Returns array of warning strings if any value is out of bounds.
 */
export function validateMeasurementRanges(measurementsInCm: Record<string, number | null | undefined>): string[] {
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(measurementsInCm)) {
    if (value === null || value === undefined || isNaN(value)) continue;
    const rule = HUMAN_MEASUREMENT_LIMITS_CM[key];
    if (rule) {
      if (value < rule.min || value > rule.max) {
        warnings.push(`${rule.label} (${value} cm) is outside the typical range (${rule.min}–${rule.max} cm).`);
      }
    }
  }
  return warnings;
}

/**
 * Strips out any internal raw data or metadata that shouldn't persist.
 * Restructures confidence metrics for the DB schema and standardizes values to { valueCm: number }.
 */
export function sanitizeForStorage(measurements: any): any {
  if (!measurements) return { scan_confidence: 0, per_field_confidence: {} };
  const { overallConfidence, confidence, ...numericalMeasurements } = measurements;
  
  const per_field_confidence: Record<string, number> = {};
  const cleaned: Record<string, any> = {};

  for (const [key, val] of Object.entries(numericalMeasurements)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'object' && val !== null && 'valueCm' in val) {
      cleaned[key] = { valueCm: (val as any).valueCm };
      const unc = (val as any).uncertaintyCm ?? 2;
      per_field_confidence[key] = Math.max(0.1, 1.0 - ((unc - 2) / 10));
    } else if (typeof val === 'number') {
      cleaned[key] = { valueCm: val };
      per_field_confidence[key] = 0.95;
    }
  }

  return {
    ...cleaned,
    scan_confidence: typeof overallConfidence === 'number' ? overallConfidence : 0.95,
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
