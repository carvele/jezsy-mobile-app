import { supabase } from '@/src/lib/supabase';
import {
  SubmitReviewInput,
  VoteReviewResult,
  ReviewVoteType,
} from '@/src/types/dto/review';
import {
  DomainError,
  DomainResult,
  domainOk,
  domainFail,
  errorReporting,
} from './observability';

export const reviewService = {
  /**
   * Submits a verified review for a product.
   */
  async submitReview(input: SubmitReviewInput): Promise<DomainResult<void>> {
    try {
      const { error } = await supabase.from('reviews').insert({
        product_id: input.productId,
        user_id: input.userId,
        rating: input.rating,
        comment: input.comment ?? null,
        images: input.images ?? [],
      });

      if (error) {
        throw error;
      }

      return domainOk(undefined);
    } catch (err: any) {
      const domainError = new DomainError({
        code: err?.code || 'ERR_REVIEW_SUBMIT_FAILED',
        message: err?.message || 'Failed to submit review',
        domain: 'review',
        context: {
          operation: 'submitReview',
          productId: input.productId,
          userId: input.userId,
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
