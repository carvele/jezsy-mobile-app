import {
  TOTAL_PROFILE_STEPS,
  PROFILE_STEP_LABELS,
  resolveStepLabel,
  getStepState,
  canNavigateToStep,
  getStepAccessibilityLabel,
} from '../profileFields';

describe('Profile Setup Stepper Header Contract', () => {
  describe('Step Counts and Constants', () => {
    it('defines exactly 3 onboarding steps', () => {
      expect(TOTAL_PROFILE_STEPS).toBe(3);
      expect(PROFILE_STEP_LABELS).toHaveLength(3);
    });

    it('defines correct labels for Name, Info, and Address', () => {
      expect(PROFILE_STEP_LABELS[0]).toEqual({ short: 'Name', full: 'Name' });
      expect(PROFILE_STEP_LABELS[1]).toEqual({ short: 'Info', full: 'Personal Info' });
      expect(PROFILE_STEP_LABELS[2]).toEqual({ short: 'Address', full: 'Address' });
    });
  });

  describe('Responsive Label Resolution', () => {
    it('resolves short labels on narrow devices (< 400px)', () => {
      expect(resolveStepLabel(0, true)).toBe('Name');
      expect(resolveStepLabel(1, true)).toBe('Info');
      expect(resolveStepLabel(2, true)).toBe('Address');
    });

    it('resolves full labels on standard devices (>= 400px)', () => {
      expect(resolveStepLabel(0, false)).toBe('Name');
      expect(resolveStepLabel(1, false)).toBe('Personal Info');
      expect(resolveStepLabel(2, false)).toBe('Address');
    });

    it('returns empty string for out-of-bounds step indices', () => {
      expect(resolveStepLabel(-1, false)).toBe('');
      expect(resolveStepLabel(3, false)).toBe('');
    });
  });

  describe('Step State Progression', () => {
    it('correctly marks states on Step 0 (Name)', () => {
      expect(getStepState(0, 0)).toBe('active');
      expect(getStepState(1, 0)).toBe('upcoming');
      expect(getStepState(2, 0)).toBe('upcoming');
    });

    it('correctly marks states on Step 1 (Personal Info)', () => {
      expect(getStepState(0, 1)).toBe('completed');
      expect(getStepState(1, 1)).toBe('active');
      expect(getStepState(2, 1)).toBe('upcoming');
    });

    it('correctly marks states on Step 2 (Address)', () => {
      expect(getStepState(0, 2)).toBe('completed');
      expect(getStepState(1, 2)).toBe('completed');
      expect(getStepState(2, 2)).toBe('active');
    });
  });

  describe('Navigation & Validation Guard Contract', () => {
    it('disallows navigation to current or future steps to prevent bypassing validation', () => {
      // On Step 0, cannot navigate to step 0, 1, or 2
      expect(canNavigateToStep(0, 0)).toBe(false);
      expect(canNavigateToStep(1, 0)).toBe(false);
      expect(canNavigateToStep(2, 0)).toBe(false);

      // On Step 1, can navigate back to step 0, but not 1 or 2
      expect(canNavigateToStep(0, 1)).toBe(true);
      expect(canNavigateToStep(1, 1)).toBe(false);
      expect(canNavigateToStep(2, 1)).toBe(false);

      // On Step 2, can navigate back to step 0 and 1, but not 2
      expect(canNavigateToStep(0, 2)).toBe(true);
      expect(canNavigateToStep(1, 2)).toBe(true);
      expect(canNavigateToStep(2, 2)).toBe(false);
    });
  });

  describe('Accessibility Contract', () => {
    it('announces current step with step number and label', () => {
      const a11y = getStepAccessibilityLabel(1, 1, 3, 'Personal Info');
      expect(a11y).toBe('Step 2 of 3, Personal Info');
    });

    it('announces completed step with label and completed state', () => {
      const a11y = getStepAccessibilityLabel(0, 1, 3, 'Name');
      expect(a11y).toBe('Name, completed');
    });

    it('announces upcoming step with label and not completed state', () => {
      const a11y = getStepAccessibilityLabel(2, 1, 3, 'Address');
      expect(a11y).toBe('Address, not completed');
    });
  });
});
