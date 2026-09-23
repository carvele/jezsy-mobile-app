import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { EditPlanMetadataModal } from '../EditPlanMetadataModal';
import { PlannedOutfit } from '@/src/types/planner';
import * as plannerService from '@/src/services/plannerService';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'dark',
}));

jest.mock('@/src/services/plannerService', () => ({
  updatePlannedOutfitMetadata: jest.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditPlanMetadataModal Component (Phase H2)', () => {
  const basePlan: PlannedOutfit = {
    id: 'plan_edit_1',
    user_id: 'user_1',
    planned_date: '2026-09-24',
    slot: 'day',
    status: 'planned',
    source_type: 'manual',
    source_ref_id: null,
    plan_timezone: 'Asia/Manila',
    notes: 'Initial notes',
    climate_context: null,
    items: [],
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
    revision: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates notes and invokes updatePlannedOutfitMetadata', async () => {
    const updatedPlan: PlannedOutfit = {
      ...basePlan,
      notes: 'Updated presentation outfit notes',
      revision: 2,
    };

    (plannerService.updatePlannedOutfitMetadata as jest.Mock).mockResolvedValueOnce({
      ok: true,
      data: updatedPlan,
    });

    const onSuccess = jest.fn();
    const onClose = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <EditPlanMetadataModal
          visible={true}
          plan={basePlan}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );
    });

    const input = root!.root.find((node) => node.props && node.props.testID === 'input-plan-notes');
    ReactTestRenderer.act(() => {
      input.props.onChangeText('Updated presentation outfit notes');
    });

    const occasionInput = root!.root.find((node) => node.props && node.props.testID === 'input-plan-occasion');
    ReactTestRenderer.act(() => {
      occasionInput.props.onChangeText('Executive Conference');
    });

    const saveBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-save-notes');
    await ReactTestRenderer.act(async () => {
      await saveBtn.props.onPress();
    });

    expect(plannerService.updatePlannedOutfitMetadata).toHaveBeenCalledWith({
      planId: 'plan_edit_1',
      expectedRevision: 1,
      notes: 'Updated presentation outfit notes',
      climateContext: undefined,
    });
    expect(onSuccess).toHaveBeenCalledWith({
      ...updatedPlan,
      occasion: 'Executive Conference',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('recovers from OCC conflict by refreshing revision and preserving draft notes', async () => {
    (plannerService.updatePlannedOutfitMetadata as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'OCC_CONFLICT',
        message: 'Plan was modified by another session.',
        cause: { code: 'P0001' },
      },
    });

    const refreshedPlan: PlannedOutfit = {
      ...basePlan,
      revision: 4,
    };
    const onRefreshPlan = jest.fn().mockResolvedValue(refreshedPlan);

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <EditPlanMetadataModal
          visible={true}
          plan={basePlan}
          onClose={jest.fn()}
          onSuccess={jest.fn()}
          onRefreshPlan={onRefreshPlan}
        />
      );
    });

    const input = root!.root.find((node) => node.props && node.props.testID === 'input-plan-notes');
    ReactTestRenderer.act(() => {
      input.props.onChangeText('Draft notes preserved across conflict');
    });

    const saveBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-save-notes');
    await ReactTestRenderer.act(async () => {
      await saveBtn.props.onPress();
    });

    expect(onRefreshPlan).toHaveBeenCalledWith('plan_edit_1');
    const errorBanner = root!.root.find((node) => node.props && node.props.testID === 'edit-notes-error-banner');
    expect(errorBanner).toBeDefined();

    // Draft notes should still be in the input
    expect(input.props.value).toBe('Draft notes preserved across conflict');
  });
});
