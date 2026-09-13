/*
  Fix: Duplicate inventory rows for products with declared variants

  Problem:
    The existing seed_inventory_for_new_product() trigger creates an
    inventory row whenever a product is inserted, including products
    that already have declared sizes.

    ProductForm.jsx separately creates the actual (size, color) variant
    rows. This resulted in:

      M / "Black, White, Sky Blue, Blue" / total 1
      M / Black                         / total 0
      M / White                         / total 0
      M / Sky Blue                      / total 0
      M / Blue                          / total 0

  Correct behavior:
    - Products with declared sizes are managed by ProductForm's variant matrix.
    - The trigger must NOT create inventory rows for those products.
    - True 1-of-1 products with no declared sizes retain the existing
      automatic "One Size" inventory behavior.
    - 1-of-1 color must always be a single color, never a comma-separated list.

  This migration also repairs the specifically identified phantom row
  for Mini Skirt.
*/


/* ================================================================
   1. FIX THE INVENTORY SEED TRIGGER
   ================================================================ */

CREATE OR REPLACE FUNCTION public.seed_inventory_for_new_product()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sz text;
  prod_color text;
  clean_code text;
  clean_color text;
  v_sku text;
  effective_sizes text[];
BEGIN

  /*
    IMPORTANT:

    If the product has declared sizes, inventory is created by the
    frontend variant matrix in ProductForm.jsx.

    Do NOT create an additional inventory row here.

    This is the actual fix for the duplicate inventory problem.
  */
  IF NEW.sizes IS NOT NULL
     AND array_length(NEW.sizes, 1) > 0
  THEN
    RETURN NEW;
  END IF;


  /*
    TRUE 1-OF-1 / LEGACY PRODUCT

    Products without a declared size array continue to receive one
    automatically seeded "One Size" inventory row.

    Prefer base_color because it represents one atomic color.

    If base_color is unavailable, use only the first color token from
    NEW.color. This prevents a legacy comma-separated color value from
    becoming one composite inventory color.
  */
  prod_color := COALESCE(
    NULLIF(TRIM(NEW.base_color), ''),
    NULLIF(TRIM(split_part(COALESCE(NEW.color, ''), ',', 1)), ''),
    ''
  );

  effective_sizes := ARRAY['One Size']::text[];


  /*
    Preserve the existing SKU-generation behavior for true 1-of-1
    products.
  */
  FOREACH sz IN ARRAY effective_sizes LOOP

    IF NEW.style_code IS NOT NULL
       AND TRIM(NEW.style_code) != ''
    THEN

      clean_code := UPPER(TRIM(NEW.style_code));

      IF prod_color != '' THEN

        clean_color := UPPER(
          REGEXP_REPLACE(
            prod_color,
            '[^A-Za-z0-9]+',
            '',
            'g'
          )
        );

        v_sku :=
          clean_code
          || '-'
          || clean_color
          || '-'
          || UPPER(TRIM(sz));

      ELSE

        v_sku :=
          clean_code
          || '-'
          || UPPER(TRIM(sz));

      END IF;

    ELSE

      v_sku := NULL;

    END IF;


    /*
      Seed one unit for a genuine 1-of-1 product.

      The existing NOT EXISTS protection is retained so the trigger
      remains idempotent and does not create duplicate rows.
    */
    INSERT INTO public.inventory (
      product_doc_id,
      item,
      category,
      size,
      color,
      pattern,
      sku,
      variant_sku,
      total,
      reserved,
      available,
      deleted,
      created_at,
      updated_at
    )
    SELECT
      NEW.id,
      NEW.name,
      NEW.category,
      sz,
      prod_color,
      '',
      NEW.style_code,
      v_sku,
      1,
      0,
      1,
      false,
      now(),
      now()
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.inventory i
      WHERE i.product_doc_id = NEW.id
        AND (
          i.size IS NOT DISTINCT FROM sz
          OR (
            i.size IS NULL
            AND sz = 'One Size'
          )
        )
        AND (
          i.color IS NOT DISTINCT FROM prod_color
          OR (
            i.color IS NULL
            AND prod_color = ''
          )
        )
        AND (
          i.deleted IS NULL
          OR i.deleted = false
        )
    );

  END LOOP;


  RETURN NEW;

END;
$$;


/* ================================================================
   2. REPAIR THE KNOWN MINI SKIRT PHANTOM ROW
   ================================================================

   This is intentionally targeted.

   We DO NOT globally delete every inventory row whose color contains
   a comma because that would be too broad and could affect legitimate
   historical/future data.

   The affected product and phantom inventory row were identified in
   the diagnosis:

     Product:
       4d5dacae-2ef0-4b82-a1d3-1d2b43530061

     Phantom inventory:
       dee0a998-8f81-4c9e-acc4-7d84be03e773

   The row is soft-deleted rather than physically deleted so existing
   inventory/history semantics are preserved.
   */

UPDATE public.inventory
SET
  deleted = true,
  updated_at = now()
WHERE id = 'dee0a998-8f81-4c9e-acc4-7d84be03e773'
  AND product_doc_id = '4d5dacae-2ef0-4b82-a1d3-1d2b43530061'
  AND color = 'Black, White, Sky Blue, Blue'
  AND total = 1;


/* ================================================================
   3. END OF MIGRATION
   ================================================================ */
