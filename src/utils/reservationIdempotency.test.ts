import { getReservationAttempt } from './reservationIdempotency';

describe('getReservationAttempt', () => {
  it('reuses the key when retrying the same reservation request', () => {
    const payload = { items: [{ product_id: 'one', quantity: 1 }], payment: 'deposit' };
    const first = getReservationAttempt(null, payload);

    expect(getReservationAttempt(first, payload)).toBe(first);
  });

  it('creates a new key after the reservation details change', () => {
    const first = getReservationAttempt(null, { payment: 'deposit' });
    const changed = getReservationAttempt(first, { payment: 'full' });

    expect(changed.key).not.toBe(first.key);
  });
});
