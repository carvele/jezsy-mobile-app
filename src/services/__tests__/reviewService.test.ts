import { reviewService } from '../reviewService';
import { supabase } from '@/src/lib/supabase';
import { errorReporting } from '../observability';

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

describe('reviewService', () => {
  let captureSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    captureSpy = jest.spyOn(errorReporting, 'capture').mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  describe('submitReview', () => {
    it('submits a review successfully', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: null }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await reviewService.submitReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
        comment: 'Great fit!',
        images: ['https://example.com/pic.jpg'],
      });

      expect(supabase.from).toHaveBeenCalledWith('reviews');
      expect(mockQuery.insert).toHaveBeenCalledWith({
        product_id: 'prod-1',
        user_id: 'user-1',
        rating: 5,
        comment: 'Great fit!',
        images: ['https://example.com/pic.jpg'],
      });
      expect(result.ok).toBe(true);
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('captures error when submit fails', async () => {
      const mockQuery: any = {
        insert: jest.fn().mockResolvedValue({ error: { message: 'Verified purchase required', code: '42501' } }),
      };
      (supabase.from as jest.Mock).mockReturnValue(mockQuery);

      const result = await reviewService.submitReview({
        productId: 'prod-1',
        userId: 'user-1',
        rating: 5,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('42501');
      }
      expect(captureSpy).toHaveBeenCalled();
    });
  });

  describe('voteReview', () => {
    it('votes on a review successfully', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: { likes: 5, dislikes: 1, user_vote: 'like' },
        error: null,
      });

      const result = await reviewService.voteReview('review-1', 'like');

      expect(supabase.rpc).toHaveBeenCalledWith('vote_on_review', {
        p_review_id: 'review-1',
        p_vote_type: 'like',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.likes).toBe(5);
        expect(result.data.user_vote).toBe('like');
      }
    });

    it('captures error when vote fails', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'Vote failed', code: '500' },
      });

      const result = await reviewService.voteReview('review-1', 'like');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('500');
      }
      expect(captureSpy).toHaveBeenCalled();
    });
  });
});
