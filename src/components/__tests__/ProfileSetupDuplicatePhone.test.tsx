import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';
import ProfileSetupScreen from '@/app/(auth)/profile-setup';
import { supabase } from '@/src/lib/supabase';
import { DUPLICATE_PHONE_MESSAGE } from '@/src/utils/authErrorMapping';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockShowToast = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRefreshProfile = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
    back: mockRouterBack,
    push: jest.fn(),
  }),
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/src/hooks/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

jest.mock('@/src/context/ToastContext', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

const mockUser = {
  id: 'user-b65cb88b',
  email: 'weecarlvener@gmail.com',
  user_metadata: {},
};

let mockProfileState: any = null;

jest.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    profile: mockProfileState,
    refreshProfile: mockRefreshProfile,
  }),
}));

jest.mock('@/src/utils/authReturnTarget', () => ({
  consumeAuthReturnTarget: jest.fn().mockResolvedValue(null),
  consumePendingEntryTarget: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/src/components/CountryPickerModal', () => ({
  CountryPickerModal: () => null,
}));

jest.mock('@/src/components/DobPickerModal', () => ({
  DobPickerModal: () => null,
}));

jest.mock('@/src/lib/supabase', () => {
  return {
    supabase: {
      from: jest.fn(),
    },
  };
});

describe('ProfileSetupScreen — Duplicate Phone Recoverable State', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfileState = null;
  });

  it('handles duplicate phone conflict (23505): returns to Personal Info, sets inline error, preserves all entered data, and never exposes raw Postgres error', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "idx_profiles_phone_unique"',
            details: 'Key (phone)=(+639123659917) already exists.',
          },
        }),
      }),
    });

    (supabase.from as jest.Mock).mockReturnValue({
      update: updateMock,
    });

    let root: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      root = ReactTestRenderer.create(React.createElement(ProfileSetupScreen));
    });

    const instance = root!.root;

    // ─── Step 0: Name ───
    const firstInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.placeholder === 'e.g. Maria'
    );
    const lastInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.placeholder === 'e.g. Santos'
    );

    await ReactTestRenderer.act(async () => {
      firstInput?.props.onChangeText('Carl Vener');
      lastInput?.props.onChangeText('Wee');
    });

    // Helper to find the footer PrimaryButton by label
    const getContinueButton = () =>
      instance.findAllByType('TouchableOpacity' as any).find(
        (b) => b.props.accessibilityLabel === 'Continue'
      );
    const getFinishButton = () =>
      instance.findAllByType('TouchableOpacity' as any).find(
        (b) => b.props.accessibilityLabel === 'Finish Setup'
      );

    await ReactTestRenderer.act(async () => {
      getContinueButton()?.props.onPress();
    });

    // ─── Step 1: Personal Info ───
    const phoneInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'Mobile phone number'
    );
    const dobInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'Date of birth'
    );
    const genderChip = instance.findAllByType('TouchableOpacity' as any).find(
      (b) => b.props.accessibilityLabel === 'Male'
    );

    await ReactTestRenderer.act(async () => {
      phoneInput?.props.onChangeText('9123659917');
      dobInput?.props.onChangeText('01011995');
      genderChip?.props.onPress();
    });

    // Advance to Step 2
    await ReactTestRenderer.act(async () => {
      getContinueButton()?.props.onPress();
    });

    // ─── Step 2: Address ───
    const addressInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'Street address'
    );
    const barangayInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'Barangay'
    );
    const cityInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'City or Municipality'
    );
    const provinceInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'Province'
    );
    const zipInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'Zip code'
    );

    await ReactTestRenderer.act(async () => {
      addressInput?.props.onChangeText('123 Main St');
      barangayInput?.props.onChangeText('San Jose');
      cityInput?.props.onChangeText('Balanga');
      provinceInput?.props.onChangeText('Bataan');
      zipInput?.props.onChangeText('2100');
    });

    // Submit profile
    await ReactTestRenderer.act(async () => {
      await getFinishButton()?.props.onPress();
    });

    // 1. Toast displays user-friendly message, not raw DB constraint
    expect(mockShowToast).toHaveBeenCalledWith(DUPLICATE_PHONE_MESSAGE, 'error');
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.stringContaining('23505'), 'error');
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.stringContaining('idx_profiles_phone_unique'), 'error');

    // 2. Verified user is NOT logged out and route is NOT replaced to auth or welcome
    expect(mockRouterReplace).not.toHaveBeenCalledWith(expect.stringContaining('(auth)'));
    expect(mockRouterReplace).not.toHaveBeenCalledWith(expect.stringContaining('welcome'));

    // 3. User is returned to Step 1 (Personal Info) and inline phone error is visible
    const allTexts = instance.findAllByType('Text' as any).map((t) => t.props.children).flat().join(' ');
    expect(allTexts).toContain('Mobile number');
    expect(allTexts).toContain(DUPLICATE_PHONE_MESSAGE);

    // 4. All previously entered data remains intact
    const currentPhoneInput = instance.findAllByType('TextInput' as any).find(
      (i) => i.props.accessibilityLabel === 'Mobile phone number'
    );
    expect(currentPhoneInput?.props.value).toContain('912 365 9917');

    // 5. Correcting phone clears the error and allows resubmitting
    const updateSuccessMock = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          data: [{ id: 'user-b65cb88b' }],
          error: null,
        }),
      }),
    });
    (supabase.from as jest.Mock).mockReturnValue({
      update: updateSuccessMock,
    });

    await ReactTestRenderer.act(async () => {
      currentPhoneInput?.props.onChangeText('9991234567');
    });

    // Error text is cleared as soon as user types
    const textsAfterEdit = instance.findAllByType('Text' as any).map((t) => t.props.children).flat().join(' ');
    expect(textsAfterEdit).not.toContain(DUPLICATE_PHONE_MESSAGE);

    // Advance to Step 2 and submit again
    await ReactTestRenderer.act(async () => {
      getContinueButton()?.props.onPress();
    });

    await ReactTestRenderer.act(async () => {
      await getFinishButton()?.props.onPress();
    });

    expect(updateSuccessMock).toHaveBeenCalled();
    expect(mockRefreshProfile).toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)');
  });
});
