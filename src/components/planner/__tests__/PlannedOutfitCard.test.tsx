import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { PlannedOutfitCard } from '../PlannedOutfitCard';
import { PlannedOutfit } from '@/src/types/planner';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'dark',
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('PlannedOutfitCard Component (Phase H2)', () => {
  const basePlan: PlannedOutfit = {
    id: 'plan_123',
    user_id: 'user_1',
    planned_date: '2026-09-24',
    slot: 'evening',
    status: 'planned',
    source_type: 'saved_outfit',
    source_ref_id: 'outfit_1',
    plan_timezone: 'Asia/Manila',
    notes: 'Dinner at Nobu',
    climate_context: ['mild'],
    items: [
      {
        id: 'item_top',
        name: 'Black Silk Shirt',
        category: 'Top',
        image_url: 'https://example.com/top.png',
        sub_category: 'Black Silk Shirt',
        color_tags: ['Black'],
      },
      {
        id: 'item_bottom',
        name: 'Wool Trousers',
        category: 'Bottom',
        image_url: 'https://example.com/bottom.png',
        sub_category: 'Wool Trousers',
        color_tags: ['Charcoal'],
      },
    ],
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
    revision: 1,
  };

  it('renders snapshot items, slot label, and notes', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlannedOutfitCard
          plan={basePlan}
          onReschedule={jest.fn()}
          onEditMetadata={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const instance = root!.root;
    // Slot label
    const slotText = instance.find((node) => node.props && node.props.children === 'Evening');
    expect(slotText).toBeDefined();

    // Notes
    const notesText = instance.find((node) => node.props && node.props.children === 'Dinner at Nobu');
    expect(notesText).toBeDefined();

    // Item snapshots rendered
    const itemCards = instance.findAll((node) => node.props && node.props.testID?.startsWith('snapshot-item-'));
    expect(itemCards).toHaveLength(2);
  });

  it('renders neutral "Not confirmed" badge for unconfirmed status', () => {
    const unconfirmedPlan: PlannedOutfit = {
      ...basePlan,
      status: 'unconfirmed',
    };

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlannedOutfitCard
          plan={unconfirmedPlan}
          onReschedule={jest.fn()}
          onEditMetadata={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const badge = root!.root.find((node) => node.props && node.props.children === 'Not confirmed');
    expect(badge).toBeDefined();
  });

  it('correctly flags unavailable items when authoritative inventory is ready', () => {
    // Only item_top is in inventory; item_bottom was deleted or missing
    const authoritativeInventory = [{ id: 'item_top' }];

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlannedOutfitCard
          plan={basePlan}
          inventoryStatus="ready"
          authoritativeInventory={authoritativeInventory}
          onReschedule={jest.fn()}
          onEditMetadata={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const instance = root!.root;
    const unavailableLabels = instance.findAll((node) => node.props && node.props.children === 'Unavailable');
    expect(unavailableLabels).toHaveLength(1);
  });

  it('does NOT flag items as unavailable if inventoryStatus is not ready', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlannedOutfitCard
          plan={basePlan}
          inventoryStatus="loading"
          authoritativeInventory={[]}
          onReschedule={jest.fn()}
          onEditMetadata={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const unavailableLabels = root!.root.findAll((node) => node.props && node.props.children === 'Unavailable');
    expect(unavailableLabels).toHaveLength(0);
  });

  it('triggers reschedule and edit callbacks', () => {
    const onReschedule = jest.fn();
    const onEditMetadata = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlannedOutfitCard
          plan={basePlan}
          onReschedule={onReschedule}
          onEditMetadata={onEditMetadata}
          onCancel={jest.fn()}
        />
      );
    });

    const rescheduleBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-reschedule');
    const editBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-edit-metadata');

    ReactTestRenderer.act(() => {
      rescheduleBtn.props.onPress();
    });
    expect(onReschedule).toHaveBeenCalledWith(basePlan);

    ReactTestRenderer.act(() => {
      editBtn.props.onPress();
    });
    expect(onEditMetadata).toHaveBeenCalledWith(basePlan);
  });

  it('confirms cancel via Alert before invoking onCancel', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const onCancel = jest.fn();

    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlannedOutfitCard
          plan={basePlan}
          onReschedule={jest.fn()}
          onEditMetadata={jest.fn()}
          onCancel={onCancel}
        />
      );
    });

    const cancelBtn = root!.root.find((node) => node.props && node.props.testID === 'btn-cancel-plan');
    ReactTestRenderer.act(() => {
      cancelBtn.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();
    const alertButtons = alertSpy.mock.calls[0][2] as any[];
    const destructiveBtn = alertButtons.find((b) => b.style === 'destructive');
    expect(destructiveBtn).toBeDefined();

    // Trigger destructive confirmation
    destructiveBtn.onPress();
    expect(onCancel).toHaveBeenCalledWith(basePlan);

    alertSpy.mockRestore();
  });

  it('contains ZERO wear buttons (Phase H3 deferred)', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <PlannedOutfitCard
          plan={basePlan}
          onReschedule={jest.fn()}
          onEditMetadata={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const instance = root!.root;
    // Look for any button with "Wear", "Confirm Wear", or "Wear Today"
    const wearButtons = instance.findAll((node) => {
      const text = typeof node.props?.children === 'string' ? node.props.children.toLowerCase() : '';
      return text.includes('wear') && (String(node.type) === 'Text' || node.props?.accessibilityRole === 'button');
    });
    expect(wearButtons).toHaveLength(0);
  });
});
