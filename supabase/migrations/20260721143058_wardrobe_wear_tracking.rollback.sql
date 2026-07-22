alter table public.wardrobe_items
  drop column if exists garment_type,
  drop column if exists wear_count,
  drop column if exists last_worn_at;
