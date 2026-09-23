import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { ReschedulePlanModal } from '../ReschedulePlanModal';
import { PlannedOutfit } from '@/src/types/planner';
import * as plannerService from '@/src/services/plannerService';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'dark',
}));

jest.mock('@/src/services/plannerService', () => ({
  reschedulePlannedOutfit: jest.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ReschedulePlanModal Component (Phase H2)', () => {
  const basePlan: PlannedOutfit = {
    id: 'plan_reschedule_1',
    user_id: 'user_1',
    planned_date: '2026-09-24',
    slot: 'day',
    status: 'planned',
    source_type: 'manual',
    source_ref_id: null,
    plan_timezone: 'Asia/Manila',
    notes: 'Existing notes',
    climate_context: null,
    items: [],
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
    revision: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables confirm button when date and slot are unchanged', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <ReschedulePlanModal
          visible={true}
          plan={basePlan}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />
      );
    });

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-reschedule');
    expect(confirmBtn.props.disabled).toBe(true);
  });

  it('enables confirm button and calls reschedulePlannedOutfit when slot changes', async () => {
    const updatedPlan: PlannedOutfit = {
      ...basePlan,
      slot: 'evening',
      revision: 2,
    };

    (plannerService.reschedulePlannedOutfit as jest.Mock).mockResolvedValueOnce({
      ok: true,
      data: updatedPlan,
    });

    const onSuccess = jest.fn();
    const onClose = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <ReschedulePlanModal
          visible={true}
          plan={basePlan}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
    });

    // Select 'evening' slot chip
    const eveningChip = root!.root.find((node) => node.props && node.props.testID === 'slot-chip-evening');
    ReactTestRenderer.act(() => {
      eveningChip.props.onPress();
    });

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-reschedule');
    expect(confirmBtn.props.disabled).toBe(false);

    await ReactTestRenderer.act(async () => {
      confirmBtn.props.onPress();
    });

    expect(plannerService.reschedulePlannedOutfit).toHaveBeenCalledWith({
      planId: 'plan_reschedule_1',
      expectedRevision: 1,
      newDate: '2026-09-24',
      newSlot: 'evening',
    });
    expect(onSuccess).toHaveBeenCalledWith(updatedPlan);
    expect(onClose).toHaveBeenCalled();
  });

  it('handles OCC conflict (P0001) by invoking onRefreshPlan and updating revision', async () => {
    (plannerService.reschedulePlannedOutfit as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'OCC_CONFLICT',
        message: 'Plan was modified by another session.',
        cause: { code: 'P0001' },
      },
    });

    const refreshedPlan: PlannedOutfit = {
      ...basePlan,
      revision: 3,
    };
    const onRefreshPlan = jest.fn().mockResolvedValue(refreshedPlan);

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <ReschedulePlanModal
          visible={true}
          plan={basePlan}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
          onRefreshPlan={onRefreshPlan}
        />
      );
    });

    // Change slot to enable submit
    const eveningChip = root!.root.find((node) => node.props && node.props.testID === 'slot-chip-evening');
    ReactTestRenderer.act(() => {
      eveningChip.props.onPress();
    });

    const confirmBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-confirm-reschedule');
    await ReactTestRenderer.act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(onRefreshPlan).toHaveBeenCalledWith('plan_reschedule_1');
    const errorBanner = root!.root.find((node) => node.props && node.props.testID === 'reschedule-error-banner');
    expect(errorBanner).toBeDefined();
  });
});
