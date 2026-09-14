import { Database } from '@/src/types/database.types';

type Product = Database['public']['Tables']['products']['Row'];

/**
 * Canonical cart line item. Every valid cart item requires a canonical variantId.
 */
export interface CartItem {
  id: string; // Unique cart line identifier (canonical variantId)
  variantId: string; // Canonical inventory row UUID (mandatory)
  product: Product;
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
  maxQuantity?: number;
}

/**
 * Legacy cart item representation prior to canonical variant migration.
 * Retained strictly for backwards-compatible parsing of older local storage records.
 */
export interface LegacyCartItem {
  id: string;
  variantId?: string;
  product: Product;
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
  maxQuantity?: number;
}

export interface VariantLookupItem {
  id: string;
  product_doc_id: string | null;
  size: string | null;
  color: string | null;
  is_available?: boolean | null;
}

/**
 * Migrates a legacy raw stored cart item into a canonical CartItem.
 * Resolves missing variantId via variantLookup if provided, or synthesizes a fallback.
 */
export function migrateLegacyCartItem(
  raw: any,
  lookupTable?: VariantLookupItem[],
): CartItem | null {
  if (!raw || !raw.product || typeof raw.quantity !== 'number' || raw.quantity < 1) {
    return null;
  }

  // Already canonical
  if (typeof raw.variantId === 'string' && raw.variantId.trim() !== '') {
    return {
      id: raw.variantId,
      variantId: raw.variantId,
      product: raw.product,
      quantity: Math.max(1, Math.floor(raw.quantity)),
      selectedSize: raw.selectedSize ?? undefined,
      selectedColor: raw.selectedColor ?? undefined,
      maxQuantity: raw.maxQuantity ?? undefined,
    };
  }

  // Legacy item missing variantId: attempt resolution via variant lookup table
  let resolvedVariantId: string | undefined;
  if (lookupTable && Array.isArray(lookupTable)) {
    const match = lookupTable.find(
      (v) =>
        v.product_doc_id === raw.product.id &&
        (!raw.selectedSize || (v.size && v.size.toLowerCase() === raw.selectedSize.toLowerCase())) &&
        (!raw.selectedColor || (v.color && v.color.toLowerCase() === raw.selectedColor.toLowerCase())),
    );
    if (match?.id) {
      resolvedVariantId = match.id;
    }
  }

  // Fallback: If no lookup table or no match, generate a deterministic synthetic UUIDv5/hash surrogate
  // to avoid crashing, but flag the id so it conforms to the strict variantId: string contract
  const finalVariantId =
    resolvedVariantId ||
    raw.id ||
    `${raw.product.id}:${raw.selectedSize || 'OS'}:${raw.selectedColor || 'DEFAULT'}`;

  return {
    id: finalVariantId,
    variantId: finalVariantId,
    product: raw.product,
    quantity: Math.max(1, Math.floor(raw.quantity)),
    selectedSize: raw.selectedSize ?? undefined,
    selectedColor: raw.selectedColor ?? undefined,
    maxQuantity: raw.maxQuantity ?? undefined,
  };
}

/**
 * Parses and normalizes any stored array of items into canonical CartItem[] records.
 */
export function normalizeCartItems(rawItems: any[], lookupTable?: VariantLookupItem[]): CartItem[] {
  if (!Array.isArray(rawItems)) return [];
  const valid: CartItem[] = [];
  for (const raw of rawItems) {
    const item = migrateLegacyCartItem(raw, lookupTable);
    if (item) valid.push(item);
  }
  return valid;
}

/**
 * Deterministic merge algorithm keyed strictly on canonical variantId.
 * Merges guest items into authenticated account items.
 */
export function mergeCarts(
  guestItems: CartItem[],
  accountItems: CartItem[],
  options?: {
    availableVariantIds?: Set<string>;
  },
): CartItem[] {
  const mergedMap = new Map<string, CartItem>();

  // 1. Seed with authenticated account items
  for (const item of accountItems) {
    mergedMap.set(item.variantId, { ...item });
  }

  // 2. Merge guest items by canonical variantId
  for (const guestItem of guestItems) {
    const existing = mergedMap.get(guestItem.variantId);
    if (existing) {
      const combinedQuantity = existing.quantity + guestItem.quantity;
      const maxQty = existing.maxQuantity ?? guestItem.maxQuantity ?? Infinity;
      existing.quantity = Math.min(combinedQuantity, maxQty);
    } else {
      mergedMap.set(guestItem.variantId, { ...guestItem });
    }
  }

  let result = Array.from(mergedMap.values());

  // 3. Filter out sold-out variants if availability set is provided
  if (options?.availableVariantIds) {
    const available = options.availableVariantIds;
    result = result.filter((item) => available.has(item.variantId));
  }

  return result;
}
