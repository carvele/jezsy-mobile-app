import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import AccountCreatedScreen from '@/app/(auth)/account-created';
import { isProfileSetupComplete } from '@/src/utils/profileCompletion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockRouterReplace = jest.fn();
let mockProfile: any = null;
const mockRefreshProfile = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
}));

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    profile: mockProfile,
    refreshProfile: mockRefreshProfile,
  }),
}));

const mockConsumeAuthReturnTarget = jest.fn().mockResolvedValue(null);
const mockConsumePendingEntryTarget = jest.fn().mockResolvedValue(null);

jest.mock('@/src/utils/authReturnTarget', () => ({
  consumeAuthReturnTarget: () => mockConsumeAuthReturnTarget(),
  consumePendingEntryTarget: () => mockConsumePendingEntryTarget(),
}));

describe('AccountCreatedScreen — Profile Completion Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfile = null;
  });

  it('renders "Complete Profile" when profile has names only (Google OAuth) and routes to profile-setup', async () => {
    mockProfile = {
      id: 'google-user',
      first_name: 'Carl',
      last_name: 'Vener',
      phone: null,
      gender: null,
      date_of_birth: null,
    };

    expect(isProfileSetupComplete(mockProfile)).toBe(false);

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountCreatedScreen));
    });

    const instance = root!.root;
    const button = instance.findAllByType('TouchableOpacity' as any).find(
      (b) => b.props.accessibilityLabel === 'Complete Profile'
    );
    expect(button).toBeDefined();

    // Clicking "Complete Profile" routes to profile-setup
    await ReactTestRenderer.act(async () => {
      await button?.props.onPress();
    });

    expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/profile-setup');
    expect(mockRouterReplace).not.toHaveBeenCalledWith('/(tabs)');
  });

  it('renders "Start Exploring" when mandatory profile is complete and respects return targets', async () => {
    mockProfile = {
      id: 'complete-user',
      first_name: 'Carl',
      last_name: 'Vener',
      phone: '+639123456789',
      gender: 'Male',
      date_of_birth: '1995-01-01',
    };

    expect(isProfileSetupComplete(mockProfile)).toBe(true);

    mockConsumeAuthReturnTarget.mockResolvedValueOnce({
      pathname: '/product/[id]',
      params: { id: 'prod-123' },
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountCreatedScreen));
    });

    const instance = root!.root;
    const button = instance.findAllByType('TouchableOpacity' as any).find(
      (b) => b.props.accessibilityLabel === 'Start Exploring'
    );
    expect(button).toBeDefined();

    await ReactTestRenderer.act(async () => {
      await button?.props.onPress();
    });

    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/product/[id]',
      params: { id: 'prod-123' },
    });
  });

  it('navigates to tabs when mandatory profile is complete and no return target exists', async () => {
    mockProfile = {
      id: 'complete-user',
      first_name: 'Carl',
      last_name: 'Vener',
      phone: '+639123456789',
      gender: 'Male',
      date_of_birth: '1995-01-01',
    };

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountCreatedScreen));
    });

    const instance = root!.root;
    const button = instance.findAllByType('TouchableOpacity' as any).find(
      (b) => b.props.accessibilityLabel === 'Start Exploring'
    );

    await ReactTestRenderer.act(async () => {
      await button?.props.onPress();
    });

    expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)');
  });
});
