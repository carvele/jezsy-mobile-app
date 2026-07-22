-- Add garment_type (basic Top/Bottom/Dress/Outerwear/Shoes/Accessory bucket,
-- separate from the free-text boutique `category`) and wear-tracking columns
-- (wear_count, last_worn_at) to wardrobe_items. Powers the "Log Wear" action
-- and a working gap-analysis (previously bucketed by `category`, which never
-- matched the app's actual boutique category values).

alter table public.wardrobe_items
  add column if not exists garment_type text,
  add column if not exists wear_count integer not null default 0,
  add column if not exists last_worn_at timestamptz;

comment on column public.wardrobe_items.garment_type is
  'Basic wardrobe bucket (Top/Bottom/Dress/Outerwear/Shoes/Accessory) used for gap analysis, distinct from the free-text boutique `category`.';
comment on column public.wardrobe_items.wear_count is
  'Number of times the user has logged wearing this item.';
comment on column public.wardrobe_items.last_worn_at is
  'Timestamp of the most recent logged wear, null if never logged.';
