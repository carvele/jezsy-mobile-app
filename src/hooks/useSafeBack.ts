import { useRouter } from "expo-router";
import { useCallback } from "react";

/**
 * Custom hook providing a safe back navigation helper.
 * Checks router.canGoBack() before attempting back navigation.
 * If no back stack entry exists (e.g. accessed via deep link or push notification),
 * falls back to the specified default route (defaults to '/').
 */
export function useSafeBack(fallbackRoute: string = "/") {
  const router = useRouter();

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallbackRoute as any);
    }
  }, [router, fallbackRoute]);

  return goBack;
}
