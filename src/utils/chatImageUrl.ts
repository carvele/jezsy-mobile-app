import { resolveSignedStorageUrl } from './signedStorageUrl';

const BUCKET = 'chat-images';

// Thin wrapper kept so the chat screen's import stays unchanged; the logic is
// shared with payment receipts, which have the same private-bucket problem.
export function resolveChatImageUrl(imageUrl: string | null | undefined): Promise<string | null> {
  return resolveSignedStorageUrl(BUCKET, imageUrl);
}
