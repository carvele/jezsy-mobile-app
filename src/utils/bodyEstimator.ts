/**
 * Phase 2: Live Pose Estimator
 *
 * Replaces the mock math-only estimator. This orchestrator accepts extracted
 * body ratios from the Vision Camera frame processor, combines them with
 * user height/weight/gender, and delegates to the true anthropometric calculator.
 */

import { computeMeasurements, type MeasurementInput, type EstimatedMeasurements } from './measurementCalculator';

/**
 * Main orchestrator for body estimation.
 */
export async function estimateMeasurementsFromScan(
  input: MeasurementInput
): Promise<EstimatedMeasurements> {
  // Pass to the regression calculator
  return computeMeasurements(input);
}

/**
 * @deprecated The old mock function signature. Kept temporarily to avoid
 * breaking other imports if they exist. Use estimateMeasurementsFromScan instead.
 */
export async function estimateMeasurementsFromImage(
  imageBase64: string,
  heightCm: number,
  weightKg: number
): Promise<any> {
  throw new Error("This method is deprecated. The camera now processes frames natively via frame processors. Use the continuous scan flow instead.");
}
