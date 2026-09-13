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
    it('submits a verified review via RPC successfully', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: {
          id: 'review-1',
          product_id: 'prod-1',
          reservation_item_id: 'res-item-1',
          rating: 5,
          comment: 'Great fit!',
          size: 'M',
          color: 'Black',
          verified_purchase: true,
        },
        error: null,
      });

      const result = await reviewService.submitReview({
        reservationItemId: 'res-item-1',
        rating: 5,
        comment: 'Great fit!',
        images: ['https://example.com/pic.jpg'],
      });

      expect(supabase.rpc).toHaveBeenCalledWith('submit_verified_review', {
        p_reservation_item_id: 'res-item-1',
        p_rating: 5,
        p_comment: 'Great fit!',
        p_images: ['https://example.com/pic.jpg'],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.size).toBe('M');
        expect(result.data.verified_purchase).toBe(true);
      }
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('captures error when submit fails', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: null,
        error: { message: 'You have already reviewed this product', code: 'P0001' },
      });

      const result = await reviewService.submitReview({
        reservationItemId: 'res-item-1',
        rating: 5,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('P0001');
      }
      expect(captureSpy).toHaveBeenCalled();
    });
  });

  describe('fetchReviewFilterFacets', () => {
    it('fetches review filter facets successfully', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: {
          sizes: ['S', 'M', 'L'],
          colors: ['Black', 'Cream'],
          photo_count: 5,
          total_count: 20,
        },
        error: null,
      });

      const result = await reviewService.fetchReviewFilterFacets('prod-1');

      expect(supabase.rpc).toHaveBeenCalledWith('get_review_filter_facets', {
        p_product_id: 'prod-1',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sizes).toEqual(['S', 'M', 'L']);
        expect(result.data.total_count).toBe(20);
      }
    });
  });

  describe('fetchReviews', () => {
    it('fetches filtered reviews and total count successfully', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValueOnce({
        data: [
          {
            review: {
              id: 'rev-1',
              rating: 5,
              comment: 'Loved it',
              size: 'M',
              color: 'Black',
            },
            user_vote: 'like',
            total_filtered_count: 12,
          },
        ],
        error: null,
      });

      const result = await reviewService.fetchReviews({
        productId: 'prod-1',
        limit: 10,
        offset: 0,
        size: 'M',
        sort: 'helpful',
      });

      expect(supabase.rpc).toHaveBeenCalledWith('get_reviews_with_user_vote', {
        p_product_id: 'prod-1',
        p_limit: 10,
        p_offset: 0,
        p_rating: undefined,
        p_size: 'M',
        p_color: undefined,
        p_photos_only: false,
        p_sort: 'helpful',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.reviews).toHaveLength(1);
        expect(result.data.totalFilteredCount).toBe(12);
        expect(result.data.reviews[0].user_vote).toBe('like');
      }
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
