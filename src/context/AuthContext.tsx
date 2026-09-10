import { Session, User } from "@supabase/supabase-js";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { supabase } from "../lib/supabase";
import { Database } from "../types/database.types";
import { savePushTokenToProfile } from "../utils/pushNotifications";
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSecureValue, setSecureValue, deleteSecureValue } from '../utils/secureStorage';

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isProfileLoading: boolean;
  isProfileInitialized: boolean;
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
  isProfileInitialized: false,
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
  const isSyncingRef = useRef<string | null>(null);
  const syncedUsersRef = useRef<Set<string>>(new Set());
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileInitialized, setIsProfileInitialized] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const beginPasswordRecovery = useCallback(() => setIsPasswordRecovery(true), []);
  const endPasswordRecovery = useCallback(() => setIsPasswordRecovery(false), []);

  const hydrateProfileFromCache = useCallback(async (userId: string) => {
    try {
      const cached = await getSecureValue(profileCacheKey(userId));
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.id === userId) {
          setProfile((prev) => prev ?? parsed);
        }
      }
    } catch {}
  }, []);

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
        const cached = await getSecureValue(profileCacheKey(userId));
        const parsed = cached ? JSON.parse(cached) : null;
        const nextProfile = parsed?.id === userId ? parsed : null;
        setProfile((prev) => nextProfile ?? prev);
        return nextProfile;
      }
      const nextProfile = data ?? null;
      // Cache successful fetches for offline resilience. SecureStore (not
      // AsyncStorage) because the profile carries email/name/measurements.
      if (nextProfile) {
        await setSecureValue(profileCacheKey(userId), JSON.stringify(nextProfile));
      }
      setProfile((prev) => nextProfile ?? prev);
      return nextProfile;
    } catch (err) {
      console.error('AuthContext Profile Sync error:', err);
      // Total failure — try cache before giving up
      try {
        const cached = await getSecureValue(profileCacheKey(userId));
        const parsed = cached ? JSON.parse(cached) : null;
        const nextProfile = parsed?.id === userId ? parsed : null;
        setProfile((prev) => nextProfile ?? prev);
        return nextProfile;
      } catch {
        return null;
      }
    } finally {
      setIsProfileLoading(false);
      setIsProfileInitialized(true);
    }
  }, []);

  const syncProfile = useCallback(async (authUser: User | null | undefined) => {
    if (!authUser?.id) {
      setProfile(null);
      setIsProfileLoading(false);
      setIsProfileInitialized(true);
      return null;
    }

    // Fast-path: pre-fill from secure cache if state profile is currently null
    void hydrateProfileFromCache(authUser.id);

    // Prevent re-entrant or duplicate sync loops for the same user
    if (isSyncingRef.current === authUser.id) {
      return null;
    }
    isSyncingRef.current = authUser.id;

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

      if (existing) {
        // If profile already has first_name or auth metadata has no name to seed anyway, do not repeatedly upsert
        const meta = authUser.user_metadata ?? {};
        const fName = ((meta.full_name ?? meta.name ?? "").toString().trim().split(/\s+/)[0] ?? "");
        if (existing.first_name || !fName) {
          setProfile(existing);
          syncedUsersRef.current.add(authUser.id);
          savePushTokenToProfile(authUser.id);
          await setSecureValue(profileCacheKey(authUser.id), JSON.stringify(existing)).catch(() => {});
          return existing;
        }
      }

      const metadata = authUser.user_metadata ?? {};
      const fullName = (metadata.full_name ?? metadata.name ?? "")
        .toString()
        .trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const firstName = nameParts.shift() ?? "";
      const lastName = nameParts.join(" ") ?? "";

      let data = null;
      let error = null;

      if (existing) {
        const res = await supabase
          .from("profiles")
          .update({
            first_name: firstName || null,
            last_name: lastName || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", authUser.id)
          .select("*")
          .maybeSingle();
        data = res.data;
        error = res.error;
      } else {
        const res = await supabase
          .from("profiles")
          .insert({
            id: authUser.id,
            email: authUser.email ?? null,
            first_name: firstName || null,
            last_name: lastName || null,
            updated_at: new Date().toISOString(),
          })
          .select("*")
          .maybeSingle();
        data = res.data;
        error = res.error;

        if (error && (error as any).code === "23505") {
          const retry = await supabase
            .from("profiles")
            .update({
              first_name: firstName || null,
              last_name: lastName || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", authUser.id)
            .select("*")
            .maybeSingle();
          data = retry.data;
          error = retry.error;
        }
      }

      if (error) {
        console.error("Failed to sync profile", error);
        // Fall back to existing row or cached profile for offline resilience
        let fallback = existing ?? null;
        if (!fallback) {
          try {
            const cached = await getSecureValue(profileCacheKey(authUser.id));
            const parsed = cached ? JSON.parse(cached) : null;
            fallback = parsed?.id === authUser.id ? parsed : null;
          } catch { /* ignore */ }
        }
        setProfile((prev) => fallback ?? prev);
        return fallback;
      }

      const nextProfile = data ?? existing ?? null;
      // Cache successful profiles for offline resilience
      if (nextProfile) {
        await setSecureValue(profileCacheKey(authUser.id), JSON.stringify(nextProfile)).catch(() => {});
      }
      setProfile(nextProfile);
      syncedUsersRef.current.add(authUser.id);
      savePushTokenToProfile(authUser.id);
      return nextProfile;
    } finally {
      isSyncingRef.current = null;
      // Must run on every path including a thrown query: leaving this true
      // would strand the app on the pre-bootstrap placeholder forever.
      setIsProfileLoading(false);
      setIsProfileInitialized(true);
    }
  }, [hydrateProfileFromCache]);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const signOut = useCallback(async () => {
    try {
      syncedUsersRef.current.clear();
      setIsProfileInitialized(false);
      setProfile(null);
      // Remove the legacy shared AsyncStorage key (pre-SecureStore migration)
      // so it can never be used by an older build after logout.
      await AsyncStorage.multiRemove(['@jezsy_cart', 'jezsy_cart', 'jezsy_profile_cache']);
      if (user?.id) await deleteSecureValue(profileCacheKey(user.id));
    } catch {}
    await supabase.auth.signOut();
  }, [user]);

  useEffect(() => {
    // The local PIN feature was removed; drop the secrets it left behind on
    // devices that had already set one. Fire-and-forget: nothing gates on it.
    void SecureStore.deleteItemAsync('jezsy_user_pin').catch(() => {});
    void SecureStore.deleteItemAsync('jezsy_last_full_login').catch(() => {});

    // Deliberately NOT also calling supabase.auth.getSession() here.
    // onAuthStateChange fires once immediately on subscribe with whatever
    // session is already in storage (supabase-js's INITIAL_SESSION event),
    // so it already covers what a separate getSession() call would provide
    // -- calling both concurrently at boot made two competing requests for
    // supabase-js's cross-tab Web Locks auth lock in the same tick.
    // Confirmed live: this produced "Lock ... was not released within
    // 5000ms ... orphaned lock" and, worse, left the lock wedged such that
    // every later getSession() call on that tab hung indefinitely -- the
    // root cause of the "randomly stuck on loading" reports. A single
    // subscriber touching the lock at boot removes the race entirely.
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
          void hydrateProfileFromCache(session.user.id);
          if (!syncedUsersRef.current.has(session.user.id) || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
            await syncProfile(session.user);
          }
        } else {
          syncedUsersRef.current.clear();
          setProfile(null);
          setIsProfileLoading(false);
          setIsProfileInitialized(true);
        }
        setIsLoading(false);
      },
    );

    return () => authListener.subscription.unsubscribe();
  }, [syncProfile, hydrateProfileFromCache]);


  const contextValue = useMemo(() => ({
    user,
    session,
    isLoading,
    isProfileLoading,
    isProfileInitialized,
    profile,
    refreshProfile,
    signOut,
    isPasswordRecovery,
    beginPasswordRecovery,
    endPasswordRecovery,
  }), [
    user,
    session,
    isLoading,
    isProfileLoading,
    isProfileInitialized,
    profile,
    refreshProfile,
    signOut,
    isPasswordRecovery,
    beginPasswordRecovery,
    endPasswordRecovery,
  ]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
