import React from 'react';
import { useARTrackingSession } from '../useARTrackingSession';
import type { LengthFitSignal } from '../../utils/sizeRecommender';

const { act, create } = jest.requireActual('react-test-renderer');
const length: LengthFitSignal = { verdict: 'appropriate', deltaCm: 0, chartLengthCm: 65, trackedTorsoLengthCm: 45 };

describe('AR tracking lifecycle integration', () => {
  let latest: ReturnType<typeof useARTrackingSession>;
  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };
  let consoleError: jest.SpyInstance;

  function Harness({ enabled = true, sessionKey = 'shirt:M' }) {
    latest = useARTrackingSession(enabled, sessionKey);
    return null;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    consoleError = jest.spyOn(console, 'error').mockImplementation((message) => {
      if (!String(message).includes('react-test-renderer is deprecated')) throw new Error(String(message));
    });
    act(() => { renderer = create(React.createElement(Harness)); });
  });

  afterEach(() => {
    act(() => renderer.unmount());
    expect(jest.getTimerCount()).toBe(0);
    consoleError.mockRestore();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    jest.useRealTimers();
  });

  it('publishes silent-stream expiry and recovers on a new frame', () => {
    act(() => latest.report('GOOD_FIT', length));
    expect(latest.status).toBe('tracking');
    act(() => jest.advanceTimersByTime(800));
    expect(latest.status).toBe('lost');
    expect(latest.lengthFit).toBeNull();
    act(() => latest.report('GOOD_FIT', length));
    expect(latest.lengthFit).toEqual(length);
  });

  it('immediately clears a lost confidence signal without waiting for UI throttling', () => {
    act(() => latest.report('GOOD_FIT', length));
    act(() => latest.report('GOOD_FIT', null));
    expect(latest.lengthFit).toBeNull();
    expect(latest.status).toBe('tracking');
  });

  it('discards the old product or size session and rejects its late callbacks', () => {
    act(() => latest.report('GOOD_FIT', length));
    const oldReport = latest.report;
    const oldIsActive = latest.isActive;
    act(() => renderer.update(React.createElement(Harness, { sessionKey: 'jacket:L' })));
    expect(latest.status).toBe('searching');
    expect(latest.lengthFit).toBeNull();
    expect(oldIsActive()).toBe(false);
    expect(latest.isActive()).toBe(true);
    act(() => { expect(oldReport('GOOD_FIT', length)).toBe(false); });
    expect(latest.status).toBe('searching');
  });

  it('pauses on background, consent, or mode changes and resumes without a stale estimate', () => {
    act(() => latest.report('GOOD_FIT', length));
    const oldReport = latest.report;
    act(() => renderer.update(React.createElement(Harness, { enabled: false })));
    expect(latest.status).toBe('paused');
    expect(latest.lengthFit).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    act(() => { expect(oldReport('GOOD_FIT', length)).toBe(false); });
    act(() => renderer.update(React.createElement(Harness, { enabled: true })));
    expect(latest.status).toBe('searching');
    act(() => latest.report('GOOD_FIT', length));
    expect(latest.status).toBe('tracking');
  });
});
