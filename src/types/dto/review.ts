export type ReviewVoteType = 'like' | 'dislike';

export type ReviewSortKey = 'recent' | 'highest' | 'lowest' | 'helpful';

export interface SubmitReviewInput {
  reservationItemId: string;
  rating: number;
  comment?: string | null;
  images?: string[] | null;
}

export interface VoteReviewResult {
  likes: number;
  dislikes: number;
  user_vote: ReviewVoteType | null;
}

export interface ReviewFilterParams {
  productId: string;
  limit?: number;
  offset?: number;
  rating?: number | null;
  size?: string | null;
  color?: string | null;
  photosOnly?: boolean;
  sort?: ReviewSortKey;
}

export interface ReviewFilterFacets {
  sizes: string[];
  colors: string[];
  photo_count: number;
  total_count: number;
}
