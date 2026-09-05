# JezSy Feature & Architecture Conversation Record

**Product, privacy, social, onboarding, commerce, and review-system decisions**

**Conversation documented:** September 2026

**Purpose.** This document consolidates the feature proposals and architectural review decisions discussed in this chat into one internal product/engineering record. It is not a verbatim transcript; it preserves the plans, risks, recommendations, and implementation stance that emerged from the conversation.

## Executive Summary

- **Core product direction:** Keep JezSy centered on fashion utility and wardrobe intelligence. Social features should emerge from existing user actions rather than turn the product into a generic social network.
- **Social architecture:** Shift the primary social object from the user/wardrobe to the Outfit. Public profiles and connections support discovery, but outfits are the main unit of sharing, inspiration, commerce, and future remixing.
- **Privacy model:** Separate visibility controls by object: profile, wardrobe, outfit, wishlist. Avoid inferring one kind of public consent from another.
- **Authorization principle:** RLS and database constraints are the source of truth. The mobile UI may hide actions, but it must never be the only security boundary.
- **Onboarding:** Retain the three-tier model (pre-auth onboarding, post-auth orientation, contextual feature hints), while centralizing hint state and moving toward versioned, user-scoped discovery.
- **Commerce signals:** Wishlist and review-voting signals are useful, but should be privacy-safe, analytically meaningful, and backed by authoritative database aggregation.
- **Recommendation systems:** The deterministic Style Advisor is a strength. Preserve explainability, but evolve its scoring model from hardcoded occasion boosts toward richer garment and behavior signals.

| Area | Current Direction | Implementation Stance |
|---|---|---|
| **Admin Wishlist** | Customer preference + product demand visibility | Proceed after data/RLS/performance checks |
| **System Guide** | Three-tier onboarding/discovery | Keep; evolve to centralized/versioned discovery |
| **Feature Hints** | User-scoped AsyncStorage keys | Proceed |
| **P2P Social** | Connections + separate direct chat + privacy | Revise security/permission model before SQL |
| **Passive Discovery** | Suggestions + profile sharing + social proof | Proceed with privacy revisions |
| **Virtual Stylist** | Wardrobe + outfit builder + deterministic advisor | Strong core; use as social foundation |
| **Outfit-First Social** | Outfit privacy + public outfit discovery | Proceed after RLS/data-model refinement |
| **Review Voting** | Per-user votes + cached counters + optimistic UI | Proceed after RLS/RPC hardening |

---

## 1. Admin Dashboard Wishlist Integration

**Original goal.** Reflect mobile Wishlist data inside the Admin Dashboard so staff can understand customer intent and identify popular products beyond reservations.

**Proposed scope**
- `customerService.js`: extend `getCustomerStatsBatch` with wishlist count and recent wishlist items; incorporate wishlist activity into engagement score.
- `productService.js`: add `getMostWishlistedProducts()`.
- `Customers.jsx`: add a Wishlisted customer stat and recent wishlist section.
- `Analytics.jsx`: add Top Wishlisted / Most Hearted catalog insight.

**Architectural review**
- **Bound customer detail queries:** Recent wishlist items should be limited (for example 5-10) and deterministically ordered by creation time; do not return the entire wishlist through batch stats.
- **Avoid query growth in a monolithic batch function:** If `getCustomerStatsBatch` is already doing many joins/aggregations, consider a dedicated wishlist stats query and compose the result.
- **Avoid N+1 product lookups:** `getMostWishlistedProducts()` should return enough product metadata for the UI, not only product IDs and counts.
- **Engagement score needs semantic clarity:** Wishlist size is a signal of interest, not necessarily recent activity. If used in the score, cap it and document the meaning; ideally distinguish recent intent from historical accumulation.
- **Analytics should compare intent with conversion:** Wishlist count is stronger when shown beside reservations or conversion rate, so operators can distinguish strong demand from conversion friction.
- **RLS and admin access must be verified:** Customer-specific behavioral data should only be visible through the intended admin authorization path.

**Decision: APPROVE DIRECTION, REVISE IMPLEMENTATION DETAILS BEFORE BUILDING.**

---

## 2. Onboarding, System Tour & Feature Discovery

**Current architecture.** JezSy uses three layers: initial pre-auth onboarding, a post-auth system tour, and just-in-time feature hints.

| Layer | Purpose | State Model |
|---|---|---|
| **Initial onboarding** | Explain why JezSy exists | Device-level AsyncStorage flag |
| **System tour** | Explain core areas after login | User-scoped AsyncStorage flag |
| **Feature hints** | Explain how to use complex features at first use | Historically fragmented per-screen keys |

**Review: what should stay**
- Keep the three-tier progression: WHY -> WHAT -> HOW.
- Do not teach AR mechanics in the initial carousel; complex operational guidance belongs at first use or during runtime.
- Keep onboarding optional/skippable and do not make tutorials the only way to discover features.

**Industry-standard evolution**
- **Shorter orientation:** Move from a four-step product manual toward a concise choose-your-path orientation: Discover styles, Try something on, Explore wardrobe, Get help.
- **Progressive disclosure:** Teach only the feature relevant to the user’s current intent.
- **Discovery state instead of a single seen flag:** Long term, distinguish exposed, acknowledged, visited, used, completed, and returned states.
- **Event-driven hints:** Trigger guidance when the feature is actually ready/relevant, not simply because a screen mounted.
- **Replayable help:** Provide a Help & Guidance area so skipped or forgotten onboarding can be revisited.
- **Least-disruptive surface:** Prefer inline help, then coachmarks, bottom sheets, modals, and only then full-screen tutorials.
- **Version education:** Feature guidance should be versioned so material changes can legitimately reintroduce a hint.
- **Accessibility:** Modal focus/reading order, dynamic type, contrast, reduced motion, large targets, and escape/back behavior should be treated as first-class requirements.

---

## 3. Consolidated, User-Scoped Feature Hints

**Plan.** Replace ad hoc keys such as `ar_hint_seen` and `body_scan_hint_seen` with a centralized `firstUseHints.ts` utility using user + feature + version scoped keys.

```text
@jezsy_feature_hint:{userId}:{featureId}
Examples:
@jezsy_feature_hint:<user>:ar_try_on:v1
@jezsy_feature_hint:<user>:body_scan:v1
```

**Approved changes**
- Centralize `hasSeenHint(userId, featureId)` and `markHintSeen(userId, featureId)`.
- Remove direct AsyncStorage access from Body Scan and AR Try-On screens.
- Use versioned IDs (`ar_try_on:v1`, `body_scan:v1`).
- Keep first-use education separate from runtime camera/pose guidance.
- Test account switching A -> B -> A and app relaunch persistence.
- Test version transition v1 -> v2 so new guidance can reappear when appropriate.

**Caveats**
- Do not conflate “no authenticated user” with “user has already seen the hint.” If guest users are ineligible, document that as eligibility behavior.
- Verify user-facing AR terminology matches the actual UI; avoid internal phrases such as “2D pose guidance overlay” if the user does not see that wording.
- Verify privacy claims such as “processed securely on-device” against the actual implementation before putting them in product copy.

**Decision: PROCEED. Low-risk architectural cleanup with meaningful correctness benefits.**

---

## 4. P2P Connections, Direct Chat & Wardrobe Privacy

**Feature goal.** Introduce a user-to-user social layer while preserving the existing customer-to-staff support conversation system.

**Strong decisions**
- Keep P2P chat separate from the existing support `conversations` model.
- Default wardrobe visibility to `private` for existing users.
- Enforce wardrobe access through RLS, not client-side checks.
- Use Supabase Realtime only after participant/relationship authorization is established.

**Recommended data model**
- `connections`
- `direct_chats`
- `direct_chat_participants`
- `direct_messages`
- `profiles.wardrobe_privacy`

- **Prefer relational participants:** Use `direct_chat_participants(chat_id, user_id)` instead of a participants array.
- **Connection invariants:** Prevent self-connections and duplicate/inverse relationship rows. Define accepted as a bilateral relationship once the receiver accepts.
- **Block semantics:** Define effects on search, profile visibility, wardrobe access, existing chat, future requests, and message sending.
- **Profile discovery is separate from wardrobe privacy:** Who can find me and who can see my wardrobe are distinct product decisions.
- **Avoid email search by default:** Prefer username/display name. Email-based discovery should require explicit opt-in if introduced.
- **Chat retention policy:** Define what happens to history after disconnect, block, account deletion, and message deletion.

**Required permission matrix**

| Action | Owner | Accepted Connection | Non-connection | Staff | Blocked |
|---|---|---|---|---|---|
| View private wardrobe | Yes | No | No | Policy decision | No |
| View connections wardrobe | Yes | Yes | No | Policy decision | No |
| View public wardrobe | Yes | Yes | Yes | Policy decision | No |
| Send P2P message | N/A | Yes | No | Separate support system | No |
| Read direct messages | Participant | Participant | No | No by default | No |
| Send connection request | N/A | N/A | Yes if allowed | N/A | No |

**Decision: FEATURE DIRECTION APPROVED; DO NOT EXECUTE SECURITY-SENSITIVE SQL UNTIL THE AUTHORIZATION CONTRACT IS PRECISE.**

---

## 5. Passive Social Discovery

**Proposed features.** Suggested For You, shareable profile links, and product-page social proof (“Loved By”).

**Suggested For You**
- Use friends-of-friends first, then a privacy-safe fallback based on internal activity signals.
- Exclude self, blocked users (both directions), existing connections, pending requests, deactivated accounts, and users who opt out of discovery.
- Do not expose precise “recently active” timestamps; use activity only as an internal ranking signal.
- Prefer a recommendation RPC that derives the caller from `auth.uid()` rather than accepting an arbitrary `p_user_id`.
- If `SECURITY DEFINER` is truly needed, treat it as a privileged API endpoint: restrict execution, set a safe search path, and ensure results cannot bypass privacy rules.

**Shareable profile links**
- Use human-readable `@username` public links while retaining UUID support internally/backward-compatibly.
- Enforce username uniqueness and decide case-insensitive normalization rules.
- Handle invalid/deleted usernames safely.

**Loved By privacy correction**
- **Key decision:** A public wardrobe does not imply consent to publish wishlist behavior.
- `wardrobe_privacy != wishlist_privacy`
- Introduce independent wishlist visibility if named wishlist activity will become social.
- Prefer aggregate proof first: “12 people saved this.”
- Show individual names/avatars only for users who explicitly opted into public wishlist activity.
- Avoid introducing “follow” terminology unless JezSy intentionally adds a second social graph beyond bilateral connections.

**Decision: PROCEED WITH SUGGESTIONS + PROFILE SHARING. REVISE “LOVED BY” TO USE INDEPENDENT, EXPLICIT WISHLIST VISIBILITY.**

---

## 6. Virtual Stylist, Digital Wardrobe & Outfit Builder

**Current product core.** JezSy already has a rich wardrobe system, a freeform Outfit Builder, and a deterministic Style Advisor. These should be treated as the foundation of the social roadmap, not isolated features.

**Digital Wardrobe strengths**
- Inventory, saved outfits, capsules, mannequin view, persisted tabs, filtering, gap analysis, and wardrobe stats create a strong personal-fashion data layer.
- Future wardrobe intelligence can add cost-per-wear, most/least worn, recent wear, category distribution, favorite colors/brands, and utilization metrics.

**Outfit Builder strengths**
- Combines wardrobe, wishlist, and catalog items into a structured look.
- Canvas mode, local background removal, harmony scoring, view-shot sharing, and structured Supabase saves already produce a natural social artifact.
- The outfit is more expressive and privacy-safe as a social object than the full wardrobe.

**Style Advisor review**
- **Preserve deterministic recommendations:** The current no-LLM architecture is fast, explainable, and appropriate.
- **Evolve hardcoded rules:** Move from category boosts such as “outerwear +10 for work” toward garment attributes: formality, season, material, silhouette, style tags, and richer occasion compatibility.
- **Keep weights flexible:** Do not let 80% color harmony / 20% neglect become permanent architecture. Treat scoring signals independently so they can evolve.
- **Learn from behavior without requiring an LLM:** Wishlist, wear history, saved outfits, repeated style choices, and engagement can become user preference signals.
- **Use positive UX language:** Internally “neglected” can be a metric; user-facing copy should say “Try something you haven’t worn lately.”

**Product-loop conclusion**
Discover -> Catalog/Wishlist -> Wardrobe -> Outfit Builder -> Style Advisor -> Save -> Share -> Social Discovery -> Inspiration -> Recreate/Shop

**Strategic decision: THE OUTFIT SHOULD BECOME JEZSY’S PRIMARY SOCIAL OBJECT.**

---

## 7. Outfit-First Social Architecture

**Plan.** Add granular profile/outfit privacy, prepare product-to-outfit discovery (“Styled By”), and set the foundation for future Remix functionality.

**Privacy granularity**
- `profile_visibility`
- `wardrobe_privacy`
- `outfit_privacy`
- `wishlist_privacy`

- Default `outfit_privacy` to private so existing saved outfits never become public accidentally.
- Define exactly what a private profile means for search, deep links, avatar/name visibility, connection requests, and outfit visibility.
- The outfit owner must always retain access to private outfits.
- Blocked relationships should override otherwise-public social visibility if that is the intended policy.

**Styled By data model**
- **Concern.** Querying product IDs embedded inside a JSON items array can work as a temporary bridge, but it is not the strongest long-term foundation for product-to-outfit discovery.
- **Preferred long-term relation:**
  - `saved_outfits 1---N outfit_items`
  - `outfit_items(outfit_id, product_id, slot, ...)`
- A relational `outfit_items` table makes “all public outfits containing Product X” a normal indexed many-to-many query.
- Separate privacy migrations from product/outfit indexing/query migrations for cleaner history and rollback reasoning.
- Use RPC only where it adds a clear authorization/API boundary; avoid unnecessary `SECURITY DEFINER`.
- If public outfit contents include an item from a user’s wishlist, publishing the outfit should not automatically reveal that the user wishlisted the item.

**Rollout order**
1. Privacy foundations
2. Public profiles
3. Public outfits / outfit detail as a social page
4. Styled By product sections
5. Connections
6. Remix this look
7. Direct chat

**Decision: APPROVE THE OUTFIT-FIRST DIRECTION AFTER RLS, PROFILE-VISIBILITY SEMANTICS, AND DATA-MODEL REFINEMENT.**

---

## 8. Product Review Voting (Like/Dislike / Helpful)

**Core plan.** Add one vote per user per review, cached like/dislike counters on `reviews`, an RPC that returns each review with the current user’s vote, and optimistic mobile interactions.

**Recommended schema**
- `reviews`: `likes_count >= 0`, `dislikes_count >= 0`
- `review_votes`: `id`, `review_id -> reviews(id) ON DELETE CASCADE`, `user_id -> profiles(id) ON DELETE CASCADE`, `vote_type CHECK (like|dislike)`, `created_at`, `updated_at`, `UNIQUE(review_id, user_id)`

**Database behavior**

| Transition | likes_count | dislikes_count |
|---|---|---|
| Insert like | +1 | 0 |
| Insert dislike | 0 | +1 |
| Like -> dislike | -1 | +1 |
| Dislike -> like | +1 | -1 |
| Delete like | -1 | 0 |
| Delete dislike | 0 | -1 |

- Use trigger-maintained counters for fast review reads; keep updates delta-based.
- Add non-negative constraints as an integrity safety net.
- Do not expose every `review_votes` row unless there is a real product requirement. Users need aggregate counts plus their own vote, not everyone’s voting identity.
- An RPC returning reviews + aggregate counts + `my_vote` is a clean client contract.
- Consider a mutation RPC (`vote_on_review`) if the team wants voting transitions and authorization centralized in the database API.

**Client interaction**
- Standard toggle behavior is approved: empty -> like/dislike; active -> remove; switching thumbs replaces the existing vote.
- Use optimistic local updates for responsiveness, but roll back on failure.
- Protect against rapid tap races using a per-review mutation lock or latest-intent reconciliation.
- If using upsert, target the `(review_id, user_id)` uniqueness constraint explicitly.

**Product semantics**
- Define whether authors can vote on their own review; recommendation was no.
- For commerce reviews, “Helpful / Not Helpful” may be semantically stronger than generic Like / Dislike because it measures decision usefulness rather than popularity.
- Leave room for future abuse controls if vote counts ever influence ranking or moderation.

**Decision: APPROVE AFTER RLS/RPC PRIVACY HARDENING AND CONCURRENCY/ROLLBACK TESTS.**

---

## 9. Cross-Cutting Architecture Principles

1. **Database-authoritative security:** RLS, constraints, and server-side authorization must enforce privacy and identity boundaries even if the mobile UI is bypassed.
2. **Separate privacy by object:** Profile, wardrobe, outfit, and wishlist visibility represent different user choices; one must not silently grant another.
3. **Prefer relational modeling for core query surfaces:** JSON is useful for flexible payloads, but many-to-many relationships that power discovery should migrate toward indexed relational tables.
4. **Centralize state machines:** Feature hints, connection status, vote state, and social visibility should each have one canonical interpretation across UI and database code.
5. **Progressive disclosure over product manuals:** Teach users when intent is clear; keep runtime guidance separate from introductory education.
6. **Outfit-first social differentiation:** Social should amplify JezSy’s fashion workflow: create, style, share, inspire, recreate, and shop.
7. **Optimistic UI, authoritative backend:** Immediate client feedback is good; server state remains canonical and failures must roll back cleanly.
8. **Privacy-safe defaults:** Existing user content should remain private unless a new public behavior is explicitly opted into or clearly configured.
9. **Design negative-path verification:** Happy-path testing is not enough for social/privacy systems. Direct API/RLS bypass tests should be part of release verification.
10. **Avoid premature social complexity:** Do not add follower graphs, public leaderboards, generic feeds, or public behavioral exposure unless they advance the core fashion workflow.

---

## 10. Consolidated Product/Engineering Roadmap

| Tier | Priority | Feature / Foundation |
|---|---|---|
| Tier 1 | Core | Wardrobe intelligence, Outfit Builder, Style Advisor |
| Tier 1 | Safety | Granular privacy + RLS permission matrix |
| Tier 1 | UX | Centralized versioned onboarding/feature discovery |
| Tier 2 | Social | Profiles, public outfits, outfit sharing, connections |
| Tier 2 | Commerce | Admin wishlist intelligence, review helpfulness voting |
| Tier 3 | Discovery | Suggested users, Styled By, shareable profile/outfit links |
| Tier 3 | Creation | Remix this look / recreate with my wardrobe |
| Tier 3 | Communication | P2P chat after relationship and privacy rules are stable |
| Later | Intelligence | Adaptive style preference learning, context/weather, richer recommendation weights |

---

## 11. Verification Standards Established in the Conversation

- TypeScript compile / lint checks are necessary but not sufficient for privacy-sensitive work.
- Test multiple accounts on the same device for user-scoped state.
- Test public, connections-only, private, blocked, and owner cases for every social object.
- Call sensitive RPCs and table operations directly as unauthorized users to confirm the database denies access.
- Test app relaunch and state persistence for onboarding/hints.
- Test optimistic mutation failure and rapid-tap concurrency for review voting.
- Verify safe defaults for existing rows during migrations.
- Verify UPDATE policies still have the required SELECT visibility under RLS.
- Run database advisors/security checks after schema or RLS changes.

---

## 12. Final Architecture Position

The conversation converged on a clear product architecture: **JezSy should remain a fashion utility first, with a social layer that grows out of outfits, styling, wardrobe intelligence, and commerce intent.** Privacy should be granular and explicit; authorization should be enforced at the database boundary; and onboarding should progressively teach the product rather than front-load it. The strongest future loop is not “follow people,” but “discover a look, understand how it was styled, recreate it with your own wardrobe, and shop only where useful.”

*Document status: Conversation synthesis / internal architecture record. Implementation should still be verified against the live repository and current Supabase schema before changes are applied.*
