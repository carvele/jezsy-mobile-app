import { NotificationData } from '@/src/types/dto/notification';

const WHITELISTED_ROUTE_REGEX = /^\/(reservations|product|messages)(\/|\?|$)/;

/**
 * Resolves a canonical internal app route for a notification payload.
 *
 * Evaluation order:
 * 1. Typed entity resolution (strongly-typed entity_type & entity_id, with backward-compatibility keys)
 * 2. Whitelisted internal deep_link fallback
 */
export function resolveNotificationRoute(data?: NotificationData | null): string | null {
  if (!data) return null;

  // 1. Reservation
  const reservationId = data.reservation_id || (data.entity_type === 'reservation' ? data.entity_id : null);
  if (reservationId) {
    return `/reservations/${reservationId}`;
  }

  // 2. Product review (check before bare product so review notifications navigate to review screen)
  const isReview = data.entity_type === 'review' || Boolean(data.review_id);
  const productId = data.product_id || (data.entity_type === 'product' ? data.entity_id : null);
  if (isReview) {
    if (productId) return `/product/reviews?productId=${productId}`;
    return null;
  }

  // 3. Product detail
  if (productId) {
    return `/product/${productId}`;
  }

  // 4. Boutique / Support Conversation
  const conversationId = data.conversation_id || (data.entity_type === 'conversation' ? data.entity_id : null);
  if (conversationId) {
    return `/messages/${conversationId}`;
  }

  // 5. Direct P2P chat (retired with connections; fallback to messages inbox)
  const isDirectChat = data.entity_type === 'direct_chat' || Boolean(data.direct_chat_id);
  if (isDirectChat) {
    return '/messages';
  }

  // 6. Whitelisted deep_link fallback
  if (data.deep_link && WHITELISTED_ROUTE_REGEX.test(data.deep_link)) {
    return data.deep_link;
  }

  return null;
}
