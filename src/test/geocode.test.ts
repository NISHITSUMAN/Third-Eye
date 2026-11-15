import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlaces } from "../lib/geocode-server";
import {
  isAntimeridianBBoxQuery,
  isTrackFrameQuery,
  normalizeGeoSearchResult,
  parseLocalGeoQuery,
} from "../lib/geocode";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("geospatial query parsing", () => {
  it("parses decimal and DMS coordinates into labeled approximate search areas", () => {
    expect(parseLocalGeoQuery("34.05, -118.25")).toMatchObject({
      type: "coordinates",
      latitude: 34.05,
      longitude: -118.25,
      bbox: [-118.5, 33.8, -118, 34.3],
      extentQuality: "approximate",
    });
    expect(parseLocalGeoQuery(`34° 3' N, 118° 15' W`)).toMatchObject({
      type: "coordinates",
      latitude: 34.05,
      longitude: -118.25,
    });
  });

  describe("public place-search adapter", () => {
    it("uses Photon first and returns its provider-attributed place result", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          features: [{
            geometry: { coordinates: [-73.9857, 40.7484] },
            properties: {
              osm_id: 123,
              osm_type: "N",
              name: "Empire State Building",
              city: "New York",
              state: "New York",
              country: "United States",
              type: "landmark",
              importance: 0.91,
              extent: [-73.986, 40.749, -73.985, 40.748],
            },
          }],
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await searchPlaces("Empire State Building");
      expect(response).toMatchObject({
        status: "ready",
        results: [{
          name: "Empire State Building",
          type: "landmark",
          provider: "photon-osm",
          confidence: null,
          providerRelevance: 0.91,
          extentQuality: "source",
          bbox: [-73.986, 40.748, -73.985, 40.749],
        }],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(response.results[0]?.attribution).toContain("OpenStreetMap");
    });

    it("falls back to Open-Meteo when Photon is unavailable and reports the partial source status", async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error("network unavailable"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ id: 100, name: "Reykjavik", latitude: 64.1466, longitude: -21.9426, country: "Iceland", feature_code: "PPLC" }],
          }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const response = await searchPlaces("Reykjavik");
      expect(response).toMatchObject({
        status: "partial",
        results: [{ name: "Reykjavik", provider: "open-meteo-geonames", extentQuality: "approximate" }],
        warnings: ["Photon: network unavailable"],
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("parses ordered bounding boxes and closed WKT polygons without accepting invalid extents", () => {
    expect(parseLocalGeoQuery("bbox: -123, 32, -117, 38")).toMatchObject({
      type: "bbox",
      bbox: [-123, 32, -117, 38],
      extentQuality: "source",
    });
    expect(parseLocalGeoQuery("POLYGON ((-123 32, -117 32, -117 38, -123 38, -123 32))")).toMatchObject({
      type: "bbox",
      bbox: [-123, 32, -117, 38],
    });
    expect(parseLocalGeoQuery("bbox 10, 20, 10, 30")).toBeNull();
    expect(parseLocalGeoQuery("POLYGON ((-123 32, -117 32, -117 38, -123 38))")).toBeNull();
    expect(parseLocalGeoQuery("91, 20")).toBeNull();
  });

  it("recognizes unsupported track/frame identifiers and rejects malformed provider results", () => {
    expect(isAntimeridianBBoxQuery("bbox 170, -10, -170, 10")).toBe(true);
    expect(isAntimeridianBBoxQuery("bbox -10, -10, 10, 10")).toBe(false);
    expect(isTrackFrameQuery("track 42 frame 12")).toBe(true);
    expect(isTrackFrameQuery("track: 42 / frame: 12")).toBe(true);
    expect(isTrackFrameQuery("track 42")).toBe(false);
    expect(normalizeGeoSearchResult({ latitude: 100, longitude: 0 })).toBeNull();
  });
});
