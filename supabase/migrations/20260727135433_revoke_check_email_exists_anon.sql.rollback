-- Reverts 20260727135433_revoke_check_email_exists_anon.sql
--
-- Restores the PostgreSQL default of EXECUTE granted to PUBLIC. Note this
-- reopens the unauthenticated account-enumeration vector (finding M-1).

GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO PUBLIC;
