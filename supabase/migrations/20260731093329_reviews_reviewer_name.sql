-- Denormalize a display name onto reviews, mirroring reservations.customer_name.
-- profiles' read policy only lets a customer see their own row
-- ((auth.uid() = id) OR is_staff_or_admin()), so the previous reviews-list
-- embed (user:user_id(first_name,last_name)) returned null for every
-- reviewer but the viewer themselves -- every review but your own rendered
-- "Anonymous". Storing the display name at write time sidesteps the RLS
-- block instead of routing around it with a DEFINER RPC.
alter table reviews add column if not exists reviewer_name text;

update reviews r
set reviewer_name = trim(
  concat_ws(' ', p.first_name, nullif(left(p.last_name, 1), '') || '.')
)
from profiles p
where p.id = r.user_id
  and r.reviewer_name is null
  and p.first_name is not null
  and p.first_name != '';
