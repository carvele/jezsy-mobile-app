import { Database } from '@/src/types/database.types';
import { OverallAssessment } from '@/src/utils/aiStylistAdvisor';

export type WardrobeItem = Database['public']['Tables']['wardrobe_items']['Row'];

export interface StylingIntent {
  rawPrompt: string;
  selectedOccasion?: string | null;
  formality?: 'formal' | 'semiFormal' | 'elevatedCasual' | 'casual';
  activity?: string;
  weather?: string;
  temperatureNeeds?: string;
  isIndoor?: boolean;
  mustUseItemIds?: string[];
  excludedItemIds?: string[];
  preferredColors?: string[];
  avoidedColors?: string[];
  comfortPriority?: boolean;
  modestyPreference?: boolean;
  conflictingConstraints?: string[];
}

export type StyleAdvisorVibe = 'polished' | 'relaxed' | 'comfortable' | 'minimal';

export interface StyleAdvisorChipContext {
  occasion?: string;
  weather?: string;
  temperature?: string;
  vibe?: StyleAdvisorVibe;
  comfort?: boolean;
}

export interface ExplicitTextProvenance {
  hasExplicitOccasion: boolean;
  hasExplicitFormality: boolean;
  hasExplicitWeather: boolean;
  hasExplicitTemperature: boolean;
  hasExplicitComfort: boolean;
  hasExplicitModesty: boolean;
  hasExplicitColors: boolean;
  hasExplicitGarments: boolean;
}

export interface CandidateGarmentSummary {
  wardrobeItemId: string;
  category: string;
  subCategory: string;
  name: string;
  colors: string[];
  material?: string;
  pattern?: string;
  formality: string;
  wearCount: number;
}

export interface CandidateOutfit {
  candidateId: string;
  items: WardrobeItem[];
  key: string; // sorted item IDs joined by '|'
  baseScore: number;
  colorMatchLabel: string;
  formalityLevel: string;
  isComfortFocused?: boolean;
  isStatementFocused?: boolean;
  hasDress: boolean;
  hasShoes: boolean;
  hasOuterwear: boolean;
  hasBag?: boolean;
  hasBelt?: boolean;
  accessoryCount?: number;
}

export interface CandidateGeneratorConfig {
  perSlotMax: number;             // default 8
  coreBaseLimit: number;          // default 12 (Top K core ensembles)
  accessoryCandidateLimit: number;// default 8 per subtype
  maxAccessoryBundlesPerCore: number; // default 6
  maxJewelryCount: number;        // default 2
  neglectDays: number;            // default 60
}

export const DEFAULT_GENERATOR_CONFIG: CandidateGeneratorConfig = {
  perSlotMax: 8,
  coreBaseLimit: 12,
  accessoryCandidateLimit: 8,
  maxAccessoryBundlesPerCore: 6,
  maxJewelryCount: 2,
  neglectDays: 60,
};

export interface WhyThisWorksDetails {
  summary: string;
  palette: string;
  silhouette: string;
  occasion: string;
  layering?: string;
  footwear?: string;
  accessories?: string;
}

export interface StylingAIRecommendation {
  candidateId: string;
  label: string;
  headline: string;
  intentMatch: string;
  whyThisWorks: WhyThisWorksDetails;
  proTip?: string;
}

export interface StylingOption {
  candidateId: string;
  items: WardrobeItem[];
  key: string;
  label: string; // Contextual: e.g. "Polished", "Contemporary", "Comfortable", or "Look 1", "Look 2", "Look 3"
  headline: string;
  intentMatch: string;
  whyThisWorks: WhyThisWorksDetails;
  proTip?: string;
  isAiRanked: boolean;
  assessment: OverallAssessment;
  score: number;
}

export type StylingRefinementType =
  | 'moreFormal'
  | 'moreRelaxed'
  | 'moreComfortable'
  | 'moreColorful'
  | 'moreModest'
  | 'tryAnother'
  | 'avoidItem'
  | 'useItem';
