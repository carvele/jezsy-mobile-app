import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import { useHardwarePermission } from '../useHardwarePermission';
import { Linking } from 'react-native';

// Mock nativeVision
const mockUseCameraPermission = jest.fn();
let mockNativeVisionAvailable = true;

jest.mock('@/src/utils/nativeVision', () => ({
  get NATIVE_VISION_AVAILABLE() {
    return mockNativeVisionAvailable;
  },
  useCameraPermission: () => mockUseCameraPermission(),
}));

interface TestWrapperProps {
  hasDevice?: boolean;
  onResult: (result: ReturnType<typeof useHardwarePermission>) => void;
}

function TestWrapper(props: TestWrapperProps) {
  const result = useHardwarePermission({ hasDevice: props.hasDevice });
  React.useEffect(() => {
    props.onResult(result);
  }, [result, props]);
  return null;
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('useHardwarePermission hook (UX-FOUND-005)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeVisionAvailable = true;
    mockUseCameraPermission.mockReturnValue({
      hasPermission: false,
      requestPermission: jest.fn().mockResolvedValue(false),
    });
  });

  it('initializes to not_determined when camera permission is not yet granted', () => {
    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    expect(currentResult.status).toBe('not_determined');
  });

  it('initializes to granted when permission is already granted', () => {
    mockUseCameraPermission.mockReturnValue({
      hasPermission: true,
      requestPermission: jest.fn().mockResolvedValue(true),
    });

    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    expect(currentResult.status).toBe('granted');
  });

  it('resolves to hardware_unavailable when hasDevice is false', () => {
    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          hasDevice: false,
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    expect(currentResult.status).toBe('hardware_unavailable');
  });

  it('transitions to granted when requestPermission succeeds', async () => {
    const requestPermissionMock = jest.fn().mockResolvedValue(true);
    mockUseCameraPermission.mockReturnValue({
      hasPermission: false,
      requestPermission: requestPermissionMock,
    });

    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    let granted = false;
    await ReactTestRenderer.act(async () => {
      granted = await currentResult.requestPermission();
    });

    expect(granted).toBe(true);
    expect(currentResult.status).toBe('granted');
  });

  it('transitions to denied_can_ask_again on first denial', async () => {
    const requestPermissionMock = jest.fn().mockResolvedValue(false);
    mockUseCameraPermission.mockReturnValue({
      hasPermission: false,
      requestPermission: requestPermissionMock,
    });

    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    await ReactTestRenderer.act(async () => {
      await currentResult.requestPermission();
    });

    expect(currentResult.status).toBe('denied_can_ask_again');
  });

  it('transitions to permanently_denied on subsequent denial', async () => {
    const requestPermissionMock = jest.fn().mockResolvedValue(false);
    mockUseCameraPermission.mockReturnValue({
      hasPermission: false,
      requestPermission: requestPermissionMock,
    });

    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    await ReactTestRenderer.act(async () => {
      await currentResult.requestPermission();
    });
    expect(currentResult.status).toBe('denied_can_ask_again');

    await ReactTestRenderer.act(async () => {
      await currentResult.requestPermission();
    });
    expect(currentResult.status).toBe('permanently_denied');
  });

  it('transitions to runtime_error when native request throws', async () => {
    const requestPermissionMock = jest.fn().mockRejectedValue(new Error('Driver failure'));
    mockUseCameraPermission.mockReturnValue({
      hasPermission: false,
      requestPermission: requestPermissionMock,
    });

    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    await ReactTestRenderer.act(async () => {
      await currentResult.requestPermission();
    });

    expect(currentResult.status).toBe('runtime_error');
    expect(currentResult.error?.message).toBe('Driver failure');
  });

  it('calls Linking.openSettings when openSettings is invoked', async () => {
    let currentResult: any;
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        React.createElement(TestWrapper, {
          onResult: (res: any) => {
            currentResult = res;
          },
        })
      );
    });

    await ReactTestRenderer.act(async () => {
      await currentResult.openSettings();
    });

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });
});
