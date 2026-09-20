/**
 * garmentVisualCache.ts
 * Lightweight in-memory cache for per-item visual evidence.
 *
 * Cache key = imageUrl + updated_at so stale analysis is never reused when
 * the image or item metadata changes.  Both Mannequin and Style Advisor share
 * the same cache instance so a given item is analysed at most once per session.
 */

import { fashionVisionEngine } from './fashionVisionEngine';
import { GarmentAnalysisResult } from '../types/dto/aiAttributes';

export interface VisualItemEvidence {
  /** Image URL that was analysed */
  imageUrl: string;
  /** Version token used to construct the cache key */
  versionToken: string;
  /** Whether the result came from the real ML pipeline or a geometric/colour fallback */
  isRealMl: boolean;
  /** Model name that produced the result */
  modelName: string;
  /** Dominant colours extracted from the actual image pixels */
  dominantColors: { name: string; hex: string; role: 'dominant' | 'secondary' | 'accent'; confidence: number }[];
  /**
   * Visual garment family as detected by the vision engine.
   * Never overwrites the user-entered Category — used as supporting evidence only.
   */
  visualGarmentFamily: string;
  /** Visual formality signal: 0 = fully casual, 1 = fully formal */
  formalitySignal: number;
  /** True when the image shows clear athletic garment cues */
  athleticSignal: boolean;
  /** True when the image shows clear swimwear cues */
  swimwearSignal: boolean;
  /** Pattern detected visually (Solid, Striped, Floral, etc.) */
  visualPattern: string | null;
  /** Confidence of the vision analysis (0-1) */
  confidence: number;
  /** Whether this result is uncertain / low-confidence */
  lowConfidence: boolean;
}

const cache = new Map<string, VisualItemEvidence>();

function buildCacheKey(imageUrl: string, versionToken: string): string {
  return `${imageUrl}:::${versionToken}`;
}

/**
 * Maps a GarmentAnalysisResult garmentType to a formality signal (0–1).
 * Only reliable coarse-grained signals are used; material inference is unreliable.
 */
function inferFormalitySignal(result: GarmentAnalysisResult): number {
  const sub = (result.subcategory || '').toLowerCase();
  const type = (result.garmentType || '').toLowerCase();
  if (/blazer|tuxedo|suit|dress shoe|oxford|loafer|formal|tailored/i.test(sub)) return 0.85;
  if (/dress shirt|trousers|slacks|heels|pumps/i.test(sub)) return 0.75;
  if (/midi dress|maxi dress|cocktail/i.test(sub)) return 0.70;
  if (/polo|chino|blouse/i.test(sub)) return 0.55;
  if (/sneaker|athletic|hoodie|sweatpants|jogger/i.test(sub)) return 0.10;
  if (/jeans|t-shirt|shorts|casual/i.test(sub)) return 0.20;
  if (type === 'dress') return 0.60;
  if (type === 'outerwear') return 0.50;
  return 0.35; // uncertain — treat as casual-leaning
}

function inferAthleticSignal(result: GarmentAnalysisResult): boolean {
  const sub = (result.subcategory || '').toLowerCase();
  return /sneaker|athletic|running|gym|jogger|sweatpants|track|sports? bra|workout/i.test(sub);
}

function inferSwimwearSignal(result: GarmentAnalysisResult): boolean {
  const sub = (result.subcategory || '').toLowerCase();
  const type = (result.garmentType || '').toLowerCase();
  return /swim|bikini|boardshort|rash guard/i.test(sub + ' ' + type);
}

/**
 * Returns cached visual evidence for an item.  Runs analysis if not cached.
 * Fails gracefully — never throws; returns null when image cannot be analysed.
 */
export async function getVisualEvidence(
  imageUrl: string,
  versionToken: string,
  aspectRatio?: number
): Promise<VisualItemEvidence | null> {
  if (!imageUrl) return null;

  const key = buildCacheKey(imageUrl, versionToken);
  if (cache.has(key)) return cache.get(key)!;

  let result: GarmentAnalysisResult;
  try {
    result = await fashionVisionEngine.analyzeGarment(imageUrl, { aspectRatio });
  } catch {
    return null;
  }

  const evidence: VisualItemEvidence = {
    imageUrl,
    versionToken,
    isRealMl: result.isRealMl ?? false,
    modelName: result.modelMetadata?.name ?? 'unknown',
    dominantColors: (result.colors || []).map((c) => ({
      name: c.name,
      hex: c.hex,
      role: c.role,
      confidence: c.confidence,
    })),
    visualGarmentFamily: result.garmentType || 'unknown',
    formalitySignal: inferFormalitySignal(result),
    athleticSignal: inferAthleticSignal(result),
    swimwearSignal: inferSwimwearSignal(result),
    visualPattern: result.pattern && result.pattern !== 'Not detected' ? result.pattern : null,
    confidence: result.confidence ?? 0.5,
    lowConfidence: (result.confidence ?? 0) < 0.60 || result.needsReview === true,
  };

  cache.set(key, evidence);
  return evidence;
}

/**
 * Fetches visual evidence for a batch of items concurrently.
 * Returns a map keyed by imageUrl.  Items where analysis fails are absent from the map.
 */
export async function getBatchVisualEvidence(
  items: { imageUrl: string; versionToken: string; aspectRatio?: number }[]
): Promise<Map<string, VisualItemEvidence>> {
  const results = await Promise.allSettled(
    items.map((it) => getVisualEvidence(it.imageUrl, it.versionToken, it.aspectRatio))
  );
  const map = new Map<string, VisualItemEvidence>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      map.set(items[i].imageUrl, r.value);
    }
  }
  return map;
}

/** Clears the in-memory cache — useful in tests. */
export function clearVisualEvidenceCache(): void {
  cache.clear();
}
