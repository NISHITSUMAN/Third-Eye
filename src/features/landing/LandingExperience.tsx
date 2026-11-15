import { ClientOnly } from "@tanstack/react-router";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import LandingApp from "./site/App";
import { AuthProvider } from "./site/auth/AuthProvider";
import "./site/styles.css";

function LandingApplication() {
  return (
    <AuthProvider>
      <LandingApp />
    </AuthProvider>
  );
}

function LandingHistoryBridge() {
  const location = useLocation();
  const navigate = useNavigate();
  const href = `${location.pathname === "/" ? "" : location.pathname}${location.search}${location.hash}`;
  const lastHref = useRef("");

  useEffect(() => {
    const target = `/landing${href}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== target && lastHref.current !== target) {
      window.history.pushState(window.history.state, "", target);
    }
    lastHref.current = target;
  }, [href]);

  useEffect(() => {
    const syncFromBrowser = () => {
      if (!window.location.pathname.startsWith("/landing")) return;
      const path = window.location.pathname.slice("/landing".length) || "/";
      void navigate(`${path}${window.location.search}${window.location.hash}`, { replace: true });
    };

    window.addEventListener("popstate", syncFromBrowser);
    return () => window.removeEventListener("popstate", syncFromBrowser);
  }, [navigate]);

  return null;
}

function LandingClient() {
  const initialEntry = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  return (
    <MemoryRouter
      basename="/landing"
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <LandingHistoryBridge />
      <LandingApplication />
    </MemoryRouter>
  );
}

export default function LandingExperience() {
  return (
    <ClientOnly fallback={<div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground" role="status">Opening the Landing project…</div>}>
      <LandingClient />
    </ClientOnly>
  );
}
