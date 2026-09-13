import React from 'react';
import { useBodyAlignment } from '../useBodyAlignment';
import { LANDMARK_INDEX, type Landmark } from '../../utils/poseDetector';
import * as ReactTestRenderer from 'react-test-renderer';

// Mock evaluateBodyAlignment and others if needed
// Actually, since we're just testing the temporal logic, we can use a wrapper component.

interface TestWrapperProps {
  onCaptureReady: () => void;
  requestedPose?: 'front' | 'side';
  renderHook: (props: ReturnType<typeof useBodyAlignment>) => React.ReactNode;
}

function TestWrapper(props: TestWrapperProps) {
  const hookResult = useBodyAlignment({
    onCaptureReady: props.onCaptureReady,
    context: { isMirrored: false, sensorRotation: 0 },
    requestedPose: props.requestedPose,
  });
  return React.createElement(React.Fragment, null, props.renderHook(hookResult));
}

describe('useBodyAlignment hook', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const createValidPose = (): Landmark[] => {
    const pose = new Array(33).fill({ x: 0.5, y: 0.5, visibility: 0.95 }) as Landmark[];
    pose[LANDMARK_INDEX.nose] = { x: 0.5, y: 0.2, visibility: 0.95 };
    pose[7] = { x: 0.55, y: 0.2, visibility: 0.95 }; // leftEar
    pose[8] = { x: 0.45, y: 0.2, visibility: 0.95 }; // rightEar
    pose[LANDMARK_INDEX.leftShoulder] = { x: 0.4, y: 0.3, visibility: 0.95 };
    pose[LANDMARK_INDEX.rightShoulder] = { x: 0.6, y: 0.3, visibility: 0.95 };
    pose[LANDMARK_INDEX.leftHip] = { x: 0.45, y: 0.55, visibility: 0.95 };
    pose[LANDMARK_INDEX.rightHip] = { x: 0.55, y: 0.55, visibility: 0.95 };
    pose[LANDMARK_INDEX.leftKnee] = { x: 0.45, y: 0.75, visibility: 0.95 };
    pose[LANDMARK_INDEX.rightKnee] = { x: 0.55, y: 0.75, visibility: 0.95 };
    pose[LANDMARK_INDEX.leftAnkle] = { x: 0.43, y: 0.88, visibility: 0.95 };
    pose[LANDMARK_INDEX.rightAnkle] = { x: 0.57, y: 0.88, visibility: 0.95 };
    // Foot points for 3-point derived target (indices 29, 30, 31, 32)
    pose[29] = { x: 0.43, y: 0.88, visibility: 0.95 };
    pose[30] = { x: 0.57, y: 0.88, visibility: 0.95 };
    pose[31] = { x: 0.43, y: 0.88, visibility: 0.95 };
    pose[32] = { x: 0.57, y: 0.88, visibility: 0.95 };
    return pose;
  };

  const createInvalidPose = (): Landmark[] => {
    const pose = createValidPose();
    pose[LANDMARK_INDEX.leftShoulder] = { x: 0.1, y: 0.1, visibility: 0.95 }; // off center
    return pose;
  };

  const createMovingValidPose = (frameIdx: number): Landmark[] => {
    const pose = createValidPose();
    // Add motion larger than RMS_MOTION_THRESHOLD (which is 0.015)
    pose[LANDMARK_INDEX.leftShoulder] = { x: 0.4 + frameIdx * 0.05, y: 0.3, visibility: 0.95 };
    return pose;
  };

  it('progresses from SEARCHING to POSITIONING to STABILIZING to LOCKED with 350ms confirmation', () => {
    const onCaptureReady = jest.fn();
    let hookResult: ReturnType<typeof useBodyAlignment> | null = null;
    
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onCaptureReady,
          renderHook: (res: ReturnType<typeof useBodyAlignment>) => {
            hookResult = res;
            return null;
          }
        })
      );
    });

    expect(hookResult!.result.state).toBe('SEARCHING');

    // Invalid pose -> POSITIONING
    ReactTestRenderer.act(() => {
      hookResult!.processFrame(createInvalidPose(), true);
    });
    
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(hookResult!.result.state).toBe('POSITIONING');

    // Valid pose -> STABILIZING
    ReactTestRenderer.act(() => {
      for (let i = 0; i < 5; i++) {
        hookResult!.processFrame(createValidPose(), true);
      }
    });

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(hookResult!.result.state).toBe('STABILIZING');

    // Hold still for 1000ms dwell -> reaches LOCKED
    ReactTestRenderer.act(() => {
      hookResult!.processFrame(createValidPose(), true); 
      jest.advanceTimersByTime(1050); 
      hookResult!.processFrame(createValidPose(), true); 
    });

    expect(hookResult!.result.state).toBe('LOCKED');
    // Important: capture callback should NOT be called immediately upon reaching LOCKED
    expect(onCaptureReady).not.toHaveBeenCalled();

    // 350ms confirmation window elapses -> capture triggers
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(360);
    });

    expect(onCaptureReady).toHaveBeenCalledTimes(1);
  });

  it('resets stabilizing timer if motion exceeds threshold during STABILIZING', () => {
    const onCaptureReady = jest.fn();
    let hookResult: ReturnType<typeof useBodyAlignment> | null = null;
    
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onCaptureReady,
          renderHook: (res: ReturnType<typeof useBodyAlignment>) => {
            hookResult = res;
            return null;
          }
        })
      );
    });

    ReactTestRenderer.act(() => {
      for (let i = 0; i < 5; i++) {
        hookResult!.processFrame(createValidPose(), true);
      }
      jest.advanceTimersByTime(250);
    });

    expect(hookResult!.result.state).toBe('STABILIZING');

    // Simulate motion during dwell window (at t=500ms into the 1000ms dwell)
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(500);
      hookResult!.processFrame(createMovingValidPose(1), true);
      hookResult!.processFrame(createMovingValidPose(2), true);
    });

    // Advance by another 600ms (total elapsed > 1000ms from start, but reset occurred)
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(600);
      hookResult!.processFrame(createValidPose(), true);
      jest.advanceTimersByTime(250);
    });

    // Should still be STABILIZING, not LOCKED
    expect(hookResult!.result.state).toBe('STABILIZING');
    expect(onCaptureReady).not.toHaveBeenCalled();
  });

  it('resets cleanly when switching requestedPose from front to side', () => {
    const onCaptureReady = jest.fn();
    let hookResult: ReturnType<typeof useBodyAlignment> | null = null;
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onCaptureReady,
          requestedPose: 'front',
          renderHook: (res: ReturnType<typeof useBodyAlignment>) => {
            hookResult = res;
            return null;
          },
        })
      );
    });

    // Advance to STABILIZING with valid front pose
    ReactTestRenderer.act(() => {
      for (let i = 0; i < 5; i++) {
        hookResult!.processFrame(createValidPose(), true);
      }
      jest.advanceTimersByTime(250);
    });

    expect(hookResult!.result.state).toBe('STABILIZING');

    // Switch requestedPose to 'side'
    ReactTestRenderer.act(() => {
      renderer.update(
        React.createElement(TestWrapper, {
          onCaptureReady,
          requestedPose: 'side',
          renderHook: (res: ReturnType<typeof useBodyAlignment>) => {
            hookResult = res;
            return null;
          },
        })
      );
    });

    // State should reset to SEARCHING, instruction to "Turn sideways", violations to ['NO_PERSON']
    expect(hookResult!.result.state).toBe('SEARCHING');
    expect(hookResult!.result.instruction).toBe('Turn sideways');
    expect(hookResult!.result.violations).toEqual(['NO_PERSON']);
  });
});
