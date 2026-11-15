import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/te/Logo";
import { useAuth } from "@/lib/auth";
import { safeAuthReturnPath } from "@/lib/auth-routing";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — THIRD EYE" },
      { name: "description", content: "Sign in to Third Eye Earth Intelligence with Google." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { configured, loading, session, error: sessionError, signInWithGoogle } = useAuth();
  const { next: requestedNext } = Route.useSearch();
  const next = safeAuthReturnPath(requestedNext);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) window.location.replace(next);
  }, [loading, next, session]);

  async function handleGoogleSignIn() {
    setError(null);
    try {
      await signInWithGoogle(next);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Google sign-in could not be started.");
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card glass">
        <Link to="/landing" className="login-brand" aria-label="Third Eye home">
          <LogoMark size={24} />
          <span>THIRD EYE<span className="text-primary">.</span></span>
        </Link>
        <p className="label-xs mt-8 text-primary">TEAM Cypher / EARTH INTELLIGENCE</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Continue to the mission</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Sign in to open the Third Eye Dashboard or Learn.
        </p>
        <Button className="mt-7 h-11 w-full" onClick={() => void handleGoogleSignIn()}>
          <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-white text-sm font-bold text-slate-800">G</span>
          Continue with Google
        </Button>
        {!configured && (
          <p className="mt-4 text-sm leading-6 text-amber-200" role="status">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in the app environment.
          </p>
        )}
        {(error || sessionError) && (
          <p className="mt-4 text-sm leading-6 text-rose-300" role="alert">{error ?? sessionError}</p>
        )}
        <Link to="/landing" className="mt-6 inline-flex text-xs text-muted-foreground transition hover:text-foreground">
          Return to the public Home page
        </Link>
      </section>
    </main>
  );
}
