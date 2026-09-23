import { passwordPolicyError, translatePasswordServerError } from './passwordPolicy';
import { isInStock } from './stock';
import {
  statusBucket,
  statusLabel,
  isAwaitingPayment,
  canReschedule,
  isTerminalStatus,
  getReservationPaymentPresentation,
} from './reservationStatus';

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
    // 'Pending' is a retired status no writer can produce anymore -- an
    // unrecognized value now falls into 'toPay' rather than a dead tab.
    expect(statusBucket('Pending')).toBe('toPay');
    expect(statusBucket('confirmed')).toBe('toPay');
    expect(statusBucket('to pickup')).toBe('ready');
    expect(statusBucket('completed')).toBe('completed');
    expect(statusBucket('cancelled')).toBe('cancelled');
    expect(statusBucket(null)).toBe('toPay');
  });

  test('returns human readable badge labels', () => {
    expect(statusLabel('Pending')).toBe('To pay');
    expect(statusLabel('confirmed')).toBe('To pay');
    expect(statusLabel('to pickup')).toBe('Ready for pickup');
  });

  test('correctly evaluates payment awaiting state', () => {
    expect(isAwaitingPayment('confirmed')).toBe(true);
    expect(isAwaitingPayment('Pending')).toBe(true);
  });

  test('evaluates reschedule permission correctly', () => {
    expect(canReschedule('Pending')).toBe(true);
    expect(canReschedule('confirmed')).toBe(true);
    expect(canReschedule('Preparing')).toBe(true);
    expect(canReschedule('Ready')).toBe(false);
    expect(canReschedule('To Pickup')).toBe(false);
    expect(canReschedule('completed')).toBe(false);
    expect(canReschedule('cancelled')).toBe(false);
  });

  test('terminal statuses never carry live requests', () => {
    expect(isTerminalStatus('Completed')).toBe(true);
    expect(isTerminalStatus('Cancelled')).toBe(true);
    expect(isTerminalStatus('Unclaimed')).toBe(true);
    expect(isTerminalStatus('Ready')).toBe(false);
  });

  test('Ready + deposit only shows balance due, not paid in full', () => {
    const p = getReservationPaymentPresentation({ status: 'Ready', payment_status: 'Paid', rental_price: 1999, deposit: 999.5 });
    expect(p.key).toBe('balanceDue');
    expect(p.label).toBe('Balance due ₱999.50');
    expect(p.readyToCollect).toBe(false);
  });

  test('Ready + balance receipt submitted shows review state', () => {
    const p = getReservationPaymentPresentation({
      status: 'Ready', payment_status: 'Paid', rental_price: 200, deposit: 100, balance_payment_status: 'submitted',
    });
    expect(p.key).toBe('balanceUnderReview');
    expect(p.readyToCollect).toBe(false);
  });

  test('Ready + settled balance is ready to collect', () => {
    const settled = getReservationPaymentPresentation({
      status: 'Ready', payment_status: 'Paid', rental_price: 200, deposit: 100, balance_settled_at: '2026-09-24T02:00:00Z',
    });
    const full = getReservationPaymentPresentation({ status: 'Ready', payment_status: 'Paid', rental_price: 200, deposit: 200 });
    expect(settled.key).toBe('paidInFull');
    expect(settled.readyToCollect).toBe(true);
    expect(full.readyToCollect).toBe(true);
  });
});
