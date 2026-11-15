import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../lib/store";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useApp.setState({
    liveEvents: [],
    liveDataStatus: "idle",
    liveDataUpdatedAt: null,
    liveDataError: null,
    liveProviderStatus: {
      usgs: { status: "idle", error: null, updatedAt: null, cached: false },
      eonet: { status: "idle", error: null, updatedAt: null, cached: false },
    },
  });
});

describe("independent public-feed state", () => {
  it("retains a successful USGS response when NASA EONET fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("earthquake.usgs.gov")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            features: [{
              id: "usgs-independent",
              geometry: { type: "Point", coordinates: [72.8, 19.1, 12] },
              properties: { time: Date.parse("2026-10-15T08:30:00Z"), mag: 5.2 },
            }],
          }),
        };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    }));

    await useApp.getState().refreshLiveData();
    const state = useApp.getState();
    expect(state.liveDataStatus).toBe("partial");
    expect(state.liveProviderStatus.usgs.status).toBe("ready");
    expect(state.liveProviderStatus.eonet.status).toBe("error");
    expect(state.liveEvents.map((event) => event.source)).toEqual(["USGS"]);
    expect(state.liveDataError).toContain("NASA EONET");
  });
});
