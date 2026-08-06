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
- **Color data**: `color_options` table + `src/utils/colorOptions.ts` -- fixed, admin-managed
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
| Outfit check & grading (color harmony / fit / texture) | **Color harmony partially exists** (live score in the builder); **fit could reuse** the existing sizing profile from body-scan (compare outfit's garment measurements against the user's, same data `ar-tryon` already uses) | Texture has no data source today (nothing captures fabric/texture on items) -- would need new tagging or CV; fit-scoring is a natural extension of data already collected | Medium overall (texture is the new part; harmony + fit are mostly wiring existing data) |
| Style education (explain AI pairings) | Not present as UI, but the rule-based matcher already has explicit, nameable rules (e.g. "complementary colors," "neutral base") | Surface the matcher's own rule outcome as explanatory text -- cheap because the logic is already deterministic and inspectable, unlike a black-box model | Small |
| Purchase recommendations | **Exists** (`GapAnalysis.tsx` "Shop {X}s" -> catalog) | -- | Done |

### 4. App engagement & access

| Feature | Status |
|---|---|
| Cross-platform (iOS + Android) | **Exists** -- standard Expo app |

## Bottom line

The "outdated" feeling likely isn't a capability gap as much as a **polish/discoverability** gap
-- capsule planning, gap-driven purchase suggestions, mix-and-match, and outfit color scoring all
already exist in the app today, just not necessarily surfaced as prominently or as smoothly as
Essembl's UI does it. Worth checking whether these are easy to find/use before assuming they need
to be rebuilt.

Genuinely new work, ranked cheapest to most involved:
1. **Style education text** and **background removal at add-item time** -- small, wire up what
   already exists elsewhere in the app.
2. **Rule-based AI outfit generator** and **outfit grading (harmony + fit)** -- small/medium,
   built from data and logic already in the app (color matcher, sizing profile), no new deps.
3. **Fashion inspiration grids** and **context-aware (occasion/weather) recommendations** --
   medium, mostly new UI/content plus one small external integration (weather API) for the latter.
4. **Selfie color analysis** and **magic multi-item upload** -- the two features needing
   genuinely new capability: new CV/ML, most likely a new external API vendor, and for selfie
   analysis a new sensitive-data (biometric-adjacent) collection flow. These also drift furthest
   from the reserve-and-collect core purpose. Per `CLAUDE.md`, a new native module or external
   AI-vendor dependency needs explicit confirmation before any build starts -- recommend deciding
   on these two specifically, separately from the rest, before scoping either into a real task.
