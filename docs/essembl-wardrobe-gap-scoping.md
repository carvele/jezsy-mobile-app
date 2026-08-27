# Essembl wardrobe feature gap -- scoping

Evaluated against the full Essembl feature list the user provided (4 categories, 13 features).
Research only, no code changes.

## What already exists in this app

- **Wardrobe screen** (`app/(tabs)/wardrobe.tsx`) -- My Items / Saved Outfits / Capsules tabs,
  backed by `wardrobe_items`, `saved_outfits`, `capsules` tables. Items track `wear_count`
  (`20260721143058_wardrobe_wear_tracking.sql`), `garment_type`, `color_tags`.
- **Capsule wardrobe planning** -- a full `capsules` tab with a create-capsule flow
  (`app/wardrobe/create-capsule`), `CapsuleCard` component. Already built.
- **Gap analysis / purchase recommendations** (`src/components/GapAnalysis.tsx`) -- rule-based:
  buckets items by `garment_type`, flags missing categories ("You have tops but no bottoms"),
  and renders a **"Shop {category}s" button that links straight to the catalog**
  (`router.push('/(tabs)/explore')`). This *is* Essembl's "Purchase Recommendations" feature,
  already shipped, and it plugs directly into this app's actual product catalog rather than a
  generic suggestion.
- **Outfit builder / mix-and-match** (`app/outfit-builder.tsx`) -- manual 5-slot builder (top/
  bottom/outerwear/shoes/accessory), picks from wardrobe or catalog, per-item background removal
  (`@six33/react-native-bg-removal`, a JS lib -- not one of the three load-bearing native
  modules), and a **live color-harmony score** from `src/utils/colorMatcher.ts` (an 8-color rule
  matrix -- rule-based, not AI, but it is a real "Outfit Check" scoring an outfit right now).
- **Color data**: `color_options` table + `src/utils/colorOptions.ts` -- fixed, owner-managed
  vocabulary users manually tag. No perceptual/seasonal analysis.
- **Body-scan / fit**: `app/profile/body-scan.tsx` (vision-camera + mediapipe-posedetection)
  captures measurements into `useSizingProfile`; `app/ar-tryon/[id].tsx` overlays *fit* (tight/
  loose zones, recommended size) using those measurements against product measurements. No
  garment-on-body visual compositing.
- **Add-item flow** (`app/wardrobe/add-item.tsx`) -- one photo at a time via
  `expo-image-picker`, manual tagging.
- **Cross-platform** -- already true; this is a standard Expo app on iOS and Android.
- **No AI/LLM API integration exists anywhere in the app today.** Every "smart" behavior above
  (color harmony, gap analysis) is pure rule-based JS with zero external model calls.

## Feature-by-feature assessment

### 1. Wardrobe digitization & organization

| Feature | Status | Needed | Size |
|---|---|---|---|
| Magic Upload (multi-item, one photo) | Not present -- add-item is single-photo only | Multi-object detection/segmentation (new CV model or external vision API) + a review/split UX | Large |
| Automatic background removal | **Exists in the outfit builder**, not yet applied at add-item capture time | Wire the same `@six33/react-native-bg-removal` call into `add-item.tsx` | Small |
| Digital wardrobe organizer | **Exists** (My Items tab) | -- | Done |
| Capsule wardrobe planning | **Exists** (Capsules tab + create flow) | -- | Done |

### 2. AI styling & outfit generation

| Feature | Status | Needed | Size |
|---|---|---|---|
| AI outfit generator | Builder + harmony scoring exist, but slots are filled manually | Rule-based auto-fill (score all combinations, present the best) is pure JS on existing data; a true generative version needs an external LLM/vision API | Small (rule-based) -- Medium (real AI) |
| Context-aware recommendations (occasion/mood/weather) | Not present -- no occasion tagging, no weather integration | New `occasion` field on saved outfits/items + a weather API call; filtering logic on top of what auto-fill would already produce | Medium |
| Mix & match builder | **Exists** (outfit-builder manual slots) | -- | Done |
| Universal fashion inspiration (curated grids: Streetwear, Old Money, etc.) | Not present | Mostly a content/curation task (someone authors example outfits per aesthetic), plus a browse UI -- little new engineering | Medium (content-heavy, not code-heavy) |
| Gender-inclusive styling | Depends on whether the product catalog already tags gender/category this way -- not confirmed in this pass | If the catalog data supports it, mostly a filtering/UI concern | Small-Medium (needs a follow-up check on catalog schema) |

### 3. Personal analysis & feedback

| Feature | Status | Needed | Size |
|---|---|---|---|
| Selfie color analysis | Not present -- vision-camera only used for body-scan pose today; `color_options` is a static manual list | New skin-tone/palette CV or an external API call; new camera flow; real privacy questions (biometric-adjacent selfie data) | Medium-Large |
| Outfit check & grading (color harmony / fit / texture) | **Colour harmony is done** (real hue-geometry scoring, surfaced on suggestions). Fit and texture both have **no data source** -- see correction below | Both need a schema change plus a capture flow, not just wiring | Medium each, and neither is "wiring existing data" |
| Style education (explain AI pairings) | Not present as UI, but the rule-based matcher already has explicit, nameable rules (e.g. "complementary colors," "neutral base") | Surface the matcher's own rule outcome as explanatory text -- cheap because the logic is already deterministic and inspectable, unlike a black-box model | Small |
| Purchase recommendations | **Exists** (`GapAnalysis.tsx` "Shop {X}s" -> catalog) | -- | Done |

### 4. App engagement & access

| Feature | Status |
|---|---|
| Cross-platform (iOS + Android) | **Exists** -- standard Expo app |

## Correction: fit scoring is not buildable from existing data

An earlier version of this doc said fit scoring could reuse the body-scan sizing profile and was
"mostly wiring existing data". That was wrong, and it matters because it made fit look cheaper
than texture when the two are the same size of job.

`analyzeFit()` in `src/utils/sizeRecommender.ts` does exist and works -- but it needs two inputs,
and the wardrobe only has one of them:

- **Body measurements: available.** `useSizingProfile` supplies these from the body scan.
- **Garment measurements: unavailable.** `wardrobe_items` has no measurements column. Items
  linked to a catalog product (`product_id`) could borrow `products.measurements`, but items the
  user photographed themselves have nothing at all.
- **Which size the user owns: not captured anywhere.** `wardrobe_items` has no `size` column, and
  `app/wardrobe/add-item.tsx` never asks for one. Without it there is no way to pick a row from a
  size chart, so even a catalog-linked item cannot be scored. The outfit builder's `SlotItem`
  does not carry a size either.

So fit scoring needs, at minimum: a `size` column on `wardrobe_items`, a field in the add-item
flow to capture it, and a fallback for items with no linked product. That is the same shape of
work as texture -- schema plus capture flow -- not an afternoon of wiring.

Both belong in one migration if either is picked up, since they touch the same table and the same
add-item form.

## Bottom line

The "outdated" feeling likely isn't a capability gap as much as a **polish/discoverability** gap
-- capsule planning, gap-driven purchase suggestions, mix-and-match, and outfit color scoring all
already exist in the app today, just not necessarily surfaced as prominently or as smoothly as
Essembl's UI does it. Worth checking whether these are easy to find/use before assuming they need
to be rebuilt.

Genuinely new work, ranked cheapest to most involved:
1. **Style education text** and **background removal at add-item time** -- small, wire up what
   already exists elsewhere in the app.
2. **Rule-based AI outfit generator** -- shipped. Outfit grading on **colour** is shipped with it;
   grading on **fit or texture** is not cheap, see the correction above.
3. **Fashion inspiration grids** and **context-aware (occasion/weather) recommendations** --
   medium, mostly new UI/content plus one small external integration (weather API) for the latter.
4. **Selfie color analysis** and **magic multi-item upload** -- the two features needing
   genuinely new capability: new CV/ML, most likely a new external API vendor, and for selfie
   analysis a new sensitive-data (biometric-adjacent) collection flow. These also drift furthest
   from the reserve-and-collect core purpose. Per `CLAUDE.md`, a new native module or external
   AI-vendor dependency needs explicit confirmation before any build starts -- recommend deciding
   on these two specifically, separately from the rest, before scoping either into a real task.
