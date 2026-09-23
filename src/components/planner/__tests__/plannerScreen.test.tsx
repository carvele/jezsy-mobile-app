import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import PlannerScreen from '@/app/planner';
import * as plannerService from '@/src/services/plannerService';
import * as wardrobeService from '@/src/services/wardrobeService';
import { PlannedOutfit } from '@/src/types/planner';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, style }: any) => React.createElement('SafeAreaView', { style }, children),
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
  }),
}));

jest.mock('@/src/services/plannerService', () => ({
  getPlannedOutfitsRange: jest.fn(),
  cancelPlannedOutfit: jest.fn(),
  getPlannedOutfitById: jest.fn(),
  reschedulePlannedOutfit: jest.fn(),
  updatePlannedOutfitMetadata: jest.fn(),
}));

jest.mock('@/src/services/wardrobeService', () => ({
  getWardrobeItemsPage: jest.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PlannerScreen (Phase H2)', () => {
  const mockPlans: PlannedOutfit[] = [
    {
      id: 'plan_screen_1',
      user_id: 'test_user_id',
      planned_date: '2026-09-24',
      slot: 'evening',
      status: 'planned',
      source_type: 'saved_outfit',
      source_ref_id: 'outfit_1',
      plan_timezone: 'Asia/Manila',
      notes: 'Gala Dinner',
      climate_context: null,
      items: [
        {
          id: 'item_1',
          name: 'Tuxedo Shirt',
          category: 'Top',
          image_url: 'https://example.com/top.png',
          sub_category: 'Tuxedo Shirt',
          color_tags: ['White'],
        },
      ],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z',
      revision: 1,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (wardrobeService.getWardrobeItemsPage as jest.Mock).mockResolvedValue({
      items: [{ id: 'item_1' }],
      total: 1,
    });
    (plannerService.getPlannedOutfitsRange as jest.Mock).mockResolvedValue({
      ok: true,
      data: mockPlans,
    });
  });

  it('performs bounded range query on mount and renders plans for selected day', async () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(<PlannerScreen />);
    });

    // Verify bounded range query called
    expect(plannerService.getPlannedOutfitsRange).toHaveBeenCalled();
    const calls = (plannerService.getPlannedOutfitsRange as jest.Mock).mock.calls[0];
    expect(calls[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // weekStart YYYY-MM-DD
    expect(calls[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // weekEnd YYYY-MM-DD

    const instance = root!.root;
    // Notes from mock plan rendered
    const notes = instance.find((node) => node.props && node.props.children === 'Gala Dinner');
    expect(notes).toBeDefined();
  });

  it('renders quiet luxury empty state when no plans exist for selected day and navigates on source CTA tap', async () => {
    // Return empty plans
    (plannerService.getPlannedOutfitsRange as jest.Mock).mockResolvedValue({
      ok: true,
      data: [],
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(<PlannerScreen />);
    });

    const instance = root!.root;
    // Empty state heading
    const emptyHeading = instance.find(
      (node) => node.props && node.props.children === 'No Looks Planned'
    );
    expect(emptyHeading).toBeDefined();

    // Tap "Plan a Look" button to open chooser modal
    const planActionBtn = instance.find((node) => node.props && node.props.testID === 'btn-empty-plan-look');
    await ReactTestRenderer.act(async () => {
      planActionBtn.props.onPress();
    });

    // Chooser item for Saved Outfits
    const savedOutfitsChooser = instance.find((node) => node.props && node.props.testID === 'chooser-saved-outfits');
    await ReactTestRenderer.act(async () => {
      savedOutfitsChooser.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith('/(tabs)/wardrobe?tab=outfits');
  });

  it('navigates to style advisor and mannequin from source chooser', async () => {
    (plannerService.getPlannedOutfitsRange as jest.Mock).mockResolvedValue({
      ok: true,
      data: [],
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(<PlannerScreen />);
    });

    const instance = root!.root;
    const planActionBtn = instance.find((node) => node.props && node.props.testID === 'btn-empty-plan-look');
    await ReactTestRenderer.act(async () => {
      planActionBtn.props.onPress();
    });

    const styleAdvisorChooser = instance.find((node) => node.props && node.props.testID === 'chooser-style-advisor');
    await ReactTestRenderer.act(async () => {
      styleAdvisorChooser.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/style-advisor');

    const mannequinChooser = instance.find((node) => node.props && node.props.testID === 'chooser-mannequin');
    await ReactTestRenderer.act(async () => {
      mannequinChooser.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/wardrobe?tab=mannequin');
  });

  it('handles plan cancellation OCC conflict gracefully by refetching latest plan without fake success and alerting user', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (plannerService.getPlannedOutfitsRange as jest.Mock).mockResolvedValue({
      ok: true,
      data: mockPlans,
    });
    (plannerService.cancelPlannedOutfit as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'OCC_CONFLICT',
        message: 'Plan was modified by another session.',
        cause: { code: 'P0001' },
      },
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(<PlannerScreen />);
    });

    const instance = root!.root;
    const cards = instance.findAll((node) => node.props && typeof node.props.onCancel === 'function');
    expect(cards.length).toBeGreaterThan(0);

    const card = cards[0];
    await ReactTestRenderer.act(async () => {
      await card.props.onCancel(mockPlans[0]);
    });

    expect(plannerService.cancelPlannedOutfit).toHaveBeenCalledWith('plan_screen_1', 1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Update Required',
      expect.stringContaining('This plan was modified on another device')
    );
    expect(plannerService.getPlannedOutfitsRange).toHaveBeenCalledTimes(2);

    alertSpy.mockRestore();
  });
});
