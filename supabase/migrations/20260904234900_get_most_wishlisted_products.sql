CREATE OR REPLACE FUNCTION public.get_most_wishlisted_products()
RETURNS TABLE (
    product_id uuid,
    product_name text,
    image_url text,
    wishlist_count bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT 
        w.product_id,
        p.name as product_name,
        p.image_url,
        count(w.id) as wishlist_count
    FROM public.wishlists w
    JOIN public.products p ON p.id = w.product_id
    GROUP BY w.product_id, p.name, p.image_url
    ORDER BY wishlist_count DESC;
$$;
