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
  hasPinSetup: boolean;
  isPinAuthenticated: boolean;
  requireFullLogin: boolean;
  setHasPinSetup: (val: boolean) => void;
  setIsPinAuthenticated: (val: boolean) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isProfileLoading: false,
  profile: null,
  refreshProfile: async () => {},
  signOut: async () => {},
  hasPinSetup: false,
  isPinAuthenticated: false,
  requireFullLogin: false,
  setHasPinSetup: () => {},
  setIsPinAuthenticated: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [hasPinSetup, setHasPinSetup] = useState(false);
  const [isPinAuthenticated, setIsPinAuthenticated] = useState(false);
  const [requireFullLogin, setRequireFullLogin] = useState(false);
  const fetchProfile = useCallback(async (userId: string) => {
    setIsProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      const nextProfile = error ? null : (data ?? null);
      setProfile(nextProfile);
      return nextProfile;
    } catch {
      setProfile(null);
      return null;
    } finally {
      setIsProfileLoading(false);
    }
  }, []);

  const syncProfile = useCallback(async (authUser: User | null | undefined) => {
    if (!authUser?.id) {
      setProfile(null);
      return null;
    }

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
      // Fall back to whatever row already existed rather than nulling it out.
      setProfile(existing ?? null);
      return existing ?? null;
    }

    const nextProfile = data ?? existing ?? null;
    setProfile(nextProfile);
    savePushTokenToProfile(authUser.id);
    return nextProfile;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    await SecureStore.deleteItemAsync('jezsy_user_pin');
    await SecureStore.deleteItemAsync('jezsy_last_full_login');
    setHasPinSetup(false);
    setIsPinAuthenticated(false);
    setRequireFullLogin(false);
  }, []);

  useEffect(() => {
    const checkInitialState = async () => {
      try {
        const lastLoginStr = await SecureStore.getItemAsync('jezsy_last_full_login');
        if (lastLoginStr) {
          // 30-day forced logout removed per policy change.
          // Sessions are kept alive indefinitely.
        } else {
          // No record of login means they need one
          setRequireFullLogin(true);
        }

        const storedPin = await SecureStore.getItemAsync('jezsy_user_pin');
        setHasPinSetup(!!storedPin);
      } catch (err) {
        console.error('Error checking secure store:', err);
      }
    };

    // Both reads must settle before we flip isLoading, or the very first
    // render of the redirect gate in app/_layout.tsx can act on a default
    // hasPinSetup/requireFullLogin value that hasn't caught up yet.
    Promise.all([
      checkInitialState(),
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await syncProfile(session.user);
        }
      }),
    ]).finally(() => {
      setIsLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          void syncProfile(session.user);
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
        hasPinSetup,
        isPinAuthenticated,
        requireFullLogin,
        setHasPinSetup,
        setIsPinAuthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
