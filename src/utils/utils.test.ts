import { passwordPolicyError, translatePasswordServerError } from './passwordPolicy';
import { isInStock } from './stock';
import { statusBucket, statusLabel, isAwaitingPayment, canReschedule } from './reservationStatus';

describe('passwordPolicy Utility', () => {
  test('validates minimum length', () => {
    expect(passwordPolicyError('Short1!')).toContain('at least 8 characters');
  });

  test('validates lowercase requirement', () => {
    expect(passwordPolicyError('UPPER123!')).toBe('Please add a lowercase letter.');
  });

  test('validates uppercase requirement', () => {
    expect(passwordPolicyError('lower123!')).toBe('Please add an uppercase letter.');
  });

  test('validates digit requirement', () => {
    expect(passwordPolicyError('NoDigits!')).toBe('Please add a number.');
  });

  test('validates symbol requirement', () => {
    expect(passwordPolicyError('NoSymbols123')).toBe('Please add a symbol, like ! or #.');
  });

  test('returns null for valid password', () => {
    expect(passwordPolicyError('ValidP@ssword123')).toBeNull();
  });

  test('translates raw Supabase server error message', () => {
    const rawError = 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz';
    expect(translatePasswordServerError(rawError)).toContain('At least 8 characters');
  });
});

describe('stock Utility', () => {
  test('returns true for null/undefined stock (legacy items)', () => {
    expect(isInStock({ stock: null })).toBe(true);
    expect(isInStock({ stock: undefined })).toBe(true);
  });

  test('returns true when stock > 0', () => {
    expect(isInStock({ stock: 5 })).toBe(true);
  });

  test('returns false when stock is 0', () => {
    expect(isInStock({ stock: 0 })).toBe(false);
  });
});

describe('reservationStatus Utility', () => {
  test('maps status strings to correct buckets', () => {
    expect(statusBucket('Pending')).toBe('pending');
    expect(statusBucket('confirmed')).toBe('toPay');
    expect(statusBucket('to pickup')).toBe('ready');
    expect(statusBucket('completed')).toBe('completed');
    expect(statusBucket('cancelled')).toBe('cancelled');
    expect(statusBucket(null)).toBe('pending');
  });

  test('returns human readable badge labels', () => {
    expect(statusLabel('Pending')).toBe('Awaiting approval');
    expect(statusLabel('confirmed')).toBe('To pay');
    expect(statusLabel('to pickup')).toBe('Ready to collect');
  });

  test('correctly evaluates payment awaiting state', () => {
    expect(isAwaitingPayment('confirmed')).toBe(true);
    expect(isAwaitingPayment('Pending')).toBe(false);
  });

  test('evaluates reschedule permission correctly', () => {
    expect(canReschedule('Pending')).toBe(true);
    expect(canReschedule('confirmed')).toBe(true);
    expect(canReschedule('completed')).toBe(false);
    expect(canReschedule('cancelled')).toBe(false);
  });
});
