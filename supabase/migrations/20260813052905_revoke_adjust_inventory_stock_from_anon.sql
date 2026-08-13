-- REVOKE ... FROM PUBLIC alone did not remove anon's EXECUTE grant --
-- verified live with has_function_privilege('anon', ..., 'EXECUTE') still
-- returning true after the PUBLIC revoke in the prior migration. Same
-- footgun this project has hit before on table grants: anon can carry an
-- independent grant layered on top of (or reasserted alongside) the PUBLIC
-- default, so REVOKE FROM PUBLIC alone can no-op for it. Always verify with
-- has_function_privilege rather than assuming a PUBLIC revoke is sufficient.
REVOKE EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid, integer, integer, integer) FROM anon;
