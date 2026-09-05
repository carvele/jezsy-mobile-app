const fs = require('fs');
let c = fs.readFileSync('src/types/database.types.ts', 'utf8');

if (!c.includes('get_reviews_with_user_vote')) {
  // Find where Functions are defined, or inject before Views
  const replacement = `Functions: {
        get_reviews_with_user_vote: {
          Args: {
            p_product_id: string
          }
          Returns: {
            id: string
            product_id: string
            user_id: string
            rating: number
            title: string | null
            content: string | null
            created_at: string
            updated_at: string
            likes_count: number
            dislikes_count: number
            user_vote: 'like' | 'dislike' | null
          }[]
        }
        vote_on_review: {
          Args: {
            p_review_id: string
            p_vote_type: 'like' | 'dislike' | null
          }
          Returns: void
        }
      }
      Views: {`;
  c = c.replace(/Views: \{/, replacement);
  fs.writeFileSync('src/types/database.types.ts', c);
  console.log('Patched DB types');
}
