-- Demo catalog so no category is a dead end.
--
-- Nine of the ten top-level categories had zero live products, so every tile
-- in the Explore grid and the Home rail led to an empty screen. This seeds two
-- products into each, plus the inventory rows behind them.
--
-- Stock is never written to products directly: trg_sync_product_stock_from_inventory
-- derives products.stock from the inventory rows, so inserting inventory is
-- what makes an item sellable.
--
-- Photos are Unsplash placeholders, verified to resolve (several existing
-- category URLs were 404ing). They are stand-ins for real boutique photography.
-- Underwear / Intimates is deliberately left imageless rather than given a
-- mismatched stock photo; the card renders a plain tinted tile.
--
-- Fixed UUIDs plus ON CONFLICT DO NOTHING so a re-apply is inert.

-- 1. Category artwork: two were 404ing, three had none.
update categories set image_url = 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600' where name = 'Accessories';
update categories set image_url = 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=600' where name = 'Activewear';
update categories set image_url = 'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=600' where name = 'Footwear';
update categories set image_url = 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=600' where name = 'Knitwear / Layering';
update categories set image_url = 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600' where name = 'Loungewear & Sleepwear';

-- 2. Products. category_id points at a SUBCATEGORY row, never a top-level one.
insert into products (
  id, name, description, price, category_id, image_url, sizes, measurements,
  base_color, material, pattern, occasion, season, is_featured, is_new_arrival,
  visibility, status, deleted
) values
  ('b0000001-0000-4000-8000-000000000001','Woven Tote Bag','Roomy woven tote with a soft leather handle.',1450,'a1111111-0000-0000-0000-000000000001','https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800',array['One Size'],'{}'::jsonb,'Beige','Woven straw','Solid','Casual','All Season',false,true,'public','active',false),
  ('b0000001-0000-4000-8000-000000000002','Leather Belt','Slim full-grain leather belt with a brushed buckle.',890,'a1111111-0000-0000-0000-000000000004','https://images.unsplash.com/photo-1479064555552-3ef4979f8908?w=800',array['S','M','L'],'{}'::jsonb,'Brown','Leather','Solid','Everyday','All Season',false,false,'public','active',false),

  ('b0000002-0000-4000-8000-000000000001','Seamless Sports Bra','Medium-support seamless bra with a wide underband.',1190,'a2222222-0000-0000-0000-000000000001','https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":78,"waist":62},"S":{"bust":82,"waist":66},"M":{"bust":88,"waist":72},"L":{"bust":94,"waist":78},"XL":{"bust":100,"waist":84}}'::jsonb,'Black','Nylon blend','Solid','Sport','All Season',false,true,'public','active',false),
  ('b0000002-0000-4000-8000-000000000002','High-Waist Leggings','Squat-proof high-waist leggings with a hidden pocket.',1390,'a2222222-0000-0000-0000-000000000002','https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800',array['XS','S','M','L','XL'],'{"XS":{"waist":62,"hips":86,"inseam":68},"S":{"waist":66,"hips":90,"inseam":69},"M":{"waist":72,"hips":96,"inseam":70},"L":{"waist":78,"hips":102,"inseam":71},"XL":{"waist":84,"hips":108,"inseam":72}}'::jsonb,'Black','Nylon blend','Solid','Sport','All Season',false,false,'public','active',false),

  ('b0000003-0000-4000-8000-000000000001','Straight-Leg Jeans','Mid-rise straight-leg jeans in rigid cotton denim.',2290,'a3333333-0000-0000-0000-000000000002','https://images.unsplash.com/photo-1479064555552-3ef4979f8908?w=800',array['XS','S','M','L','XL'],'{"XS":{"waist":64,"hips":88,"inseam":74},"S":{"waist":68,"hips":92,"inseam":75},"M":{"waist":72,"hips":96,"inseam":76},"L":{"waist":78,"hips":102,"inseam":77},"XL":{"waist":84,"hips":108,"inseam":78}}'::jsonb,'Blue','Denim','Solid','Casual','All Season',false,false,'public','active',false),
  ('b0000003-0000-4000-8000-000000000002','Pleated Midi Skirt','Fine-pleated midi skirt with an elasticated waist.',1690,'a3333333-0000-0000-0000-000000000005','https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800',array['XS','S','M','L','XL'],'{"XS":{"waist":64,"hips":88},"S":{"waist":68,"hips":92},"M":{"waist":72,"hips":96},"L":{"waist":78,"hips":102},"XL":{"waist":84,"hips":108}}'::jsonb,'Green','Polyester','Pleated','Formal','All Season',false,true,'public','active',false),

  ('b0000005-0000-4000-8000-000000000001','Everyday Sneakers','Low-profile leather sneakers with a cushioned sole.',2890,'a5555555-0000-0000-0000-000000000001','https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800',array['36','37','38','39','40','41'],'{}'::jsonb,'White','Leather','Solid','Casual','All Season',false,true,'public','active',false),
  ('b0000005-0000-4000-8000-000000000002','Leather Ankle Boots','Stacked-heel ankle boots in polished leather.',3490,'a5555555-0000-0000-0000-000000000005','https://images.unsplash.com/photo-1479064555552-3ef4979f8908?w=800',array['36','37','38','39','40'],'{}'::jsonb,'Brown','Leather','Solid','Everyday','Cold Season',false,false,'public','active',false),

  ('b0000006-0000-4000-8000-000000000001','Ribbed Knit Cardigan','Longline ribbed cardigan with mother-of-pearl buttons.',1990,'a6666666-0000-0000-0000-000000000002','https://images.unsplash.com/photo-1445205170230-053b83016050?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":86,"waist":72},"S":{"bust":90,"waist":76},"M":{"bust":96,"waist":82},"L":{"bust":102,"waist":88},"XL":{"bust":108,"waist":94}}'::jsonb,'Cream','Cotton blend','Ribbed','Everyday','Cold Season',false,false,'public','active',false),
  ('b0000006-0000-4000-8000-000000000002','Oversized Hoodie','Brushed-back fleece hoodie with a dropped shoulder.',1590,'a6666666-0000-0000-0000-000000000004','https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":92,"waist":88},"S":{"bust":98,"waist":94},"M":{"bust":104,"waist":100},"L":{"bust":110,"waist":106},"XL":{"bust":116,"waist":112}}'::jsonb,'Yellow','Cotton fleece','Solid','Casual','Cold Season',false,true,'public','active',false),

  ('b0000007-0000-4000-8000-000000000001','Cotton Pajama Set','Piped cotton pajama set with a relaxed cut.',1290,'a7777777-0000-0000-0000-000000000001','https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":86,"waist":70,"hips":90},"S":{"bust":90,"waist":74,"hips":94},"M":{"bust":96,"waist":80,"hips":100},"L":{"bust":102,"waist":86,"hips":106},"XL":{"bust":108,"waist":92,"hips":112}}'::jsonb,'Blue','Cotton','Striped','Loungewear','All Season',false,false,'public','active',false),
  ('b0000007-0000-4000-8000-000000000002','Lounge Set','Cropped hoodie and jogger set in soft loopback.',1490,'a7777777-0000-0000-0000-000000000002','https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":86,"waist":64,"hips":90},"S":{"bust":90,"waist":68,"hips":94},"M":{"bust":96,"waist":74,"hips":100},"L":{"bust":102,"waist":80,"hips":106},"XL":{"bust":108,"waist":86,"hips":112}}'::jsonb,'Yellow','Cotton','Solid','Loungewear','All Season',false,true,'public','active',false),

  ('b0000008-0000-4000-8000-000000000001','Bomber Jacket','Lightweight bomber with ribbed cuffs and a zip sleeve.',2790,'a8888888-0000-0000-0000-000000000001','https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":92,"waist":86},"S":{"bust":98,"waist":92},"M":{"bust":104,"waist":98},"L":{"bust":110,"waist":104},"XL":{"bust":116,"waist":110}}'::jsonb,'Rust','Polyester','Solid','Casual','Cold Season',false,false,'public','active',false),
  ('b0000008-0000-4000-8000-000000000002','Tailored Blazer','Single-breasted blazer with a clean shoulder line.',3190,'a8888888-0000-0000-0000-000000000003','https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":86,"waist":70,"hips":92},"S":{"bust":90,"waist":74,"hips":96},"M":{"bust":96,"waist":80,"hips":102},"L":{"bust":102,"waist":86,"hips":108},"XL":{"bust":108,"waist":92,"hips":114}}'::jsonb,'Cream','Wool blend','Solid','Formal','All Season',true,true,'public','active',false),

  ('b0000009-0000-4000-8000-000000000001','Silk Blouse','Relaxed silk blouse with a concealed placket.',1890,'a9999999-0000-0000-0000-000000000003','https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":84,"waist":70},"S":{"bust":88,"waist":74},"M":{"bust":94,"waist":80},"L":{"bust":100,"waist":86},"XL":{"bust":106,"waist":92}}'::jsonb,'White','Silk','Solid','Formal','All Season',true,false,'public','active',false),
  ('b0000009-0000-4000-8000-000000000002','Cotton T-Shirt','Midweight combed-cotton tee with a ribbed neck.',690,'a9999999-0000-0000-0000-000000000001','https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800',array['XS','S','M','L','XL'],'{"XS":{"bust":84,"waist":78},"S":{"bust":88,"waist":82},"M":{"bust":94,"waist":88},"L":{"bust":100,"waist":94},"XL":{"bust":106,"waist":100}}'::jsonb,'Green','Cotton','Solid','Everyday','All Season',false,false,'public','active',false),

  ('b000000a-0000-4000-8000-000000000001','Everyday Bra','Wireless everyday bra with a smooth microfibre cup.',1090,'aaaaaaaa-0000-0000-0000-000000000001',null,array['XS','S','M','L','XL'],'{"XS":{"bust":78},"S":{"bust":82},"M":{"bust":88},"L":{"bust":94},"XL":{"bust":100}}'::jsonb,'Nude','Microfibre','Solid','Everyday','All Season',false,false,'public','active',false),
  ('b000000a-0000-4000-8000-000000000002','Seamless Shapewear','Light-control seamless shaping short.',1290,'aaaaaaaa-0000-0000-0000-000000000003',null,array['XS','S','M','L','XL'],'{"XS":{"waist":62,"hips":86},"S":{"waist":66,"hips":90},"M":{"waist":72,"hips":96},"L":{"waist":78,"hips":102},"XL":{"waist":84,"hips":108}}'::jsonb,'Black','Nylon blend','Solid','Everyday','All Season',false,false,'public','active',false)
on conflict (id) do nothing;

-- 3. Inventory per size. The sync trigger fires per row and fills products.stock.
insert into inventory (product_doc_id, sku, item, category, size, total, reserved, available)
select
  p.id,
  'SEED-' || upper(left(replace(p.id::text, '-', ''), 8)) || '-' || sz,
  p.name,
  c.name,
  sz,
  6, 0, 6
from products p
join categories c on c.id = p.category_id
cross join unnest(p.sizes) as sz
where p.id::text like 'b00000%-0000-4000-8000-%'
  and not exists (
    select 1 from inventory i where i.product_doc_id = p.id and i.size = sz
  );
