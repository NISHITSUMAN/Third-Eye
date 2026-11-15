import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../lib/store";
import { rectangleAOI } from "../lib/analysis";
import type { GeoSearchResult } from "../lib/geocode";

const location: GeoSearchResult = {
  id: "bigdatacloud:19.1,72.8",
  name: "Mumbai",
  displayName: "Mumbai, Maharashtra, India",
  type: "location",
  latitude: 19.1,
  longitude: 72.8,
  bbox: [72.55, 18.85, 73.05, 19.35],
  provider: "bigdatacloud",
  confidence: null,
  providerRelevance: null,
  attribution: "BigDataCloud reverse geocoding",
  extentQuality: "approximate",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useApp.getState().select(null);
  useApp.getState().setAOI(null);
  useApp.getState().setDrawTool(null);
});

describe("shared-store reverse geocoding", () => {
  it("completes a rectangle AOI from points drawn on the shared globe/map", () => {
    useApp.getState().setDrawTool("rectangle");
    useApp.getState().addDrawingPoint([-123, 37]);
    expect(useApp.getState().drawingPoints).toHaveLength(1);
    useApp.getState().addDrawingPoint([-122, 38]);

    expect(useApp.getState()).toMatchObject({
      drawTool: null,
      drawingPoints: [],
      aoi: { name: "Rectangle AOI", feature: { geometry: { type: "Polygon" } } },
    });
  });

  it("finishes a polygon AOI after clicking vertices on the shared globe/map", () => {
    useApp.getState().setDrawTool("polygon");
    useApp.getState().addDrawingPoint([-123, 37]);
    useApp.getState().addDrawingPoint([-122, 37]);
    useApp.getState().addDrawingPoint([-122.5, 38]);
    useApp.getState().finishDrawing();

    expect(useApp.getState()).toMatchObject({
      drawTool: null,
      drawingPoints: [],
      aoi: { name: "Polygon AOI", feature: { geometry: { type: "Polygon" } } },
    });
  });

  it("publishes an attributed map location after the provider responds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...location, geometry: { type: "Point", coordinates: [location.longitude, location.latitude] } }),
    }));

    await useApp.getState().lookupLocation(location.latitude, location.longitude);

    expect(useApp.getState()).toMatchObject({
      selectedId: location.id,
      locationResult: location,
      locationStatus: "ready",
      locationError: null,
      view: { lat: location.latitude, lng: location.longitude },
      aoi: { name: location.displayName },
    });
  });

  it("ignores an in-flight lookup after the location panel is dismissed", async () => {
    let resolveResponse: ((response: { ok: boolean; status: number; json: () => Promise<GeoSearchResult> }) => void) | undefined;
    const pending = new Promise<{ ok: boolean; status: number; json: () => Promise<GeoSearchResult> }>(resolve => {
      resolveResponse = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));

    const lookup = useApp.getState().lookupLocation(location.latitude, location.longitude);
    useApp.getState().select(null);
    resolveResponse?.({ ok: true, status: 200, json: async () => location });
    await lookup;

    expect(useApp.getState()).toMatchObject({
      locationResult: null,
      locationStatus: "idle",
      locationError: null,
    });
  });

  it("clears a previously selected search marker when the AOI changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => location,
    }));
    await useApp.getState().lookupLocation(location.latitude, location.longitude);

    const nextAOI = rectangleAOI([-123, 37], [-122, 38]);
    useApp.getState().setAOI(nextAOI);

    expect(useApp.getState()).toMatchObject({
      aoi: nextAOI,
      selectedId: null,
      locationResult: null,
      locationStatus: "idle",
      investigation: { selectedId: null },
    });
  });
});
