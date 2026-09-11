export interface MeasurementSubfields {
  bust?: { valueCm: number } | null;
  waist?: { valueCm: number } | null;
  hips?: { valueCm: number } | null;
  inseam?: { valueCm: number } | null;
  shoulderWidth?: { valueCm: number } | null;
  armLength?: { valueCm: number } | null;
  torsoLength?: { valueCm: number } | null;
  legLength?: { valueCm: number } | null;
  [key: string]: { valueCm: number } | null | undefined;
}

export interface ProfileMeasurementsInput {
  fitPreference: string | null;
  height: number | null;
  weight: number | null;
  measurements: MeasurementSubfields | null;
  scanConfidence?: number | null;
  perFieldConfidence?: Record<string, number> | null;
  measurementSource?: string | null;
}

export interface UpdateProfileMeasurementsResult {
  success: boolean;
  user_id: string;
}
