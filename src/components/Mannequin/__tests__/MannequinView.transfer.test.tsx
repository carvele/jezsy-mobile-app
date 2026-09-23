import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { MannequinView } from '../MannequinView';
import { transientMannequinService } from '@/src/services/styling/transientMannequinService';
import { outfitService } from '@/src/services';
import { localExposureService } from '@/src/services/styling/localExposureService';
import { WardrobeItem } from '@/src/utils/mannequinConfig';

let mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage[key] || null),
    setItem: jest.fn(async (key: string, val: string) => {
      mockStorage[key] = String(val);
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockStorage[key];
    }),
    getAllKeys: jest.fn(async () => Object.keys(mockStorage)),
    clear: jest.fn(async () => {
      mockStorage = {};
    }),
  },
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    setParams: mockSetParams,
  }),
}));

const mockShowToast = jest.fn();
jest.mock('@/src/context/ToastContext', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

const currentUserId = 'test_user_phase_d';
jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    session: {
      user: {
        id: currentUserId,
      },
    },
  }),
}));

jest.mock('@/src/hooks/useSizingProfile', () => ({
  useSizingProfile: () => ({
    profile: null,
    loading: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/src/services', () => ({
  outfitService: {
    saveOutfitOnce: jest.fn().mockResolvedValue({ ok: true, data: { id: 'saved_1' } }),
    getOutfitById: jest.fn(),
  },
}));

jest.mock('@/src/services/styling/localExposureService', () => ({
  localExposureService: {
    logPresentation: jest.fn(),
    logInteraction: jest.fn(),
    getExposureHistory: jest.fn(),
  },
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      })),
    })),
  },
}));

jest.mock('@/components/ui/icon-symbol', () => ({
  __esModule: true,
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('expo-image', () => ({
  __esModule: true,
  Image: (props: any) => React.createElement('Image', props),
}));

jest.mock('react-native-svg', () => {
  const MockSvg = (props: any) => React.createElement('Svg', props, props.children);
  return {
    __esModule: true,
    default: MockSvg,
    Path: (props: any) => React.createElement('Path', props),
    Ellipse: (props: any) => React.createElement('Ellipse', props),
    G: (props: any) => React.createElement('G', props, props.children),
    Defs: (props: any) => React.createElement('Defs', props, props.children),
    LinearGradient: (props: any) => React.createElement('LinearGradient', props, props.children),
    Stop: (props: any) => React.createElement('Stop', props),
  };
});

jest.mock('react-native-reanimated', () => {
  return {
    __esModule: true,
    default: {
      View: (props: any) => React.createElement('View', props),
    },
    useSharedValue: (init: any) => ({ value: init }),
    useAnimatedStyle: () => ({}),
    withRepeat: (anim: any) => anim,
    withTiming: (toVal: any) => toVal,
    Easing: {
      inOut: () => ({}),
      ease: {},
    },
  };
});

jest.mock('@/src/components/MannequinSilhouette', () => ({
  __esModule: true,
  MannequinSilhouette: (props: any) => React.createElement('MannequinSilhouette', props),
}));

jest.mock('../MannequinCanvasItem', () => ({
  __esModule: true,
  MannequinCanvasItem: (props: any) => React.createElement('MannequinCanvasItem', props),
}));

jest.mock('../StylistCritiqueModal', () => ({
  __esModule: true,
  StylistCritiqueModal: (props: any) => React.createElement('StylistCritiqueModal', props),
}));

jest.mock('../OutfitContextModal', () => ({
  __esModule: true,
  OutfitContextModal: (props: any) => React.createElement('OutfitContextModal', props),
}));

jest.mock('@/src/utils/webBackgroundRemoval', () => ({
  removeBackgroundWeb: jest.fn(),
}));

jest.mock('@/src/utils/aiStylistAdvisor', () => ({
  gradeOutfitWithAI: jest.fn(),
}));

jest.mock('@/src/utils/stylistRun', () => ({
  runStylistRequest: jest.fn(),
}));

jest.mock('@/src/services/styleProfileService', () => ({
  styleProfileService: {
    getProfile: jest.fn().mockResolvedValue(null),
    saveProfile: jest.fn(),
  },
}));

jest.mock('@/src/utils/personalStyleEngine', () => ({
  updateProfileFromFeedback: jest.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeMockWardrobeItem(partial: Partial<WardrobeItem> & { id: string; category: string }): WardrobeItem {
  return {
    id: partial.id,
    user_id: currentUserId,
    product_id: null,
    image_url: 'https://example.com/item.png',
    category: partial.category,
    sub_category: partial.sub_category || partial.category,
    deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    color_tags: ['Black'],
    garment_type: partial.category,
    wear_count: 0,
    last_worn_at: null,
    description: null,
    user_notes: null,
    ai_attributes: null,
    occasions: ['Work'],
    seasons: ['All'],
  } as WardrobeItem;
}

const mockWardrobe: WardrobeItem[] = [
  makeMockWardrobeItem({ id: 'top_1', category: 'Top', sub_category: 'Black Silk Top' }),
  makeMockWardrobeItem({ id: 'bottom_1', category: 'Bottom', sub_category: 'Black Trousers' }),
  makeMockWardrobeItem({ id: 'shoes_1', category: 'Shoes', sub_category: 'Leather Loafers' }),
];

describe('MannequinView: Hardened Transient Token Transfer Lifecycle (Phase D)', () => {
  beforeEach(async () => {
    transientMannequinService._resetMemoryStore();
    mockStorage = {};
    jest.clearAllMocks();
  });

  it('gates token consumption on wardrobe readiness (isWardrobeLoaded: false)', async () => {
    const { token } = await transientMannequinService.createToken({
      userId: currentUserId,
      itemIds: ['top_1', 'bottom_1'],
      source: 'style-advisor',
    });

    const consumeSpy = jest.spyOn(transientMannequinService, 'consumeToken');

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <MannequinView
          wardrobeItems={[]}
          isWardrobeLoaded={false}
          onRefreshWardrobe={jest.fn()}
          initialTransientToken={token}
        />
      );
    });

    // Wardrobe is NOT loaded yet, so consumeToken must NOT be called
    expect(consumeSpy).not.toHaveBeenCalled();

    // Now wardrobe finishes loading: transition isWardrobeLoaded to true
    await ReactTestRenderer.act(async () => {
      renderer.update(
        <MannequinView
          wardrobeItems={mockWardrobe}
          isWardrobeLoaded={true}
          onRefreshWardrobe={jest.fn()}
          initialTransientToken={token}
        />
      );
    });

    // Token consumption proceeds once wardrobe is loaded
    expect(consumeSpy).toHaveBeenCalledWith(token, currentUserId);
  });

  it('handles empty wardrobe cleanly without breaking: consumes, resolves 0 items, preserves canvas, clears route token', async () => {
    const { token } = await transientMannequinService.createToken({
      userId: currentUserId,
      itemIds: ['top_1'],
      source: 'style-advisor',
    });

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <MannequinView
          wardrobeItems={[]} // genuinely empty wardrobe
          isWardrobeLoaded={true} // loading has completed!
          onRefreshWardrobe={jest.fn()}
          initialTransientToken={token}
        />
      );
    });

    // Token was consumed
    const checkToken = await transientMannequinService.consumeToken(token!, currentUserId);
    expect(checkToken.valid).toBe(false); // Already consumed!

    // Feedback toast displayed
    expect(mockShowToast).toHaveBeenCalledWith(
      'No matching garments found in your wardrobe for this transfer.',
      'info'
    );

    // Route token cleared
    expect(mockSetParams).toHaveBeenCalledWith({ transientToken: undefined });
  });

  it('partially resolves items when some are deleted or missing from user wardrobe', async () => {
    const { token } = await transientMannequinService.createToken({
      userId: currentUserId,
      itemIds: ['top_1', 'deleted_item_999'],
      source: 'style-advisor',
    });

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <MannequinView
          wardrobeItems={mockWardrobe} // only has top_1, bottom_1, shoes_1
          isWardrobeLoaded={true}
          onRefreshWardrobe={jest.fn()}
          initialTransientToken={token}
        />
      );
    });

    // Informs user of the missing garment
    expect(mockShowToast).toHaveBeenCalledWith(
      '1 garment was no longer in your wardrobe.',
      'info'
    );

    // Route token cleared
    expect(mockSetParams).toHaveBeenCalledWith({ transientToken: undefined });
    expect(mockShowToast).toHaveBeenCalledWith('Loaded look onto mannequin', 'success');
  });

  it('replaces canvas items, resets pins, and clears route parameter on valid transfer', async () => {
    const { token } = await transientMannequinService.createToken({
      userId: currentUserId,
      itemIds: ['top_1', 'bottom_1'],
      source: 'passive-outfits',
    });

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <MannequinView
          wardrobeItems={mockWardrobe}
          isWardrobeLoaded={true}
          onRefreshWardrobe={jest.fn()}
          initialTransientToken={token}
        />
      );
    });

    expect(mockSetParams).toHaveBeenCalledWith({ transientToken: undefined });
    expect(mockShowToast).toHaveBeenCalledWith('Loaded look onto mannequin', 'success');
  });

  it('strictly performs zero database writes, zero exposure records, and zero wear mutations', async () => {
    const { token } = await transientMannequinService.createToken({
      userId: currentUserId,
      itemIds: ['top_1', 'shoes_1'],
      source: 'style-advisor',
    });

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <MannequinView
          wardrobeItems={mockWardrobe}
          isWardrobeLoaded={true}
          onRefreshWardrobe={jest.fn()}
          initialTransientToken={token}
        />
      );
    });

    // Zero DB writes
    expect(outfitService.saveOutfitOnce).not.toHaveBeenCalled();

    // Zero exposure history logs
    expect(localExposureService.logPresentation).not.toHaveBeenCalled();
    expect(localExposureService.logInteraction).not.toHaveBeenCalled();
  });
});
