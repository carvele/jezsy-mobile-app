import { supabase } from '../lib/supabase';
import {
  StylistEvidencePacket,
  StructuredAIResponse,
  AIAnalysisResult,
} from '../types/aiStylist';
import { WardrobeItem } from '../services/wardrobeService';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitized?: StructuredAIResponse;
}

/**
 * Validates the structured AI response against grounded facts, context relevance,
 * item ID validity, and section uniqueness.
 */
export function validateAIResponse(
  response: unknown,
  packet: StylistEvidencePacket,
  wardrobeLookup?: Record<string, WardrobeItem>
): ValidationResult {
  if (!response || typeof response !== 'object') {
    return { valid: false, reason: 'Response is not an object' };
  }

  const res = response as Partial<StructuredAIResponse>;

  // 1. Core structural presence
  const validAssessments = [
    'Appropriate for this occasion',
    'Could work with changes',
    'Not appropriate for this occasion',
    'Incomplete outfit',
  ];

  if (!res.assessment || !validAssessments.includes(res.assessment)) {
    return { valid: false, reason: `Invalid or missing assessment: "${res.assessment}"` };
  }

  if (!res.headline || typeof res.headline !== 'string' || res.headline.trim().length < 3) {
    return { valid: false, reason: 'Missing or empty headline' };
  }

  if (!res.whyJezsySaysThis || typeof res.whyJezsySaysThis !== 'string' || res.whyJezsySaysThis.trim().length < 15) {
    return { valid: false, reason: 'Missing or insufficient whyJezsySaysThis explanation' };
  }

  if (!res.stylistTake || typeof res.stylistTake !== 'string' || res.stylistTake.trim().length < 10) {
    return { valid: false, reason: 'Missing or insufficient stylistTake summary' };
  }

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

  // 4. Wardrobe item ID grounding validation
  const sanitizedImprovements: { reason: string; existingWardrobeItemIds: string[] }[] = [];
  if (Array.isArray(res.improvements)) {
    for (const imp of res.improvements) {
      if (imp && typeof imp.reason === 'string') {
        const validIds = (imp.existingWardrobeItemIds || []).filter((id) =>
          wardrobeLookup ? Boolean(wardrobeLookup[id]) : true
        );
        sanitizedImprovements.push({
          reason: imp.reason,
          existingWardrobeItemIds: validIds,
        });
      }
    }
  }

  // 5. Context relevance semantic check
  const fullContextText = `${packet.request.rawContext} ${JSON.stringify(packet.request.structuredContext)}`.toLowerCase();
  const fullResponseText = `${res.headline} ${res.whyJezsySaysThis} ${res.stylistTake} ${(res.whatConflicts || []).join(' ')}`.toLowerCase();

  // Swimming context check
  if (/swim|pool|water/i.test(fullContextText)) {
    if (!/swim|pool|water|chlorine|beach|aquatic/i.test(fullResponseText)) {
      return { valid: false, reason: 'Response failed to address swimming / water context' };
    }
  }

  // Cold weather check
  if (/cold|freezing|chilly|winter|snow/i.test(fullContextText) && !packet.request.structuredContext.isIndoorOverride) {
    if (!/cold|warm|thermal|temperature|chill|layer|insulat|bare leg/i.test(fullResponseText)) {
      return { valid: false, reason: 'Response failed to address cold weather context' };
    }
  }

  // Running check
  if (/run|5km|jog|sprint|marathon/i.test(fullContextText)) {
    if (!/run|jog|athletic|workout|km|pace|performance|cushion/i.test(fullResponseText)) {
      return { valid: false, reason: 'Response failed to address running context' };
    }
  }

  // Wedding / formal check
  if (/wedding|matrimony|nuptial|gala|black.?tie/i.test(fullContextText)) {
    if (!/wedding|formal|dress.?code|ceremony|elevat|tailor/i.test(fullResponseText)) {
      return { valid: false, reason: 'Response failed to address wedding / formal context' };
    }
  }

  const sanitized: StructuredAIResponse = {
    assessment: res.assessment,
    headline: res.headline,
    contextFit: res.contextFit,
    whyJezsySaysThis: res.whyJezsySaysThis,
    whatWorks: Array.isArray(res.whatWorks) ? res.whatWorks : undefined,
    whatConflicts: Array.isArray(res.whatConflicts) ? res.whatConflicts : undefined,
    personalization: res.personalization,
    stylistTake: res.stylistTake,
    improvements: sanitizedImprovements,
    missing: Array.isArray(res.missing) ? res.missing : undefined,
  };

  return { valid: true, sanitized };
}

export interface IAIStylistProvider {
  analyze(
    packet: StylistEvidencePacket,
    wardrobeLookup?: Record<string, WardrobeItem>
  ): Promise<AIAnalysisResult>;
}

/**
 * Supabase Edge Function Provider for secure server-side LLM execution
 */
export class SupabaseEdgeAIStylistProvider implements IAIStylistProvider {
  async analyze(
    packet: StylistEvidencePacket,
    wardrobeLookup?: Record<string, WardrobeItem>
  ): Promise<AIAnalysisResult> {
    try {
      const { data, error } = await supabase.functions.invoke('ai-stylist-analyze', {
        body: packet,
      });

      if (error) {
        return {
          success: false,
          analysisMode: 'ruleBasedFallback',
          fallbackReason: `Edge function invocation error: ${error.message}`,
        };
      }

      if (!data || !data.success) {
        return {
          success: false,
          analysisMode: 'ruleBasedFallback',
          fallbackReason: data?.reason || 'Server indicated fallback required',
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
        provider: data.provider || 'supabase-edge',
        model: data.model || 'gemini-1.5-flash',
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
