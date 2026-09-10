export const LEGACY_CART_STORAGE_KEYS = ['@jezsy_cart', 'jezsy_cart'] as const;

export function cartStorageKey(userId?: string | null): string {
  return `@jezsy_cart:${userId ?? 'guest'}`;
}
