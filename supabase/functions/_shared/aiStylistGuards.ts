/**
 * Pure validation helpers for the AI stylist. Shared by the ai-stylist-analyze Edge Function and
 * the client (aiStylistProvider). No imports and no runtime globals, so it runs under Deno, Metro and Jest.
 *
 * Everything here treats its input as untrusted: the evidence packet is client supplied and the
 * model output is model supplied. Both are rebuilt from a whitelist rather than passed through.
 */

export const MAX_PACKET_CHARS = 20_000;
export const MAX_OUTFIT_ITEMS = 12;

export type Assessment =
  | 'Appropriate for this occasion'
  | 'Could work with changes'
  | 'Not appropriate for this occasion'
  | 'Incomplete outfit';

export const ASSESSMENTS: readonly Assessment[] = [
  'Appropriate for this occasion',
  'Could work with changes',
  'Not appropriate for this occasion',
  'Incomplete outfit',
];

export type ContradictionSeverity = 'severe' | 'major' | 'moderate' | 'minor';
const SEVERITIES: readonly ContradictionSeverity[] = ['severe', 'major', 'moderate', 'minor'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Shape check only. Whether the caller owns the id is decided by the database, never by this. */
export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && SAFE_ID_RE.test(v);
}

/** Higher = stricter verdict. Incomplete sits above "could work" because a missing base garment is not a style nuance. */
export function assessmentRank(a: Assessment | string | undefined): number {
  switch (a) {
    case 'Appropriate for this occasion':
      return 0;
    case 'Could work with changes':
      return 1;
    case 'Incomplete outfit':
      return 2;
    case 'Not appropriate for this occasion':
      return 3;
    default:
      return 0;
  }
}

/** True when the AI verdict is more lenient than the deterministic evidence allows. */
export function aiVerdictIsMoreLenient(ai: Assessment | string, deterministic: Assessment | string): boolean {
  return assessmentRank(ai) < assessmentRank(deterministic);
}

/** Lowest verdict the packet's own contradictions permit. */
export function assessmentFloorFromContradictions(
  contradictions: { severity: string }[] | undefined
): Assessment {
  if (!contradictions || contradictions.length === 0) return 'Appropriate for this occasion';
  if (contradictions.some((c) => c.severity === 'severe')) return 'Not appropriate for this occasion';
  if (contradictions.some((c) => c.severity === 'major')) return 'Could work with changes';
  return 'Appropriate for this occasion';
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Trims, strips control characters and clips. Returns undefined for non-strings or empty results. */
export function clipText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const cleaned = v.replace(CONTROL_CHARS, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function clipList(v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const entry of v) {
    const s = clipText(entry, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Evidence packet (client -> server)
// ---------------------------------------------------------------------------------------------

export interface SanitizedVisualEvidence {
  visualGarmentFamily: string;
  formalitySignal: number;
  athleticSignal: boolean;
  swimwearSignal: boolean;
  visualPattern: string | null;
  dominantColors: { name: string; hex: string; role: string; confidence: number }[];
  isRealMl: boolean;
  modelName: string;
  confidence: number;
  lowConfidence: boolean;
}

export interface SanitizedPacket {
  request: {
    analysisId: string;
    rawContext: string;
    structuredContext: Record<string, string | boolean>;
    generatedAt: string;
  };
  outfit: {
    items: {
      wardrobeItemId: string;
      category: string;
      subCategory: string;
      effectiveGarmentBucket?: string;
      garmentType?: string;
      garmentFamily?: string;
      garmentSubtype?: string;
      description?: string;
      userNotes?: string;
      whereWorn?: string;
      rawColor?: string;
      colorTags?: string[];
      thermalLevel?: string;
      coverageLevel?: string;
      functionalRole?: string;
      personalUsage?: { activities?: string[]; rawText?: string };
      styleSignals?: Record<string, boolean>;
      visualEvidence?: SanitizedVisualEvidence;
    }[];
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
  requirements: Record<string, string | boolean>;
  contradictions: { dimension: string; severity: ContradictionSeverity; message: string; garmentId?: string }[];
  personalization: { garmentId: string; description?: string; activities?: string[] }[];
  visualEvidence?: {
    paletteColors: string[];
    dominantColors?: { name: string; hex: string }[];
    itemEvidence?: Record<string, SanitizedVisualEvidence>;
    colorHarmonyNote?: string;
    overallFormalitySignal?: number;
    visualAnalysisMode?: string;
  };
}

const STRUCTURED_CONTEXT_KEYS = [
  'rawOccasion',
  'rawAdditionalContext',
  'activity',
  'occasionType',
  'timeOfDay',
  'weather',
  'temperatureRequirement',
  'socialContext',
  'environment',
  'isIndoorOverride',
] as const;

function sanitizeVisualEvidence(v: unknown): SanitizedVisualEvidence | undefined {
  if (!isRecord(v)) return undefined;
  const colors = Array.isArray(v.dominantColors) ? v.dominantColors : [];
  const dominantColors: SanitizedVisualEvidence['dominantColors'] = [];
  for (const c of colors.slice(0, 6)) {
    if (!isRecord(c)) continue;
    const name = clipText(c.name, 40);
    const hex = clipText(c.hex, 9);
    if (!name || !hex) continue;
    dominantColors.push({
      name,
      hex,
      role: clipText(c.role, 12) ?? 'dominant',
      confidence: num(c.confidence, 0, 1) ?? 0,
    });
  }
  return {
    visualGarmentFamily: clipText(v.visualGarmentFamily, 40) ?? 'unknown',
    formalitySignal: num(v.formalitySignal, 0, 1) ?? 0.35,
    athleticSignal: v.athleticSignal === true,
    swimwearSignal: v.swimwearSignal === true,
    visualPattern: clipText(v.visualPattern, 40) ?? null,
    dominantColors,
    isRealMl: v.isRealMl === true,
    modelName: clipText(v.modelName, 80) ?? 'unknown',
    confidence: num(v.confidence, 0, 1) ?? 0,
    // Missing or malformed confidence must never read as trustworthy evidence.
    lowConfidence: v.lowConfidence === false && typeof v.confidence === 'number' ? false : true,
  };
}

export type PacketValidation =
  | { ok: true; packet: SanitizedPacket; wardrobeIds: string[] }
  | { ok: false; reason: string };

/**
 * Rebuilds the packet from a whitelist with bounded sizes. Unknown fields are dropped, so nothing the
 * client adds can reach the prompt. The item ids that look like wardrobe uuids are returned for the
 * server-side ownership check.
 */
export function validateEvidencePacket(raw: unknown): PacketValidation {
  if (!isRecord(raw)) return { ok: false, reason: 'PACKET_NOT_OBJECT' };
  if (!isRecord(raw.request) || !isRecord(raw.outfit)) return { ok: false, reason: 'PACKET_MISSING_FIELDS' };
  if (!Array.isArray(raw.outfit.items) || raw.outfit.items.length === 0) {
    return { ok: false, reason: 'PACKET_NO_ITEMS' };
  }
  if (raw.outfit.items.length > MAX_OUTFIT_ITEMS) return { ok: false, reason: 'PACKET_TOO_MANY_ITEMS' };

  const analysisId = clipText(raw.request.analysisId, 64);
  if (!analysisId) return { ok: false, reason: 'PACKET_MISSING_ANALYSIS_ID' };

  const rawCtx = isRecord(raw.request.structuredContext) ? raw.request.structuredContext : {};
  const structuredContext: Record<string, string | boolean> = {};
  for (const key of STRUCTURED_CONTEXT_KEYS) {
    const val = rawCtx[key];
    if (typeof val === 'boolean') structuredContext[key] = val;
    else {
      const s = clipText(val, key === 'rawAdditionalContext' ? 500 : 120);
      if (s) structuredContext[key] = s;
    }
  }

  const items: SanitizedPacket['outfit']['items'] = [];
  const wardrobeIds: string[] = [];
  for (const it of raw.outfit.items) {
    if (!isRecord(it)) return { ok: false, reason: 'PACKET_ITEM_MALFORMED' };
    const id = clipText(it.wardrobeItemId, 64);
    if (!id) return { ok: false, reason: 'PACKET_ITEM_MISSING_ID' };
    if (isUuid(id)) wardrobeIds.push(id);

    const style: Record<string, boolean> = {};
    if (isRecord(it.styleSignals)) {
      for (const [k, val] of Object.entries(it.styleSignals).slice(0, 24)) {
        if (typeof val === 'boolean' && /^[A-Za-z0-9_]{1,40}$/.test(k)) style[k] = val;
      }
    }
    const pu = isRecord(it.personalUsage) ? it.personalUsage : null;

    items.push({
      wardrobeItemId: id,
      category: clipText(it.category, 80) ?? '',
      subCategory: clipText(it.subCategory, 80) ?? '',
      effectiveGarmentBucket: clipText(it.effectiveGarmentBucket, 24),
      garmentType: clipText(it.garmentType, 40),
      garmentFamily: clipText(it.garmentFamily, 40),
      garmentSubtype: clipText(it.garmentSubtype, 60),
      description: clipText(it.description, 300),
      userNotes: clipText(it.userNotes, 300),
      whereWorn: clipText(it.whereWorn, 200),
      rawColor: clipText(it.rawColor, 80),
      colorTags: clipList(it.colorTags, 8, 40),
      thermalLevel: clipText(it.thermalLevel, 24),
      coverageLevel: clipText(it.coverageLevel, 24),
      functionalRole: clipText(it.functionalRole, 40),
      personalUsage: pu
        ? { activities: clipList(pu.activities, 8, 40), rawText: clipText(pu.rawText, 200) }
        : undefined,
      styleSignals: Object.keys(style).length > 0 ? style : undefined,
      visualEvidence: sanitizeVisualEvidence(it.visualEvidence),
    });
  }

  const st = isRecord(raw.structure) ? raw.structure : {};
  const structure: SanitizedPacket['structure'] = {
    completeness: clipText(st.completeness, 24) ?? 'incomplete',
    hasTop: st.hasTop === true,
    hasBottom: st.hasBottom === true,
    hasOnePiece: st.hasOnePiece === true,
    hasOuterwear: st.hasOuterwear === true,
    hasShoes: st.hasShoes === true,
    isOvercrowded: st.isOvercrowded === true,
    structuralNotes: clipText(st.structuralNotes, 200),
  };

  const requirements: Record<string, string | boolean> = {};
  if (isRecord(raw.requirements)) {
    for (const [k, val] of Object.entries(raw.requirements).slice(0, 16)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
      if (typeof val === 'boolean') requirements[k] = val;
      else {
        const s = clipText(val, 40);
        if (s) requirements[k] = s;
      }
    }
  }

  const contradictions: SanitizedPacket['contradictions'] = [];
  if (Array.isArray(raw.contradictions)) {
    for (const c of raw.contradictions.slice(0, 20)) {
      if (!isRecord(c)) continue;
      const severity = SEVERITIES.find((s) => s === c.severity);
      const message = clipText(c.message, 300);
      if (!severity || !message) continue;
      contradictions.push({
        dimension: clipText(c.dimension, 40) ?? 'general',
        severity,
        message,
        garmentId: clipText(c.garmentId, 64),
      });
    }
  }

  const personalization: SanitizedPacket['personalization'] = [];
  if (Array.isArray(raw.personalization)) {
    for (const p of raw.personalization.slice(0, MAX_OUTFIT_ITEMS)) {
      if (!isRecord(p)) continue;
      const garmentId = clipText(p.garmentId, 64);
      if (!garmentId) continue;
      personalization.push({
        garmentId,
        description: clipText(p.description, 300),
        activities: clipList(p.activities, 8, 40),
      });
    }
  }

  let visualEvidence: SanitizedPacket['visualEvidence'];
  if (isRecord(raw.visualEvidence)) {
    const ve = raw.visualEvidence;
    const itemEvidence: Record<string, SanitizedVisualEvidence> = {};
    if (isRecord(ve.itemEvidence)) {
      for (const [k, val] of Object.entries(ve.itemEvidence).slice(0, MAX_OUTFIT_ITEMS)) {
        const cleaned = sanitizeVisualEvidence(val);
        if (cleaned && k.length <= 64) itemEvidence[k] = cleaned;
      }
    }
    const dom: { name: string; hex: string }[] = [];
    if (Array.isArray(ve.dominantColors)) {
      for (const c of ve.dominantColors.slice(0, 12)) {
        if (!isRecord(c)) continue;
        const name = clipText(c.name, 40);
        const hex = clipText(c.hex, 9);
        if (name && hex) dom.push({ name, hex });
      }
    }
    visualEvidence = {
      paletteColors: clipList(ve.paletteColors, 16, 40) ?? [],
      dominantColors: dom.length > 0 ? dom : undefined,
      itemEvidence: Object.keys(itemEvidence).length > 0 ? itemEvidence : undefined,
      colorHarmonyNote: clipText(ve.colorHarmonyNote, 300),
      overallFormalitySignal: num(ve.overallFormalitySignal, 0, 1),
      visualAnalysisMode: clipText(ve.visualAnalysisMode, 16),
    };
  }

  return {
    ok: true,
    wardrobeIds: Array.from(new Set(wardrobeIds)),
    packet: {
      request: {
        analysisId,
        rawContext: clipText(raw.request.rawContext, 600) ?? '',
        structuredContext,
        generatedAt: clipText(raw.request.generatedAt, 40) ?? '',
      },
      outfit: { items },
      structure,
      requirements,
      contradictions,
      personalization,
      visualEvidence,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Model output (server -> client)
// ---------------------------------------------------------------------------------------------

export interface SanitizedAIResponse {
  assessment: Assessment;
  headline: string;
  contextFit?: Partial<Record<'occasion' | 'activity' | 'weather' | 'thermal' | 'social' | 'practicality', string>>;
  whyJezsySaysThis: string;
  whatWorks?: string[];
  whatConflicts?: string[];
  personalization?: string;
  stylistTake: string;
  improvements?: { reason: string; existingWardrobeItemIds: string[] }[];
  missing?: string[];
}

export type ResponseValidation = { ok: true; value: SanitizedAIResponse } | { ok: false; reason: string };

const CONTEXT_FIT_KEYS = ['occasion', 'activity', 'weather', 'thermal', 'social', 'practicality'] as const;

/**
 * Schema check for model output. Every field that reaches the UI is a bounded plain string (or list of
 * them), so a malformed or hostile response can neither crash a render nor smuggle structure through.
 */
export function sanitizeAIResponse(raw: unknown): ResponseValidation {
  if (!isRecord(raw)) return { ok: false, reason: 'Response is not an object' };

  const assessment = ASSESSMENTS.find((a) => a === raw.assessment);
  if (!assessment) return { ok: false, reason: `Invalid or missing assessment` };

  const headline = clipText(raw.headline, 140);
  if (!headline || headline.length < 3) return { ok: false, reason: 'Missing or empty headline' };

  const why = clipText(raw.whyJezsySaysThis, 900);
  if (!why || why.length < 15) return { ok: false, reason: 'Missing or insufficient whyJezsySaysThis explanation' };

  const take = clipText(raw.stylistTake, 700);
  if (!take || take.length < 10) return { ok: false, reason: 'Missing or insufficient stylistTake summary' };

  let contextFit: SanitizedAIResponse['contextFit'];
  if (isRecord(raw.contextFit)) {
    const cf: NonNullable<SanitizedAIResponse['contextFit']> = {};
    for (const key of CONTEXT_FIT_KEYS) {
      const s = clipText(raw.contextFit[key], 300);
      if (s) cf[key] = s;
    }
    if (Object.keys(cf).length > 0) contextFit = cf;
  }

  const improvements: NonNullable<SanitizedAIResponse['improvements']> = [];
  if (Array.isArray(raw.improvements)) {
    for (const imp of raw.improvements.slice(0, 6)) {
      if (!isRecord(imp)) continue;
      const reason = clipText(imp.reason, 300);
      if (!reason) continue;
      const ids = Array.isArray(imp.existingWardrobeItemIds)
        ? imp.existingWardrobeItemIds.filter(isSafeId).slice(0, 6)
        : [];
      improvements.push({ reason, existingWardrobeItemIds: Array.from(new Set(ids)) });
    }
  }

  return {
    ok: true,
    value: {
      assessment,
      headline,
      contextFit,
      whyJezsySaysThis: why,
      whatWorks: clipList(raw.whatWorks, 6, 300),
      whatConflicts: clipList(raw.whatConflicts, 6, 300),
      personalization: clipText(raw.personalization, 400),
      stylistTake: take,
      improvements,
      missing: clipList(raw.missing, 6, 200),
    },
  };
}

/** Drops improvement item ids the caller does not own; the AI's ids are never authoritative. */
export function restrictImprovementIds(
  value: SanitizedAIResponse,
  ownedIds: ReadonlySet<string>
): SanitizedAIResponse {
  return {
    ...value,
    improvements: (value.improvements ?? []).map((imp) => ({
      reason: imp.reason,
      existingWardrobeItemIds: imp.existingWardrobeItemIds.filter((id) => ownedIds.has(id)),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Context relevance (word-boundary matching)
// ---------------------------------------------------------------------------------------------

/** Whole-word test. `stems` may end in `\w*` style stems, e.g. 'swim' matches swim, swimming, swimmer. */
export function mentionsWord(text: string, stems: readonly string[]): boolean {
  const alternation = stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`\\b(?:${alternation})\\w*`, 'i').test(text);
}

export interface ContextRelevanceInput {
  /** The user's own words: occasion + additional context. */
  userText: string;
  activity?: string;
  occasionType?: string;
  isIndoorOverride?: boolean;
  weather?: string;
  temperatureRequirement?: string;
}

const SWIM_STEMS = ['swim', 'pool', 'water', 'aquatic', 'chlorin', 'beach'] as const;
const COLD_STEMS = ['cold', 'freez', 'chill', 'winter', 'snow'] as const;
const RUN_STEMS = ['run', 'jog', 'sprint', 'marathon', '5km', '10km', '5k', '10k'] as const;
const FORMAL_STEMS = ['wedding', 'matrimon', 'nuptial', 'gala', 'black tie', 'black-tie', 'blacktie'] as const;

/**
 * Names the topics the user's context makes mandatory for a response to address. Uses whole-word matching,
 * so "brunch" is not "run" and "scold" is not "cold".
 */
export function requiredTopics(ctx: ContextRelevanceInput): ('swim' | 'cold' | 'run' | 'formal')[] {
  const topics: ('swim' | 'cold' | 'run' | 'formal')[] = [];
  const t = ctx.userText || '';
  if (ctx.activity === 'activeSwimming' || ctx.occasionType === 'swimming' || mentionsWord(t, SWIM_STEMS)) {
    topics.push('swim');
  }
  const coldStructured = ctx.weather === 'cold' || ctx.temperatureRequirement === 'warmthNeeded';
  if (!ctx.isIndoorOverride && (coldStructured || mentionsWord(t, COLD_STEMS))) topics.push('cold');
  if (ctx.activity === 'running' || ctx.occasionType === 'running' || mentionsWord(t, RUN_STEMS)) topics.push('run');
  if (mentionsWord(t, FORMAL_STEMS)) topics.push('formal');
  return topics;
}

const TOPIC_RESPONSE_STEMS: Record<'swim' | 'cold' | 'run' | 'formal', readonly string[]> = {
  swim: ['swim', 'pool', 'water', 'chlorin', 'beach', 'aquatic'],
  cold: ['cold', 'warm', 'thermal', 'temperature', 'chill', 'layer', 'insulat', 'bare leg', 'freez'],
  run: ['run', 'jog', 'athletic', 'workout', 'km', 'pace', 'performance', 'cushion'],
  formal: ['wedding', 'formal', 'dress code', 'dress-code', 'ceremony', 'elevat', 'tailor'],
};

/** Returns the first mandatory topic the response text fails to address, or null. */
export function firstUnaddressedTopic(
  responseText: string,
  ctx: ContextRelevanceInput
): 'swim' | 'cold' | 'run' | 'formal' | null {
  for (const topic of requiredTopics(ctx)) {
    if (!mentionsWord(responseText, TOPIC_RESPONSE_STEMS[topic])) return topic;
  }
  return null;
}
