import { cartStorageKey } from './cartStorage';

describe('cartStorageKey', () => {
  it('isolates each signed-in customer cart', () => {
    expect(cartStorageKey('customer-a')).not.toBe(cartStorageKey('customer-b'));
  });

  it('keeps anonymous items in a separate guest cart', () => {
    expect(cartStorageKey(null)).toBe('@jezsy_cart:guest');
    expect(cartStorageKey('customer-a')).not.toBe(cartStorageKey(null));
  });
});
