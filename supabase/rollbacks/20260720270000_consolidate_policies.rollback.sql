-- Rollback for 20260720270000_consolidate_policies.sql
-- Restores every dropped policy, including the permissive messages INSERT
-- rule (which reopens the cross-conversation injection hole -- roll back only
-- if the tightened policy is actually breaking a client).

CREATE POLICY "Allow public read of categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON public.products FOR SELECT USING (true);

CREATE POLICY "Customers can insert own conversations" ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "Customers can view own conversations" ON public.conversations FOR SELECT
  USING ((auth.uid() = customer_id) OR (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['admin','owner']))));
CREATE POLICY "Customers can update own conversations" ON public.conversations FOR UPDATE
  USING ((auth.uid() = customer_id) OR (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['admin','owner']))));

CREATE POLICY "Users can view messages in their conversations" ON public.messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND ((c.customer_id = auth.uid()) OR (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['admin','owner']))))));
CREATE POLICY "Users can insert messages in their conversations" ON public.messages FOR INSERT
  WITH CHECK ((auth.uid() = sender_id) AND (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = messages.conversation_id AND ((c.customer_id = auth.uid()) OR (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = ANY (ARRAY['admin','owner'])))))));

CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT
  USING (customer_id = (SELECT auth.uid()));
CREATE POLICY "Users can view their own orders" ON public.orders FOR SELECT
  USING (auth.uid() = customer_id);

CREATE POLICY "Users can manage their own reviews" ON public.reviews FOR ALL
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Enable insert for messages in own conversation or admin" ON public.messages;
CREATE POLICY "Enable insert for messages in own conversation or admin"
  ON public.messages FOR INSERT
  WITH CHECK (
    (sender_id = auth.uid()) OR is_staff_or_admin() OR (EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id AND conversations.customer_id = auth.uid()
    ))
  );
