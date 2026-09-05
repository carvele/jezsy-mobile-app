-- Give staff and admin roles permission to select from wishlists
CREATE POLICY "Staff can view all wishlists" ON public.wishlists
FOR SELECT
TO public
USING (public.is_staff_or_admin());
