import { encode } from 'base64-arraybuffer';
import { supabase } from '@/src/lib/supabase';
import { resolveImageFileInfo } from '@/src/utils/imageUpload';

export type GarmentTagSuggestion = {
  category: 'Top' | 'Bottom' | 'Dress' | 'Outerwear' | 'Shoes' | 'Accessory';
  subCategory: string;
  primaryColor: string;
  colorTags: string[];
  pattern: string;
  material: string;
  fit: string;
  lengthType: string;
  sleeveType: string;
  neckline: string;
  silhouette: string;
  confidence: number;
};

type TaggingResponse =
  | { success: true; suggestion: GarmentTagSuggestion }
  | { success: false; reason?: string };

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function messageFor(reason?: string): string {
  switch (reason) {
    case 'TAGGING_NOT_CONFIGURED':
      return 'Auto-detect is not available right now. You can enter the details manually.';
    case 'IMAGE_TOO_LARGE':
      return 'This photo is too large to auto-detect. You can still enter the details manually.';
    case 'RATE_LIMITED':
      return 'Auto-detect is busy right now. Please enter the details manually or try again later.';
    default:
      return 'Could not detect clothing details. Please enter them manually.';
  }
}

export async function analyzeGarmentImage(uri: string): Promise<GarmentTagSuggestion> {
  const image = await fetch(uri);
  if (!image.ok) throw new Error(messageFor());
  const bytes = await image.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(messageFor('IMAGE_TOO_LARGE'));
  }
  const { contentType } = resolveImageFileInfo(uri, image.headers.get('content-type'));
  const { data, error } = await supabase.functions.invoke<TaggingResponse>('analyze-wardrobe-image', {
    body: { mimeType: contentType, imageBase64: encode(bytes) },
  });
  if (error || !data || !data.success) throw new Error(messageFor(data && !data.success ? data.reason : undefined));
  return data.suggestion;
}
