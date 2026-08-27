-- Finding L-2, advisor lint 0024. Four UPDATE policies pair USING (true) with
-- an owner-only WITH CHECK. A non-owner's UPDATE still fails the check, so
-- this is not currently exploitable -- but USING (true) means the whole table
-- is row-eligible for update attempts by anyone, and the only thing standing
-- between that and a write is a WITH CHECK that must never be dropped.
--
-- Mirror the existing WITH CHECK predicate into USING verbatim, rather than
-- substituting is_admin_or_owner(), so the two clauses are provably identical
-- and this migration cannot change owner behaviour.
--
-- BLAST RADIUS: admins pass the predicate, so their writes are unaffected.
-- Non-owner writes already failed. Low risk, but it is an RLS change on the
-- shared database -- notify the owner-dashboard owner before applying.

ALTER POLICY "Allow admins to update categories" ON public.categories
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['owner'::text])
      AND profiles.deleted = false
      AND profiles.is_blocked = false
  ));

ALTER POLICY "Allow admins to update colors" ON public.color_list
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['owner'::text])
      AND profiles.deleted = false
      AND profiles.is_blocked = false
  ));

ALTER POLICY "Allow admins to update patterns" ON public.pattern_list
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['owner'::text])
      AND profiles.deleted = false
      AND profiles.is_blocked = false
  ));

ALTER POLICY "Allow admins to edit inventory columns on products" ON public.products
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['owner'::text])
      AND profiles.deleted = false
      AND profiles.is_blocked = false
  ));
