-- Reverts 20260727075852_revoke_create_reservation_public_execute.sql
--
-- Restores the PostgreSQL default of EXECUTE granted to PUBLIC.

GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, text, text, integer, text, text, text) TO PUBLIC;
