import {
  isPaymentPurpose,
  paymentAmountCentavos,
  paymentPurposeLabel,
} from './reservationPayment';

describe('reservation payment purpose', () => {
  test('calculates initial, full, and remaining payment amounts server-side', () => {
    const base = { depositPesos: 595, totalPesos: 1190, paidCentavos: 59500 };

    expect(paymentAmountCentavos({ ...base, purpose: 'initial_deposit' })).toBe(59500);
    expect(paymentAmountCentavos({ ...base, purpose: 'full_payment' })).toBe(119000);
    expect(paymentAmountCentavos({ ...base, purpose: 'remaining_balance' })).toBe(59500);
  });

  test('never returns a negative remaining balance', () => {
    expect(paymentAmountCentavos({
      purpose: 'remaining_balance',
      depositPesos: 500,
      totalPesos: 1000,
      paidCentavos: 110000,
    })).toBe(0);
  });

  test('accepts only supported purposes and gives each accurate checkout copy', () => {
    expect(isPaymentPurpose('remaining_balance')).toBe(true);
    expect(isPaymentPurpose('refund')).toBe(false);
    expect(paymentPurposeLabel('initial_deposit')).toBe('Reservation payment for');
    expect(paymentPurposeLabel('full_payment')).toBe('Full payment for');
    expect(paymentPurposeLabel('remaining_balance')).toBe('Remaining balance for');
  });
});
