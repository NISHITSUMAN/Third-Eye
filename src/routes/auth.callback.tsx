import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { safeAuthReturnPath } from "@/lib/auth-routing";

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : undefined,
    error: typeof search.error_description === "string"
      ? search.error_description
      : typeof search.error === "string" ? search.error : undefined,
  }),
  component: AuthCallback,
});

function AuthCallback() {
  const { loading, session, error: sessionError } = useAuth();
  const { next: requestedNext, error } = Route.useSearch();
  const next = safeAuthReturnPath(requestedNext);

  useEffect(() => {
    if (!loading && session) window.location.replace(next);
  }, [loading, next, session]);

  if (loading) {
    return <p className="mx-auto mt-24 max-w-lg px-5 text-sm text-muted-foreground" role="status">Completing Google sign-in…</p>;
  }

  if (session) {
    return <p className="mx-auto mt-24 max-w-lg px-5 text-sm text-muted-foreground" role="status">Opening your workspace…</p>;
  }

  return (
    <main className="login-screen">
      <section className="login-card glass">
        <p className="label-xs text-primary">SIGN-IN CALLBACK</p>
        <h1 className="mt-3 text-2xl font-medium">Sign-in did not complete</h1>
        <p className="mt-3 text-sm leading-6 text-rose-200" role="alert">
          {error ?? sessionError ?? "Supabase returned without an authenticated session. Check the Google provider and redirect URLs."}
        </p>
        <Link to="/login" search={{ next }} className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Try Google sign-in again
        </Link>
      </section>
    </main>
  );
}
