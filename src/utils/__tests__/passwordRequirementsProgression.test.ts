import {
  evaluatePasswordRequirements,
  areAllPasswordRequirementsMet,
} from '../passwordPolicy';

/**
 * Helper simulating the display state resolution used in AuthScreen.
 */
function resolvePasswordRequirementDisplayState(password: string) {
  if (password.length === 0) {
    return {
      isVisible: false,
      mode: 'hidden' as const,
      pills: [],
      successMessage: null,
    };
  }

  const allMet = areAllPasswordRequirementsMet(password);
  if (allMet) {
    return {
      isVisible: true,
      mode: 'collapsed_success' as const,
      pills: [],
      successMessage: 'Password meets all requirements',
    };
  }

  const pills = evaluatePasswordRequirements(password);
  return {
    isVisible: true,
    mode: 'pills' as const,
    pills,
    successMessage: null,
  };
}

/**
 * Helper simulating confirm-password match indicator logic.
 */
function resolveConfirmPasswordMatch(password: string, confirmPassword: string) {
  if (confirmPassword.length === 0) {
    return { isVisible: false, match: false, message: null };
  }
  const match = password === confirmPassword;
  return {
    isVisible: true,
    match,
    message: match ? 'Passwords match' : 'Passwords do not match yet',
  };
}

describe('Password Requirements Progressive Compression Contract', () => {
  test('empty password → requirements hidden', () => {
    const state = resolvePasswordRequirementDisplayState('');
    expect(state.isVisible).toBe(false);
    expect(state.mode).toBe('hidden');
    expect(state.pills).toHaveLength(0);
    expect(state.successMessage).toBeNull();
  });

  test('partially valid password → compact pills visible', () => {
    const state = resolvePasswordRequirementDisplayState('abc');
    expect(state.isVisible).toBe(true);
    expect(state.mode).toBe('pills');
    expect(state.pills).toHaveLength(5);
    expect(state.successMessage).toBeNull();

    // Check pill short labels
    expect(state.pills.map(p => p.shortLabel)).toEqual([
      '8+ chars',
      'A-Z',
      'a-z',
      '0-9',
      'Symbol',
    ]);
  });

  test('individual rule satisfied → corresponding pill updates', () => {
    // 1 char lowercase: only lowercase met
    let state = resolvePasswordRequirementDisplayState('a');
    expect(state.pills.find(p => p.id === 'lowercase')?.met).toBe(true);
    expect(state.pills.find(p => p.id === 'uppercase')?.met).toBe(false);
    expect(state.pills.find(p => p.id === 'number')?.met).toBe(false);
    expect(state.pills.find(p => p.id === 'symbol')?.met).toBe(false);
    expect(state.pills.find(p => p.id === 'length')?.met).toBe(false);

    // Add uppercase: 'aB'
    state = resolvePasswordRequirementDisplayState('aB');
    expect(state.pills.find(p => p.id === 'lowercase')?.met).toBe(true);
    expect(state.pills.find(p => p.id === 'uppercase')?.met).toBe(true);
    expect(state.pills.find(p => p.id === 'number')?.met).toBe(false);

    // Add number: 'aB1'
    state = resolvePasswordRequirementDisplayState('aB1');
    expect(state.pills.find(p => p.id === 'number')?.met).toBe(true);

    // Add symbol: 'aB1!'
    state = resolvePasswordRequirementDisplayState('aB1!');
    expect(state.pills.find(p => p.id === 'symbol')?.met).toBe(true);
    expect(state.pills.find(p => p.id === 'length')?.met).toBe(false);
  });

  test('all rules satisfied → pills disappear and "Password meets all requirements" appears', () => {
    const state = resolvePasswordRequirementDisplayState('ValidPass123!');
    expect(state.isVisible).toBe(true);
    expect(state.mode).toBe('collapsed_success');
    expect(state.pills).toHaveLength(0);
    expect(state.successMessage).toBe('Password meets all requirements');
  });

  test('password becomes invalid again → pills return', () => {
    // Start with valid password
    let state = resolvePasswordRequirementDisplayState('ValidPass123!');
    expect(state.mode).toBe('collapsed_success');
    expect(state.successMessage).toBe('Password meets all requirements');

    // Backspace to remove the special symbol
    state = resolvePasswordRequirementDisplayState('ValidPass123');
    expect(state.mode).toBe('pills');
    expect(state.pills).toHaveLength(5);
    expect(state.successMessage).toBeNull();
    expect(state.pills.find(p => p.id === 'symbol')?.met).toBe(false);

    // Backspace down to empty -> hidden
    state = resolvePasswordRequirementDisplayState('');
    expect(state.isVisible).toBe(false);
    expect(state.mode).toBe('hidden');
  });

  test('confirm password match indicator → remains independent and unchanged', () => {
    const pwd = 'ValidPass123!';

    // Confirm password empty
    let matchState = resolveConfirmPasswordMatch(pwd, '');
    expect(matchState.isVisible).toBe(false);

    // Confirm password mismatch while requirements are valid
    matchState = resolveConfirmPasswordMatch(pwd, 'Different123!');
    expect(matchState.isVisible).toBe(true);
    expect(matchState.match).toBe(false);
    expect(matchState.message).toBe('Passwords do not match yet');

    // Confirm password match while requirements are valid
    matchState = resolveConfirmPasswordMatch(pwd, 'ValidPass123!');
    expect(matchState.isVisible).toBe(true);
    expect(matchState.match).toBe(true);
    expect(matchState.message).toBe('Passwords match');

    // Confirm password matches even if main password is non-compliant (e.g. both are 'abc')
    matchState = resolveConfirmPasswordMatch('abc', 'abc');
    expect(matchState.isVisible).toBe(true);
    expect(matchState.match).toBe(true);
    expect(matchState.message).toBe('Passwords match');
  });
});
