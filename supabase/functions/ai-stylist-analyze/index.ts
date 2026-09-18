import { corsHeaders, handleCors } from '../_shared/cors.ts';

const jsonResponse = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });

// Free-tier LLM providers can stall far longer than a user will wait; bail out fast
// so the client falls back to the deterministic engine instead of hanging.
const LLM_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface StylistEvidencePacket {
  request: {
    analysisId: string;
    rawContext: string;
    structuredContext: Record<string, unknown>;
    generatedAt: string;
  };
  outfit: {
    items: Array<{
      wardrobeItemId: string;
      category: string;
      subCategory: string;
      description?: string;
      personalUsage?: string;
      color?: string;
      colorTags?: string[];
      thermalLevel?: string;
      functionalRole?: string;
      styleSignals?: Record<string, boolean>;
    }>;
  };
  structure: {
    completeness: string;
    hasTop: boolean;
    hasBottom: boolean;
    hasOnePiece: boolean;
    hasOuterwear: boolean;
    hasShoes: boolean;
    isOvercrowded: boolean;
    structuralNotes?: string;
  };
  requirements: Record<string, unknown>;
  contradictions: Array<{
    dimension: string;
    severity: string;
    message: string;
    garmentId?: string;
  }>;
  personalization: Array<{
    garmentId: string;
    description?: string;
    activities?: string[];
  }>;
  visualEvidence?: {
    paletteColors: string[];
    dominantColors?: Array<{ name: string; hex: string }>;
  };
}

const SYSTEM_PROMPT = `You are JeZsy's expert AI fashion stylist.
You evaluate outfits based on grounded evidence, actual garment properties, and the user's specific context.

STRICT OPERATING RULES:
1. REASON OVER EVIDENCE: You are provided with a structured evidence packet containing the user's active garments, descriptions, usage habits, and detected contradictions. Use this evidence directly.
2. NO HALLUCINATION: Never invent garments, materials, brands, weather conditions, or wardrobe items not present in the packet.
3. CONTEXT FIRST: The current user context dictates which garment relationships matter. A piece that is great for running may conflict heavily with a formal dinner or a pool swim.
4. HONEST CONTRADICTIONS: When severe or major contradictions exist (e.g., bare legs in freezing cold, running shorts at a formal wedding, knit sweaters in a swimming pool), state them directly as the primary issue before addressing minor aesthetic points.
5. NO GENERIC FILLER: Never use meaningless boilerplate like "comfortable separates suited for", "relaxed and wearable", or "effortlessly styled" unless directly supported by evidence.
6. DISTINCT SECTIONS:
   - "whyJezsySaysThis": The primary causal explanation for the verdict.
   - "whatWorks": Only genuine positive evidence and functional/aesthetic benefits.
   - "whatConflicts": Specific clashes, thermal/activity mismatches, or formality conflicts.
   - "stylistTake": Concise, professional, nuanced synthesis.
   Do not repeat the exact same sentences across these sections.
7. ACTIONABLE RECOMMENDATIONS: When suggesting alternative pieces, reference real items or state that none exist in the user's wardrobe.
8. RETURN PURE JSON: Return ONLY a valid JSON object matching the requested schema.`;

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405);
  }

  let packet: StylistEvidencePacket;
  try {
    packet = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON payload' }, 400);
  }

  if (!packet || !packet.request || !packet.outfit) {
    return jsonResponse(req, { error: 'Missing required evidence packet fields' }, 400);
  }

  // Check for server-side configured AI keys
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('AI_STYLING_API_KEY');
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

  if (!geminiApiKey && !openaiApiKey && !openrouterApiKey) {
    return jsonResponse(req, {
      success: false,
      fallbackRequired: true,
      reason: 'NO_SERVER_LLM_KEY_CONFIGURED',
      message: 'No server-side AI provider key configured. Use deterministic evidence fallback.',
    });
  }

  const promptContent = `EVIDENCE PACKET:
${JSON.stringify(packet, null, 2)}

Produce a structured JSON critique with this exact schema:
{
  "assessment": "Appropriate for this occasion" | "Could work with changes" | "Not appropriate for this occasion" | "Incomplete outfit",
  "headline": "Short punchy headline (e.g. 'Thermal Mismatch for Cold Night')",
  "contextFit": {
    "occasion": "Evaluation against occasion",
    "activity": "Evaluation against activity",
    "weather": "Evaluation against weather/temperature",
    "thermal": "Evaluation of thermal balance",
    "social": "Evaluation of social appropriateness",
    "practicality": "Practical considerations"
  },
  "whyJezsySaysThis": "Clear causal explanation referencing specific garments and context",
  "whatWorks": ["Positive factor 1", "Positive factor 2"],
  "whatConflicts": ["Specific conflict 1", "Specific conflict 2"],
  "personalization": "Observation referencing user wear habits or descriptions if present",
  "stylistTake": "One cohesive, professional stylist summary",
  "improvements": [
    {
      "reason": "Why this change helps",
      "existingWardrobeItemIds": []
    }
  ],
  "missing": ["Any missing foundational layer or footwear"]
}`;

  try {
    let resultJson: string | null = null;
    let providerName = 'unknown';
    let modelName = 'unknown';

    if (geminiApiKey) {
      providerName = 'gemini';
      modelName = 'gemini-1.5-flash';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: `${SYSTEM_PROMPT}\n\n${promptContent}` }],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
        },
        LLM_TIMEOUT_MS
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error('[ai-stylist-analyze] Gemini API error:', response.status, errText);
        return jsonResponse(req, {
          success: false,
          fallbackRequired: true,
          reason: 'GEMINI_API_ERROR',
          status: response.status,
        });
      }

      const data = await response.json();
      resultJson = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } else if (openaiApiKey || openrouterApiKey) {
      providerName = openaiApiKey ? 'openai' : 'openrouter';
      modelName = openaiApiKey ? 'gpt-4o-mini' : 'deepseek/deepseek-v4-flash-0731:free';
      const endpoint = openaiApiKey
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions';
      const key = openaiApiKey || openrouterApiKey;

      const response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: promptContent },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
          }),
        },
        LLM_TIMEOUT_MS
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error('[ai-stylist-analyze] LLM API error:', response.status, errText);
        return jsonResponse(req, {
          success: false,
          fallbackRequired: true,
          reason: 'LLM_API_ERROR',
          status: response.status,
        });
      }

      const data = await response.json();
      resultJson = data?.choices?.[0]?.message?.content ?? null;
    }

    if (!resultJson) {
      return jsonResponse(req, {
        success: false,
        fallbackRequired: true,
        reason: 'EMPTY_LLM_RESPONSE',
      });
    }

    const parsed = JSON.parse(resultJson);
    return jsonResponse(req, {
      success: true,
      data: parsed,
      provider: providerName,
      model: modelName,
      analysisId: packet.request.analysisId,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[ai-stylist-analyze] LLM request timed out after', LLM_TIMEOUT_MS, 'ms');
      return jsonResponse(req, {
        success: false,
        fallbackRequired: true,
        reason: 'LLM_TIMEOUT',
      });
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[ai-stylist-analyze] Unexpected server error:', errorMsg);
    return jsonResponse(req, {
      success: false,
      fallbackRequired: true,
      reason: 'SERVER_EXCEPTION',
      error: errorMsg,
    });
  }
});
