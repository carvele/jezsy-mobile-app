-- Migration: Consolidate redundant RLS policies; close a message-injection hole
--
-- DB_AUDIT_2026-07-20.md finding 10 (policy sprawl). Overlapping generations
-- of policies OR together, so the broadest always wins and auditing any table
-- means reading 4-6 policies to figure out the effective rule.
--
-- Each policy dropped below was verified to be a STRICT SUBSET of a policy
-- that remains, by comparing the actual live expressions -- so dropping it
-- removes no access from anyone. Two of them additionally tighten security as
-- a side effect: the "Customers can view/update own conversations" pair
-- checked profiles.role WITHOUT `deleted = false`, so a soft-deleted admin
-- satisfied them; the surviving is_staff_or_admin() does check it.
--
-- Dropped (redundant subsets):
--   categories    "Allow public read of categories"          == "Public read categories" (both USING true)
--   products      "Enable read access for all users"         == "Public read products"   (both USING true)
--   conversations "Customers can insert own conversations"   ⊂ "Enable insert for own conversation or admin"
--   conversations "Customers can view own conversations"     ⊂ "Enable select for own conversation or admin"
--   conversations "Customers can update own conversations"   ⊂ "Enable update for own conversation or admin"
--   messages      "Users can view messages in their conversations" ⊂ "Enable select for messages ..."
--   orders        "Users can view own orders"                ⊂ "Enable select for own orders or staff"
--   orders        "Users can view their own orders"          ⊂ "Enable select for own orders or staff"
--   reviews       "Users can manage their own reviews"       ⊂ "Enable all access for own reviews or admin"
--
-- ── SECURITY FIX (not a consolidation) ──────────────────────────────────────
-- "Enable insert for messages in own conversation or admin" had:
--     WITH CHECK (sender_id = auth.uid() OR is_staff_or_admin() OR <conv is mine>)
-- The first disjunct stands alone, so ANY authenticated user could insert a
-- message into ANY conversation_id -- including a stranger's private
-- conversation -- simply by setting sender_id to their own id. The victim
-- would see the injected message in their thread. The narrower policy that
-- OR-ed alongside it ("Users can insert messages in their conversations",
-- which correctly required uid = sender AND the conversation to be theirs)
-- could never restrict this, because permissive policies only ever widen.
--
-- Replaced with a rule that requires BOTH sender identity and conversation
-- membership. Verified against both clients:
--   * mobile sends sender_id = session.user.id into its own conversation
--     (MessagesContext.tsx:76-77) -> passes the customer branch.
--   * admin sends sender_id = staffUser?.uid ?? null, i.e. possibly NULL,
--     into any customer's conversation (customerService.js:175) -> passes the
--     staff branch, which is why that branch cannot require a sender match.

DROP POLICY IF EXISTS "Allow public read of categories" ON public.categories;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.products;

DROP POLICY IF EXISTS "Customers can insert own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Customers can view own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Customers can update own conversations" ON public.conversations;

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON public.messages;

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;

DROP POLICY IF EXISTS "Users can manage their own reviews" ON public.reviews;

DROP POLICY IF EXISTS "Enable insert for messages in own conversation or admin" ON public.messages;
CREATE POLICY "Enable insert for messages in own conversation or admin"
  ON public.messages FOR INSERT
  WITH CHECK (
    is_staff_or_admin()
    OR (
      sender_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = messages.conversation_id
          AND c.customer_id = auth.uid()
      )
    )
  );
