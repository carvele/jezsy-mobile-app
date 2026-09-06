# Audit: MOBILE — Social Layer & User Discovery

Date: 2026-09-07
Auditor: code-review-ultra (Claude)
Scope requested: "MOBILE: Social Layer & User Discovery"

## Audit Scope

Bilateral user-to-user connections (not follow/friend-asymmetric), username-based profile
discovery, gated 1:1 direct messaging, and privacy-scoped visibility of wardrobe/wishlist.
Inspected in full:

- `app/network.tsx` — My Network screen (Connections / Pending / Search tabs)
- `app/user/[id].tsx` — public-facing user profile
- `app/chat/[id].tsx` — 1:1 direct-message screen
- `app/(tabs)/profile.tsx` — own profile tab (Network entry point, share-profile deep link)
- `app/(auth)/profile-setup.tsx`, `app/profile/edit.tsx` — profile forms that write `username`
- `app/profile/privacy-settings.tsx` — wardrobe/wishlist privacy controls
- `app/product/[id].tsx` — "Loved By" social-proof block
- `supabase/migrations/20260905001100_create_connections.sql` (+ rollback)
- `supabase/migrations/20260905001200_wardrobe_privacy.sql` (+ rollback)
- `supabase/migrations/20260905001300_create_p2p_chat.sql`
- `supabase/migrations/20260905001400_rpc_get_or_create_chat.sql`
- `supabase/migrations/20260905001500_add_username.sql`
- `supabase/migrations/20260905001500_fix_direct_chat_participants_recursion.sql`
- `supabase/migrations/20260905133326_social_privacy_and_suggestions.sql`
- `supabase/migrations/20260905140000_outfit_profile_privacy.sql` (+ rollback)
- `supabase/migrations/20260905140100_outfit_items_relation.sql` (+ rollback)
- `supabase/migrations/20260905140200_get_public_outfits_for_product.sql` (+ rollback)
- `supabase/migrations/20260905150000_fix_wishlist_wardrobe_privacy_rls.sql` (+ rollback)
- `supabase/migrations/20260905180000_public_profile_accessors_for_social.sql` (+ rollback)
- `docs/architecture-conversation-record-sept-2026.md` (primary contract doc)

## Dependency Scope

Traced: `profiles` table + its owner-only RLS; `connections`, `direct_chats`,
`direct_chat_participants`, `direct_messages`, `wishlists`, `wardrobe_items`, `saved_outfits`,
`outfit_items` RLS; SECURITY DEFINER accessors (`get_public_profiles`, `search_public_profiles`,
`resolve_username`, `get_wishlist_privacy`, `get_wardrobe_privacy`, `is_blocked_between`,
`is_chat_participant`, `get_suggested_connections`, `get_outfit_privacy`,
`get_public_outfits_for_product`); realtime subscription on `direct_messages`;
`src/context/AuthContext.tsx` (session), `ToastContext`. No hooks/services layer exists for
this feature — everything is inline in route screens.

## Evidence Limitations

- `npx tsc --noEmit` crashed the local Node process with an out-of-memory fatal error before
  producing output (V8 zone allocation failure at ~14s / 500MB+ heap). This is very likely a
  pre-existing environment/repo-size issue, not something introduced by this feature — but it
  means **type-safety was verified by manual inspection of the specific files above, not by a
  full compiler pass**. Recommend re-running with `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
  or `tsc --noEmit -p tsconfig.json` scoped down, in an environment with more available memory.
- No Jest/RTL suite exists in this repo (confirmed no `test` script, no `*.test.ts` under this
  feature's files) — findings involving RLS/timing could not be executed against a live DB or
  emulator from this session; classified as CONFIRMED only where provable by static SQL/logic
  analysis, otherwise marked Unverified Hypothesis.
- Did not load the app in a device/simulator (no dev-client build available in this session) —
  UX/failure-state findings below are inferred from code paths, not observed live.

## Tests Executed

- `npx tsc --noEmit` — **crashed (OOM)**, no output obtained.
- No Jest suite exists to run (`package.json` has no `test` script for this repo, per
  `CLAUDE.md`).
- Manual static verification of each RLS policy's `USING`/`WITH CHECK` clauses against the
  client mutations that invoke them (see findings SOC-001, SOC-002 for the exact logic proof).

---

## Findings

### 🛡️ [SOC-001] Blocked users can resurrect a connection the other party blocked
- **Claim:** A user who has been blocked via `handleBlock` can undo the block themselves by
  re-sending a connection request, because the `connections` table's UPDATE policy does not
  carry the same "not blocked by the other party" exclusion that its SELECT policy has — despite
  the migration's own comment claiming it does.
- **Evidence:**
  - `supabase/migrations/20260905001100_create_connections.sql:53-66`:
    ```sql
    CREATE POLICY "Users can update their connections"
    ON public.connections FOR UPDATE
    TO public
    USING (
        (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
    )
    WITH CHECK (
        -- You can't update if you were blocked by the other person
        -- This relies on the SELECT policy already filtering out rows where you are blocked.
        (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
        AND action_user_id = auth.uid()
    );
    ```
    Compare to the SELECT policy three lines above it (`:23-31`), which *does* have the
    exclusion: `AND NOT (status = 'blocked' AND action_user_id != auth.uid())`.
  - `app/network.tsx:161-180` (`handleBlock`) performs the block via
    `.upsert({ status: 'blocked', action_user_id: user.id }, { onConflict: 'user_id_1,user_id_2' })`.
    `app/network.tsx:111-139` (`handleConnect`) and `app/user/[id].tsx:108-121` (`handleConnect`)
    perform a fresh connect via `.upsert({ status: 'pending', action_user_id: user.id }, ...)` on
    the same unique key — which resolves to an `UPDATE ... ON CONFLICT` against the *same row*
    Bob set to `blocked`.
- **Reasoning:** RLS policies are independent per command; a `FOR UPDATE` policy does not
  inherit a `FOR SELECT` policy's row filter. Postgres RLS's `UPDATE` USING-clause is the only
  gate applied to whether Alice's own UPDATE/UPSERT can touch the row — and that clause only
  checks "am I involved," not "was I the one who was blocked." So: Bob blocks Alice
  (`status='blocked', action_user_id=Bob`). Alice calls the same `handleConnect` upsert used
  everywhere else in the UI. `USING`: Alice is `user_id_1` or `user_id_2` → true. `WITH CHECK`:
  Alice is involved (true) and sets `action_user_id = auth.uid()` = herself (true). The UPDATE
  succeeds, overwriting Bob's block with `status='pending', action_user_id=Alice`.
- **Impact:** The block feature can be unilaterally defeated by the blocked party. Bob has no
  further recourse signal (the row simply flips back to pending, and per SOC-002 Alice can also
  self-accept it — see below — potentially reinstating full "accepted" access, including P2P
  chat eligibility per `direct_chat_participants`' accepted-connection check) without Bob ever
  being notified or re-consenting.
- **Recommended Fix:** Add the same exclusion to the UPDATE policy's `USING` clause:
  ```sql
  USING (
      (auth.uid() = user_id_1 OR auth.uid() = user_id_2)
      AND NOT (status = 'blocked' AND action_user_id != auth.uid())
  )
  ```
  This mirrors the SELECT policy and matches the migration comment's actual intent. Add as a
  new forward migration + `.rollback.sql` per repo convention; do not edit the shipped migration
  file in place.
- **Verification:** Provable by direct SQL policy analysis (both clauses quoted above, same
  file, 8 lines apart) — no live DB access needed to confirm the gap exists. To confirm the
  exploit path end-to-end, run as two real (non-staff) users with `SET LOCAL ROLE authenticated`
  + `request.jwt.claims` set to each uid: block A→B, then attempt the same upsert B currently
  runs in `handleConnect`, and observe it succeeds instead of raising a policy violation.

### 🛡️ [SOC-002] A user can unilaterally accept their own outgoing connection request
- **Claim:** The `connections` UPDATE policy never checks that the accepting user differs from
  the request's original sender, so a user can send a pending request and immediately flip it to
  `accepted` themselves, without the other party's consent.
- **Evidence:** Same policy as SOC-001
  (`supabase/migrations/20260905001100_create_connections.sql:53-66`). `WITH CHECK` only
  requires `action_user_id = auth.uid()` on the new row — it never compares against the row's
  prior `action_user_id` or `status`. The UI-side gate at `app/network.tsx:201-208` (`Accept`
  button only rendered when `item.action_user_id !== user?.id`) is a client-side convenience,
  not a security boundary — `handleAccept` (`app/network.tsx:141-159`) issues a plain
  `.update({ status: 'accepted', action_user_id: user.id }).eq('user_id_1', u1).eq('user_id_2', u2)`
  that any authenticated client can call directly with `u1`/`u2` for their own outgoing request.
- **Reasoning:** Alice inserts `(status='pending', action_user_id=Alice)` via `handleConnect`.
  Alice then calls the exact same update Bob would use to accept, substituting her own id — RLS
  has no way to distinguish "Bob accepting Alice's request" from "Alice accepting her own
  request" because it never inspects `OLD.action_user_id`.
- **Impact:** The entire "mutual consent" premise of the bilateral-connections design
  (`docs/architecture-conversation-record-sept-2026.md` Section 4, "not follow") is bypassable —
  a user can force a one-sided "accepted" connection with anyone who hasn't blocked them,
  unlocking connections-gated wardrobe/wishlist visibility and P2P chat eligibility
  (`direct_chat_participants` INSERT policy only checks `status = 'accepted'`, not who set it)
  without the target ever clicking Accept.
- **Recommended Fix:** Add a trigger (RLS `WITH CHECK` cannot see `OLD` directly in a portable
  way across all Postgres versions used here, so a `BEFORE UPDATE` trigger is the safer fix)
  rejecting a transition to `accepted` when `OLD.action_user_id = auth.uid()` and `OLD.status =
  'pending'`:
  ```sql
  CREATE OR REPLACE FUNCTION public.prevent_self_accept()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.status = 'accepted' AND OLD.status = 'pending' AND OLD.action_user_id = auth.uid() THEN
      RAISE EXCEPTION 'Cannot accept your own connection request';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

  CREATE TRIGGER connections_prevent_self_accept
  BEFORE UPDATE ON public.connections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_accept();
  ```
- **Verification:** Provable by static policy analysis. To confirm live: as Alice, insert a
  pending request to Bob, then run the same update `handleAccept` would run but with Alice's own
  session — expect it to now raise instead of succeeding.

### 🟠 [SOC-003] Per-pair block is not enforced by profile discovery RPCs
- **Claim:** `get_public_profiles`, `search_public_profiles`, and `resolve_username` only filter
  on the global `profiles.is_blocked` flag (an admin/moderation flag), not on
  `connections.status = 'blocked'` between the two specific users — unlike wishlist/wardrobe/
  outfit visibility, which all correctly use the `is_blocked_between()` accessor added in the
  same feature.
- **Evidence:**
  `supabase/migrations/20260905180000_public_profile_accessors_for_social.sql:14-26, 31-47,
  52-62` — each function's `WHERE` clause has `AND COALESCE(p.is_blocked, false) = false` and
  nothing referencing `connections`. Contrast with
  `supabase/migrations/20260905150000_fix_wishlist_wardrobe_privacy_rls.sql:70-75`, which does
  `AND NOT public.is_blocked_between((select auth.uid()), wishlists.user_id)`.
- **Reasoning:** Bob blocks Alice via `app/network.tsx` (`connections.status = 'blocked'`,
  which is a per-pair relationship, distinct from the global moderation `is_blocked` column).
  Alice's `connections` SELECT row for that pair is now hidden from her (per the SELECT policy's
  own exclusion), so `app/user/[id].tsx:57-71` sees `connData = null` and does **not** set
  `accessDenied`. Alice can still: search for Bob by name/username
  (`search_public_profiles`), resolve `@bob` to his id (`resolve_username`), and fetch his
  display profile (`get_public_profiles`) — and the UI will render a "Connect" button, since
  `connection?.status !== 'accepted'` is true when `connection` is `null`.
- **Impact:** Blocking someone does not stop them from finding you via Search or a shared
  `@username` link, or seeing your name/avatar on your profile card — only wardrobe/wishlist
  content is actually hidden (via the correctly-implemented `is_blocked_between()` path). This
  contradicts the intended behavior implied by the block feature's UI copy ("User blocked") and
  the architecture doc's permission matrix.
- **Recommended Fix:** Add `AND NOT public.is_blocked_between(auth.uid(), p.id)` (or the
  equivalent for the array/id-based variants) to `get_public_profiles`,
  `search_public_profiles`, and use it inside `resolve_username` to return `NULL` for a blocked
  pair.
- **Verification:** Provable by comparing the two migrations' `WHERE` clauses directly (both
  quoted above). To confirm live: block a test user, then call `search_public_profiles` as the
  blocked user with the blocker's name — expect it to still appear (defect confirmed) vs. not
  appear (after fix).

### 🟠 [SOC-004] "Wardrobe" section reads `wishlists`, gated by the wrong privacy column
- **Claim:** `app/user/[id].tsx`'s "Wardrobe" section title and copy describe the wardrobe, but
  the query and privacy gate both operate on the wishlist data/setting, not the wardrobe's.
- **Evidence:** `app/user/[id].tsx:70` passes `profileRows[0].wardrobe_privacy` into
  `loadWardrobe`; `loadWardrobe` (`:81-106`) gates on that `wardrobe_privacy` value, but its
  actual query at `:94-97` is `supabase.from('wishlists').select('*, product:products(*)').eq('user_id', targetId)`.
  The section header at `:173` reads `"Wardrobe"`.
- **Reasoning:** A user who sets `wishlist_privacy = 'public'` (intending strangers to see their
  saved items, per the copy in `app/profile/privacy-settings.tsx:178`) but leaves
  `wardrobe_privacy = 'private'` (the default) will find their "public" wishlist rendered as
  invisible on their own profile page (`accessDenied` fires because the checked field —
  `wardrobe_privacy` — is `'private'`), even though the DB-level RLS on `wishlists` (which
  correctly checks `wishlist_privacy`) would have allowed the fetch to succeed structurally.
  Conversely a user who sets `wardrobe_privacy = 'connections'` but `wishlist_privacy =
  'private'` would have their private wishlist exposed to any accepted connection, believing
  only their (currently-empty, since there's no wardrobe UI reachable here) wardrobe was shared.
- **Impact:** Direct privacy-setting/behavior mismatch — the screen enforces a different privacy
  contract than the one the user configured and than the one the underlying RLS policy actually
  checks (`get_wishlist_privacy`), producing wrong-audience exposure or wrong-audience denial
  depending on which two settings diverge.
- **Recommended Fix:** Change `:70` to pass `profileRows[0].wishlist_privacy` (requires adding
  `wishlist_privacy` to `get_public_profiles`'s return columns, currently only returns
  `wardrobe_privacy` per the accessor migration) and rename the section to "Wishlist" — or, if
  "Wardrobe" is meant to eventually show `wardrobe_items`, swap the table in the query instead
  and keep gating on `wardrobe_privacy`. Confirm which was intended with the user before fixing.
- **Verification:** Set `wishlist_privacy='public'`, `wardrobe_privacy='private'` on a test
  account with ≥1 wishlist item; view that profile as a stranger — item list should show per the
  "public wishlist" setting but currently will not (defect reproduces).

### 🔴 [SOC-005] No UI path to ever set a username; DB requires lowercase, client never enforces it
- **Claim:** Both profile-writing screens declare and upsert a `username` field but render no
  input control for it, so a user can never set their own `@username` through the app — breaking
  every discovery feature that depends on it (Search-by-username, `resolve_username`,
  share-profile deep links).
- **Evidence:** `app/(auth)/profile-setup.tsx:64,103,230` and `app/profile/edit.tsx:49,72,136`
  all reference `username` in state/upsert payloads; grepping both files for `username` finds no
  `TextInput`/`onChangeText` binding for it (only the three state-management lines above appear
  in each file). `app/(tabs)/profile.tsx`'s `handleShareProfile()` builds a
  `user/@{username}` deep link assuming one exists. The DB enforces
  `profiles_username_lowercase_chk CHECK (username = lower(username))`
  (`supabase/migrations/20260905133326_social_privacy_and_suggestions.sql:7`), but neither
  screen's upsert (`profile-setup.tsx:230`, `profile/edit.tsx:136`) calls `.toLowerCase()` on the
  value before writing it — currently harmless only because no input path exists to produce a
  mixed-case value in the first place.
- **Reasoning:** Without a way to set `username`, it stays `NULL` (or whatever was seeded) for
  every user who signs up after this feature shipped. Search results, profile links, and
  `@username` sharing all depend on a populated, unique username.
- **Impact:** The entire discovery/sharing surface of this feature is unreachable for any user
  who doesn't already have a username set by some other means (e.g. a DB seed/backfill). This is
  the single highest-impact functional gap found in this audit.
- **Recommended Fix:** Add a `TextInput` bound to the existing `username` state in both screens,
  with client-side `.toLowerCase()` normalization and inline availability/format validation
  before the upsert, matching the DB constraint. Confirm with the user whether this was
  mid-implementation (removed for iteration) or an oversight before adding it back.
- **Verification:** Manual: open profile-setup and profile/edit in a running build, confirm no
  username field is visible; grep confirms no `TextInput` references `username` in either file.

### 🏗️ [SOC-006] "Loved By" social-proof block is fully dead code, tripled
- **Claim:** `app/product/[id].tsx`'s "Social Proof: Loved By" JSX block can never render (its
  gating state is never set above zero), and the same block is duplicated verbatim three times
  in the file.
- **Evidence:** `lovedByCount`/`lovedByUsers` are declared at `app/product/[id].tsx:60-61` via
  `useState(0)`/`useState([])`; a full-file grep for their setters (`setLovedByCount`,
  `setLovedByUsers`) finds zero call sites anywhere in the file. The gated block
  (`{lovedByCount > 0 && (...)}`) appears three times, at lines ~397-427, ~428-458, ~459-489.
- **Reasoning:** Since the count is never incremented from its `0` initial value, `lovedByCount
  > 0` is always false — the block, and its tripled copy, never render and cannot be reached by
  any user interaction.
- **Impact:** No user-facing defect today (dead code renders nothing), but it's ~90 lines of
  duplicated, unreachable JSX that will confuse future maintainers into thinking "Loved By" is
  live, and triples the maintenance cost of ever wiring it up correctly.
- **Recommended Fix:** Either wire up the data fetch (likely a `wishlists` count/join query
  respecting `wishlist_privacy='public'`, consistent with the copy in
  `privacy-settings.tsx:178`) once, in one place, or remove the dead block entirely until it's
  ready to ship.
- **Verification:** Grep-confirmed (setter call count = 0); no live testing needed since the
  code is unreachable by construction.

### 🏗️ [SOC-007] Two fully-built backend features have no client caller
- **Claim:** `get_suggested_connections()` and `get_public_outfits_for_product()` are complete,
  RLS-safe SECURITY DEFINER RPCs with correct exclusion logic, but neither is invoked from any
  client code.
- **Evidence:** `app/network.tsx:43-44` declares `suggestedUsers`/`suggestedLoading` state that
  is never populated (no call site for `get_suggested_connections` found in the app tree, per
  scoping search). `get_public_outfits_for_product`
  (`supabase/migrations/20260905140200_get_public_outfits_for_product.sql`) likewise has no
  caller.
- **Impact:** Half-shipped feature surface — not a defect, but worth flagging so it isn't
  mistaken for "already delivered" when checking feature completeness against the architecture
  doc's Section 5/7 plans.
- **Recommended Fix:** Either wire the Search tab's suggestions section to
  `get_suggested_connections` (the state scaffolding already exists) and the product page to
  `get_public_outfits_for_product` ("Styled By"), or track both explicitly as not-yet-started in
  the thesis/feature tracker rather than as done.
- **Verification:** Confirmed absent via scoping search across `app/`, `src/`, `components/`,
  `hooks/` for both RPC names as call sites.

### 🟠 [SOC-008] Privacy settings screen doesn't expose two DB-level privacy columns
- **Claim:** `profiles.outfit_privacy` and `profiles.profile_visibility`
  (`supabase/migrations/20260905140000_outfit_profile_privacy.sql`) exist and are enforced by
  RLS on `saved_outfits`, but `app/profile/privacy-settings.tsx` only renders controls for
  `wardrobe_privacy` and `wishlist_privacy`.
- **Impact:** Users have no way to change their outfit-visibility default from whatever the
  column default is — a silent gap between what the DB supports and what the UI lets a user
  control.
- **Recommended Fix:** Add a third settings card for outfit/profile visibility, or confirm this
  is intentionally deferred until "Styled By" (SOC-007) ships and note it in the architecture
  doc as a known sequencing choice rather than a gap.
- **Verification:** Confirmed by grep — `outfit_privacy`/`profile_visibility` do not appear
  anywhere under `app/profile/`.

### 🔬 [SOC-009] Possible message-delivery gap between initial load and realtime subscribe (Unverified Hypothesis)
- **Claim:** `app/chat/[id].tsx` fetches message history once (`loadMessages`, triggered from
  `initChat`) before the realtime channel subscription for new inserts is established (a
  separate `useEffect` keyed on `chatId`, `:34-53`), so a message sent by the other party in the
  window between the initial fetch resolving and `.subscribe()` completing could be missed until
  the screen is reopened.
- **Reasoning:** React effect ordering means the `chatId`-keyed effect (which creates the
  channel) runs after the state update from `initChat` that set `chatId`, and
  `supabase.channel(...).subscribe()` is asynchronous — there is no guarantee the subscription is
  live before another client's INSERT lands.
- **Impact (if real):** A missed message that only appears on next chat open, not immediately —
  minor but user-visible if it occurs.
- **Recommended Fix:** Not proposing a change without confirming the gap is real — Supabase
  Realtime's actual subscribe-then-catch-up semantics would need to be checked against the SDK
  version in use before changing anything.
- **Verification:** **Unverified Hypothesis** — could not be reproduced without a running
  two-client session in this audit; flagging for manual/live testing rather than as a confirmed
  defect.

### 🔬 [SOC-010] Errors are swallowed to `console.log` with no remote observability (Unverified severity)
- **Claim:** Every catch block across `network.tsx`, `user/[id].tsx`, `chat/[id].tsx` logs to
  `console.log` (not even `console.error`) and shows a generic toast, with no capture to a crash/
  error-reporting service.
- **Evidence:** e.g. `app/network.tsx:88-89, 104-105, 136-137, 156-157, 177-178`;
  `app/user/[id].tsx:72-74, 101-102`; `app/chat/[id].tsx:108-110, 124-125, 155-156`.
- **Impact:** Production failures in this feature (RLS denials, RPC errors, realtime drops) are
  undiagnosable after the fact — there's no way to know how often `handleConnect`/`handleAccept`/
  message sends are failing in the field.
- **Recommended Fix:** Route these catch blocks through the project's existing error-reporting
  path (Sentry is available in this environment per the connected tool list) instead of
  `console.log`, at minimum for the mutation paths (connect/accept/block/send-message).
- **Verification:** Confirmed by inspection (no `Sentry.*` or equivalent call anywhere in these
  three files); classifying as Architecture Concern rather than Actual Defect since silent
  console logging is a pattern used elsewhere in this codebase too (not unique to this feature) —
  worth a broader decision, not a one-off fix.

### ✓ No substantiated finding — Dimensions checked with no issue found
- **Cross-Feature Contract (chat ↔ connections):** `direct_chat_participants` and
  `direct_messages` INSERT policies correctly require an `accepted` connection between all
  participants (`supabase/migrations/20260905001300_create_p2p_chat.sql:67-82, 97-117`), and the
  infinite-recursion fix (`...001500_fix_direct_chat_participants_recursion.sql`) correctly
  dropped the old self-referential policies before introducing `is_chat_participant()` — no
  leftover duplicate/conflicting policy found.
- **Mark-as-read RPC:** `mark_direct_message_read` correctly validates chat participancy, is a
  no-op for the sender, and only ever writes `read_at` — properly narrowed after the
  `col = col` tautology bug was fixed in the same migration that introduced it historically (not
  a live issue in the current schema).
- **Idempotency of duplicate-connect:** `handleConnect`'s plain `.insert(...)` correctly handles
  the `23505` unique-violation case with a friendly toast (`app/network.tsx:126-131`,
  `app/user/[id].tsx` upsert form) rather than crashing.
- **Self-connection:** DB-level `connections_no_self` CHECK constraint prevents a user from
  connecting to themselves; not reachable from the UI either (`profile.id !== user?.id` guards
  the Connect button in `user/[id].tsx:153`).
- **UUID ordering consistency:** Client-side `user.id < targetId` string comparison
  (`app/network.tsx:114-115`, `app/user/[id].tsx:55-56,110-111`) is consistent with Postgres's
  `uuid` type ordering (byte-wise, which matches lowercase-hex lexicographic string ordering) and
  with the `connections_user_order` CHECK constraint — no ordering-mismatch defect found.

---

## Severity Summary

| ID | Severity | Title |
|---|---|---|
| SOC-001 | 🛡️ Security/Data Integrity | Blocked users can undo the block via upsert |
| SOC-002 | 🛡️ Security/Data Integrity | Self-acceptance of own connection request |
| SOC-003 | 🟠 Contract Violation | Per-pair block not enforced in profile discovery RPCs |
| SOC-004 | 🟠 Contract Violation | "Wardrobe" section reads wishlists, gated by wrong privacy field |
| SOC-005 | 🔴 Actual Defect | No UI path to ever set a username |
| SOC-006 | 🏗️ Architecture Concern | Dead "Loved By" block, tripled |
| SOC-007 | 🏗️ Architecture Concern | Two backend RPCs built but never called |
| SOC-008 | 🟠 Contract Violation | Privacy settings missing outfit/profile-visibility controls |
| SOC-009 | 🔬 Unverified Hypothesis | Possible chat realtime subscribe race |
| SOC-010 | 🏗️ Architecture Concern | No remote error observability for this feature's mutations |

**Test coverage:** 0% — no automated tests exist for connections, chat, privacy RLS, or username
resolution (consistent with this repo's stated no-test-suite convention, but noted since it means
none of these findings have a regression safety net once fixed).

**Note:** `docs/architecture-record-sept-2026.md` and
`docs/architecture-conversation-record-sept-2026.md` appear to be a near-duplicate draft/final
pair — confirm which is canonical before treating either as the authoritative contract for
future audits of this feature.
