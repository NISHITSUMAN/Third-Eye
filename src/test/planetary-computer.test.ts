import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlanetaryComputer, verifyPlanetaryComputerVisualization } from "../lib/planetary-computer-server";
import { handlePlanetaryComputerSearch } from "../routes/api.planetary-computer.search";
import { handlePlanetaryComputerVisualization } from "../routes/api.planetary-computer.visualization";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockSTAC(payload: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const response = {
  type: "FeatureCollection",
  context: { matched: 1 },
  features: [{
    type: "Feature",
    id: "S1B_SAMPLE",
    collection: "sentinel-1-rtc",
    bbox: [-122.2, 37.2, -121.8, 37.6],
    geometry: {
      type: "Polygon",
      coordinates: [[[-122.2, 37.2], [-121.8, 37.2], [-121.8, 37.6], [-122.2, 37.6], [-122.2, 37.2]]],
    },
    properties: {
      datetime: "2025-01-03T23:59:48.986558Z",
      platform: "sentinel-1b",
      instruments: ["c-sar"],
      title: "Sentinel-1 RTC observation",
    },
    links: [{ rel: "self", href: "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-rtc/items/S1B_SAMPLE" }],
  }],
};

function mockCollectionSTAC(options: {
  failFirstAttemptFor?: string;
  failNetworkAttemptsFor?: string;
  timeoutFirstAttemptFor?: string;
  failAlwaysFor?: string;
  invalidGeometry?: boolean;
  untrustedItemLink?: boolean;
  untrustedPreview?: boolean;
} = {}) {
  const attempts = new Map<string, number>();
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { collections?: string[] };
    const collectionId = body.collections?.[0];
    if (!collectionId) throw new Error("Expected one collection per STAC request.");
    const attempt = (attempts.get(collectionId) ?? 0) + 1;
    attempts.set(collectionId, attempt);
    if (options.timeoutFirstAttemptFor === collectionId && attempt === 1) {
      return await new Promise<never>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    if (options.failNetworkAttemptsFor === collectionId && attempt <= 2) {
      throw new TypeError("fetch failed");
    }
    if (
      options.failAlwaysFor === collectionId ||
      (options.failFirstAttemptFor === collectionId && attempt === 1)
    ) return { ok: false, status: 503, json: async () => ({}) };

    return {
      ok: true,
      status: 200,
      json: async () => ({
        ...response,
        features: response.features.map((feature) => ({
          ...feature,
          id: `${collectionId.toUpperCase()}_SAMPLE`,
          collection: collectionId,
          geometry: options.invalidGeometry
            ? { type: "Polygon", coordinates: [[[200, 37], [-121, 37], [-121, 38], [200, 37]]] }
            : feature.geometry,
          links: [{
            rel: "self",
            href: options.untrustedItemLink
              ? "https://attacker.example/item"
              : `https://planetarycomputer.microsoft.com/api/stac/v1/collections/${collectionId}/items/${collectionId.toUpperCase()}_SAMPLE`,
          }, {
            rel: "preview",
            type: "text/html",
            href: options.untrustedPreview
              ? `https://planetarycomputer.microsoft.com/api/data/v1/item/map?collection=${collectionId}&item=OTHER_ITEM`
              : `https://planetarycomputer.microsoft.com/api/data/v1/item/map?collection=${collectionId}&item=${collectionId.toUpperCase()}_SAMPLE`,
          }],
        })),
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Planetary Computer STAC discovery", () => {
  it("uses allowlisted collections, AOI geometry, date bounds, and normalizes real catalog items", async () => {
    const fetchMock = mockCollectionSTAC();
    const geometry = {
      type: "Polygon" as const,
      coordinates: [[[-122, 37], [-121, 37], [-121, 38], [-122, 38], [-122, 37]]],
    };
    const result = await searchPlanetaryComputer(
      "flood-water",
      "2025-01-01",
      "2025-01-05",
      geometry,
    );

    expect(result).toMatchObject({
      source: "Microsoft Planetary Computer STAC",
      dataClass: "catalog-metadata",
      matched: 4,
    });
    expect(result.items).toHaveLength(4);
    expect(result.items[0]).toMatchObject({
      id: "pc:sentinel-1-rtc:SENTINEL-1-RTC_SAMPLE",
      collectionLabel: "Sentinel-1 radar",
      datetime: "2025-01-03T23:59:48.986Z",
      platform: "sentinel-1b",
      dataClass: "catalog-observation",
      previewUrl: "https://planetarycomputer.microsoft.com/api/data/v1/item/map?collection=sentinel-1-rtc&item=SENTINEL-1-RTC_SAMPLE",
    });
    expect(result.items[0]?.geometry?.type).toBe("Polygon");
    expect(result.items[0]?.sourceMetadata).toMatchObject({
      id: "SENTINEL-1-RTC_SAMPLE",
      properties: { platform: "sentinel-1b", instruments: ["c-sar"] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(url).toBe("https://planetarycomputer.microsoft.com/api/stac/v1/search");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.collections).toHaveLength(1);
      if (body.collections?.[0] === "jrc-gsw") {
        expect(body).not.toHaveProperty("datetime");
      } else {
        expect(body.datetime).toBe("2025-01-01T00:00:00Z/2025-01-05T23:59:59Z");
      }
      expect(body.intersects).toEqual(geometry);
      expect(body.limit).toBe(100);
    }
  });

  it("balances the item limit across collections so recent results cannot hide older sources", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { collections?: string[] };
      const collectionId = body.collections?.[0];
      if (!collectionId) throw new Error("Expected one collection per STAC request.");
      const sampleFeature = response.features[0];
      if (!sampleFeature) throw new Error("Expected a sample STAC feature.");
      const itemCount = collectionId === "modis-14A1-061" ? 120 : 1;
      const datetime = collectionId === "modis-14A1-061"
        ? "2025-01-03T23:59:48.986Z"
        : "2025-01-01T00:00:00.000Z";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...response,
          features: Array.from({ length: itemCount }, (_, index) => ({
            ...sampleFeature,
            id: `${collectionId.toUpperCase()}_${index}`,
            collection: collectionId,
            properties: { ...sampleFeature.properties, datetime },
          })),
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchPlanetaryComputer(
      "wildfire-monitoring",
      "2025-01-01",
      "2025-01-05",
      null,
    );

    expect(result.items).toHaveLength(100);
    expect(new Set(result.items.map(item => item.collectionId))).toEqual(new Set([
      "modis-14A1-061",
      "sentinel-1-rtc",
      "sentinel-2-l2a",
    ]));
  });

  it("caches successful searches and retries a transient provider failure", async () => {
    const cachedFetch = mockCollectionSTAC();
    const first = await searchPlanetaryComputer("wildfire-monitoring", "2024-01-01", "2024-01-02", null);
    const second = await searchPlanetaryComputer("wildfire-monitoring", "2024-01-01", "2024-01-02", null);
    expect(first).toEqual(second);
    expect(cachedFetch).toHaveBeenCalledTimes(3);

    const retryFetch = mockCollectionSTAC({ failFirstAttemptFor: "sentinel-1-rtc" });
    const retried = await searchPlanetaryComputer("flood-water", "2024-02-01", "2024-02-02", null);
    expect(retried.items).toHaveLength(4);
    expect(retryFetch).toHaveBeenCalledTimes(5);
  });

  it("retries transient network failures before marking a collection unavailable", async () => {
    const fetchMock = mockCollectionSTAC({ failNetworkAttemptsFor: "sentinel-1-rtc" });
    const result = await searchPlanetaryComputer("wildfire-monitoring", "2024-05-01", "2024-05-02", null);

    expect(result.items).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("retries a timed-out collection and keeps the successful collection results", async () => {
    vi.useFakeTimers();
    const fetchMock = mockCollectionSTAC({ timeoutFirstAttemptFor: "sentinel-1-rtc" });
    const resultPromise = searchPlanetaryComputer("wildfire-monitoring", "2024-06-01", "2024-06-02", null);
    await vi.advanceTimersByTimeAsync(20_250);
    const result = await resultPromise;

    expect(result.items).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns successful collections when another collection fails and does not cache partial results", async () => {
    const fetchMock = mockCollectionSTAC({ failAlwaysFor: "sentinel-1-rtc" });
    const first = await searchPlanetaryComputer("wildfire-monitoring", "2024-04-01", "2024-04-02", null);
    expect(first.items).toHaveLength(2);
    expect(first.matched).toBeNull();
    expect(first.warnings).toContainEqual(expect.stringContaining("Sentinel-1 radar catalog search failed"));

    await searchPlanetaryComputer("wildfire-monitoring", "2024-04-01", "2024-04-02", null);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("omits untrusted item links and malformed observation geometry", async () => {
    mockCollectionSTAC({ invalidGeometry: true, untrustedItemLink: true, untrustedPreview: true });
    const result = await searchPlanetaryComputer("flood-water", "2024-03-01", "2024-03-02", null);
    expect(result.items[0]).toMatchObject({ id: "pc:sentinel-1-rtc:SENTINEL-1-RTC_SAMPLE", geometry: null, itemUrl: null, previewUrl: null });
    expect(result.warnings).toHaveLength(1);
  });

  it("rejects unsupported workflow IDs before querying arbitrary collections", async () => {
    const fetchMock = mockSTAC(response);
    const invalid = await handlePlanetaryComputerSearch(new Request("http://localhost/api/planetary-computer/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId: "custom", startDate: "2024-01-01", endDate: "2024-01-02" }),
    }));
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only exposes imagery after a public tile path and an in-footprint image tile are verified", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          type: "Feature",
          id: "MODIS_ITEM",
          collection: "modis-14A1-061",
          bbox: [-122.2, 37.2, -121.8, 37.6],
          properties: { datetime: "2026-10-10T00:00:00Z" },
          assets: {
            tilejson: {
              href: "https://planetarycomputer.microsoft.com/api/data/v1/item/modis-14A1-061/MODIS_ITEM/tilejson.json",
              type: "application/json",
              roles: ["tiles"],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tiles: ["https://planetarycomputer.microsoft.com/api/data/v1/item/modis-14A1-061/MODIS_ITEM/tiles/{z}/{x}/{y}"],
          bounds: [-122.2, 37.2, -121.8, 37.6],
          attribution: "Microsoft Planetary Computer",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "image/png" }),
        body: null,
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyPlanetaryComputerVisualization(
      "wildfire-monitoring",
      "modis-14A1-061",
      "MODIS_ITEM",
    );

    expect(result).toMatchObject({
      source: "Microsoft Planetary Computer",
      itemId: "pc:modis-14A1-061:MODIS_ITEM",
      bounds: [-122.2, 37.2, -121.8, 37.6],
      attribution: "Microsoft Planetary Computer",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/tiles/8/");
  });

  it("does not mark signed or untrusted tile URLs as visualizable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        type: "Feature",
        id: "UNTRUSTED_ITEM",
        collection: "modis-14A1-061",
        bbox: [-122.2, 37.2, -121.8, 37.6],
        properties: {},
        assets: {
          tilejson: {
            href: "https://attacker.example/tilejson",
            type: "application/json",
            roles: ["tiles"],
          },
        },
      }),
    }));

    await expect(verifyPlanetaryComputerVisualization(
      "wildfire-monitoring",
      "modis-14A1-061",
      "UNTRUSTED_ITEM",
    )).rejects.toThrow("verified public tile");
  });

  it("does not expose provider-signed tile metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        type: "Feature",
        id: "SIGNED_ITEM",
        collection: "modis-14A1-061",
        bbox: [-122.2, 37.2, -121.8, 37.6],
        properties: {},
        assets: {
          tilejson: {
            href: "https://planetarycomputer.microsoft.com/api/data/v1/item/modis-14A1-061/SIGNED_ITEM/tilejson.json?sig=not-for-browser",
            type: "application/json",
            roles: ["tiles"],
          },
        },
      }),
    }));

    await expect(verifyPlanetaryComputerVisualization(
      "wildfire-monitoring",
      "modis-14A1-061",
      "SIGNED_ITEM",
    )).rejects.toThrow("verified public tile");
  });

  it("validates the visualization request against workflow collections", async () => {
    const fetchMock = mockSTAC(response);
    const invalid = await handlePlanetaryComputerVisualization(new Request("http://localhost/api/planetary-computer/visualization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId: "wildfire-monitoring", collectionId: "private-collection", itemId: "item-1" }),
    }));
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
