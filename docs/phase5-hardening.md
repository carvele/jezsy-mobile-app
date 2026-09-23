# Phase 5 hardening

Scope: reliability, security and data integrity of the wardrobe, Mannequin and AI stylist flows. Zero cost: no paid
provider, service or infrastructure was added.

## AI stylist

- `deterministic critique -> optional LLM synthesis`. The deterministic evidence engine (`evaluateWardrobeOutfit`)
  is authoritative. A model verdict that ranks below the engine's verdict is discarded and the deterministic critique
  is returned with `analysisMode: 'ruleBasedFallback'` (`gradeOutfitWithAI`). A model may only sharpen a verdict.
- The critique is labelled `hybridLLM` only when a validated model response was actually used.
- Shared, dependency-free validation lives in `supabase/functions/_shared/aiStylistGuards.ts` and is used by both the
  Edge Function and the client: evidence-packet whitelist/clipping, model-output schema check, verdict ranking,
  whole-word context relevance ("brunch" is not "run").

## Edge Function `ai-stylist-analyze`

- Requires a valid, non-anonymous Supabase user (`auth.getUser`). Gateway JWT verification stays off so browser CORS
  preflights work; the handler enforces auth itself. Verified in production: no token -> 401, anon key -> 401.
- Per-user limits through the existing `check_rate_limit` RPC: 8/min and 120/day. Fails closed if the limiter is down.
- Every wardrobe id in the packet must be readable by the caller under RLS; suggested item ids are filtered the same way.
- Payload capped at 20,000 chars, 12 items; provider errors and exceptions are logged, never returned.
- CORS: `jezsy-app.pages.dev` (+ subdomains), `jezsy.com`, localhost, plus explicit `ALLOWED_ORIGINS` entries. A `*`
  secret does not open this function.
- Handler is `handler.ts` (all side effects injected, tested in `src/services/__tests__/aiStylistEdgeHandler.test.ts`);
  `index.ts` wires Supabase.

## LLM configuration (zero cost)

There is no default model. The function calls a provider only when a key AND a model are configured:

| Secret | Meaning |
| --- | --- |
| `GEMINI_API_KEY` (or `AI_STYLING_API_KEY`) | Google AI Studio key (has a free tier) |
| `OPENROUTER_API_KEY` | OpenRouter key |
| `AI_STYLING_MODEL` | Model id, required. Use a model that is currently free for your key. |

OpenAI is not supported (no free tier). Until `AI_STYLING_MODEL` is set the app runs entirely on the deterministic
stylist, which is fully functional. The previous hard-coded slug `deepseek/deepseek-v4-flash-0731:free` returned 404 on
every call.

```bash
npx supabase secrets set AI_STYLING_MODEL=<free-model-id> --project-ref wufcmtndotfvxvvxkamv
```

Free tiers change without notice; check the model list of the chosen provider before setting it.

## Workflows

- Wear logging (Style Advisor): atomic `increment_wear_count` RPC per item; success is only shown for confirmed writes.
- Send to Mannequin / Save: `outfitService.saveOutfitOnce` reuses an existing look with the same items.
- Search: `buildSearchOrFilter` strips PostgREST filter syntax and LIKE wildcards; ownership filters unchanged.
- Add Item: client-generated item id (idempotent insert), verified save (`saveItemVerified`), upload reused across
  retries, orphaned upload removed when the database definitively refuses the row, `ai_attributes` is never dropped on a
  schema error (only `embedding`/`seasons` may be, and only when the database names them).
- Mannequin confirm: `runStylistRequest` guarantees errors reach the user and superseded requests stay silent.
- Dead `outfit_feedback` insert removed. Feedback is local-first (`AsyncStorage`); no table was created.

## Storage

`wardrobe-images` stays public because saved outfits, public profiles and shared looks render other users' image URLs.
Listing is disabled (no SELECT policy on the bucket). New uploads use a random uuid file name so URLs are not
guessable. Moving to private/signed URLs needs a URL-migration plan and is a follow-up.

## Schema

Production lacks most of `20260916010000_wardrobe_ai_stylist_upgrade` even though the ledger lists it. Deliberately not
re-applied. Real columns in use: `ai_attributes` (where-worn, raw colour), `embedding`, `occasions`, `seasons`.

## CI

`tsc --noEmit` is blocking. The manual Cloudflare workflow still carries the public anon-key fallback because the
GitHub repository has no `EXPO_PUBLIC_SUPABASE_*` secrets; add them (or repo variables) before removing it.
