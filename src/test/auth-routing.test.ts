import { describe, expect, it } from "vitest";
import { isLandingPath, isPublicPath, legacyRouteRedirect, requiresApplicationAuthentication, safeAuthReturnPath, usesStandaloneLayout } from "@/lib/auth-routing";

describe("authentication route boundaries", () => {
  it("keeps all application routes public without authentication", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/landing")).toBe(true);
    expect(isPublicPath("/landing/team")).toBe(true);
    expect(isPublicPath("/landing/links")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/dashboard")).toBe(true);
    expect(isPublicPath("/analysis/report-1")).toBe(true);
    expect(isPublicPath("/learn")).toBe(true);
    expect(requiresApplicationAuthentication("/")).toBe(false);
    expect(requiresApplicationAuthentication("/landing")).toBe(false);
    expect(requiresApplicationAuthentication("/dashboard")).toBe(false);
    expect(requiresApplicationAuthentication("/learn")).toBe(false);
    expect(requiresApplicationAuthentication("/analysis/report-1")).toBe(false);
    expect(isLandingPath("/landing")).toBe(true);
    expect(isLandingPath("/landing/section")).toBe(true);
    expect(isLandingPath("/dashboard")).toBe(false);
    expect(legacyRouteRedirect("/login")).toBe("/dashboard");
    expect(legacyRouteRedirect("/auth/callback")).toBe("/dashboard");
    expect(legacyRouteRedirect("/dashboard")).toBe("/dashboard");
    expect(usesStandaloneLayout("/landing")).toBe(true);
    expect(usesStandaloneLayout("/learn")).toBe(true);
  });

  it("allows only safe public or protected application destinations after sign-in", () => {
    expect(safeAuthReturnPath("/landing?section=overview")).toBe("/landing?section=overview");
    expect(safeAuthReturnPath("/landing/section#details")).toBe("/landing/section#details");
    expect(safeAuthReturnPath("/dashboard")).toBe("/dashboard");
    expect(safeAuthReturnPath("/learn?section=radar")).toBe("/learn?section=radar");
    expect(safeAuthReturnPath("/events?source=usgs")).toBe("/events?source=usgs");
    expect(safeAuthReturnPath("//example.com")).toBe("/landing");
    expect(safeAuthReturnPath("https://example.com")).toBe("/landing");
    expect(safeAuthReturnPath("/landing/login")).toBe("/landing");
    expect(safeAuthReturnPath("/landing/auth/callback")).toBe("/landing");
    expect(safeAuthReturnPath("/login?next=/landing")).toBe("/landing");
    expect(safeAuthReturnPath("/auth/callback")).toBe("/landing");
    expect(safeAuthReturnPath("/api/assistant")).toBe("/landing");
  });
});
