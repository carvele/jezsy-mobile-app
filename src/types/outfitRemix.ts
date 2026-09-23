import { WardrobeItem, StylingIntent, CandidateOutfit, WhyThisWorksDetails } from './styleAdvisor';
import { UserStyleProfileDto } from './dto/styleProfile';

export type OutfitRemixSlotType = 'top' | 'bottom' | 'dress' | 'shoes' | 'outerwear';

export type RemixLockReason =
  | 'style-around'     // Phase D session anchor ("Style Around This Item")
  | 'parent-must-use'  // Authoritative parent intent requirement (prompt or refinement)
  | 'remix';           // Locally toggled by user inside Remix drawer

export interface RemixedSlotItem {
  slotType: OutfitRemixSlotType;
  item: WardrobeItem;
  isLocked: boolean;
  lockReason: RemixLockReason;
  canUnlockInRemix: boolean; // false for style-around and parent-must-use
}

export interface OutfitRemixResult {
  items: WardrobeItem[];
  outfitKey: string;
  score: number;
  headline: string;
  label: string;
  whyThisWorks: WhyThisWorksDetails;
  isRemixedDraft: boolean;
}

export interface OutfitRemixState {
  sourceType: 'style-advisor' | 'passive-outfit' | 'saved-outfit';
  originalOutfitKey: string;
  slots: Record<OutfitRemixSlotType, RemixedSlotItem | null>;
  passthroughItems: WardrobeItem[]; // Accessories, unknown items (Phase F boundary)
  history: string[]; // Bounded ring buffer (capacity 10) of newest-first outfit keys
  intent: StylingIntent;
  profile?: UserStyleProfileDto | null;
  activeCandidate: CandidateOutfit | null;
  isDirty: boolean;
  error?: string | null;
  missingItems?: { id: string; slot?: string; name?: string }[];
}
