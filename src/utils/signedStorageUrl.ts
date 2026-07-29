import { supabase } from '@/src/lib/supabase';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

// chat-images and payment_receipts are both private buckets, and the columns
// pointing into them may hold either a bare object path (current rows) or a
// legacy full public URL (rows written before the buckets were privatized).
// Local optimistic URIs (file://, content://, ph://, asset://) pass through
// untouched since they are not in storage yet.
export async function resolveSignedStorageUrl(
  bucket: string,
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;

  if (!value.startsWith('http') && value.includes('://')) {
    return value;
  }

  let objectPath = value;
  if (value.startsWith('http')) {
    const marker = `/${bucket}/`;
    const index = value.indexOf(marker);
    if (index === -1) return value;
    objectPath = value.slice(index + marker.length).split('?')[0];
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
