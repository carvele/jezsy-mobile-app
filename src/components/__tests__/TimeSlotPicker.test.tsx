import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { TimeSlotPicker } from '../TimeSlotPicker';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('TimeSlotPicker (HCI-001)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders explicit error state and recovers upon retry', async () => {
    // 1. Mock failure on store_hours
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockRejectedValue(new Error('Network failure')),
        }),
      }),
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(
        <TimeSlotPicker
          selectedDate={new Date(Date.now() + 86400000 * 2)}
          selectedSlot={undefined}
          onSelectSlot={jest.fn()}
        />
      );
    });

    const instance = root!.root;
    const errorContainer = instance.findByProps({ testID: 'timeslot-error-container' });
    expect(errorContainer).toBeDefined();

    const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    expect(texts).toContain('Could not load schedule');

    const retryBtn = instance.findByProps({ testID: 'timeslot-retry-button' });
    expect(retryBtn).toBeDefined();

    // 2. Mock success for retry
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'store_hours') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: {
                  is_closed: false,
                  open_time: '09:00:00',
                  close_time: '18:00:00',
                  slot_capacity: 5,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'store_closures') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: jest.fn() };
    });

    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [],
      error: null,
    });

    await ReactTestRenderer.act(async () => {
      retryBtn.props.onPress();
    });

    // Now it should have succeeded and rendered the time slot trigger
    const trigger = instance.findAllByType('TouchableOpacity' as any).find(
      (node) => node.props.accessibilityRole === 'button' && node.props.testID !== 'timeslot-retry-button'
    );
    expect(trigger).toBeDefined();
  });
});
