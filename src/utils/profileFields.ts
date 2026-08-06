// Shared between the first-time setup wizard (app/(auth)/profile-setup.tsx)
// and the flat profile edit form (app/profile/edit.tsx), so both save the
// exact same shape and validate phone/DOB the same way.

export type ProfileData = {
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  addressLine: string;
  barangay: string;
  city: string;
  province: string;
  zipCode: string;
};

export type Country = {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
  format: string;
  maxLength: number;
  placeholder: string;
  regex: RegExp;
};

export const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

export const COUNTRIES: Country[] = [
  {
    code: 'PH',
    name: 'Philippines',
    dialCode: '+63',
    flag: '🇵🇭',
    format: '900 000 0000',
    maxLength: 10,
    placeholder: '912 345 6789',
    regex: /^9\d{9}$/,
  },
  {
    code: 'US',
    name: 'United States',
    dialCode: '+1',
    flag: '🇺🇸',
    format: '000 000 0000',
    maxLength: 10,
    placeholder: '201 555 0123',
    regex: /^\d{10}$/,
  },
  {
    code: 'SG',
    name: 'Singapore',
    dialCode: '+65',
    flag: '🇸🇬',
    format: '0000 0000',
    maxLength: 8,
    placeholder: '8123 4567',
    regex: /^[89]\d{7}$/,
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    dialCode: '+44',
    flag: '🇬🇧',
    format: '0000 000000',
    maxLength: 10,
    placeholder: '7123 456789',
    regex: /^7\d{9}$/,
  },
];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const currentYear = new Date().getFullYear();
export const YEARS = Array.from({ length: currentYear - 1939 }, (_, i) => currentYear - i);
export const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export const getDaysInMonth = (month: number, year: number): number =>
  new Date(year, month + 1, 0).getDate();

// Formats raw phone digits into the country's spaced display format. Shared
// by live input handling and by prefill when loading an existing number.
export const formatPhoneForCountry = (digits: string, country: Country): string => {
  let cleaned = digits.replace(/\D/g, '');
  if (country.code === 'PH' && cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  cleaned = cleaned.substring(0, country.maxLength);

  let formatted = '';
  let formatIndex = 0;
  for (let i = 0; i < cleaned.length; i++) {
    while (formatIndex < country.format.length && country.format[formatIndex] === ' ') {
      formatted += ' ';
      formatIndex++;
    }
    formatted += cleaned[i];
    formatIndex++;
  }
  return formatted;
};

export const DOB_PATTERN = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}$/;

// MM/DD/YYYY -> YYYY-MM-DD, or null if not a real calendar date.
export const parseDateOfBirth = (dob: string): string | null => {
  if (!dob.trim()) return null;
  const [month, day, year] = dob.split('/').map(Number);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// Stored phone is "+<dial><local>"; recover the country and local digits.
export const matchCountryFromStoredPhone = (
  storedPhone: string | null | undefined
): { country: Country | null; localPhone: string } => {
  if (!storedPhone) return { country: null, localPhone: '' };
  const match = COUNTRIES.find((c) => storedPhone.startsWith(c.dialCode));
  if (!match) return { country: null, localPhone: '' };
  return { country: match, localPhone: storedPhone.slice(match.dialCode.length) };
};

// YYYY-MM-DD -> MM/DD/YYYY, for prefilling the form field from a stored DOB.
export const dbDateToFormDate = (dbDate: string | null | undefined): string => {
  if (!dbDate) return '';
  const [y, m, d] = dbDate.split('-');
  return y && m && d ? `${m}/${d}/${y}` : '';
};
