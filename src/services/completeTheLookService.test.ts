import { getCompleteTheLook } from './completeTheLookService';
import { supabase } from '@/src/lib/supabase';

jest.mock('@/src/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

/**
 * The real query builder is thenable (some chains in the service are
 * awaited directly without a terminal call like .maybeSingle()), so the
 * mock builder must be awaitable itself, not just chainable.
 */
function makeQueryBuilder(result: { data: any; error: any }) {
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    order: jest.fn(() => builder),
    gt: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function product(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'anchor',
    name: 'Product',
    category: 'Tops',
    category_id: null,
    color: 'black',
    price: 100,
    sale_price: null,
    on_sale: false,
    image_url: 'x.jpg',
    deleted: false,
    visibility: 'public',
    created_at: '2026-01-01',
    ...overrides,
  };
}

function inventoryRow(productId: string, available = 5) {
  return { id: `inv-${productId}`, product_doc_id: productId, deleted: false, available };
}

/** Queues one mock result per table per call, in call order, so a table
 * queried multiple times for different purposes (e.g. `products` for
 * curated lookups, sibling lookups, and the anchor) can return different
 * data each time. */
function mockTables(queues: Record<string, { data: any; error: any }[]>) {
  const cursors: Record<string, number> = {};
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    const queue = queues[table] || [];
    const i = cursors[table] || 0;
    cursors[table] = i + 1;
    return makeQueryBuilder(queue[i] ?? { data: [], error: null });
  });
}

describe('completeTheLookService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Tier 1: returns curated links in sort_order order, tagged manual, when all are sellable', async () => {
    mockTables({
      product_complements: [
        // Already in the order a real `.order('sort_order')` query would
        // return -- the mock query builder doesn't simulate server-side
        // ordering, so the fixture supplies it pre-sorted.
        { data: [
          { complementary_product_id: 'p1', sort_order: 0 },
          { complementary_product_id: 'p2', sort_order: 1 },
        ], error: null },
      ],
      products: [
        { data: [product({ id: 'p1' }), product({ id: 'p2' })], error: null },
      ],
      inventory: [
        { data: [inventoryRow('p1'), inventoryRow('p2')], error: null },
      ],
    });

    const result = await getCompleteTheLook('anchor', 6);

    expect(result.map((r) => r.product.id)).toEqual(['p1', 'p2']);
    expect(result.every((r) => r.tier === 'manual')).toBe(true);
  });

  test('sellability predicate: a curated link with zero in-stock variants is excluded', async () => {
    mockTables({
      product_complements: [
        { data: [{ complementary_product_id: 'p1', sort_order: 0 }], error: null },
      ],
      products: [
        { data: [product({ id: 'p1' })], error: null },
      ],
      inventory: [
        { data: [], error: null }, // no sellable variants for p1
      ],
      pose_guide_products: [
        { data: [], error: null }, // Tier 2 finds nothing either
      ],
    });

    const result = await getCompleteTheLook('anchor', 6);

    expect(result).toEqual([]);
  });

  test('dedup: Tier 2 does not re-add a product Tier 1 already returned', async () => {
    mockTables({
      product_complements: [
        { data: [{ complementary_product_id: 'p1', sort_order: 0 }], error: null },
      ],
      products: [
        { data: [product({ id: 'p1' })], error: null }, // Tier 1 lookup
        { data: [product({ id: 'p1' }), product({ id: 'p3' })], error: null }, // Tier 2 sibling lookup
      ],
      inventory: [
        { data: [inventoryRow('p1')], error: null }, // Tier 1 sellability
        { data: [inventoryRow('p1'), inventoryRow('p3')], error: null }, // Tier 2 sellability
      ],
      pose_guide_products: [
        { data: [{ pose_guide_id: 'look-1' }], error: null }, // anchor's own looks
        { data: [
          { product_id: 'p1', sort_order: 0 }, // already in results -- must not duplicate
          { product_id: 'p3', sort_order: 1 },
        ], error: null },
      ],
    });

    const result = await getCompleteTheLook('anchor', 6);

    expect(result.map((r) => r.product.id)).toEqual(['p1', 'p3']);
    expect(result.find((r) => r.product.id === 'p1')!.tier).toBe('manual');
    expect(result.find((r) => r.product.id === 'p3')!.tier).toBe('styled_look_suggestion');
  });

  test('Tier 2 ordering: higher shared_look_count ranks first', async () => {
    mockTables({
      product_complements: [{ data: [], error: null }],
      pose_guide_products: [
        { data: [{ pose_guide_id: 'look-1' }, { pose_guide_id: 'look-2' }], error: null },
        { data: [
          { product_id: 'p_once', sort_order: 0 },   // appears in 1 shared look
          { product_id: 'p_twice', sort_order: 5 },  // appears in 2 shared looks
          { product_id: 'p_twice', sort_order: 0 },
        ], error: null },
      ],
      products: [
        { data: [product({ id: 'p_once' }), product({ id: 'p_twice' })], error: null },
      ],
      inventory: [
        { data: [inventoryRow('p_once'), inventoryRow('p_twice')], error: null },
      ],
    });

    const result = await getCompleteTheLook('anchor', 6);

    expect(result.map((r) => r.product.id)).toEqual(['p_twice', 'p_once']);
  });

  test('stops querying further tiers once limit is already filled by an earlier tier', async () => {
    mockTables({
      product_complements: [
        { data: [
          { complementary_product_id: 'p1', sort_order: 0 },
          { complementary_product_id: 'p2', sort_order: 1 },
        ], error: null },
      ],
      products: [
        { data: [product({ id: 'p1' }), product({ id: 'p2' })], error: null },
      ],
      inventory: [
        { data: [inventoryRow('p1'), inventoryRow('p2')], error: null },
      ],
    });

    const result = await getCompleteTheLook('anchor', 2);

    expect(result.map((r) => r.product.id)).toEqual(['p1', 'p2']);
    // Tier 2 (pose_guide_products) must never have been queried once Tier 1 filled the limit.
    expect(supabase.from).not.toHaveBeenCalledWith('pose_guide_products');
  });

  test('a product with only one sellable variant among several exposes only that variant', async () => {
    mockTables({
      product_complements: [
        { data: [{ complementary_product_id: 'p1', sort_order: 0 }], error: null },
      ],
      products: [
        { data: [product({ id: 'p1' })], error: null },
      ],
      inventory: [
        { data: [
          { id: 'inv-out', product_doc_id: 'p1', deleted: false, available: 0 },
          { id: 'inv-in', product_doc_id: 'p1', deleted: false, available: 3 },
        ].filter((r) => r.available > 0), error: null }, // .gt('available', 0) applied server-side
      ],
    });

    const result = await getCompleteTheLook('anchor', 6);

    expect(result).toHaveLength(1);
    expect(result[0].sellableVariants.map((v) => v.id)).toEqual(['inv-in']);
  });
});
