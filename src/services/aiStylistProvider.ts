import { supabase } from '../lib/supabase';
import {
  StylistEvidencePacket,
  StructuredAIResponse,
  AIAnalysisResult,
} from '../types/aiStylist';
import { WardrobeItem } from '../services/wardrobeService';
import {
  firstUnaddressedTopic,
  sanitizeAIResponse,
} from '../../supabase/functions/_shared/aiStylistGuards';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitized?: StructuredAIResponse;
}

/**
 * Validates the structured AI response: schema, generic-filler rejection, section uniqueness, context
 * relevance and wardrobe-id grounding. Verdict authority is enforced separately against the deterministic
 * critique (see gradeOutfitWithAI); nothing here lets model wording decide suitability.
 */
export function validateAIResponse(
  response: unknown,
  packet: StylistEvidencePacket,
  wardrobeLookup?: Record<string, WardrobeItem>
): ValidationResult {
  // 1. Schema: bounded plain strings only, so a malformed field can never reach a render.
  const schema = sanitizeAIResponse(response);
  if (!schema.ok) return { valid: false, reason: schema.reason };
  const res = schema.value;

  // 2. Generic filler rejection
  const bannedPhrases = [
    /casual everyday outfit/i,
    /comfortable separates suited for/i,
    /the pieces create a relaxed, wearable outfit/i,
    /effortlessly daytime styling/i,
  ];
  for (const pattern of bannedPhrases) {
    if (pattern.test(res.headline) || pattern.test(res.whyJezsySaysThis) || pattern.test(res.stylistTake)) {
      return { valid: false, reason: 'Contains disallowed generic fallback boilerplate' };
    }
  }

  // 3. Section duplication check
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, '');
  if (normalize(res.whyJezsySaysThis) === normalize(res.stylistTake)) {
    return { valid: false, reason: 'whyJezsySaysThis and stylistTake are identical duplicates' };
  }

  // 4. Item id grounding. Without a wardrobe to check against, no suggested id is trusted.
  const improvements = (res.improvements ?? []).map((imp) => ({
    reason: imp.reason,
    existingWardrobeItemIds: imp.existingWardrobeItemIds.filter((id) => Boolean(wardrobeLookup?.[id])),
  }));

  // 5. Context relevance, by whole word: "brunch" is not "run".
  const ctx = packet.request.structuredContext;
  const responseText = [
    res.headline,
    res.whyJezsySaysThis,
    res.stylistTake,
    ...(res.whatConflicts ?? []),
    ...(res.whatWorks ?? []),
    ...Object.values(res.contextFit ?? {}),
  ].join(' ');
  const missedTopic = firstUnaddressedTopic(responseText, {
    userText: packet.request.rawContext,
    activity: ctx.activity,
    occasionType: ctx.occasionType,
    isIndoorOverride: ctx.isIndoorOverride,
    weather: ctx.weather,
    temperatureRequirement: ctx.temperatureRequirement,
  });
  if (missedTopic) {
    const label = { swim: 'swimming / water', cold: 'cold weather', run: 'running', formal: 'wedding / formal' }[missedTopic];
    return { valid: false, reason: `Response failed to address ${label} context` };
  }

  return {
    valid: true,
    sanitized: {
      assessment: res.assessment,
      headline: res.headline,
      contextFit: res.contextFit,
      whyJezsySaysThis: res.whyJezsySaysThis,
      whatWorks: res.whatWorks,
      whatConflicts: res.whatConflicts,
      personalization: res.personalization,
      stylistTake: res.stylistTake,
      improvements,
      missing: res.missing,
    },
  };
}

export interface IAIStylistProvider {
  analyze(
    packet: StylistEvidencePacket,
    wardrobeLookup?: Record<string, WardrobeItem>
  ): Promise<AIAnalysisResult>;
}

// The client owns the hard cutoff: whichever settles first, the response or this timer, wins. The server
// gives the provider 40s; a critique that needs longer than this is not worth waiting for because the
// deterministic critique is already available.
const CLIENT_LLM_TIMEOUT_MS = 45_000;

// Server reasons that mean "no LLM is configured here". Retrying on every critique only adds latency.
const NOT_CONFIGURED_REASONS = new Set([
  'NO_SERVER_LLM_KEY_CONFIGURED',
  'LLM_MODEL_NOT_CONFIGURED',
  'LLM_MODEL_INVALID',
]);
const NOT_CONFIGURED_TTL_MS = 10 * 60 * 1000;
let llmUnavailableUntil = 0;

/** Test hook: forget any cached "LLM not configured" state. */
export function resetAIStylistProviderState(): void {
  llmUnavailableUntil = 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`AI stylist request exceeded ${ms}ms client-side timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function httpErrorReason(error: unknown): string {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (status === 401) return 'Sign in is required for AI analysis';
  if (status === 429) return 'AI analysis rate limit reached';
  if (status === 403) return 'AI analysis rejected the outfit items';
  if (status === 400 || status === 413) return 'AI analysis rejected the request';
  return 'AI analysis is temporarily unavailable';
}

/**
 * Supabase Edge Function Provider for secure server-side LLM execution
 */
export class SupabaseEdgeAIStylistProvider implements IAIStylistProvider {
  async analyze(
    packet: StylistEvidencePacket,
    wardrobeLookup?: Record<string, WardrobeItem>
  ): Promise<AIAnalysisResult> {
    if (Date.now() < llmUnavailableUntil) {
      return {
        success: false,
        analysisMode: 'ruleBasedFallback',
        fallbackReason: 'LLM synthesis is not configured on the server',
      };
    }

    try {
      const { data, error } = await withTimeout(
        supabase.functions.invoke('ai-stylist-analyze', { body: packet }),
        CLIENT_LLM_TIMEOUT_MS
      );

      if (error) {
        return {
          success: false,
          analysisMode: 'ruleBasedFallback',
          fallbackReason: httpErrorReason(error),
        };
      }

      if (!data || !data.success) {
        const reason = typeof data?.reason === 'string' ? data.reason : 'Server indicated fallback required';
        if (NOT_CONFIGURED_REASONS.has(reason)) llmUnavailableUntil = Date.now() + NOT_CONFIGURED_TTL_MS;
        return {
          success: false,
          analysisMode: 'ruleBasedFallback',
          fallbackReason: reason,
        };
      }

      const validation = validateAIResponse(data.data, packet, wardrobeLookup);
      if (!validation.valid || !validation.sanitized) {
        return {
          success: false,
          analysisMode: 'ruleBasedFallback',
          fallbackReason: `Validation failed: ${validation.reason}`,
        };
      }

      return {
        success: true,
        data: validation.sanitized,
        provider: typeof data.provider === 'string' ? data.provider : 'supabase-edge',
        model: typeof data.model === 'string' ? data.model : 'unknown',
        analysisMode: 'hybridLLM',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        analysisMode: 'ruleBasedFallback',
        fallbackReason: `Network or runtime exception: ${msg}`,
      };
    }
  }
}

export const defaultAIStylistProvider: IAIStylistProvider = new SupabaseEdgeAIStylistProvider();
