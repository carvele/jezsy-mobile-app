export interface AddWardrobeItemInput {
  userId: string;
  category: string;
  garmentType: string;
  subCategory?: string | null;
  imageUrl: string;
  colorTags?: string[] | null;
}

export interface CapsuleItemInput {
  capsuleId: string;
  wardrobeItemId: string;
}
