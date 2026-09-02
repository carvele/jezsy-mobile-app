/* eslint-disable */
import { Session, User } from "@supabase/supabase-js";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import { supabase } from "../lib/supabase";
import { Database } from "../types/database.types";
import { savePushTokenToProfile } from "../utils/pushNotifications";
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isProfileLoading: boolean;
  profile: Profile | null;
  /** Call this after saving profile data so routing re-evaluates immediately. */
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * True while a password-recovery session is active. A recovery session is a
   * real session, so routing must pin the user to reset-password until they
   * actually set a new password -- otherwise the emailed link is a full login.
   */
  isPasswordRecovery: boolean;
  beginPasswordRecovery: () => void;
  endPasswordRecovery: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isProfileLoading: false,
  profile: null,
  refreshProfile: async () => {},
  signOut: async () => {},
  isPasswordRecovery: false,
  beginPasswordRecovery: () => {},
  endPasswordRecovery: () => {},
});

const PROFILE_CACHE_PREFIX = 'jezsy_profile_cache:';
const profileCacheKey = (userId: string) => `${PROFILE_CACHE_PREFIX}${userId}`;

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const beginPasswordRecovery = useCallback(() => setIsPasswordRecovery(true), []);
  const endPasswordRecovery = useCallback(() => setIsPasswordRecovery(false), []);

  const fetchProfile = useCallback(async (userId: string) => {
    setIsProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        // Network/server error — fall back to cached profile
        const cached = await AsyncStorage.getItem(profileCacheKey(userId));
        const parsed = cached ? JSON.parse(cached) : null;
        const nextProfile = parsed?.id === userId ? parsed : null;
        setProfile(nextProfile);
        return nextProfile;
      }
      const nextProfile = data ?? null;
      // Cache successful fetches for offline resilience
      if (nextProfile) {
        await AsyncStorage.setItem(profileCacheKey(userId), JSON.stringify(nextProfile));
      }
      setProfile(nextProfile);
      return nextProfile;
    } catch {
      // Total failure — try cache before giving up
      try {
        const cached = await AsyncStorage.getItem(profileCacheKey(userId));
        const parsed = cached ? JSON.parse(cached) : null;
        const nextProfile = parsed?.id === userId ? parsed : null;
        setProfile(nextProfile);
        return nextProfile;
      } catch {
        setProfile(null);
        return null;
      }
    } finally {
      setIsProfileLoading(false);
    }
  }, []);

  const syncProfile = useCallback(async (authUser: User | null | undefined) => {
    if (!authUser?.id) {
      setProfile(null);
      setIsProfileLoading(false);
      return null;
    }

    // The routing gate in app/_layout.tsx holds off on redirecting while
    // isProfileLoading is true. This flag has to be raised here, before the
    // first await: onAuthStateChange calls this without awaiting it and then
    // immediately clears isLoading, so without it the gate wakes up on a live
    // session with a still-null profile and routes to profile-setup for a
    // frame before the real profile arrives.
    setIsProfileLoading(true);
    try {
      // The handle_new_user DB trigger already creates a bare profile row
      // (id/email/role) on signup, so a row normally exists by the time this
      // runs. Fetch it first: this callback fires on every auth-state change
      // (including silent token refreshes), and re-seeding names from OAuth
      // metadata each time would clobber a name the user edited in
      // profile-setup. Only seed names when they are still empty.
      const { data: existing } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      if (existing?.first_name) {
        setProfile(existing);
        savePushTokenToProfile(authUser.id);
        return existing;
      }

      const metadata = authUser.user_metadata ?? {};
      const fullName = (metadata.full_name ?? metadata.name ?? "")
        .toString()
        .trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const firstName = nameParts.shift() ?? "";
      const lastName = nameParts.join(" ") ?? "";

      const { data, error } = await supabase
        .from("profiles")
        .upsert(
          {
            id: authUser.id,
            email: authUser.email ?? null,
            first_name: firstName || null,
            last_name: lastName || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        )
        .select("*")
        .maybeSingle();

      if (error) {
        console.error("Failed to sync profile", error);
        // Fall back to existing row or cached profile for offline resilience
        let fallback = existing ?? null;
        if (!fallback) {
          try {
            const cached = await AsyncStorage.getItem(profileCacheKey(authUser.id));
            const parsed = cached ? JSON.parse(cached) : null;
            fallback = parsed?.id === authUser.id ? parsed : null;
          } catch { /* ignore */ }
        }
        setProfile(fallback);
        return fallback;
      }

      const nextProfile = data ?? existing ?? null;
      // Cache successful profiles for offline resilience
      if (nextProfile) {
        await AsyncStorage.setItem(profileCacheKey(authUser.id), JSON.stringify(nextProfile)).catch(() => {});
      }
      setProfile(nextProfile);
      savePushTokenToProfile(authUser.id);
      return nextProfile;
    } finally {
      // Must run on every path including a thrown query: leaving this true
      // would strand the app on the pre-bootstrap placeholder forever.
      setIsProfileLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const signOut = useCallback(async () => {
    try {
      // Profile caches are user-scoped; remove the legacy shared key as part of
      // the migration so it can never be used by an older build after logout.
      await AsyncStorage.multiRemove(['jezsy_cart', 'jezsy_profile_cache']);
    } catch (e) {}
    await supabase.auth.signOut();
  }, []);

  useEffect(() => {
    // The local PIN feature was removed; drop the secrets it left behind on
    // devices that had already set one. Fire-and-forget: nothing gates on it.
    void SecureStore.deleteItemAsync('jezsy_user_pin').catch(() => {});
    void SecureStore.deleteItemAsync('jezsy_last_full_login').catch(() => {});

    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await syncProfile(session.user);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Belt-and-braces alongside the explicit begin/end calls: on platforms
        // where the SDK detects the recovery link itself, this is the only
        // signal we get.
        if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
        if (event === 'SIGNED_OUT') setIsPasswordRecovery(false);

        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await syncProfile(session.user);
        } else {
          setProfile(null);
          setIsProfileLoading(false);
        }
        setIsLoading(false);
      },
    );

    return () => authListener.subscription.unsubscribe();
  }, [signOut, syncProfile]);


  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isProfileLoading,
        profile,
        refreshProfile,
        signOut,
        isPasswordRecovery,
        beginPasswordRecovery,
        endPasswordRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
