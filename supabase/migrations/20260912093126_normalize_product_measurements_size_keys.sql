-- Seed-data fix: products.measurements used malformed outer size keys
-- (_s, _m, _l, _x_s, _x_l) instead of the canonical keys matching
-- products.sizes (XS, S, M, L, XL). recommendSize() and the product page's
-- hasSizeChart check both index measurements by the real size string, so
-- this silently broke size recommendations AND hid the Size Chart link for
-- most of the catalog. Two products already used correct keys, and the
-- IS DISTINCT FROM guard below leaves them untouched.
--
-- Also fixes an inner-field naming mismatch on the two products that carry
-- a shoulder measurement: `shoulder_width` (snake_case) was written, but
-- sizeRecommender.ts's ProductMeasurements type and recommendSize() both
-- read `shoulderWidth` (camelCase) -- shoulder-width matching for tops
-- never actually fired for these products either.
--
-- Idempotent: IS DISTINCT FROM guard means a re-run touches nothing.
WITH outer_key_map(bad, good) AS (
  VALUES ('_xs','XS'), ('_x_s','XS'), ('_s','S'), ('_m','M'), ('_l','L'), ('_xl','XL'), ('_x_l','XL')
),
inner_key_map(bad, good) AS (
  VALUES ('shoulder_width','shoulderWidth')
),
size_entries AS (
  SELECT p.id AS product_id,
         COALESCE(okm.good, sizes.key) AS size_key,
         sizes.value AS size_value
  FROM products p
  CROSS JOIN LATERAL jsonb_each(p.measurements) AS sizes(key, value)
  LEFT JOIN outer_key_map okm ON okm.bad = sizes.key
  WHERE p.measurements IS NOT NULL
),
size_entries_fixed AS (
  SELECT se.product_id, se.size_key,
         jsonb_object_agg(COALESCE(ikm.good, fields.key), fields.value) AS size_value_fixed
  FROM size_entries se
  CROSS JOIN LATERAL jsonb_each(se.size_value) AS fields(key, value)
  LEFT JOIN inner_key_map ikm ON ikm.bad = fields.key
  GROUP BY se.product_id, se.size_key
),
remapped AS (
  SELECT product_id, jsonb_object_agg(size_key, size_value_fixed) AS new_measurements
  FROM size_entries_fixed
  GROUP BY product_id
)
UPDATE products p
SET measurements = r.new_measurements
FROM remapped r
WHERE p.id = r.product_id
  AND p.measurements IS DISTINCT FROM r.new_measurements;
