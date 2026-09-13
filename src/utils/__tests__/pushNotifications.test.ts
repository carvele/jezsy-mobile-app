import AsyncStorage from '@react-native-async-storage/async-storage';
import { handleNotificationResponse } from '@/src/utils/pushNotifications';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    appOwnership: 'standalone',
    expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

describe('pushNotifications response handling & deduplication', () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  it('returns false if response is null or undefined', async () => {
    const res1 = await handleNotificationResponse(null, mockRouter);
    const res2 = await handleNotificationResponse(undefined, mockRouter);
    expect(res1).toBe(false);
    expect(res2).toBe(false);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('routes to target screen when valid notification response is received', async () => {
    const response = {
      notification: {
        request: {
          identifier: 'notif-123',
          content: {
            data: {
              entity_type: 'reservation',
              entity_id: 'res-abc-123',
              action: 'status_changed',
            },
          },
        },
      },
    };

    const handled = await handleNotificationResponse(response, mockRouter);
    expect(handled).toBe(true);
    expect(mockRouter.push).toHaveBeenCalledWith('/reservations/res-abc-123');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@last_handled_notification_id', 'notif-123');
  });

  it('deduplicates in-memory when same notification identifier is received repeatedly', async () => {
    const response = {
      notification: {
        request: {
          identifier: 'notif-unique-456',
          content: {
            data: {
              reservation_id: 'res-456',
            },
          },
        },
      },
    };

    const first = await handleNotificationResponse(response, mockRouter);
    expect(first).toBe(true);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);

    // Second call with same identifier
    const second = await handleNotificationResponse(response, mockRouter);
    expect(second).toBe(false);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('deduplicates from AsyncStorage on cold start when identifier was already handled', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('cold-start-id-789');

    const response = {
      notification: {
        request: {
          identifier: 'cold-start-id-789',
          content: {
            data: {
              product_id: 'prod-789',
            },
          },
        },
      },
    };

    const handled = await handleNotificationResponse(response, mockRouter);
    expect(handled).toBe(false);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('routes review notification correctly to /product/reviews?productId=...', async () => {
    const response = {
      notification: {
        request: {
          identifier: 'notif-review-1',
          content: {
            data: {
              entity_type: 'review',
              product_id: 'p-123',
              action: 'review_reply',
            },
          },
        },
      },
    };

    const handled = await handleNotificationResponse(response, mockRouter);
    expect(handled).toBe(true);
    expect(mockRouter.push).toHaveBeenCalledWith('/product/reviews?productId=p-123');
  });
});
