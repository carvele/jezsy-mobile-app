import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { PlanOutfitModal } from '../PlanOutfitModal';
import { PlanLaterPayload, PlannedOutfit } from '@/src/types/planner';
import * as plannerService from '@/src/services/plannerService';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'dark',
}));

jest.mock('@/src/services/plannerService', () => ({
  createPlannedOutfit: jest.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PlanOutfitModal Component (Phase H2)', () => {
  const mockPayload: PlanLaterPayload = {
    sourceType: 'saved_outfit',
    sourceRefId: 'saved_outfit_99',
    name: 'Minimalist Monochrome',
    items: [
      { id: 'item_1', name: 'Charcoal Blazer', category: 'Outerwear', image_url: 'https://example.com/1.png' },
      { id: 'item_2', name: 'White Poplin Shirt', category: 'Top', image_url: 'https://example.com/2.png' },
    ],
  };

  const authoritativeInventory = [{ id: 'item_1' }, { id: 'item_2' }];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal with outfit title and items', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlanOutfitModal
          visible={true}
          payload={mockPayload}
          authoritativeInventory={authoritativeInventory}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );
    });

    const titleText = root!.root.find((node) => node.props && node.props.children === 'Minimalist Monochrome');
    expect(titleText).toBeDefined();

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-plan');
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn.props.disabled).toBe(false);
  });

  it('blocks scheduling when saved outfit items are missing from inventory (preflight check)', () => {
    // Only item_1 is in inventory; item_2 is missing
    const incompleteInventory = [{ id: 'item_1' }];

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlanOutfitModal
          visible={true}
          payload={mockPayload}
          authoritativeInventory={incompleteInventory}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );
    });

    // Check preflight banner
    const banner = root!.root.find((node) => node.props && node.props.testID === 'preflight-error-banner');
    expect(banner).toBeDefined();

    // Confirm button must be disabled
    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-plan');
    expect(confirmBtn.props.disabled).toBe(true);
  });

  it('submits plan and invokes onSuccess when plannerService succeeds', async () => {
    const createdPlan: PlannedOutfit = {
      id: 'plan_new_1',
      user_id: 'user_1',
      planned_date: '2026-09-24',
      slot: 'all_day',
      status: 'planned',
      source_type: 'saved_outfit',
      source_ref_id: 'saved_outfit_99',
      plan_timezone: 'Asia/Manila',
      notes: null,
      climate_context: null,
      items: [],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z',
      revision: 1,
    };

    (plannerService.createPlannedOutfit as jest.Mock).mockResolvedValueOnce({
      ok: true,
      data: createdPlan,
    });

    const onSuccess = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlanOutfitModal
          visible={true}
          payload={mockPayload}
          authoritativeInventory={authoritativeInventory}
          onClose={jest.fn()}
          onSuccess={onSuccess}
        />
      );
    });

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-plan');
    await ReactTestRenderer.act(async () => {
      confirmBtn.props.onPress();
    });

    expect(plannerService.createPlannedOutfit).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: 'all_day',
        sourceType: 'saved_outfit',
        sourceRefId: 'saved_outfit_99',
      })
    );
    expect(onSuccess).toHaveBeenCalledWith(createdPlan);
  });

  it('handles server collision (P0004/23505) gracefully and calls onCollisionRefreshDate', async () => {
    (plannerService.createPlannedOutfit as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'A look is already planned for this date and slot.',
        cause: { code: '23505' },
      },
    });

    const onCollisionRefresh = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlanOutfitModal
          visible={true}
          payload={mockPayload}
          authoritativeInventory={authoritativeInventory}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
          onCollisionRefreshDate={onCollisionRefresh}
        />
      );
    });

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-plan');
    await ReactTestRenderer.act(async () => {
      await confirmBtn.props.onPress();
    });

    // Error banner should show collision text
    const errorBanner = root!.root.find((node) => node.props && node.props.testID === 'plan-error-banner');
    expect(errorBanner).toBeDefined();
    expect(onCollisionRefresh).toHaveBeenCalled();
  });

  it('retains user inputs and displays error on network failure to allow retry', async () => {
    (plannerService.createPlannedOutfit as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Could not connect to server. Please try again.',
      },
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlanOutfitModal
          visible={true}
          payload={mockPayload}
          authoritativeInventory={authoritativeInventory}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );
    });

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-plan');
    await ReactTestRenderer.act(async () => {
      confirmBtn.props.onPress();
    });

    // Error banner shown
    const errorBanner = root!.root.find((node) => node.props && node.props.testID === 'plan-error-banner');
    expect(errorBanner).toBeDefined();

    // Confirm button remains enabled for retry
    expect(confirmBtn.props.disabled).toBe(false);
  });

  it('persists occasion in createPlannedOutfit payload', async () => {
    (plannerService.createPlannedOutfit as jest.Mock).mockResolvedValueOnce({
      ok: true,
      data: { id: 'plan_occasion_1', status: 'planned', revision: 1 },
    });

    const payloadWithOccasion: PlanLaterPayload = {
      ...mockPayload,
      occasion: 'Black Tie Gala',
    };

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlanOutfitModal
          visible={true}
          payload={payloadWithOccasion}
          authoritativeInventory={authoritativeInventory}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );
    });

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-plan');
    await ReactTestRenderer.act(async () => {
      confirmBtn.props.onPress();
    });

    expect(plannerService.createPlannedOutfit).toHaveBeenCalledWith(
      expect.objectContaining({
        occasion: 'Black Tie Gala',
      })
    );
  });

  it('proves all 4 UI slot options map to exact H1 enum values: all_day, day, evening, workout', async () => {
    const slotPairs: { label: string; expectedSlot: string }[] = [
      { label: 'Slot: All Day', expectedSlot: 'all_day' },
      { label: 'Slot: Daytime', expectedSlot: 'day' },
      { label: 'Slot: Evening', expectedSlot: 'evening' },
      { label: 'Slot: Workout', expectedSlot: 'workout' },
    ];

    for (const { label, expectedSlot } of slotPairs) {
      jest.clearAllMocks();
      (plannerService.createPlannedOutfit as jest.Mock).mockResolvedValueOnce({
        ok: true,
        data: { id: `plan_${expectedSlot}`, status: 'planned', revision: 1 },
      });

      let root: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        root = ReactTestRenderer.create(
          <PlanOutfitModal
            visible={true}
            payload={mockPayload}
            authoritativeInventory={authoritativeInventory}
            onClose={jest.fn()}
            onSuccess={jest.fn()}
          />
        );
      });

      const slotBtn = root!.root.find((node) => node.props && node.props.accessibilityLabel === label);
      expect(slotBtn).toBeDefined();

      ReactTestRenderer.act(() => {
        slotBtn.props.onPress();
      });

      const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-plan');
      await ReactTestRenderer.act(async () => {
        confirmBtn.props.onPress();
      });

      expect(plannerService.createPlannedOutfit).toHaveBeenCalledWith(
        expect.objectContaining({
          slot: expectedSlot,
        })
      );
    }
  });
});
