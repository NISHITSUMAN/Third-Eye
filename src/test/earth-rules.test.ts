import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FILTER, useApp, visibleEvents } from "../lib/store";
import { EARTH_EVENTS, lodForAltitude } from "../lib/earth-data";

const state = () => ({
  layers: new Set<string>(),
  filter: { ...DEFAULT_FILTER },
  time: { start: "2026-01-01", end: "2026-12-31", current: "2026-12-31" },
  lod: "global" as const,
});

describe("Earth data integrity", () => {
  beforeEach(() => {
    useApp.setState({ selectedId: null, view: { lat: 18, lng: 70, altitude: 2.4 }, viewNonce: 0 });
  });

  it("does not load fabricated science events", () => {
    expect(EARTH_EVENTS).toEqual([]);
    expect(visibleEvents(state())).toEqual([]);
  });

  it("keeps camera detail bands stable", () => {
    expect([2.4, 0.7, 0.1, 0.01].map(lodForAltitude)).toEqual(["global", "regional", "local", "analysis"]);
  });

  it("switching Earth mode preserves camera and selected object", () => {
    useApp.getState().select("nisar:test-granule");
    const before = useApp.getState().view;
    useApp.getState().setEarthMode("2d");
    expect(useApp.getState().selectedId).toBe("nisar:test-granule");
    expect(useApp.getState().view).toEqual(before);
  });

  it("comparison preserves geographic filters", () => {
    useApp.getState().setFilter({ region: "Maharashtra", types: ["flood"] });
    useApp.getState().setInvestigation({ comparison: "historical" });
    expect(useApp.getState().investigation.region).toBe("Maharashtra");
    expect(useApp.getState().investigation.types).toEqual(["flood"]);
  });
});
