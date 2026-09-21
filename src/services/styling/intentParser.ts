import { WardrobeItem, StylingIntent } from '@/src/types/styleAdvisor';
import { interpretOutfitContext, OutfitContextInterpretation } from '@/src/utils/aiStylistAdvisor';
import { resolveEffectiveGarmentBucket } from '@/src/utils/garmentSemanticClassifier';

const KNOWN_COLORS = [
  'black', 'white', 'cream', 'beige', 'navy', 'blue', 'denim', 'gray', 'grey',
  'charcoal', 'red', 'burgundy', 'maroon', 'wine', 'pink', 'rose', 'blush',
  'orange', 'rust', 'terracotta', 'yellow', 'mustard', 'gold', 'silver', 'green',
  'olive', 'sage', 'emerald', 'teal', 'purple', 'lavender', 'brown', 'tan', 'camel', 'khaki',
];

/**
 * Parses natural language styling prompt + optional occasion into a structured StylingIntent.
 * Reuses Mannequin context interpretation and resolves explicit garment and color constraints.
 */
export function parseStylingIntent(
  rawPrompt: string,
  selectedOccasion: string | null | undefined,
  wardrobe: WardrobeItem[],
  existingIntent?: StylingIntent | null
): StylingIntent {
  const prompt = (rawPrompt || '').trim();
  const occ = (selectedOccasion || '').trim();
  const lowerPrompt = prompt.toLowerCase();

  // 1. Reuse existing Mannequin context interpretation
  const ctx: OutfitContextInterpretation = interpretOutfitContext({
    occasion: occ || (prompt.length > 0 ? prompt : 'Casual'),
    additionalContext: prompt,
  });

  const preferredColors = new Set<string>(existingIntent?.preferredColors || []);
  const avoidedColors = new Set<string>(existingIntent?.avoidedColors || []);
  const mustUseItemIds = new Set<string>(existingIntent?.mustUseItemIds || []);
  const excludedItemIds = new Set<string>(existingIntent?.excludedItemIds || []);
  const conflictingConstraints: string[] = [];

  // 2. Color extraction: Avoided vs. Preferred
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
    }
    if (preferRegex.test(lowerPrompt) || new RegExp(`\\ball\\s+${color}\\b`, 'i').test(lowerPrompt)) {
      preferredColors.add(color);
    }
  }

  // Check for direct color contradiction (e.g. "All black but avoid black")
  for (const color of preferredColors) {
    if (avoidedColors.has(color)) {
      conflictingConstraints.push(
        `Contradictory color request: requested ${color} while also asking to avoid ${color}.`
      );
    }
  }

  // 3. Garment extraction from user's actual wardrobe
  // Match phrases like "use my [piece]", "with my [piece]", "wear my [piece]"
  const usePattern = /\b(?:use|wear|with|incorporate|feature|include|put on|style)\s+(?:my\s+)?([a-z0-9\s-]+?)(?=[,.]|\band\b|\bavoid\b|\bwith\b|\bfor\b|$)/gi;
  let useMatch: RegExpExecArray | null;
  while ((useMatch = usePattern.exec(lowerPrompt)) !== null) {
    const phrase = useMatch[1].trim();
    if (phrase.length >= 3 && !phrase.startsWith('a ') && !phrase.startsWith('the ')) {
      const match = findWardrobeItemByPhrase(phrase, wardrobe);
      if (match) {
        mustUseItemIds.add(match.id);
      }
    }
  }

  // Match phrases like "avoid [piece]", "no [piece]", "without [piece]", "don't use [piece]"
  const avoidPattern = /\b(?:avoid|no|without|don't use|dont use|don't wear|dont wear|skip)\s+(?:my\s+)?([a-z0-9\s-]+?)(?=[,.]|\band\b|\bwith\b|\bfor\b|$)/gi;
  let avoidMatch: RegExpExecArray | null;
  while ((avoidMatch = avoidPattern.exec(lowerPrompt)) !== null) {
    const phrase = avoidMatch[1].trim();
    if (phrase.length >= 3) {
      const match = findWardrobeItemByPhrase(phrase, wardrobe);
      if (match) {
        excludedItemIds.add(match.id);
      }
    }
  }

  // Check for direct garment contradiction (e.g. must use item that was also excluded)
  for (const id of mustUseItemIds) {
    if (excludedItemIds.has(id)) {
      const item = wardrobe.find((w) => w.id === id);
      const name = item?.sub_category || item?.category || 'selected garment';
      conflictingConstraints.push(
        `Contradictory request: instructed to both use and avoid your ${name}.`
      );
    }
  }

  // 4. Formality & Comfort detection
  let formality = ctx.formalityExpectation;
  if (/\b(formal|black.?tie|black tie|suit|tuxedo|gala|elegant|dressy)\b/i.test(lowerPrompt)) {
    formality = 'formal';
  } else if (/\b(casual|laid back|relaxed|low key|easy)\b/i.test(lowerPrompt)) {
    formality = 'casual';
  } else if (/\b(smart casual|business casual|polished casual)\b/i.test(lowerPrompt)) {
    formality = 'elevatedCasual';
  }

  const comfortPriority =
    existingIntent?.comfortPriority ||
    /\b(comfortable|comfy|breathable|loose|relaxed|easy to move|walk a lot|walking)\b/i.test(lowerPrompt);

  const modestyPreference =
    existingIntent?.modestyPreference ||
    /\b(modest|not too revealing|more coverage|conservative|covered)\b/i.test(lowerPrompt);

  return {
    rawPrompt: prompt,
    selectedOccasion: occ || null,
    formality,
    activity: ctx.activity,
    weather: ctx.weather !== 'unknown' ? ctx.weather : undefined,
    temperatureNeeds: ctx.temperatureRequirement !== 'unknown' ? ctx.temperatureRequirement : undefined,
    isIndoor: ctx.isIndoorOverride,
    mustUseItemIds: Array.from(mustUseItemIds),
    excludedItemIds: Array.from(excludedItemIds),
    preferredColors: Array.from(preferredColors),
    avoidedColors: Array.from(avoidedColors),
    comfortPriority,
    modestyPreference,
    conflictingConstraints: conflictingConstraints.length > 0 ? conflictingConstraints : undefined,
  };
}

/**
 * Searches the user's wardrobe for an item matching a natural phrase (e.g. "black blazer", "denim jacket", "loafers").
 */
function findWardrobeItemByPhrase(phrase: string, wardrobe: WardrobeItem[]): WardrobeItem | null {
  const clean = phrase.toLowerCase().replace(/^(my|a|an|the)\s+/, '').trim();
  if (!clean || clean.length < 3) return null;

  // Exact matches first
  for (const item of wardrobe) {
    const sub = (item.sub_category || '').toLowerCase();
    const desc = (item.description || '').toLowerCase();
    const cat = (item.category || '').toLowerCase();
    const bucket = resolveEffectiveGarmentBucket(item).toLowerCase();
    const colors = (item.color_tags || []).map((c) => c.toLowerCase());

    const itemTokens = `${colors.join(' ')} ${sub} ${bucket} ${cat} ${desc}`;
    if (itemTokens.includes(clean)) {
      return item;
    }
  }

  // Substring / word matches
  const phraseWords = clean.split(/\s+/).filter((w) => w.length >= 3);
  if (phraseWords.length >= 2) {
    for (const item of wardrobe) {
      const sub = (item.sub_category || '').toLowerCase();
      const bucket = resolveEffectiveGarmentBucket(item).toLowerCase();
      const colors = (item.color_tags || []).map((c) => c.toLowerCase());
      const itemTokens = `${colors.join(' ')} ${sub} ${bucket}`;

      if (phraseWords.every((w) => itemTokens.includes(w))) {
        return item;
      }
    }
  }

  return null;
}
