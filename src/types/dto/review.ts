export type ReviewVoteType = 'like' | 'dislike';

export interface SubmitReviewInput {
  productId: string;
  userId: string;
  rating: number;
  comment?: string | null;
  images?: string[] | null;
}

export interface VoteReviewResult {
  likes: number;
  dislikes: number;
  user_vote: ReviewVoteType | null;
}
