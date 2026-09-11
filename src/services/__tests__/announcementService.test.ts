import { announcementService } from '../announcementService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('announcementService', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    captureSpy = jest.spyOn(errorReporting, 'capture').mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  it('records dismissal of an announcement', async () => {
    const mockQuery: any = {
      insert: jest.fn().mockResolvedValue({ error: null }),
    };
    (supabase.from as jest.Mock).mockReturnValue(mockQuery);

    const result = await announcementService.dismiss({
      userId: 'user-1',
      announcementId: 'ann-123',
    });

    expect(supabase.from).toHaveBeenCalledWith('announcement_dismissals');
    expect(mockQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      announcement_id: 'ann-123',
    });
    expect(result.ok).toBe(true);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('captures error when dismissal fails', async () => {
    const mockQuery: any = {
      insert: jest.fn().mockResolvedValue({ error: { message: 'Insert failed', code: '500' } }),
    };
    (supabase.from as jest.Mock).mockReturnValue(mockQuery);

    const result = await announcementService.dismiss({
      userId: 'user-1',
      announcementId: 'ann-123',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('500');
    }
    expect(captureSpy).toHaveBeenCalled();
  });
});
