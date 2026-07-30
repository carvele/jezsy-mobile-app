-- Security advisor sweep: SECURITY DEFINER functions reachable via
-- /rest/v1/rpc/ by roles that have no business calling them.
--
-- REVOKE FROM anon alone is a no-op against the PUBLIC default grant. That is
-- exactly why 20260727135433_revoke_check_email_exists_anon did not stick --
-- has_function_privilege('anon', ...) still returns true for it today. Every
-- revoke below names PUBLIC explicitly.

-- create_order, both roles. It inserts every row with status 'paid' and never
-- takes payment, so any signed-in user could mint a settled order for free.
-- Nothing in the mobile app calls it any more -- checkout was removed when the
-- buy-and-ship path was retired -- so this closes the hole now rather than
-- waiting on the conversation about dropping the orders tables outright.
-- If the admin dashboard turns out to need it, it should use service_role,
-- which bypasses grants entirely.
REVOKE EXECUTE ON FUNCTION public.create_order(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- anon only. None of these are called by the mobile client at all, and the
-- admin dashboard calls them as a signed-in staff user, so authenticated keeps
-- its grant.
REVOKE EXECUTE ON FUNCTION public.check_email_exists(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO authenticated;

-- Mutates staff employment status. Was reachable unauthenticated.
REVOKE EXECUTE ON FUNCTION public.update_staff_status(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_status(uuid, text, boolean, text) TO authenticated;

-- Staff action at the counter; a customer's own app never calls it.
REVOKE EXECUTE ON FUNCTION public.verify_pickup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_pickup(uuid) TO authenticated;

-- Recomputes derived stock. Kept for authenticated because the admin-dashboard
-- may call it directly, per the note in 20260728015951.
REVOKE EXECUTE ON FUNCTION public.sync_product_stock(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_product_stock(uuid) TO authenticated;

-- DELIBERATELY NOT REVOKED: is_staff_or_admin() and is_admin_or_owner().
--
-- The advisor flags both for anon, but they are RLS infrastructure, not API.
-- Policies on conversations, messages, profiles, reservations, reviews,
-- saved_outfits, user_measurements, wardrobe_items, products, logs and the
-- orders tables reference them with roles = {public}, which includes anon. RLS
-- expressions are evaluated with the *caller's* privileges, so revoking anon's
-- EXECUTE would make those policies raise a permission error instead of simply
-- returning no rows -- trading a benign lint for broken reads.
--
-- Verified before deciding: zero policies reference any of the five functions
-- revoked above, so none of them carry that risk.
