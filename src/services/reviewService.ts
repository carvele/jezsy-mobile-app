import { supabase } from '@/src/lib/supabase';
import {
  SubmitReviewInput,
  VoteReviewResult,
  ReviewVoteType,
  ReviewFilterParams,
  ReviewFilterFacets,
} from '@/src/types/dto/review';
import { Database } from '@/src/types/database.types';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';

export type ReviewRow = Database['public']['Tables']['reviews']['Row'];
export type ReviewWithVote = ReviewRow & {
  user_vote: ReviewVoteType | null;
};

export interface FetchReviewsResult {
  reviews: ReviewWithVote[];
  totalFilteredCount: number;
}

export const reviewService = {
  /**
   * Submits a verified review for a product via submit_verified_review RPC.
   * Derives product_id, size, and color authoritatively from reservation_item_id.
   */
  async submitReview(input: SubmitReviewInput): Promise<DomainResult<ReviewRow>> {
    try {
      const { data, error } = await supabase.rpc('submit_verified_review', {
        p_reservation_item_id: input.reservationItemId,
        p_rating: input.rating,
        p_comment: input.comment ?? undefined,
        p_images: input.images ?? [],
      });

      if (error) {
        throw error;
      }

      return domainOk(data as ReviewRow);
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_REVIEW_SUBMIT_FAILED',
        message: err?.message || 'Failed to submit review',
        domain: 'review',
        context: {
          operation: 'submitReview',
          reservationItemId: input.reservationItemId,
        },
        cause: err,
      });

      errorReporting.capture(domainError, {
        domain: 'review',
        operation: 'submitReview',
      });

      return domainFail(domainError);
    }
  },

  /**
   * Fetches global review filter facets (available sizes, colors, photo counts, and total reviews) for a product.
   */
  async fetchReviewFilterFacets(productId: string): Promise<DomainResult<ReviewFilterFacets>> {
    try {
      const { data, error } = await supabase.rpc('get_review_filter_facets', {
        p_product_id: productId,
      });

      if (error) {
        throw error;
      }

      const facets = (data as any) || { sizes: [], colors: [], photo_count: 0, total_count: 0 };
      return domainOk({
        sizes: Array.isArray(facets.sizes) ? facets.sizes : [],
        colors: Array.isArray(facets.colors) ? facets.colors : [],
        photo_count: typeof facets.photo_count === 'number' ? facets.photo_count : 0,
        total_count: typeof facets.total_count === 'number' ? facets.total_count : 0,
      });
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_REVIEW_FACETS_FAILED',
        message: err?.message || 'Failed to fetch review filter facets',
        domain: 'review',
        context: { operation: 'fetchReviewFilterFacets', productId },
        cause: err,
      });

      errorReporting.capture(domainError, {
        domain: 'review',
        operation: 'fetchReviewFilterFacets',
      });

      return domainFail(domainError);
    }
  },

  /**
   * Fetches reviews with server-side filtering, deterministic sorting, and pagination.
   */
  async fetchReviews(params: ReviewFilterParams): Promise<DomainResult<FetchReviewsResult>> {
    try {
      const { data, error } = await supabase.rpc('get_reviews_with_user_vote', {
        p_product_id: params.productId,
        p_limit: params.limit ?? 20,
        p_offset: params.offset ?? 0,
        p_rating: params.rating ?? undefined,
        p_size: params.size ?? undefined,
        p_color: params.color ?? undefined,
        p_photos_only: params.photosOnly ?? false,
        p_sort: params.sort ?? 'recent',
      });

      if (error) {
        throw error;
      }

      const rows = data || [];
      const totalFilteredCount = rows.length > 0 ? Number((rows[0] as any).total_filtered_count || rows.length) : 0;

      const reviews: ReviewWithVote[] = rows.map((row: any) => ({
        ...row.review,
        user_vote: (row.user_vote as ReviewVoteType | null) ?? null,
      }));

      return domainOk({
        reviews,
        totalFilteredCount,
      });
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_REVIEW_FETCH_FAILED',
        message: err?.message || 'Failed to fetch reviews',
        domain: 'review',
        context: { operation: 'fetchReviews', params },
        cause: err,
      });

      errorReporting.capture(domainError, {
        domain: 'review',
        operation: 'fetchReviews',
      });

      return domainFail(domainError);
    }
  },

  /**
   * Casts or toggles a helpful vote on a review via vote_on_review RPC.
   */
  async voteReview(
    reviewId: string,
    voteType: ReviewVoteType | null
  ): Promise<DomainResult<VoteReviewResult>> {
    try {
      const { data, error } = await supabase.rpc('vote_on_review', {
        p_review_id: reviewId,
        p_vote_type: voteType ?? undefined,
      });

      if (error) {
        throw error;
      }

      const result = (data as any) || { likes: 0, dislikes: 0, user_vote: null };
      return domainOk({
        likes: result.likes ?? 0,
        dislikes: result.dislikes ?? 0,
        user_vote: result.user_vote ?? null,
      });
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_REVIEW_VOTE_FAILED',
        message: err?.message || 'Failed to record vote on review',
        domain: 'review',
        context: {
          operation: 'voteReview',
          reviewId,
          voteType,
        },
        cause: err,
      });

      errorReporting.capture(domainError, {
        domain: 'review',
        operation: 'voteReview',
      });

      return domainFail(domainError);
    }
  },
};
