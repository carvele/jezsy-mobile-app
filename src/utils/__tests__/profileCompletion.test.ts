import {
  hasCompleteName,
  hasCompletePersonalInfo,
  hasCompleteAddress,
  isProfileSetupComplete,
  getProfileSetupResumeStep,
  type ProfileRecord,
} from '../profileCompletion';

describe('Profile Completion Evaluator (isProfileSetupComplete)', () => {
  const completeProfile: ProfileRecord = {
    id: 'user-123',
    email: 'user@example.com',
    first_name: 'Maria',
    last_name: 'Santos',
    phone: '+639123456789',
    gender: 'Female',
    date_of_birth: '1995-05-15',
    address_line: '123 Rizal St',
    barangay: 'San Antonio',
    city: 'Pasig',
    province: 'Metro Manila',
    zip_code: '1600',
    role: 'customer',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    deleted: false,
    employment_status: null,
    expo_push_token: null,
    fit_preference: null,
    full_name: null,
    invite_delivery_status: null,
    invited_at: null,
    is_blocked: null,
    is_wardrobe_shared: null,
    last_invited_at: null,
    outfit_privacy: 'private',
    privacy_accepted_at: null,
    privacy_version: null,
    profile_visibility: 'private',
    terms_accepted_at: null,
    terms_version: null,
    username: null,
    wardrobe_privacy: null,
    wishlist_privacy: null,
  };

  describe('hasCompleteName', () => {
    it('returns true when first and last name are non-empty', () => {
      expect(hasCompleteName(completeProfile)).toBe(true);
    });

    it('returns false when first_name is missing or whitespace only', () => {
      expect(hasCompleteName({ ...completeProfile, first_name: null })).toBe(false);
      expect(hasCompleteName({ ...completeProfile, first_name: '   ' })).toBe(false);
    });

    it('returns false when last_name is missing or whitespace only', () => {
      expect(hasCompleteName({ ...completeProfile, last_name: null })).toBe(false);
      expect(hasCompleteName({ ...completeProfile, last_name: '' })).toBe(false);
    });

    it('returns false for null or undefined profile', () => {
      expect(hasCompleteName(null)).toBe(false);
      expect(hasCompleteName(undefined)).toBe(false);
    });
  });

  describe('hasCompletePersonalInfo', () => {
    it('returns true when phone, gender, and date_of_birth are valid', () => {
      expect(hasCompletePersonalInfo(completeProfile)).toBe(true);
    });

    it('returns false when phone is missing or invalid format', () => {
      expect(hasCompletePersonalInfo({ ...completeProfile, phone: null })).toBe(false);
      expect(hasCompletePersonalInfo({ ...completeProfile, phone: 'invalid-phone' })).toBe(false);
      expect(hasCompletePersonalInfo({ ...completeProfile, phone: '+63123' })).toBe(false); // too short
    });

    it('validates supported international phone formats (US, SG, GB)', () => {
      expect(hasCompletePersonalInfo({ ...completeProfile, phone: '+12015550123' })).toBe(true);
      expect(hasCompletePersonalInfo({ ...completeProfile, phone: '+6581234567' })).toBe(true);
      expect(hasCompletePersonalInfo({ ...completeProfile, phone: '+447123456789' })).toBe(true);
    });

    it('returns false when gender is missing or not in GENDER_OPTIONS', () => {
      expect(hasCompletePersonalInfo({ ...completeProfile, gender: null })).toBe(false);
      expect(hasCompletePersonalInfo({ ...completeProfile, gender: 'Alien' })).toBe(false);
      expect(hasCompletePersonalInfo({ ...completeProfile, gender: 'Non-binary' })).toBe(true);
    });

    it('returns false when date_of_birth is missing or invalid calendar date', () => {
      expect(hasCompletePersonalInfo({ ...completeProfile, date_of_birth: null })).toBe(false);
      expect(hasCompletePersonalInfo({ ...completeProfile, date_of_birth: 'not-a-date' })).toBe(false);
      expect(hasCompletePersonalInfo({ ...completeProfile, date_of_birth: '1995-02-31' })).toBe(false); // Feb 31 does not exist
    });
  });

  describe('hasCompleteAddress', () => {
    it('returns true when all five address fields are present', () => {
      expect(hasCompleteAddress(completeProfile)).toBe(true);
    });

    it('returns false if any single address field is missing', () => {
      expect(hasCompleteAddress({ ...completeProfile, address_line: null })).toBe(false);
      expect(hasCompleteAddress({ ...completeProfile, barangay: '' })).toBe(false);
      expect(hasCompleteAddress({ ...completeProfile, city: null })).toBe(false);
      expect(hasCompleteAddress({ ...completeProfile, province: null })).toBe(false);
      expect(hasCompleteAddress({ ...completeProfile, zip_code: null })).toBe(false);
    });
  });

  describe('isProfileSetupComplete (app-entry invariant)', () => {
    it('returns true for fully completed profile', () => {
      expect(isProfileSetupComplete(completeProfile)).toBe(true);
    });

    it('returns true even if address fields are empty (Address is optional for app entry)', () => {
      const profileNoAddress: ProfileRecord = {
        ...completeProfile,
        address_line: null,
        barangay: null,
        city: null,
        province: null,
        zip_code: null,
      };
      expect(isProfileSetupComplete(profileNoAddress)).toBe(true);
    });

    it('returns false if only first_name and last_name are present (Google OAuth seeded)', () => {
      const googleSeededProfile: ProfileRecord = {
        ...completeProfile,
        phone: null,
        gender: null,
        date_of_birth: null,
        address_line: null,
        barangay: null,
        city: null,
        province: null,
        zip_code: null,
      };
      expect(isProfileSetupComplete(googleSeededProfile)).toBe(false);
    });

    it('returns false if only first_name is present', () => {
      const partialNameProfile: ProfileRecord = {
        ...completeProfile,
        last_name: null,
        phone: null,
        gender: null,
        date_of_birth: null,
      };
      expect(isProfileSetupComplete(partialNameProfile)).toBe(false);
    });

    it('returns false for null or undefined profile', () => {
      expect(isProfileSetupComplete(null)).toBe(false);
      expect(isProfileSetupComplete(undefined)).toBe(false);
    });
  });

  describe('getProfileSetupResumeStep', () => {
    it('returns Step 0 (Name) if first_name or last_name is missing', () => {
      expect(getProfileSetupResumeStep(null)).toBe(0);
      expect(getProfileSetupResumeStep({ ...completeProfile, first_name: null })).toBe(0);
      expect(getProfileSetupResumeStep({ ...completeProfile, last_name: '' })).toBe(0);
    });

    it('returns Step 1 (Personal Info) if names are present but personal info is incomplete (Google OAuth case)', () => {
      const googleUser: ProfileRecord = {
        ...completeProfile,
        phone: null,
        gender: null,
        date_of_birth: null,
      };
      expect(getProfileSetupResumeStep(googleUser)).toBe(1);
    });

    it('returns Step 1 if names and phone are present but gender or DOB is missing', () => {
      const partialInfo: ProfileRecord = {
        ...completeProfile,
        gender: null,
      };
      expect(getProfileSetupResumeStep(partialInfo)).toBe(1);
    });

    it('returns Step 2 (Address) if names and personal info are complete', () => {
      const readyForAddress: ProfileRecord = {
        ...completeProfile,
        address_line: null,
        barangay: null,
        city: null,
        province: null,
        zip_code: null,
      };
      expect(getProfileSetupResumeStep(readyForAddress)).toBe(2);
    });

    it('returns Step 2 if all fields are complete (when editing/reviewing)', () => {
      expect(getProfileSetupResumeStep(completeProfile)).toBe(2);
    });
  });
});
