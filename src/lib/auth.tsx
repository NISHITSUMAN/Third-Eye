import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { safeAuthReturnPath } from "./auth-routing";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  error: string | null;
  signInWithGoogle: (returnTo?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const configured = Boolean(supabaseUrl && supabasePublishableKey);
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!configured || !supabaseUrl || !supabasePublishableKey) return null;
  client ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  return client;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setError(null);
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
      } else {
        setSession(data.session);
      }
      setLoading(false);
    }).catch((sessionError: unknown) => {
      if (!active) return;
      setError(sessionError instanceof Error ? sessionError.message : "Could not read the saved sign-in session.");
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (returnTo = "/landing") => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before signing in.");
    }
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", safeAuthReturnPath(returnTo));
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (signInError) throw signInError;
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase authentication is not configured.");
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured,
    loading,
    session,
    user: session?.user ?? null,
    error,
    signInWithGoogle,
    signOut,
  }), [error, loading, session, signInWithGoogle, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
