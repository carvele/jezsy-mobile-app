import { supabase } from "@/src/lib/supabase";

/**
 * Supabase's password-recovery email links to `redirectTo` with the session
 * tokens in the URL fragment (implicit flow), e.g.
 * `jezsymobileapp://reset-password#access_token=...&refresh_token=...&type=recovery`.
 * React Native's Linking API hands us the whole URL string including that
 * fragment (there's no browser to strip it), so we parse it by hand rather
 * than relying on URLSearchParams against the query string.
 */
export function parseRecoveryTokens(
  url: string,
): { accessToken: string; refreshToken: string } | null {
  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  const paramsStr =
    hashIndex >= 0
      ? url.slice(hashIndex + 1)
      : queryIndex >= 0
        ? url.slice(queryIndex + 1)
        : "";
  if (!paramsStr) return null;

  const params = new URLSearchParams(paramsStr);
  if (params.get("type") !== "recovery") return null;

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}

/**
 * If `url` is a password-recovery link, establishes the recovery session and
 * returns true so the caller can navigate to the reset-password screen.
 * Returns false for any other URL (including a plain app open).
 */
export async function handleRecoveryUrl(url: string | null): Promise<boolean> {
  if (!url) return false;
  const tokens = parseRecoveryTokens(url);
  if (!tokens) return false;

  const { error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error) {
    console.error("Failed to establish recovery session:", error);
    return false;
  }
  return true;
}
