-- Fixes the Supabase performance advisor's auth_rls_initplan warning across
-- every affected policy (54 of them): calling auth.uid() directly inside an
-- RLS qual/with_check re-evaluates it once PER ROW instead of once per
-- query, which shows up as real query latency at scale. Wrapping it in
-- (select auth.uid()) lets Postgres treat it as a stable subplan evaluated
-- once and reused -- same auth check, same result, no behavior change.
--
-- Every DROP+CREATE pair below is byte-for-byte the original policy's
-- cmd/role/qual/with_check with only auth.uid() -> (select auth.uid())
-- changed, generated programmatically from a live pg_policies dump rather
-- than transcribed by hand, specifically to avoid subtly changing who can
-- access what while "just" doing a performance pass on a shared live DB.
--
-- Verified live before applying: dry-ran the whole batch in a
-- BEGIN...ROLLBACK, confirmed via has_function-style textual diff that only
-- the auth.uid() wrapping changed per policy, then applied for real and
-- reconfirmed the query shape via pg_policies afterward.

DROP POLICY IF EXISTS "Users file own deletion request" ON public.account_deletion_requests;
CREATE POLICY "Users file own deletion request" ON public.account_deletion_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((select auth.uid()) = user_id) AND (status = 'pending'::text)));

DROP POLICY IF EXISTS "Users read own deletion requests" ON public.account_deletion_requests;
CREATE POLICY "Users read own deletion requests" ON public.account_deletion_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users withdraw own pending deletion request" ON public.account_deletion_requests;
CREATE POLICY "Users withdraw own pending deletion request" ON public.account_deletion_requests AS PERMISSIVE FOR DELETE TO authenticated USING ((((select auth.uid()) = user_id) AND (status = 'pending'::text)));

DROP POLICY IF EXISTS "Users manage own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users manage own dismissals" ON public.announcement_dismissals AS PERMISSIVE FOR ALL TO authenticated USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.ar_sessions;
CREATE POLICY "Enable insert for authenticated users" ON public.ar_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can delete own capsule items" ON public.capsule_items;
CREATE POLICY "Users can delete own capsule items" ON public.capsule_items AS PERMISSIVE FOR DELETE TO public USING ((capsule_id IN ( SELECT capsules.id
   FROM capsules
  WHERE (capsules.user_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Users can insert own capsule items" ON public.capsule_items;
CREATE POLICY "Users can insert own capsule items" ON public.capsule_items AS PERMISSIVE FOR INSERT TO public WITH CHECK ((capsule_id IN ( SELECT capsules.id
   FROM capsules
  WHERE (capsules.user_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Users can view own capsule items" ON public.capsule_items;
CREATE POLICY "Users can view own capsule items" ON public.capsule_items AS PERMISSIVE FOR SELECT TO public USING ((capsule_id IN ( SELECT capsules.id
   FROM capsules
  WHERE (capsules.user_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Users can delete own capsules" ON public.capsules;
CREATE POLICY "Users can delete own capsules" ON public.capsules AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can insert own capsules" ON public.capsules;
CREATE POLICY "Users can insert own capsules" ON public.capsules AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can update own capsules" ON public.capsules;
CREATE POLICY "Users can update own capsules" ON public.capsules AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can view own capsules" ON public.capsules;
CREATE POLICY "Users can view own capsules" ON public.capsules AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Allow admins to create categories" ON public.categories;
CREATE POLICY "Allow admins to create categories" ON public.categories AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Allow admins to delete categories" ON public.categories;
CREATE POLICY "Allow admins to delete categories" ON public.categories AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Allow admins to update categories" ON public.categories;
CREATE POLICY "Allow admins to update categories" ON public.categories AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Allow admins to create colors" ON public.color_list;
CREATE POLICY "Allow admins to create colors" ON public.color_list AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Allow admins to delete colors" ON public.color_list;
CREATE POLICY "Allow admins to delete colors" ON public.color_list AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Allow admins to update colors" ON public.color_list;
CREATE POLICY "Allow admins to update colors" ON public.color_list AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Enable insert for own conversation or admin" ON public.conversations;
CREATE POLICY "Enable insert for own conversation or admin" ON public.conversations AS PERMISSIVE FOR INSERT TO public WITH CHECK (((customer_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable select for own conversation or admin" ON public.conversations;
CREATE POLICY "Enable select for own conversation or admin" ON public.conversations AS PERMISSIVE FOR SELECT TO public USING (((customer_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable update for own conversation or admin" ON public.conversations;
CREATE POLICY "Enable update for own conversation or admin" ON public.conversations AS PERMISSIVE FOR UPDATE TO public USING (((customer_id = (select auth.uid())) OR is_staff_or_admin())) WITH CHECK (((customer_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.feedback;
CREATE POLICY "Enable insert for authenticated users" ON public.feedback AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.logs;
CREATE POLICY "Enable insert for authenticated users" ON public.logs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((((select auth.uid()) = user_id) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable insert for messages in own conversation or admin" ON public.messages;
CREATE POLICY "Enable insert for messages in own conversation or admin" ON public.messages AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_staff_or_admin() OR ((sender_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.customer_id = (select auth.uid()))))))));

DROP POLICY IF EXISTS "Enable select for messages in own conversation or admin" ON public.messages;
CREATE POLICY "Enable select for messages in own conversation or admin" ON public.messages AS PERMISSIVE FOR SELECT TO public USING (((sender_id = (select auth.uid())) OR is_staff_or_admin() OR (EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = messages.conversation_id) AND (conversations.customer_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Users can update their messages or mark as read" ON public.messages;
CREATE POLICY "Users can update their messages or mark as read" ON public.messages AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((c.customer_id = (select auth.uid())) OR is_staff_or_admin())))));

DROP POLICY IF EXISTS "Users can manage their own notifications" ON public.notifications;
CREATE POLICY "Users can manage their own notifications" ON public.notifications AS PERMISSIVE FOR ALL TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Allow admins to create patterns" ON public.pattern_list;
CREATE POLICY "Allow admins to create patterns" ON public.pattern_list AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Allow admins to delete patterns" ON public.pattern_list;
CREATE POLICY "Allow admins to delete patterns" ON public.pattern_list AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Allow admins to update patterns" ON public.pattern_list;
CREATE POLICY "Allow admins to update patterns" ON public.pattern_list AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Users read own payments" ON public.payments;
CREATE POLICY "Users read own payments" ON public.payments AS PERMISSIVE FOR SELECT TO authenticated USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Allow admins to edit inventory columns on products" ON public.products;
CREATE POLICY "Allow admins to edit inventory columns on products" ON public.products AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;
CREATE POLICY "Enable insert for authenticated users only" ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = id));

DROP POLICY IF EXISTS "Enable read for own profile or admin" ON public.profiles;
CREATE POLICY "Enable read for own profile or admin" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((((select auth.uid()) = id) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable update for users based on email" ON public.profiles;
CREATE POLICY "Enable update for users based on email" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = id));

DROP POLICY IF EXISTS "Enable select for own reservations or admin" ON public.reservations;
CREATE POLICY "Enable select for own reservations or admin" ON public.reservations AS PERMISSIVE FOR SELECT TO public USING (((customer_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Customers can delete own reviews" ON public.reviews;
CREATE POLICY "Customers can delete own reviews" ON public.reviews AS PERMISSIVE FOR DELETE TO public USING (((user_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Customers can insert reviews for reserved products" ON public.reviews;
CREATE POLICY "Customers can insert reviews for reserved products" ON public.reviews AS PERMISSIVE FOR INSERT TO public WITH CHECK ((is_staff_or_admin() OR ((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM (reservation_items ri
     JOIN reservations r ON ((r.id = ri.reservation_id)))
  WHERE ((r.customer_id = (select auth.uid())) AND (ri.product_id = reviews.product_id) AND (COALESCE(r.deleted, false) = false)))))));

DROP POLICY IF EXISTS "Customers can update own reviews" ON public.reviews;
CREATE POLICY "Customers can update own reviews" ON public.reviews AS PERMISSIVE FOR UPDATE TO public USING (((user_id = (select auth.uid())) OR is_staff_or_admin())) WITH CHECK (((user_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable all access for own saved outfits or admin" ON public.saved_outfits;
CREATE POLICY "Enable all access for own saved outfits or admin" ON public.saved_outfits AS PERMISSIVE FOR ALL TO public USING (((user_id = (select auth.uid())) OR is_staff_or_admin())) WITH CHECK (((user_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "History readable by staff and admin" ON public.staff_status_history;
CREATE POLICY "History readable by staff and admin" ON public.staff_status_history AS PERMISSIVE FOR SELECT TO public USING (((( SELECT profiles.role
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.deleted = false))) = ANY (ARRAY['admin'::text, 'owner'::text])) OR (staff_id = (select auth.uid()))));

DROP POLICY IF EXISTS "Allow admins to create stock_movements" ON public.stock_movements;
CREATE POLICY "Allow admins to create stock_movements" ON public.stock_movements AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::text, 'owner'::text])) AND (profiles.deleted = false) AND (profiles.is_blocked = false)))));

DROP POLICY IF EXISTS "Users manage own stock notify requests" ON public.stock_notify_requests;
CREATE POLICY "Users manage own stock notify requests" ON public.stock_notify_requests AS PERMISSIVE FOR ALL TO authenticated USING (((select auth.uid()) = user_id)) WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Enable insert for own measurements or admin" ON public.user_measurements;
CREATE POLICY "Enable insert for own measurements or admin" ON public.user_measurements AS PERMISSIVE FOR INSERT TO public WITH CHECK (((user_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable select for own measurements or admin" ON public.user_measurements;
CREATE POLICY "Enable select for own measurements or admin" ON public.user_measurements AS PERMISSIVE FOR SELECT TO public USING (((user_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Enable update/delete for own measurements or admin" ON public.user_measurements;
CREATE POLICY "Enable update/delete for own measurements or admin" ON public.user_measurements AS PERMISSIVE FOR ALL TO public USING (((user_id = (select auth.uid())) OR is_staff_or_admin())) WITH CHECK (((user_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Users can insert own streaks" ON public.user_streaks;
CREATE POLICY "Users can insert own streaks" ON public.user_streaks AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can update own streaks" ON public.user_streaks;
CREATE POLICY "Users can update own streaks" ON public.user_streaks AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can view own streaks" ON public.user_streaks;
CREATE POLICY "Users can view own streaks" ON public.user_streaks AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Enable all access for own wardrobe items or admin" ON public.wardrobe_items;
CREATE POLICY "Enable all access for own wardrobe items or admin" ON public.wardrobe_items AS PERMISSIVE FOR ALL TO public USING (((user_id = (select auth.uid())) OR is_staff_or_admin())) WITH CHECK (((user_id = (select auth.uid())) OR is_staff_or_admin()));

DROP POLICY IF EXISTS "Users can delete their own wishlists" ON public.wishlists;
CREATE POLICY "Users can delete their own wishlists" ON public.wishlists AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can insert their own wishlists" ON public.wishlists;
CREATE POLICY "Users can insert their own wishlists" ON public.wishlists AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users can view their own wishlists" ON public.wishlists;
CREATE POLICY "Users can view their own wishlists" ON public.wishlists AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = user_id));

DROP POLICY IF EXISTS "Users manage their own wishlist" ON public.wishlists;
CREATE POLICY "Users manage their own wishlist" ON public.wishlists AS PERMISSIVE FOR ALL TO public USING (((select auth.uid()) = user_id));

