import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  redirect,
  useLocation,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { isLandingPath, requiresApplicationAuthentication } from "@/lib/auth-routing";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/te/Sidebar";
import "../features/intro/intro.css";
import "../components/auth/auth.css";


function NotFoundComponent() {
  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="label-xs">ERROR 404</div>
        <h1 className="mt-2 text-xl font-medium">No signal at this location</h1>
        <p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
        <Link to="/landing" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Return to home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-medium text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again or head back.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>
          <a href="/" className="rounded-md border border-border px-4 py-2 text-sm">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/login") {
      throw redirect({ href: `/landing/login${location.searchStr}`, replace: true, reloadDocument: true });
    }
    if (location.pathname === "/auth/callback") {
      const hash = location.hash ? `#${location.hash}` : "";
      throw redirect({ href: `/landing/auth/callback${location.searchStr}${hash}`, replace: true, reloadDocument: true });
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Third Eye — Earth Intelligence" },
      { name: "description", content: "Earth-observation explorer with live NASA NISAR catalog coverage, attributed public context feeds, and no simulated science products." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/third-eye-mark.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { pathname } = useLocation();
  const isPublicExperience = pathname === "/" || isLandingPath(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      {isPublicExperience
        ? <Outlet />
        : <AuthProvider><ProtectedApplication><Outlet /></ProtectedApplication></AuthProvider>}
    </QueryClientProvider>
  );
}

function ProtectedApplication({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  const { pathname, searchStr, hash } = useLocation();
  const requiresAuthentication = requiresApplicationAuthentication(pathname);
  const returnTo = `${pathname}${searchStr}${hash ? `#${hash}` : ""}`;
  const isStandaloneApplication = pathname === "/learn";

  useEffect(() => {
    if (requiresAuthentication && !loading && !user) {
      window.location.replace(`/landing/login?next=${encodeURIComponent(returnTo)}`);
    }
  }, [loading, requiresAuthentication, returnTo, user]);

  if (requiresAuthentication && (loading || !user)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground" role="status">
        {loading ? "Restoring secure session…" : "Opening secure sign-in…"}
      </div>
    );
  }

  if (isStandaloneApplication) return children;

  return (
    <div className="app-frame">
      <Sidebar />
      <main className="root-main">{children}</main>
    </div>
  );
}
