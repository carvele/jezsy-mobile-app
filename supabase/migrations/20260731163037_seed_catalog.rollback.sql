-- Removes the seeded demo catalog. Inventory first so the stock sync trigger
-- runs against rows that still exist.
delete from inventory where product_doc_id::text like 'b00000%-0000-4000-8000-%';
delete from products where id::text like 'b00000%-0000-4000-8000-%';

-- Category artwork is left in place: the two URLs it replaced were 404ing, so
-- restoring them would only reinstate broken images.
