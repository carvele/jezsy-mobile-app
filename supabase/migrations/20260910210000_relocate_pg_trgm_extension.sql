-- Migration: 20260910210000_relocate_pg_trgm_extension.sql
-- Relocates the relocatable pg_trgm extension from schema public to extensions,
-- resolving the extension_in_public warning for pg_trgm.
-- Note: pg_net is non-relocatable (extrelocatable = false) and remains an accepted
-- platform finding (SEC-EXT-001) as its procedures are already in schema net.

-- 1. Relocate pg_trgm to extensions schema
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- 2. Update search_catalog_fuzzy to include extensions in its pinned search_path
ALTER FUNCTION public.search_catalog_fuzzy(text, integer)
  SET search_path = public, extensions, pg_temp;
