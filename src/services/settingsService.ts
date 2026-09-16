import { supabase } from '@/src/lib/supabase';

export const DEFAULT_RETURN_REQUEST_WINDOW_DAYS = 7;

let cachedReturnWindowDays: number | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getReturnRequestWindowDays(): Promise<number> {
  const now = Date.now();
  if (cachedReturnWindowDays !== null && now < cacheExpiry) {
    return cachedReturnWindowDays;
  }
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['commerce.return_request_window_days', 'commerce_policies'])
      .limit(2);
    if (error) throw error;
    let days = DEFAULT_RETURN_REQUEST_WINDOW_DAYS;
    if (data && data.length > 0) {
      const directRow = data.find((r) => r.key === 'commerce.return_request_window_days');
      if (directRow && directRow.value != null) {
        const val = typeof directRow.value === 'number' ? directRow.value : Number(directRow.value);
        if (!Number.isNaN(val) && val > 0) days = val;
      } else {
        const policyRow = data.find((r) => r.key === 'commerce_policies');
        const policyVal = (policyRow?.value as Record<string, unknown> | null)?.return_request_window_days;
        if (typeof policyVal === 'number' && policyVal > 0) {
          days = policyVal;
        }
      }
    }
    cachedReturnWindowDays = days;
    cacheExpiry = now + CACHE_TTL_MS;
    return days;
  } catch (err) {
    console.warn('[SettingsService] Failed to load return window setting, using default:', err);
    return DEFAULT_RETURN_REQUEST_WINDOW_DAYS;
  }
}

export function clearSettingsCache(): void {
  cachedReturnWindowDays = null;
  cacheExpiry = 0;
}
