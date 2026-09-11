import { supabase } from '@/src/lib/supabase';
import {
  ProfileMeasurementsInput,
  UpdateProfileMeasurementsResult,
} from '@/src/types/dto/profileMeasurements';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';

export const profileService = {
  /**
   * Updates user profile fit preference and upserts measurements atomically.
   * Encapsulates the 15s bounded attempt and up-to-3-attempt retry policy on timeout.
   */
  async updateProfileAndMeasurements(
    input: ProfileMeasurementsInput
  ): Promise<DomainResult<UpdateProfileMeasurementsResult>> {
    const attemptWrite = () => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr: any = new Error('Request timed out while saving measurements.');
          timeoutErr.isTimeout = true;
          reject(timeoutErr);
        }, 15000);
      });

      return Promise.race([
        supabase.rpc('update_profile_and_measurements', {
          _fit_preference: input.fitPreference ?? '',
          _height: input.height,
          _weight: input.weight,
          _measurements: (input.measurements ?? null) as any,
          _scan_confidence: input.scanConfidence ?? null,
          _per_field_confidence: (input.perFieldConfidence ?? null) as any,
          _measurement_source: input.measurementSource ?? null,
        }),
        timeoutPromise,
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
    };

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data, error } = await attemptWrite();
        if (error) {
          throw error;
        }

        const result = (data as any) || { success: true };
        return domainOk({
          success: Boolean(result.success),
          user_id: result.user_id || '',
        });
      } catch (err: any) {
        lastError = err;
        if (!err?.isTimeout || attempt === maxAttempts) {
          break;
        }
      }
    }

    const isTimeout = Boolean(lastError?.isTimeout);
    let code = 'ERR_PROFILE_UPDATE_FAILED';
    if (isTimeout) {
      code = 'ERR_TIMEOUT';
    } else if (
      lastError?.message?.includes('JWT') ||
      lastError?.message?.includes('auth') ||
      lastError?.code === '401' ||
      lastError?.code === '42501' ||
      lastError?.code === '28000' ||
      lastError?.message?.includes('row-level security')
    ) {
      code = 'ERR_AUTH_EXPIRED';
    }

    const domainError = new DomainError({
      code,
      message: lastError?.message || 'Failed to update profile and measurements',
      domain: 'profile',
      retriable: isTimeout,
      context: {
        operation: 'updateProfileAndMeasurements',
        isTimeout,
      },
      cause: lastError,
    });

    errorReporting.capture(domainError, {
      domain: 'profile',
      operation: 'updateProfileAndMeasurements',
    });

    return domainFail(domainError);
  },
};
