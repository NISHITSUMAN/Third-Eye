import { describe, expect, it } from "vitest";
import { localLandingPath, safeAuthReturnPath } from "../features/landing/site/lib/auth-navigation";

describe("Landing authentication return paths", () => {
  it("preserves safe Landing and protected application destinations", () => {
    expect(safeAuthReturnPath("/landing/team?view=people")).toBe("/landing/team?view=people");
    expect(safeAuthReturnPath("/dashboard")).toBe("/dashboard");
    expect(safeAuthReturnPath("/learn?section=radar")).toBe("/learn?section=radar");
    expect(safeAuthReturnPath("/events?source=usgs")).toBe("/events?source=usgs");
    expect(localLandingPath("/landing/dashboard")).toBe("/dashboard");
    expect(localLandingPath("/dashboard")).toBeNull();
  });

  it("rejects external destinations and authentication loops", () => {
    expect(safeAuthReturnPath("//example.com")).toBe("/landing");
    expect(safeAuthReturnPath("https://example.com")).toBe("/landing");
    expect(safeAuthReturnPath("/landing/login")).toBe("/landing");
    expect(safeAuthReturnPath("/landing/auth/callback")).toBe("/landing");
  });
});
