import { supabase } from '@/src/lib/supabase';

const BUCKET = 'chat-images';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// The chat-images bucket is private; messages.image_url may hold either a
// legacy full public URL (pre-privatization rows) or a bare object path
// (new rows). Local optimistic URIs (file://, content://, ph://, asset://)
// are passed through untouched since they aren't in storage yet.
export async function resolveChatImageUrl(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null;

  if (!imageUrl.startsWith('http') && imageUrl.includes('://')) {
    return imageUrl;
  }

  let objectPath = imageUrl;
  if (imageUrl.startsWith('http')) {
    const marker = `/${BUCKET}/`;
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return imageUrl;
    objectPath = imageUrl.slice(idx + marker.length).split('?')[0];
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
