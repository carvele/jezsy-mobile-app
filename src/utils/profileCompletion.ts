import type { Database } from '@/src/types/database.types';
import {
  parseDateOfBirth,
  DOB_PATTERN,
  matchCountryFromStoredPhone,
  GENDER_OPTIONS,
} from '@/src/utils/profileFields';

export type ProfileRecord = Database['public']['Tables']['profiles']['Row'];

function hasText(val: string | null | undefined): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

/**
 * Validates that first_name and last_name are present non-empty strings.
 */
export function hasCompleteName(profile: ProfileRecord | null | undefined): boolean {
  return hasText(profile?.first_name) && hasText(profile?.last_name);
}

/**
 * Validates that mandatory personal info is present and correctly formatted:
 * - Phone: E.164 string matching one of the supported dial codes and regex formats
 * - Gender: One of the supported GENDER_OPTIONS
 * - Date of Birth: Valid calendar date
 */
export function hasCompletePersonalInfo(profile: ProfileRecord | null | undefined): boolean {
  if (!profile) return false;

  // 1. Phone validation
  if (!hasText(profile.phone)) return false;
  const { country, localPhone } = matchCountryFromStoredPhone(profile.phone);
  if (!country) return false;
  const digitsOnly = localPhone.replace(/\D/g, '');
  if (!country.regex.test(digitsOnly)) return false;

  // 2. Gender validation
  if (!hasText(profile.gender) || !GENDER_OPTIONS.includes(profile.gender!.trim())) {
    return false;
  }

  // 3. Date of birth validation (db stored as YYYY-MM-DD or parsed through date validators)
  if (!hasText(profile.date_of_birth)) return false;
  // If stored as YYYY-MM-DD:
  const dbDob = profile.date_of_birth!.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dbDob)) {
    const [y, m, d] = dbDob.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    if (
      dateObj.getFullYear() !== y ||
      dateObj.getMonth() !== m - 1 ||
      dateObj.getDate() !== d
    ) {
      return false;
    }
  } else if (DOB_PATTERN.test(dbDob)) {
    if (!parseDateOfBirth(dbDob)) return false;
  } else {
    return false;
  }

  return true;
}

/**
 * Validates that full delivery address fields are populated.
 * Note: Address is optional for application entry, but evaluated for step resumption
 * when Profile Setup is explicitly opened.
 */
export function hasCompleteAddress(profile: ProfileRecord | null | undefined): boolean {
  return (
    hasText(profile?.address_line) &&
    hasText(profile?.barangay) &&
    hasText(profile?.city) &&
    hasText(profile?.province) &&
    hasText(profile?.zip_code)
  );
}

/**
 * Canonical evaluation of whether Profile Setup is completed for app-entry.
 * Invariant: Name (Step 0) and Personal Info (Step 1) are mandatory.
 * Delivery Address (Step 2) is optional/skippable per product contract.
 */
export function isProfileSetupComplete(profile: ProfileRecord | null | undefined): boolean {
  if (!profile) return false;
  return hasCompleteName(profile) && hasCompletePersonalInfo(profile);
}

/**
 * Calculates the exact resume step (0, 1, or 2) when entering or returning to Profile Setup:
 * - Missing First or Last Name -> Step 0 (Name)
 * - Name present, but Phone, Gender, or DOB incomplete -> Step 1 (Personal Info)
 * - Name and Personal Info complete -> Step 2 (Address)
 */
export function getProfileSetupResumeStep(profile: ProfileRecord | null | undefined): number {
  if (!hasCompleteName(profile)) {
    return 0; // Step 0: Name
  }
  if (!hasCompletePersonalInfo(profile)) {
    return 1; // Step 1: Personal Info
  }
  return 2; // Step 2: Address (enrichment or edit)
}
