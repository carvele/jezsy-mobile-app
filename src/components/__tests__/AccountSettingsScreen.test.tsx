import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import AccountSettingsScreen from '@/app/profile/account-settings';
import { supabase } from '@/src/lib/supabase';
import { PASSWORD_SAVED_MESSAGE, MANUAL_LINKING_POLICY_MESSAGE } from '@/src/utils/connectedAccounts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockShowToast = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockRouterBack,
    push: mockRouterPush,
    replace: jest.fn(),
  }),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: () => null,
}));

jest.mock('react-native-svg', () => {
  const MockSvg = (props: any) => React.createElement('Svg', props, props.children);
  return {
    __esModule: true,
    default: MockSvg,
    Path: (props: any) => React.createElement('Path', props),
    G: (props: any) => React.createElement('G', props, props.children),
    ClipPath: (props: any) => React.createElement('ClipPath', props, props.children),
    Defs: (props: any) => React.createElement('Defs', props, props.children),
    Rect: (props: any) => React.createElement('Rect', props),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => React.createElement('View', null, children),
}));

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'test-user-uuid',
      email: 'user@jezsy.test',
    },
  }),
}));

jest.mock('@/src/context/ToastContext', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

jest.mock('@/src/utils/accountDeletion', () => ({
  getPendingDeletionRequest: jest.fn().mockResolvedValue(null),
  getUserUnsettledBalance: jest.fn().mockResolvedValue({ hasUnsettledBalance: false, totalBalance: 0, unsettledCount: 0 }),
  submitDeletionRequest: jest.fn().mockResolvedValue('deletion-id-1'),
  withdrawDeletionRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUserIdentities: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

describe('AccountSettingsScreen — Connected Accounts & Password Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Google-only account: Google shows Connected, Email shows Not Connected, and policy notice is visible', async () => {
    (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValueOnce({
      data: {
        identities: [
          {
            id: 'google-sub-123',
            identity_id: 'google-id-1',
            provider: 'google',
            identity_data: { email: 'user@gmail.com' },
          },
        ],
      },
      error: null,
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountSettingsScreen));
    });

    const instance = root!.root;
    const allTexts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    const joined = allTexts.flat().join(' ');

    expect(joined).toContain('Connected Accounts');
    expect(joined).toContain('Google');
    expect(joined).toContain('user@gmail.com');
    expect(joined).toContain('Email');
    expect(joined).toContain('✓ Connected');
    expect(joined).toContain('Not Connected');
    expect(joined).toContain(MANUAL_LINKING_POLICY_MESSAGE);

    // Verify connect / disconnect buttons are NOT exposed
    expect(joined).not.toContain('Connect Google');
    expect(joined).not.toContain('Disconnect Google');
  });

  it('renders dual-identity account: both Google and Email show Connected without exposing manual disconnect', async () => {
    (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValueOnce({
      data: {
        identities: [
          {
            id: 'google-sub-123',
            identity_id: 'google-id-1',
            provider: 'google',
            identity_data: { email: 'user@gmail.com' },
          },
          {
            id: 'email-id-2',
            identity_id: 'email-id-2',
            provider: 'email',
            identity_data: { email: 'user@jezsy.test' },
          },
        ],
      },
      error: null,
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountSettingsScreen));
    });

    const instance = root!.root;
    const allTexts = instance.findAllByType('Text' as any).map((t) => t.props.children);
    const joined = allTexts.flat().join(' ');

    expect(joined).toContain('Google');
    expect(joined).toContain('user@gmail.com');
    expect(joined).toContain('Email');
    expect(joined).toContain('user@jezsy.test');

    // Both should be marked Connected
    const connectedMatches = allTexts.filter((t) => String(t).includes('✓ Connected'));
    expect(connectedMatches.length).toBe(2);

    // Invariant: manual disconnect is not exposed while policy is disabled
    expect(joined).not.toContain('Disconnect Google');
    expect(joined).not.toContain('Disconnect Email');
  });

  it('handles password update success: shows neutral success toast and preserves identities without fabricating email identity', async () => {
    const initialIdentities = [
      {
        id: 'google-sub-123',
        identity_id: 'google-id-1',
        provider: 'google',
        identity_data: { email: 'user@gmail.com' },
      },
    ];

    (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValue({
      data: { identities: initialIdentities },
      error: null,
    });

    (supabase.auth.updateUser as jest.Mock).mockResolvedValueOnce({
      data: { user: { id: 'test-user-uuid' } },
      error: null,
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountSettingsScreen));
    });

    const instance = root!.root;
    const inputs = instance.findAllByType('TextInput' as any);
    const newPasswordInput = inputs.find((i) => i.props.accessibilityLabel === 'New password');
    const confirmPasswordInput = inputs.find((i) => i.props.accessibilityLabel === 'Confirm new password');

    // Enter valid matching password
    await ReactTestRenderer.act(async () => {
      newPasswordInput?.props.onChangeText('SecurePass123!@#');
      confirmPasswordInput?.props.onChangeText('SecurePass123!@#');
    });

    const saveButton = instance.findAllByType('TouchableOpacity' as any).find(
      (b) => b.props.accessibilityLabel === 'Save password'
    );

    await ReactTestRenderer.act(async () => {
      await saveButton?.props.onPress();
    });

    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'SecurePass123!@#' });
    expect(mockShowToast).toHaveBeenCalledWith(PASSWORD_SAVED_MESSAGE, 'success');

    // Invariant: After password update, email identity is NOT fabricated
    const allTexts = instance.findAllByType('Text' as any).map((t) => t.props.children).flat().join(' ');
    // Google remains Connected, Email remains Not Connected
    expect(allTexts).toContain('Not Connected');
  });

  it('handles password update failure: maps error safely and leaves form recoverable', async () => {
    (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValueOnce({
      data: {
        identities: [
          {
            id: 'google-sub-123',
            identity_id: 'google-id-1',
            provider: 'google',
            identity_data: { email: 'user@gmail.com' },
          },
        ],
      },
      error: null,
    });

    (supabase.auth.updateUser as jest.Mock).mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Network request failed' },
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountSettingsScreen));
    });

    const instance = root!.root;
    const inputs = instance.findAllByType('TextInput' as any);
    const newPasswordInput = inputs.find((i) => i.props.accessibilityLabel === 'New password');
    const confirmPasswordInput = inputs.find((i) => i.props.accessibilityLabel === 'Confirm new password');

    await ReactTestRenderer.act(async () => {
      newPasswordInput?.props.onChangeText('ValidPass123!');
      confirmPasswordInput?.props.onChangeText('ValidPass123!');
    });

    const saveButton = instance.findAllByType('TouchableOpacity' as any).find(
      (b) => b.props.accessibilityLabel === 'Save password'
    );

    await ReactTestRenderer.act(async () => {
      await saveButton?.props.onPress();
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'Network connection issue. Please check your internet connection and try again.',
      'error'
    );
  });

  it('reconstructs identity state on mount (app restart behavior)', async () => {
    (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValueOnce({
      data: {
        identities: [
          {
            id: 'email-id-99',
            identity_id: 'email-id-99',
            provider: 'email',
            identity_data: { email: 'emailfirst@jezsy.internal' },
          },
        ],
      },
      error: null,
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(AccountSettingsScreen));
    });

    const instance = root!.root;
    const allTexts = instance.findAllByType('Text' as any).map((t) => t.props.children).flat().join(' ');

    expect(supabase.auth.getUserIdentities).toHaveBeenCalledTimes(1);
    expect(allTexts).toContain('emailfirst@jezsy.internal');
  });
});
