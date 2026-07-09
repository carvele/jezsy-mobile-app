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

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isProfileLoading: boolean;
  profile: Profile | null;
  /** Call this after saving profile data so routing re-evaluates immediately. */
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isProfileLoading: false,
  profile: null,
  refreshProfile: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

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
      setProfile(null);
      return null;
    }

    const nextProfile = data ?? null;
    setProfile(nextProfile);
    savePushTokenToProfile(authUser.id);
    return nextProfile;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user?.id) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await syncProfile(session.user);
      }
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
  }, [syncProfile]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isProfileLoading,
        profile,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
