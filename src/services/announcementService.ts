import { supabase } from '@/src/lib/supabase';
import { DismissAnnouncementInput } from '@/src/types/dto/announcement';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';

export const announcementService = {
  /**
   * Records that an announcement was dismissed by a user.
   */
  async dismiss(input: DismissAnnouncementInput): Promise<DomainResult<void>> {
    try {
      const { error } = await supabase.from('announcement_dismissals').insert({
        user_id: input.userId,
        announcement_id: input.announcementId,
      });

      if (error) {
        throw error;
      }

      return domainOk(undefined);
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_ANNOUNCEMENT_DISMISS_FAILED',
        message: err?.message || 'Failed to dismiss announcement',
        domain: 'announcement',
        context: {
          operation: 'dismiss',
          userId: input.userId,
          announcementId: input.announcementId,
        },
        cause: err,
      });

      errorReporting.capture(domainError, {
        domain: 'announcement',
        operation: 'dismiss',
      });

      return domainFail(domainError);
    }
  },
};
