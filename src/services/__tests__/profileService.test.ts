import { profileService } from '../profileService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

describe('profileService', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    captureSpy = jest.spyOn(errorReporting, 'capture').mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  it('successfully updates profile and measurements for a first-time user', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: { success: true, user_id: 'user-123' },
      error: null,
    });

    const result = await profileService.updateProfileAndMeasurements({
      fitPreference: 'slim',
      height: 175,
      weight: 70,
      measurements: { bust: { valueCm: 90 }, waist: { valueCm: 75 } },
      scanConfidence: 0.95,
      perFieldConfidence: { bust: 0.9, waist: 0.95 },
      measurementSource: 'manual',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.success).toBe(true);
      expect(result.data.user_id).toBe('user-123');
    }

    expect(supabase.rpc).toHaveBeenCalledWith('update_profile_and_measurements', {
      _fit_preference: 'slim',
      _height: 175,
      _weight: 70,
      _measurements: { bust: { valueCm: 90 }, waist: { valueCm: 75 } },
      _scan_confidence: 0.95,
      _per_field_confidence: { bust: 0.9, waist: 0.95 },
      _measurement_source: 'manual',
    });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('successfully updates profile and measurements for an existing user', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: { success: true, user_id: 'user-456' },
      error: null,
    });

    const result = await profileService.updateProfileAndMeasurements({
      fitPreference: 'relaxed',
      height: 180,
      weight: 75,
      measurements: { hips: { valueCm: 95 } },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user_id).toBe('user-456');
    }

    expect(supabase.rpc).toHaveBeenCalledWith('update_profile_and_measurements', {
      _fit_preference: 'relaxed',
      _height: 180,
      _weight: 75,
      _measurements: { hips: { valueCm: 95 } },
      _scan_confidence: null,
      _per_field_confidence: null,
      _measurement_source: null,
    });
  });

  it('retries on timeout up to 3 attempts and succeeds', async () => {
    const timeoutErr: any = new Error('Request timed out');
    timeoutErr.isTimeout = true;

    (supabase.rpc as jest.Mock)
      .mockRejectedValueOnce(timeoutErr)
      .mockRejectedValueOnce(timeoutErr)
      .mockResolvedValueOnce({
        data: { success: true, user_id: 'user-retry' },
        error: null,
      });

    const result = await profileService.updateProfileAndMeasurements({
      fitPreference: 'regular',
      height: 168,
      weight: 60,
      measurements: null,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(true);
  });

  it('returns failure and captures error when max attempts are exceeded on timeout', async () => {
    const timeoutErr: any = new Error('Request timed out');
    timeoutErr.isTimeout = true;

    (supabase.rpc as jest.Mock).mockRejectedValue(timeoutErr);

    const result = await profileService.updateProfileAndMeasurements({
      fitPreference: 'regular',
      height: 168,
      weight: 60,
      measurements: null,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ERR_TIMEOUT');
      expect(result.error.retriable).toBe(true);
    }
    expect(captureSpy).toHaveBeenCalled();
  });

  it('maps authentication errors correctly without retrying', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { code: '28000', message: 'Not authenticated' },
    });

    const result = await profileService.updateProfileAndMeasurements({
      fitPreference: 'regular',
      height: 170,
      weight: 65,
      measurements: null,
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ERR_AUTH_EXPIRED');
    }
    expect(captureSpy).toHaveBeenCalled();
  });
});
