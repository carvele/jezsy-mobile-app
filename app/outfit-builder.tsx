import { useEffect } from 'react';
import { useRouter } from 'expo-router';

// outfit-builder is retired. Mannequin is the canonical outfit composition experience.
// This redirect preserves any existing deep-links or bookmarked routes.
export default function OutfitBuilderRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/wardrobe?tab=mannequin' as any);
  }, [router]);
  return null;
}

