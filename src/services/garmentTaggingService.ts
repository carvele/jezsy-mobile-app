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
    case 'TAGGING_PROVIDER_REJECTED':
      return 'Auto-detect needs a compatible Gemini model. Please check its server setup, then try again.';
    case 'TAGGING_PROVIDER_NOT_AUTHORIZED':
      return 'Auto-detect could not access Gemini. Please check its server key, then try again.';
    case 'TAGGING_PROVIDER_LIMITED':
      return 'Gemini has reached its current limit. Please try again later or enter the details manually.';
    case 'INVALID_PROVIDER_RESPONSE':
      return 'Auto-detect returned incomplete details. Please try again or enter them manually.';
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
  if (error) {
    const response = (error as { context?: Response }).context;
    let reason: string | undefined;
    if (response && typeof response.clone === 'function') {
      try {
        const body = await response.clone().json() as TaggingResponse;
        reason = !body.success ? body.reason : undefined;
      } catch {
        reason = undefined;
      }
    }
    throw new Error(messageFor(reason));
  }
  if (!data || !data.success) throw new Error(messageFor(data && !data.success ? data.reason : undefined));
  return data.suggestion;
}
