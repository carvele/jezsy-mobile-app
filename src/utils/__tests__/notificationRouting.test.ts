import { resolveNotificationRoute } from '../notificationRouting';
import { NotificationData } from '@/src/types/dto/notification';

describe('resolveNotificationRoute', () => {
  it('returns null for null or undefined data', () => {
    expect(resolveNotificationRoute(null)).toBeNull();
    expect(resolveNotificationRoute(undefined)).toBeNull();
    expect(resolveNotificationRoute({})).toBeNull();
  });

  describe('Reservation routing', () => {
    it('routes via reservation_id legacy key', () => {
      const data: NotificationData = { reservation_id: 'res-123' };
      expect(resolveNotificationRoute(data)).toBe('/reservations/res-123');
    });

    it('routes via entity_type and entity_id', () => {
      const data: NotificationData = {
        entity_type: 'reservation',
        entity_id: 'res-456',
      };
      expect(resolveNotificationRoute(data)).toBe('/reservations/res-456');
    });
  });

  describe('Product routing', () => {
    it('routes via product_id legacy key', () => {
      const data: NotificationData = { product_id: 'prod-123' };
      expect(resolveNotificationRoute(data)).toBe('/product/prod-123');
    });

    it('routes via entity_type product and entity_id', () => {
      const data: NotificationData = {
        entity_type: 'product',
        entity_id: 'prod-456',
      };
      expect(resolveNotificationRoute(data)).toBe('/product/prod-456');
    });
  });

  describe('Support Conversation routing', () => {
    it('routes via conversation_id legacy key', () => {
      const data: NotificationData = { conversation_id: 'conv-123' };
      expect(resolveNotificationRoute(data)).toBe('/messages/conv-123');
    });

    it('routes via entity_type conversation and entity_id', () => {
      const data: NotificationData = {
        entity_type: 'conversation',
        entity_id: 'conv-456',
      };
      expect(resolveNotificationRoute(data)).toBe('/messages/conv-456');
    });
  });

  describe('Review routing', () => {
    it('routes to /product/reviews with productId query param', () => {
      const data: NotificationData = {
        entity_type: 'review',
        entity_id: 'rev-1',
        product_id: 'prod-999',
      };
      expect(resolveNotificationRoute(data)).toBe('/product/reviews?productId=prod-999');
    });

    it('routes review_id with product_id', () => {
      const data: NotificationData = {
        review_id: 'rev-2',
        product_id: 'prod-888',
      };
      expect(resolveNotificationRoute(data)).toBe('/product/reviews?productId=prod-888');
    });

    it('returns null if review notification has no productId', () => {
      const data: NotificationData = {
        entity_type: 'review',
        entity_id: 'rev-3',
      };
      expect(resolveNotificationRoute(data)).toBeNull();
    });
  });

  describe('Direct Chat routing', () => {
    it('routes direct_chat to /messages inbox as P2P chat is retired', () => {
      const data: NotificationData = {
        entity_type: 'direct_chat',
        entity_id: 'chat-uuid',
        actor_id: 'user-other-uuid',
      };
      expect(resolveNotificationRoute(data)).toBe('/messages');
    });

    it('routes direct_chat_id to /messages inbox', () => {
      const data: NotificationData = {
        entity_type: 'direct_chat',
        direct_chat_id: 'chat-uuid',
      };
      expect(resolveNotificationRoute(data)).toBe('/messages');
    });
  });

  describe('Fallback and Whitelist routing', () => {
    it('allows whitelisted internal paths when no typed entity matches', () => {
      const data: NotificationData = {
        deep_link: '/reservations/special-res',
      };
      expect(resolveNotificationRoute(data)).toBe('/reservations/special-res');
    });

    it('rejects external URLs and non-whitelisted paths', () => {
      expect(resolveNotificationRoute({ deep_link: 'https://malicious.com' })).toBeNull();
      expect(resolveNotificationRoute({ deep_link: 'javascript:alert(1)' })).toBeNull();
      expect(resolveNotificationRoute({ deep_link: '/admin/users' })).toBeNull();
    });

    it('prioritizes typed entity resolution over conflicting deep_link', () => {
      const data: NotificationData = {
        entity_type: 'product',
        entity_id: 'prod-real',
        deep_link: '/reservations/other-res',
      };
      expect(resolveNotificationRoute(data)).toBe('/product/prod-real');
    });
  });
});
