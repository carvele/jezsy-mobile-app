import { WardrobeItem, StylingIntent, CandidateOutfit, WhyThisWorksDetails } from './styleAdvisor';
import { UserStyleProfileDto } from './dto/styleProfile';
import { AccessorySubtype } from '@/src/utils/garmentSemanticClassifier';

export type CoreRemixSlotType = 'top' | 'bottom' | 'dress' | 'shoes' | 'outerwear';
export type OutfitRemixSlotType = CoreRemixSlotType | AccessorySubtype;

export const ACCESSORY_SLOT_CAPACITIES: Record<AccessorySubtype, number> = {
  bag: 1,
  belt: 1,
  watch: 1,
  headwear: 1,
  eyewear: 1,
  scarf: 1,
  gloves: 1,
  jewelry: 2,
};

export interface AccessorySlotState {
  subtype: AccessorySubtype;
  capacity: number;
  items: RemixedSlotItem[];
}

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
  preferenceActionId?: string;
}

export interface OutfitRemixState {
  sourceType: 'style-advisor' | 'passive-outfit' | 'saved-outfit';
  originalOutfitKey: string;
  /** Core slots: exactly 1 per core slot type */
  slots: Record<CoreRemixSlotType, RemixedSlotItem | null>;
  /** Typed accessory slots with explicit capacities */
  accessorySlots?: Partial<Record<AccessorySubtype, AccessorySlotState>>;
  /** Unassigned accessories, unknown items, or deleted snapshots */
  passthroughItems: WardrobeItem[];
  history: string[]; // Bounded ring buffer (capacity 10) of newest-first outfit keys
  intent: StylingIntent;
  profile?: UserStyleProfileDto | null;
  activeCandidate: CandidateOutfit | null;
  isDirty: boolean;
  error?: string | null;
  missingItems?: { id: string; slot?: string; name?: string }[];
}

