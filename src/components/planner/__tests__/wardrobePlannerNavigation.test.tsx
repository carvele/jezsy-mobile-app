import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import WardrobeScreen from '@/app/(tabs)/wardrobe';

const mockPush = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

jest.mock('expo-image', () => ({
  Image: (props: any) => React.createElement('Image', props),
}));

jest.mock('expo-blur', () => ({
  BlurView: ({ children, style }: any) => React.createElement('BlurView', { style }, children),
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

jest.mock('react-native-reanimated', () => ({
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
    bezier: () => ({}),
    out: () => ({}),
  },
}));

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: any) => children,
  Gesture: {
    Pan: () => ({ onBegin: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }),
    Pinch: () => ({ onBegin: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }),
    Rotation: () => ({ onBegin: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }),
    Simultaneous: () => ({}),
  },
}));

jest.mock('@/src/components/Mannequin/MannequinView', () => ({
  MannequinView: () => null,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: any) => {
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 20, left: 0, right: 0 }),
  SafeAreaView: ({ children, style }: any) => React.createElement('View', { style }, children),
}));

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'dark',
}));

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test_user_id', email: 'test@example.com' },
    session: { user: { id: 'test_user_id', email: 'test@example.com' } },
  }),
}));

jest.mock('@/src/services/wardrobeService', () => ({
  getWardrobeItems: jest.fn().mockResolvedValue([]),
  getWardrobeStats: jest.fn().mockResolvedValue({ totalItems: 0 }),
  deleteWardrobeItem: jest.fn(),
  updateWardrobeItem: jest.fn(),
  getWardrobeCategories: jest.fn().mockResolvedValue([]),
  getWardrobeItemsPage: jest.fn().mockResolvedValue({ items: [], count: 0, hasMore: false, nextOffset: 0 }),
  getWardrobeOutfitsPage: jest.fn().mockResolvedValue({
    items: [
      {
        id: 'outfit_1',
        user_id: 'test_user_id',
        outfit_name: 'Summer Look',
        outfit_type: 'custom',
        items: [],
        created_at: '2026-09-24T00:00:00Z',
        updated_at: '2026-09-24T00:00:00Z',
        deleted: false,
      },
    ],
    count: 1,
    hasMore: false,
    nextOffset: 1,
  }),
  getWardrobeCapsulesPage: jest.fn().mockResolvedValue({ items: [], count: 0, hasMore: false, nextOffset: 0 }),
}));

jest.mock('@/src/services/outfitService', () => ({
  getSavedOutfits: jest.fn().mockResolvedValue([]),
  deleteSavedOutfit: jest.fn(),
}));

jest.mock('@/src/services/plannerService', () => ({
  createPlannedOutfit: jest.fn(),
}));

jest.mock('@/src/utils/haptics', () => ({
  tapLight: jest.fn(),
  tapMedium: jest.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Wardrobe Primary Planner Navigation (Phase H2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('navigates to /planner when user taps the header calendar button', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(<WardrobeScreen />);
    });

    const instance = root!.root;
    const headerPlannerBtn = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Open Outfit Planner'
    );
    expect(headerPlannerBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      headerPlannerBtn.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith('/planner');
  });

  it('navigates to /planner when user taps the Outfit Planner hub banner in the outfits tab', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(<WardrobeScreen />);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const instance = root!.root;

    // Switch to Outfits tab
    const outfitsTab = instance.find(
      (node) => node.props && node.props.accessibilityLabel === 'Outfits tab'
    );
    expect(outfitsTab).toBeDefined();

    await ReactTestRenderer.act(async () => {
      outfitsTab.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Find the Outfit Planner banner
    const banner = instance.find(
      (node) =>
        node.props &&
        node.props.accessibilityLabel === 'Outfit Planner — Schedule your week, plan upcoming looks'
    );
    expect(banner).toBeDefined();

    await ReactTestRenderer.act(async () => {
      banner.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith('/planner');
  });
});
