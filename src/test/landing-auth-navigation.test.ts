import { describe, expect, it } from "vitest";
import {
  isPublicPath,
  legacyRouteRedirect,
  requiresApplicationAuthentication,
  safeAuthReturnPath,
} from "../lib/auth-routing";

describe("Public application routing", () => {
  it("allows direct access to public application sections without authentication", () => {
    for (const path of [
      "/dashboard",
      "/learn",
      "/data",
      "/observations",
      "/events",
      "/discover",
      "/analyze",
      "/intelligence",
      "/timeline",
      "/methodology",
    ]) {
      expect(isPublicPath(path)).toBe(true);
      expect(requiresApplicationAuthentication(path)).toBe(false);
    }
  });

  it("keeps safe same-origin return paths and rejects auth loops", () => {
    expect(safeAuthReturnPath("/landing/team?view=people")).toBe("/landing/team?view=people");
    expect(safeAuthReturnPath("/dashboard")).toBe("/dashboard");
    expect(safeAuthReturnPath("/learn?section=radar")).toBe("/learn?section=radar");
    expect(safeAuthReturnPath("/events?source=usgs")).toBe("/events?source=usgs");
    expect(safeAuthReturnPath("//example.com")).toBe("/landing");
    expect(safeAuthReturnPath("https://example.com")).toBe("/landing");
    expect(safeAuthReturnPath("/landing/login")).toBe("/landing");
    expect(safeAuthReturnPath("/landing/auth/callback")).toBe("/landing");
  });

  it("sends legacy authentication URLs to the public dashboard", () => {
    expect(legacyRouteRedirect("/login")).toBe("/dashboard");
    expect(legacyRouteRedirect("/auth/callback")).toBe("/dashboard");
    expect(legacyRouteRedirect("/dashboard")).toBe("/dashboard");
  });
});
