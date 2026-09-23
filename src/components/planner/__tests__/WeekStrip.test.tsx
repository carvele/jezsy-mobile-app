import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { WeekStrip } from '../WeekStrip';
import { PlannedOutfit } from '@/src/types/planner';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'dark',
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('WeekStrip Component (Phase H2)', () => {
  const mockPlans: PlannedOutfit[] = [
    {
      id: 'plan_1',
      user_id: 'user_1',
      planned_date: '2026-09-24',
      slot: 'evening',
      status: 'planned',
      source_type: 'saved_outfit',
      source_ref_id: 'outfit_1',
      plan_timezone: 'Asia/Manila',
      notes: null,
      climate_context: null,
      items: [],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z',
      revision: 1,
    },
    {
      id: 'plan_2',
      user_id: 'user_1',
      planned_date: '2026-09-24',
      slot: 'workout',
      status: 'unconfirmed',
      source_type: 'style_advisor',
      source_ref_id: null,
      plan_timezone: 'Asia/Manila',
      notes: null,
      climate_context: null,
      items: [],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z',
      revision: 1,
    },
    {
      id: 'plan_3_cancelled',
      user_id: 'user_1',
      planned_date: '2026-09-24',
      slot: 'day',
      status: 'cancelled',
      source_type: 'manual',
      source_ref_id: null,
      plan_timezone: 'Asia/Manila',
      notes: null,
      climate_context: null,
      items: [],
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z',
      revision: 1,
    },
    {
      id: 'plan_4',
      user_id: 'user_1',
      planned_date: '2026-09-25',
      slot: 'all_day',
      status: 'planned',
      source_type: 'mannequin',
      source_ref_id: null,
      plan_timezone: 'Asia/Manila',
      notes: null,
      climate_context: null,
      items: [],
      created_at: '2026-09-25T00:00:00Z',
      updated_at: '2026-09-25T00:00:00Z',
      revision: 1,
    },
  ];

  it('renders exactly 7 calendar days', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <WeekStrip
          selectedDate="2026-09-24"
          todayDate="2026-09-24"
          plans={mockPlans}
          onSelectDate={jest.fn()}
        />
      );
    });

    const dayButtons = root!.root.findAll((node) => node.props && node.props.testID?.startsWith('week-day-'));
    expect(dayButtons).toHaveLength(7);
  });

  it('excludes cancelled plans and includes non-color accessible descriptions', () => {
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <WeekStrip
          selectedDate="2026-09-24"
          todayDate="2026-09-24"
          plans={mockPlans}
          onSelectDate={jest.fn()}
        />
      );
    });

    // 2026-09-24 has 1 planned, 1 unconfirmed, and 1 cancelled (excluded)
    const dayNode = root!.root.find((node) => node.props && node.props.testID === 'week-day-2026-09-24');
    expect(dayNode).toBeDefined();
    const a11yLabel = dayNode.props.accessibilityLabel;
    expect(a11yLabel).toContain('1 look scheduled');
    expect(a11yLabel).toContain('1 needs attention');
    expect(a11yLabel).toContain('Today');
    // should NOT say 2 looks scheduled or mention cancelled
    expect(a11yLabel).not.toContain('2 looks scheduled');
  });

  it('calls onSelectDate when a day is tapped', () => {
    const onSelect = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <WeekStrip
          selectedDate="2026-09-24"
          todayDate="2026-09-24"
          plans={mockPlans}
          onSelectDate={onSelect}
        />
      );
    });

    const day25 = root!.root.find((node) => node.props && node.props.testID === 'week-day-2026-09-25');
    ReactTestRenderer.act(() => {
      day25.props.onPress();
    });

    expect(onSelect).toHaveBeenCalledWith('2026-09-25');
  });

  it('shifts week backwards and forwards when chevrons are tapped', () => {
    const onShiftWeek = jest.fn();
    let root: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      root = ReactTestRenderer.create(
        <WeekStrip
          selectedDate="2026-09-24"
          todayDate="2026-09-24"
          plans={mockPlans}
          onSelectDate={jest.fn()}
          onShiftWeek={onShiftWeek}
        />
      );
    });

    const prevBtn = root!.root.find((node) => node.props && node.props.accessibilityLabel === 'Previous week');
    const nextBtn = root!.root.find((node) => node.props && node.props.accessibilityLabel === 'Next week');

    ReactTestRenderer.act(() => {
      prevBtn.props.onPress();
    });
    expect(onShiftWeek).toHaveBeenCalledWith('2026-09-17');

    ReactTestRenderer.act(() => {
      nextBtn.props.onPress();
    });
    expect(onShiftWeek).toHaveBeenCalledWith('2026-10-01');
  });
});
