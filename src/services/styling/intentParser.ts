import {
  WardrobeItem,
  StylingIntent,
  StyleAdvisorChipContext,
  ExplicitTextProvenance,
} from '@/src/types/styleAdvisor';
import { interpretOutfitContext, OutfitContextInterpretation } from '@/src/utils/aiStylistAdvisor';
import { resolveEffectiveGarmentBucket, resolveAccessorySubtype } from '@/src/utils/garmentSemanticClassifier';

const KNOWN_COLORS = [
  'black', 'white', 'cream', 'beige', 'navy', 'blue', 'denim', 'gray', 'grey',
  'charcoal', 'red', 'burgundy', 'maroon', 'wine', 'pink', 'rose', 'blush',
  'orange', 'rust', 'terracotta', 'yellow', 'mustard', 'gold', 'silver', 'green',
  'olive', 'sage', 'emerald', 'teal', 'purple', 'lavender', 'brown', 'tan', 'camel', 'khaki',
];

/**
 * Parses explicit natural-language prompt without chip interference and derives field provenance.
 */
export function parseExplicitUserText(
  rawPrompt: string,
  wardrobe: WardrobeItem[],
  lockedItemIds: string[] = []
): { intent: StylingIntent; provenance: ExplicitTextProvenance } {
  const prompt = (rawPrompt || '').trim();
  const lowerPrompt = prompt.toLowerCase();

  const provenance: ExplicitTextProvenance = {
    hasExplicitOccasion: false,
    hasExplicitFormality: false,
    hasExplicitWeather: false,
    hasExplicitTemperature: false,
    hasExplicitComfort: false,
    hasExplicitModesty: false,
    hasExplicitColors: false,
    hasExplicitGarments: false,
  };

  const preferredColors = new Set<string>();
  const avoidedColors = new Set<string>();
  const mustUseItemIds = new Set<string>();
  const excludedItemIds = new Set<string>();
  const conflictingConstraints: string[] = [];

  // Color extraction: Avoided vs. Preferred
  for (const color of KNOWN_COLORS) {
    const avoidRegex = new RegExp(
      `\\b(?:avoid|no|not|without|don't want|dont want|never|steer clear of|except)\\s+(?:any\\s+)?${color}\\b`,
      'i'
    );
    const preferRegex = new RegExp(
      `\\b(?:prefer|like|love|use|wear|in|all|only|with)\\s+(?:my\\s+)?${color}\\b`,
      'i'
    );

    if (avoidRegex.test(lowerPrompt)) {
      avoidedColors.add(color);
      provenance.hasExplicitColors = true;
    }
    if (preferRegex.test(lowerPrompt) || new RegExp(`\\ball\\s+${color}\\b`, 'i').test(lowerPrompt)) {
      preferredColors.add(color);
      provenance.hasExplicitColors = true;
    }
  }

  // Check for direct color contradiction
  for (const color of preferredColors) {
    if (avoidedColors.has(color)) {
      conflictingConstraints.push(
        `Contradictory color request: requested ${color} while also asking to avoid ${color}.`
      );
    }
  }

  // Garment extraction: must use
  const usePattern = /\b(?:use|wear|with|incorporate|feature|include|put on|style\s+around|style)\s+(?:my\s+)?([a-z0-9\s-]+?)(?=[,.]|\band\b|\bavoid\b|\bwith\b|\bfor\b|$)/gi;
  let useMatch: RegExpExecArray | null;
  while ((useMatch = usePattern.exec(lowerPrompt)) !== null) {
    const phrase = useMatch[1].trim();
    if (phrase.length >= 3 && !phrase.startsWith('a ') && !phrase.startsWith('the ')) {
      const match = findWardrobeItemByPhrase(phrase, wardrobe);
      if (match) {
        mustUseItemIds.add(match.id);
        provenance.hasExplicitGarments = true;
      }
    }
  }

  // Garment extraction: avoid
  const avoidPattern = /\b(?:avoid|no|without|don't use|dont use|don't wear|dont wear|skip)\s+(?:my\s+)?([a-z0-9\s-]+?)(?=[,.]|\band\b|\bwith\b|\bfor\b|$)/gi;
  let avoidMatch: RegExpExecArray | null;
  while ((avoidMatch = avoidPattern.exec(lowerPrompt)) !== null) {
    const phrase = avoidMatch[1].trim();
    if (phrase.length >= 3) {
      const match = findWardrobeItemByPhrase(phrase, wardrobe);
      if (match) {
        excludedItemIds.add(match.id);
        provenance.hasExplicitGarments = true;
      }
    }
  }

  // Check for contradiction between prompt mustUse and prompt excluded
  for (const id of mustUseItemIds) {
    if (excludedItemIds.has(id)) {
      const item = wardrobe.find((w) => w.id === id);
      const name = item?.sub_category || item?.category || 'selected garment';
      conflictingConstraints.push(
        `Contradictory request: instructed to both use and avoid your ${name}.`
      );
    }
  }

  // Check for contradiction between locked items and prompt excluded items
  for (const lockedId of lockedItemIds) {
    if (excludedItemIds.has(lockedId)) {
      const item = wardrobe.find((w) => w.id === lockedId);
      const name = item?.sub_category || item?.category || 'locked garment';
      conflictingConstraints.push(
        `Contradictory request: you locked your ${name}, but also asked to avoid it in your prompt.`
      );
    }
  }

  // Check for contradiction between locked items and avoided colors
  for (const lockedId of lockedItemIds) {
    const item = wardrobe.find((w) => w.id === lockedId);
    if (!item) continue;
    const itemColors = (item.color_tags || []).map((c) => c.toLowerCase());
    for (const avoided of avoidedColors) {
      if (itemColors.includes(avoided.toLowerCase())) {
        const name = item.sub_category || item.category || 'locked garment';
        conflictingConstraints.push(
          `Prompt avoids color ${avoided} which conflicts with locked garment "${name}".`
        );
      }
    }
  }

  // Formality detection
  let formality: 'formal' | 'semiFormal' | 'elevatedCasual' | 'casual' | undefined;
  if (/\b(formal|black.?tie|black tie|suit|tuxedo|gala|elegant|dressy)\b/i.test(lowerPrompt)) {
    formality = 'formal';
    provenance.hasExplicitFormality = true;
  } else if (/\b(casual|laid back|relaxed|low key|easy)\b/i.test(lowerPrompt)) {
    formality = 'casual';
    provenance.hasExplicitFormality = true;
  } else if (/\b(smart casual|business casual|polished casual)\b/i.test(lowerPrompt)) {
    formality = 'elevatedCasual';
    provenance.hasExplicitFormality = true;
  }

  // Comfort & Modesty
  let comfortPriority: boolean | undefined;
  if (/\b(comfortable|comfy|breathable|loose|relaxed|easy to move|walk a lot|walking)\b/i.test(lowerPrompt)) {
    comfortPriority = true;
    provenance.hasExplicitComfort = true;
  }

  let modestyPreference: boolean | undefined;
  if (/\b(modest|not too revealing|more coverage|conservative|covered)\b/i.test(lowerPrompt)) {
    modestyPreference = true;
    provenance.hasExplicitModesty = true;
  }

  // Weather & Temperature detection
  let weather: string | undefined;
  if (/\b(rain|rainy|raining|storm|stormy)\b/i.test(lowerPrompt)) {
    weather = 'rain';
    provenance.hasExplicitWeather = true;
  } else if (/\b(snow|snowing|blizzard)\b/i.test(lowerPrompt)) {
    weather = 'snow';
    provenance.hasExplicitWeather = true;
  } else if (/\b(sunny|sun|clear)\b/i.test(lowerPrompt)) {
    weather = 'sunny';
    provenance.hasExplicitWeather = true;
  }

  let temperatureNeeds: string | undefined;
  if (/\b(hot|sweltering|summer heat|warm)\b/i.test(lowerPrompt)) {
    temperatureNeeds = 'hot';
    provenance.hasExplicitTemperature = true;
  } else if (/\b(freezing|cold|chilly|winter cold|cool)\b/i.test(lowerPrompt)) {
    temperatureNeeds = 'cold';
    provenance.hasExplicitTemperature = true;
  }

  // Occasion detection in prompt
  let detectedOccasion: string | undefined;
  const occMatches = lowerPrompt.match(/\b(dinner|date night|date|work|office|interview|wedding|party|travel|flight|brunch|gym|running|gala|meeting|weekend|lounge|lounging|home)\b/i);
  if (occMatches) {
    detectedOccasion = occMatches[1];
    provenance.hasExplicitOccasion = true;
  }

  // Use interpretOutfitContext as base if prompt exists
  let ctx: OutfitContextInterpretation | undefined;
  if (prompt.length > 0) {
    ctx = interpretOutfitContext({
      occasion: detectedOccasion || prompt,
      additionalContext: prompt,
    });
    if (!formality && ctx.formalityExpectation) {
      formality = ctx.formalityExpectation;
    }
    if (!weather && ctx.weather !== 'unknown') {
      weather = ctx.weather;
    }
    if (!temperatureNeeds && ctx.temperatureRequirement !== 'unknown') {
      temperatureNeeds = ctx.temperatureRequirement;
    }
  }

  const intent: StylingIntent = {
    rawPrompt: prompt,
    selectedOccasion: detectedOccasion || null,
    formality,
    activity: ctx?.activity,
    weather,
    temperatureNeeds,
    isIndoor: ctx?.isIndoorOverride,
    mustUseItemIds: Array.from(mustUseItemIds),
    excludedItemIds: Array.from(excludedItemIds),
    preferredColors: Array.from(preferredColors),
    avoidedColors: Array.from(avoidedColors),
    comfortPriority,
    modestyPreference,
    conflictingConstraints: conflictingConstraints.length > 0 ? conflictingConstraints : undefined,
  };

  return { intent, provenance };
}

/**
 * Merges structured helper chips strictly into fields not explicitly supplied in prompt text.
 */
export function mergeIntentWithChips(
  parsed: { intent: StylingIntent; provenance: ExplicitTextProvenance },
  chipContext?: StyleAdvisorChipContext | null,
  lockedItemIds: string[] = []
): StylingIntent {
  const nextIntent: StylingIntent = {
    ...parsed.intent,
    mustUseItemIds: Array.from(new Set([...(parsed.intent.mustUseItemIds || []), ...lockedItemIds])),
  };

  if (!chipContext) {
    return nextIntent;
  }

  // Occasion: text overrides chip
  if (!parsed.provenance.hasExplicitOccasion && chipContext.occasion) {
    nextIntent.selectedOccasion = chipContext.occasion;
  }

  // Weather: text overrides chip
  if (!parsed.provenance.hasExplicitWeather && chipContext.weather) {
    nextIntent.weather = chipContext.weather;
  }

  // Temperature: text overrides chip
  if (!parsed.provenance.hasExplicitTemperature && chipContext.temperature) {
    nextIntent.temperatureNeeds = chipContext.temperature;
  }

  // Vibe / Formality: text overrides chip
  if (!parsed.provenance.hasExplicitFormality && chipContext.vibe) {
    switch (chipContext.vibe) {
      case 'polished':
        nextIntent.formality = 'elevatedCasual';
        break;
      case 'relaxed':
        nextIntent.formality = 'casual';
        break;
      case 'comfortable':
        nextIntent.comfortPriority = true;
        break;
      case 'minimal':
        // Minimal does not alter formality directly
        break;
    }
  }

  // Comfort: text overrides chip
  if (!parsed.provenance.hasExplicitComfort && chipContext.comfort) {
    nextIntent.comfortPriority = true;
  }

  return nextIntent;
}

/**
 * Main parser entry point: parses natural text and structured chips with explicit precedence.
 */
export function parseStylingIntent(
  rawPrompt: string,
  selectedOccasionOrChips: string | StyleAdvisorChipContext | null | undefined,
  wardrobe: WardrobeItem[],
  existingIntent?: StylingIntent | null,
  lockedItemIds: string[] = []
): StylingIntent {
  const chipContext: StyleAdvisorChipContext | undefined =
    typeof selectedOccasionOrChips === 'string'
      ? selectedOccasionOrChips.trim() ? { occasion: selectedOccasionOrChips.trim() } : undefined
      : selectedOccasionOrChips || undefined;

  const parsed = parseExplicitUserText(rawPrompt, wardrobe, lockedItemIds);
  const merged = mergeIntentWithChips(parsed, chipContext, lockedItemIds);

  if (existingIntent) {
    if (existingIntent.preferredColors) {
      merged.preferredColors = Array.from(new Set([...(merged.preferredColors || []), ...existingIntent.preferredColors]));
    }
    if (existingIntent.avoidedColors) {
      merged.avoidedColors = Array.from(new Set([...(merged.avoidedColors || []), ...existingIntent.avoidedColors]));
    }
    if (existingIntent.mustUseItemIds) {
      merged.mustUseItemIds = Array.from(new Set([...(merged.mustUseItemIds || []), ...existingIntent.mustUseItemIds]));
    }
    if (existingIntent.excludedItemIds) {
      merged.excludedItemIds = Array.from(new Set([...(merged.excludedItemIds || []), ...existingIntent.excludedItemIds]));
    }
  }

  return merged;
}

/**
 * Searches the user's wardrobe for an item matching a natural phrase (e.g. "black blazer", "red handbag", "gold watch").
 */
function findWardrobeItemByPhrase(phrase: string, wardrobe: WardrobeItem[]): WardrobeItem | null {
  const clean = phrase.toLowerCase().replace(/^(my|a|an|the)\s+/, '').trim();
  if (!clean || clean.length < 3) return null;

  // Exact substring matches first
  for (const item of wardrobe) {
    const sub = (item.sub_category || '').toLowerCase();
    const desc = (item.description || (item as any)?.ai_attributes?.description || '').toLowerCase();
    const cat = (item.category || '').toLowerCase();
    const bucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const accSub = (resolveAccessorySubtype(item) || '').toLowerCase();
    const colors = (item.color_tags || []).map((c) => c.toLowerCase());
    const material = ((item as any)?.ai_attributes?.material || (item as any)?.material || '').toLowerCase();

    const itemTokens = `${colors.join(' ')} ${sub} ${bucket} ${accSub} ${cat} ${material} ${desc}`;
    if (itemTokens.includes(clean)) {
      return item;
    }
  }

  // Word set matches
  const phraseWords = clean.split(/\s+/).filter((w) => w.length >= 2);
  if (phraseWords.length >= 1) {
    for (const item of wardrobe) {
      const sub = (item.sub_category || '').toLowerCase();
      const desc = (item.description || (item as any)?.ai_attributes?.description || '').toLowerCase();
      const cat = (item.category || '').toLowerCase();
      const bucket = resolveEffectiveGarmentBucket(item).toLowerCase();
      const accSub = (resolveAccessorySubtype(item) || '').toLowerCase();
      const colors = (item.color_tags || []).map((c) => c.toLowerCase());
      const material = ((item as any)?.ai_attributes?.material || (item as any)?.material || '').toLowerCase();

      const itemTokens = `${colors.join(' ')} ${sub} ${bucket} ${accSub} ${cat} ${material} ${desc}`;
      if (phraseWords.every((w) => itemTokens.includes(w))) {
        return item;
      }
    }
  }

  return null;
}
