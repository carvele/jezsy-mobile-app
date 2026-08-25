import { supabase } from '@/src/lib/supabase';
import { decode } from 'base64-arraybuffer';
import { resolveImageFileInfo } from '@/src/utils/imageUpload';

// Shared because the receipt is now uploaded from the reservation detail
// screen (after staff accept) rather than at reservation time.
//
// Uploads decoded base64 rather than wrapping a file:// uri in FormData --
// the latter fails with "Network request failed" on Android.
//
// The path is prefixed with the uploader's id because submit_reservation_receipt
// checks that prefix to prove ownership; changing this shape breaks that guard.
export async function uploadPaymentReceipt(
  userId: string,
  uri: string,
  base64: string,
): Promise<string> {
  const { contentType, ext } = resolveImageFileInfo(uri);
  const fileName = `${userId}/${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from('payment_receipts')
    .upload(fileName, decode(base64), { upsert: false, contentType });

  if (error) throw error;
  return data.path;
}
