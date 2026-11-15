import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand, summarizeNISARSearch } from "../lib/ai-agent";
import type { NISARGranule } from "../lib/nasa-cmr";
import { useApp } from "../lib/store";
import { rectangleAOI } from "../lib/analysis";

function granule(granuleId: string, startDate: string): NISARGranule {
  return {
    dataClass: "catalog-metadata",
    id: granuleId,
    conceptId: granuleId,
    granuleId,
    collectionConceptId: "C123-NISAR",
    collectionShortName: "NISAR_GCOV",
    productCode: "GCOV",
    maturity: "unknown",
    productionConfiguration: "unknown",
    orbitDirection: null,
    polarization: null,
    trackNumber: null,
    frameNumber: null,
    productionTime: null,
    platform: null,
    instrument: null,
    title: granuleId,
    startDate,
    endDate: null,
    producer: "NASA",
    bounds: null,
    footprint: null,
    browseUrl: null,
    dataUrl: null,
    metadataUrl: "https://cmr.earthdata.nasa.gov/search/concepts/G123-NISAR.umm_json",
    earthdataSearchUrl: "https://search.earthdata.nasa.gov/",
  };
}

describe("assistant NISAR action results", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useApp.getState().select(null);
    useApp.getState().setAOI(null);
    useApp.getState().clearAIMessages();
    useApp.setState({
      aiMessages: [],
      aiSteps: null,
      aiActive: false,
      nisarGranules: [],
      agentFindings: [],
      agentInvestigation: null,
    });
  });

  it("reports real search counts and the newest loaded catalog record", () => {
    const result = summarizeNISARSearch({
      status: "ready",
      error: null,
      hits: 17,
      granules: [
        granule("older-record", "2026-03-01T00:00:00Z"),
        granule("newest-record", "2026-08-15T00:00:00Z"),
      ],
    });

    expect(result).toContain("17 matching acquisition record(s); 2 granule(s) loaded");
    expect(result).toContain("newest-record, acquired Aug 15, 2026");
    expect(result).toContain("not processed radar measurements");
  });

  it("does not imply catalog data exists when the search fails or is empty", () => {
    expect(summarizeNISARSearch({
      status: "error",
      error: "NASA CMR timed out.",
      hits: 0,
      granules: [],
    })).toContain("NASA CMR search failed: NASA CMR timed out.");
    expect(summarizeNISARSearch({
      status: "ready",
      error: null,
      hits: 0,
      granules: [],
    })).toContain("no matching NISAR acquisition records");
  });

  it("geocodes a named place into the shared AOI before querying NASA CMR", async () => {
    const existingAOI = rectangleAOI([-123, 37], [-122, 38]);
    useApp.getState().setAOI(existingAOI);
    let coverageUrl = "";
    const assistantRequests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/assistant") {
        assistantRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          message: "Searching NASA CMR.",
          actions: [{ type: "search_nisar", locationQuery: "California" }],
          mode: "ai",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        return new Response(JSON.stringify({
          status: "ready",
          warnings: [],
          results: [{
            id: "photon:relation:california",
            name: "California",
            displayName: "California, United States",
            type: "state",
            latitude: 36.7783,
            longitude: -119.4179,
            bbox: [-124.48, 32.53, -114.13, 42.01],
            geometry: { type: "Point", coordinates: [-119.4179, 36.7783] },
            provider: "photon-osm",
            confidence: null,
            providerRelevance: 0.9,
            attribution: "© OpenStreetMap contributors · Photon",
            extentQuality: "source",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/nisar/coverage?")) {
        coverageUrl = url;
        return new Response(JSON.stringify({
          collections: [],
          collectionHits: 0,
          productCollections: [],
          granules: [],
          granuleHits: 0,
          granuleHitsByProduct: {},
          granuleStatusByProduct: {},
          page: 1,
          pageSize: 100,
          hasMore: false,
          warnings: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/meteomatics/context")) {
        return new Response(JSON.stringify({
          source: "Meteomatics",
          configured: false,
          status: "not-configured",
          observedAt: null,
          values: [],
          warning: "Not configured.",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Find NISAR acquisitions in California");
    const state = useApp.getState();

    expect(coverageUrl).toContain("west=-124.48");
    expect(coverageUrl).toContain("south=32.53");
    expect(coverageUrl).toContain("east=-114.13");
    expect(coverageUrl).toContain("north=42.01");
    expect(state.aoi?.name).toBe("California, United States");
    expect(state.locationResult?.displayName).toBe("California, United States");
    expect(state.selectedId).toBe("photon:relation:california");
    expect(state.layers.has("search-location")).toBe(true);
    expect(state.view).toMatchObject({ lat: 36.7783, lng: -119.4179 });
    expect(assistantRequests[0]?.["context"]).toMatchObject({
      aoi: { name: existingAOI.name, bounds: existingAOI.bounds },
    });
    expect(assistantRequests[1]?.["phase"]).toBe("plan");
    expect(assistantRequests[2]?.["phase"]).toBe("final");
    expect(assistantRequests[2]?.["context"]).toMatchObject({
      aoi: { name: "California, United States", bounds: [-124.48, 32.53, -114.13, 42.01] },
      data: { nisar: { status: "ready", loaded: 0 } },
    });
    expect(assistantRequests[2]?.["executionResults"]).toEqual([
      expect.objectContaining({
        tool: "search_nisar",
        status: "completed",
        evidenceLevel: "retrieved_dataset",
        source: "NASA CMR / NISAR catalog",
        summary: expect.stringContaining("no matching NISAR acquisition records"),
      }),
    ]);
  });

  it("replans from historical climate evidence and maps ranked nationwide candidates", async () => {
    const assistantRequests: Record<string, unknown>[] = [];
    const geocodeRequests: string[] = [];
    const climateRequests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/assistant") {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assistantRequests.push(request);
        const response = request["phase"] === "final"
          ? {
            message: "These are screening-level candidates based on retrieved five-year temperature and precipitation summaries; soil and irrigation data remain unavailable.",
            actions: [],
            mode: "ai",
          }
          : assistantRequests.length === 1
            ? {
              message: "I will sample climate context across two candidate regions.",
              actions: [
                { type: "get_climate_context", locationQuery: "Shimla" },
                { type: "get_climate_context", locationQuery: "Mahabaleshwar" },
              ],
              mode: "ai",
            }
            : assistantRequests.length === 2
              ? {
                message: "The retrieved climate summaries support a qualitative comparison.",
                actions: [{
                  type: "map_ranked_places",
                  places: [
                    { name: "Shimla", rank: 1, rationale: "Cooler historical conditions align better with a strawberry screening profile.", evidence: ["Retrieved historical temperature and precipitation summary."] },
                    { name: "Mahabaleshwar", rank: 2, rationale: "A distinct candidate with a different seasonal temperature and rainfall profile.", evidence: ["Retrieved historical temperature and precipitation summary."] },
                  ],
                }],
                mode: "ai",
              }
              : { message: "The mapped candidates are ready.", actions: [], mode: "ai" };
        return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        geocodeRequests.push(url);
        const place = new URL(url, "http://localhost").searchParams.get("q") ?? "";
        const places: Record<string, { latitude: number; longitude: number; bbox: [number, number, number, number] }> = {
          Shimla: { latitude: 31.1048, longitude: 77.1734, bbox: [77.05, 31.02, 77.25, 31.2] },
          Mahabaleshwar: { latitude: 17.9307, longitude: 73.6477, bbox: [73.55, 17.85, 73.75, 18.02] },
        };
        const point = places[place];
        if (!point) throw new Error(`Unexpected place: ${place}`);
        return new Response(JSON.stringify({
          status: "ready",
          warnings: [],
          results: [{
            id: `photon:place:${place.toLowerCase()}`,
            name: place,
            displayName: `${place}, India`,
            type: "city",
            latitude: point.latitude,
            longitude: point.longitude,
            bbox: point.bbox,
            geometry: place === "Mahabaleshwar"
              ? { type: "Polygon", coordinates: [[
                [73.55, 17.85],
                [73.75, 17.85],
                [73.75, 18.02],
                [73.55, 18.02],
                [73.55, 17.85],
              ]] }
              : { type: "Point", coordinates: [point.longitude, point.latitude] },
            provider: "photon-osm",
            confidence: null,
            providerRelevance: 0.9,
            attribution: "© OpenStreetMap contributors · Photon",
            extentQuality: "source",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/climate/context?")) {
        climateRequests.push(url);
        return new Response(JSON.stringify({
          status: "ready",
          period: { start: "2021-01-01", end: "2025-12-31" },
          monthlySummary: [{ month: 1, meanTemperatureC: 5.2, meanMonthlyPrecipitationMm: 48, completeYears: 5 }],
          elevation: { value: 2200, unit: "m", source: "Open-Meteo Elevation API" },
          sources: [{ name: "Open-Meteo Historical Weather API · ERA5-Land" }],
          limitations: ["Screening predictors only; not a validated crop model."],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("What are the best places in India to grow strawberries?");
    const state = useApp.getState();

    expect(geocodeRequests).toHaveLength(4);
    expect(climateRequests).toHaveLength(2);
    expect(assistantRequests.map(request => request["phase"])).toEqual(["plan", "plan", "plan", "final"]);
    expect(assistantRequests[1]?.["executionResults"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "get_climate_context", evidenceLevel: "retrieved_dataset" }),
    ]));
    expect(assistantRequests[2]?.["executionResults"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "get_climate_context" }),
    ]));
    expect(assistantRequests[2]?.["context"]).toMatchObject({
      previousAgentFindings: [
        expect.objectContaining({ name: "Shimla, India", rank: 1 }),
        expect.objectContaining({ name: "Mahabaleshwar, India", rank: 2 }),
      ],
    });
    expect(assistantRequests[3]?.["executionResults"]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: "map_ranked_places",
        summary: expect.stringContaining("Shimla, India"),
      }),
    ]));
    expect(state.agentFindings.map(finding => [finding.rank, finding.name])).toEqual([
      [1, "Shimla, India"],
      [2, "Mahabaleshwar, India"],
    ]);
    expect(state.agentFindings[1]?.geometry?.type).toBe("Polygon");
    expect(state.agentInvestigation).toMatchObject({
      confidence: "screening",
      summary: "2 ranked candidate locations mapped as qualitative screening findings.",
      mapActions: [{
        type: "map_ranked_places",
        findingIds: state.agentFindings.map(finding => finding.id),
      }],
    });
    expect(state.view.lat).toBeCloseTo(24.5, 0);
    expect(state.aiMessages.at(-1)?.text).toContain("soil and irrigation data remain unavailable");
  });

  it("uses the selected AOI and active date context for a local growing question", async () => {
    const area = rectangleAOI([-1, 50], [0, 51]);
    useApp.getState().setAOI({ ...area, name: "Kent, England" });
    useApp.getState().setTimeRange({ start: "2025-01-01", end: "2025-12-31" });
    const assistantRequests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/assistant") {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assistantRequests.push(request);
        const isFinal = request["phase"] === "final";
        const requestCount = assistantRequests.filter(item => item["phase"] === "plan").length;
        const response = isFinal
          ? {
            message: "For the current month, the historical summary supports a cautious seasonal screening, not a planting guarantee.",
            actions: [],
            mode: "ai",
          }
          : requestCount === 1
            ? {
              message: "Checking historical environmental context for the selected area.",
              actions: [{ type: "get_climate_context", locationQuery: "Kent, England" }],
              mode: "ai",
            }
            : { message: "The available climate summary is ready.", actions: [], mode: "ai" };
        return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        return new Response(JSON.stringify({
          status: "ready",
          warnings: [],
          results: [{
            id: "photon:region:kent",
            name: "Kent",
            displayName: "Kent, England",
            type: "state",
            latitude: 51.2,
            longitude: 0.8,
            bbox: [0.1, 50.8, 1.4, 51.5],
            geometry: { type: "Point", coordinates: [0.8, 51.2] },
            provider: "photon-osm",
            confidence: null,
            providerRelevance: 0.9,
            attribution: "© OpenStreetMap contributors · Photon",
            extentQuality: "source",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/climate/context?")) {
        return new Response(JSON.stringify({
          status: "ready",
          period: { start: "2021-01-01", end: "2025-12-31" },
          monthlySummary: [{ month: 6, meanTemperatureC: 16.4, meanMonthlyPrecipitationMm: 58, completeYears: 5 }],
          elevation: { value: 72, unit: "m" },
          sources: [{ name: "Open-Meteo Historical Weather API · ERA5-Land" }],
          limitations: ["Historical summary, not a forecast or crop model."],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("What can I grow here this month?");

    expect(assistantRequests[0]?.["context"]).toMatchObject({
      aoi: { name: "Kent, England", bounds: [-1, 50, 0, 51] },
      timeRange: { current: "2025-12-31" },
    });
    expect(assistantRequests[1]?.["executionResults"]).toEqual([
      expect.objectContaining({ tool: "get_climate_context", source: "Open-Meteo ERA5-Land historical reanalysis and elevation" }),
    ]);
    expect(useApp.getState().aiMessages.at(-1)?.text).toContain("cautious seasonal screening");
  });

  it("uses a selected AOI directly for climate context when no place name is supplied", async () => {
    const area = rectangleAOI([-1, 50], [0, 51]);
    useApp.getState().setAOI({ ...area, name: "Selected field" });
    const assistantRequests: Record<string, unknown>[] = [];
    const climateUrls: string[] = [];
    let geocodeRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/assistant") {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assistantRequests.push(request);
        const response = request["phase"] === "final"
          ? { message: "Historical context is available for the selected field.", actions: [], mode: "ai" }
          : assistantRequests.length === 1
            ? { message: "Checking the selected area.", actions: [{ type: "get_climate_context" }], mode: "ai" }
            : { message: "The area profile is ready.", actions: [], mode: "ai" };
        return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        geocodeRequests += 1;
        throw new Error("The selected AOI should not be geocoded again.");
      }
      if (url.startsWith("/api/climate/context?")) {
        climateUrls.push(url);
        return new Response(JSON.stringify({
          status: "ready",
          period: { start: "2021-01-01", end: "2025-12-31" },
          monthlySummary: [{ month: 6, meanTemperatureC: 16.4, meanMonthlyPrecipitationMm: 58, completeYears: 5 }],
          elevation: { value: 72, unit: "m", source: "Open-Meteo Elevation API" },
          sources: [{ name: "Open-Meteo Historical Weather API · ERA5-Land" }],
          limitations: ["Grid-cell screening only."],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("What can I grow in this selected area this month?");

    expect(geocodeRequests).toBe(0);
    expect(climateUrls).toHaveLength(1);
    expect(climateUrls[0]).toContain("lat=50.5");
    expect(climateUrls[0]).toContain("lng=-0.5");
    const climateResult = assistantRequests[1]?.["executionResults"] as Array<{ summary: string }>;
    expect(climateResult[0]?.summary).toContain('"location":"Selected field"');
    expect(climateResult[0]?.summary).toContain('"areaBounds":[-1,50,0,51]');
    expect(climateResult[0]?.summary).toContain('"monthlySummary":[[6,16.4,58,5]]');
  });

  it("profiles five candidate places together and preserves complete monthly evidence", async () => {
    const places: Record<string, { latitude: number; longitude: number }> = {
      Shimla: { latitude: 31.1048, longitude: 77.1734 },
      Mahabaleshwar: { latitude: 17.9307, longitude: 73.6477 },
      Ooty: { latitude: 11.4102, longitude: 76.695 },
      Kullu: { latitude: 31.9579, longitude: 77.1095 },
      Pune: { latitude: 18.5204, longitude: 73.8567 },
    };
    const assistantRequests: Record<string, unknown>[] = [];
    const climateRequests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/assistant") {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assistantRequests.push(request);
        const planningCalls = assistantRequests.filter(item => item["phase"] === "plan").length;
        const response = request["phase"] === "final"
          ? { message: "These three places are qualitatively compared using the retrieved historical profiles.", actions: [], mode: "ai" }
          : planningCalls === 1
            ? {
              message: "Retrieving consistent profiles for all three candidates.",
              actions: [{
                type: "get_climate_context",
                locationQueries: ["Shimla", "Mahabaleshwar", "Ooty", "Kullu", "Pune"],
              }],
              mode: "ai",
            }
            : planningCalls === 2
              ? {
                message: "Mapping the verified comparison candidates.",
                actions: [{
                  type: "map_ranked_places",
                  places: ["Shimla", "Mahabaleshwar", "Ooty", "Kullu", "Pune"].map((name, index) => ({
                    name,
                    rank: index + 1,
                    rationale: `Candidate ${index + 1} compared using the retrieved climate profiles.`,
                    evidence: ["Five-year monthly ERA5-Land profile."],
                  })),
                }],
                mode: "ai",
              }
              : { message: "The profiles are complete.", actions: [], mode: "ai" };
        return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        const name = new URL(url, "http://localhost").searchParams.get("q") ?? "";
        const place = places[name];
        if (!place) throw new Error(`Unexpected place: ${name}`);
        return new Response(JSON.stringify({
          status: "ready",
          warnings: [],
          results: [{
            id: `photon:place:${name.toLowerCase()}`,
            name,
            displayName: `${name}, India`,
            type: "city",
            ...place,
            bbox: [place.longitude - 0.1, place.latitude - 0.1, place.longitude + 0.1, place.latitude + 0.1],
            geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
            provider: "photon-osm",
            confidence: null,
            providerRelevance: 0.9,
            attribution: "© OpenStreetMap contributors · Photon",
            extentQuality: "source",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/climate/context?")) {
        climateRequests.push(url);
        return new Response(JSON.stringify({
          status: "ready",
          period: { start: "2021-01-01", end: "2025-12-31" },
          monthlySummary: Array.from({ length: 12 }, (_, index) => ({
            month: index + 1,
            meanTemperatureC: index + 5,
            meanMonthlyPrecipitationMm: index + 20,
            completeYears: 5,
          })),
          elevation: { value: 2200, unit: "m", source: "Open-Meteo Elevation API" },
          sources: [{ name: "Open-Meteo Historical Weather API · ERA5-Land" }],
          limitations: ["Grid-cell screening only."],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Compare these candidate places for strawberries.");

    expect(climateRequests).toHaveLength(5);
    expect(assistantRequests.map(request => request["phase"])).toEqual(["plan", "plan", "plan", "final"]);
    const climateResults = assistantRequests[1]?.["executionResults"] as Array<{ summary: string }>;
    const summary = climateResults[0]?.summary ?? "";
    expect(summary).toContain('"location":"Shimla, India"');
    expect(summary).toContain('"location":"Mahabaleshwar, India"');
    expect(summary).toContain('"location":"Ooty, India"');
    expect(summary).toContain('"location":"Kullu, India"');
    expect(summary).toContain('"location":"Pune, India"');
    expect(summary).toContain("[12,16,31,5]");
    expect(summary.length).toBeGreaterThan(1_000);
    expect(summary.length).toBeLessThan(3_500);
    expect(useApp.getState().agentFindings.map(finding => finding.name)).toEqual([
      "Shimla, India",
      "Mahabaleshwar, India",
      "Ooty, India",
      "Kullu, India",
      "Pune, India",
    ]);
  });

  it("compares Maharashtra and Himachal Pradesh with climate evidence and mapped findings", async () => {
    const assistantRequests: Record<string, unknown>[] = [];
    const climateRequests: string[] = [];
    const places: Record<string, { latitude: number; longitude: number; bbox: [number, number, number, number] }> = {
      Maharashtra: { latitude: 19.75, longitude: 75.7, bbox: [72.6, 15.6, 80.9, 22.1] },
      "Himachal Pradesh": { latitude: 31.1, longitude: 77.2, bbox: [75.6, 30.4, 79, 33.2] },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/assistant") {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assistantRequests.push(request);
        const planningCalls = assistantRequests.filter(item => item["phase"] === "plan").length;
        const response = request["phase"] === "final"
          ? {
            message: "The two states show different historical temperature and rainfall profiles; this is a screening comparison, not validated crop advice.",
            actions: [],
            mode: "ai",
          }
          : planningCalls === 1
            ? {
              message: "I will retrieve both regions before comparing them.",
              actions: [
                { type: "get_climate_context", locationQuery: "Maharashtra" },
                { type: "get_climate_context", locationQuery: "Himachal Pradesh" },
              ],
              mode: "ai",
            }
            : planningCalls === 2
              ? {
                message: "Both regional summaries are available; mapping the same comparison candidates.",
                actions: [{
                  type: "map_ranked_places",
                  places: [
                    { name: "Himachal Pradesh", rank: 1, rationale: "Cooler historical temperature profile.", evidence: ["Historical monthly temperature and precipitation summary."] },
                    { name: "Maharashtra", rank: 2, rationale: "Warmer historical profile with a distinct rainfall pattern.", evidence: ["Historical monthly temperature and precipitation summary."] },
                  ],
                }],
                mode: "ai",
              }
              : { message: "Comparison complete.", actions: [], mode: "ai" };
        return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        const name = new URL(url, "http://localhost").searchParams.get("q") ?? "";
        const place = places[name];
        if (!place) throw new Error(`Unexpected place: ${name}`);
        return new Response(JSON.stringify({
          status: "ready",
          warnings: [],
          results: [{
            id: `photon:region:${name.toLowerCase().replaceAll(" ", "-")}`,
            name,
            displayName: `${name}, India`,
            type: "state",
            latitude: place.latitude,
            longitude: place.longitude,
            bbox: place.bbox,
            geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
            provider: "photon-osm",
            confidence: null,
            providerRelevance: 0.9,
            attribution: "© OpenStreetMap contributors · Photon",
            extentQuality: "source",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/climate/context?")) {
        climateRequests.push(url);
        return new Response(JSON.stringify({
          status: "ready",
          monthlySummary: [{ month: 1, meanTemperatureC: climateRequests.length === 1 ? 24 : 6, meanMonthlyPrecipitationMm: climateRequests.length === 1 ? 12 : 48, completeYears: 5 }],
          elevation: null,
          sources: [{ name: "Open-Meteo Historical Weather API · ERA5-Land" }],
          limitations: ["Historical screening only."],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Compare Maharashtra and Himachal Pradesh for strawberry farming.");

    expect(climateRequests).toHaveLength(2);
    expect(assistantRequests.map(request => request["phase"])).toEqual(["plan", "plan", "plan", "final"]);
    expect(useApp.getState().agentFindings.map(finding => [finding.rank, finding.name])).toEqual([
      [1, "Himachal Pradesh, India"],
      [2, "Maharashtra, India"],
    ]);
    expect(useApp.getState().aiMessages.at(-1)?.text).toContain("not validated crop advice");
  });

  it("keeps the existing AOI when the assistant does not name a new region", async () => {
    const currentAOI = rectangleAOI([-123, 37], [-122, 38]);
    useApp.getState().setAOI(currentAOI);
    let coverageUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/assistant") {
        return new Response(JSON.stringify({
          message: "Searching the current area.",
          actions: [{ type: "search_nisar" }],
          mode: "ai",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/nisar/coverage?")) {
        coverageUrl = url;
        return new Response(JSON.stringify({
          collections: [],
          collectionHits: 0,
          productCollections: [],
          granules: [],
          granuleHits: 0,
          granuleHitsByProduct: {},
          granuleStatusByProduct: {},
          page: 1,
          pageSize: 100,
          hasMore: false,
          warnings: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Find recent NISAR acquisitions");

    expect(useApp.getState().aoi).toBe(currentAOI);
    expect(coverageUrl).toContain("west=-123");
    expect(coverageUrl).toContain("east=-122");
  });

  it("stops and explains the fixed planning-round limit", async () => {
    const assistantRequests: Record<string, unknown>[] = [];
    let planningCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/assistant") {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assistantRequests.push(request);
        if (request["phase"] === "final") {
          return new Response(JSON.stringify({
            message: "Four locations were checked.",
            actions: [],
            mode: "ai",
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        planningCalls += 1;
        return new Response(JSON.stringify({
          message: "Checking another candidate.",
          actions: [{ type: "get_climate_context", locationQuery: `Candidate ${planningCalls}` }],
          mode: "ai",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        const place = new URL(url, "http://localhost").searchParams.get("q") ?? "Candidate 1";
        const index = Number(place.match(/\d+/)?.[0] ?? 1);
        return new Response(JSON.stringify({
          status: "ready",
          warnings: [],
          results: [{
            id: `photon:candidate:${index}`,
            name: place,
            displayName: `${place}, India`,
            type: "city",
            latitude: 10 + index,
            longitude: 70 + index,
            bbox: [69 + index, 9 + index, 71 + index, 11 + index],
            geometry: { type: "Point", coordinates: [70 + index, 10 + index] },
            provider: "photon-osm",
            confidence: null,
            providerRelevance: 0.9,
            attribution: "© OpenStreetMap contributors · Photon",
            extentQuality: "source",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/climate/context?")) {
        return new Response(JSON.stringify({
          status: "ready",
          monthlySummary: [{ month: 1, meanTemperatureC: 12, meanMonthlyPrecipitationMm: 20, completeYears: 5 }],
          sources: [{ name: "Open-Meteo ERA5-Land" }],
          limitations: ["Screening only."],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Investigate environmental context in India.");

    expect(assistantRequests.map(request => request["phase"])).toEqual(["plan", "plan", "plan", "plan", "final"]);
    expect((assistantRequests[1]?.["executionResults"] as unknown[]).length).toBe(1);
    expect((assistantRequests[3]?.["executionResults"] as unknown[]).length).toBe(3);
    expect(useApp.getState().aiMessages.at(-1)?.text).toContain("Stopped after 4 investigation rounds");
  });

  it("resolves a place-only request and updates the shared map and AOI", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/assistant") {
        return new Response(JSON.stringify({
          message: "Focusing on Nairobi.",
          actions: [{ type: "search_location", locationQuery: "Nairobi" }],
          mode: "ai",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        return new Response(JSON.stringify({
          status: "ready",
          warnings: [],
          results: [{
            id: "photon:city:nairobi",
            name: "Nairobi",
            displayName: "Nairobi, Kenya",
            type: "city",
            latitude: -1.2864,
            longitude: 36.8172,
            bbox: [36.6, -1.45, 37, -1.15],
            geometry: { type: "Point", coordinates: [36.8172, -1.2864] },
            provider: "photon-osm",
            confidence: null,
            providerRelevance: 0.9,
            attribution: "© OpenStreetMap contributors · Photon",
            extentQuality: "source",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Show me Nairobi on the globe");

    expect(useApp.getState().aoi?.name).toBe("Nairobi, Kenya");
    expect(useApp.getState().locationResult?.displayName).toBe("Nairobi, Kenya");
    expect(useApp.getState().selectedId).toBe("photon:city:nairobi");
    expect(useApp.getState().view).toMatchObject({ lat: -1.2864, lng: 36.8172 });
  });

  it("executes typed navigation actions instead of leaving them as buttons", async () => {
    const onNavigate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) !== "/api/assistant") throw new Error(`Unexpected request: ${String(input)}`);
      return new Response(JSON.stringify({
        message: "Opening analysis on the shared globe.",
        actions: [{ type: "navigate", route: "/analyze" }],
        mode: "ai",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    await runCommand("Open the analysis tools", { onNavigate });

    expect(onNavigate).toHaveBeenCalledWith("/analyze");
    expect(useApp.getState().aiMessages.at(-1)?.actions).toEqual([]);
  });

  it("sends restored conversation history with a follow-up command", async () => {
    useApp.getState().restoreAIMessages([
      { id: "prior-user", role: "user", text: "Find recent observations in Kenya." },
      { id: "prior-assistant", role: "system", text: "I found three catalog records in Kenya." },
    ]);
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== "/api/assistant") throw new Error(`Unexpected request: ${String(input)}`);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        message: "The earlier search was for Kenya and returned three records.",
        actions: [],
        mode: "ai",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    await runCommand("Which one was the newest?");

    expect(requestBody?.["history"]).toEqual([
      { role: "user", content: "Find recent observations in Kenya." },
      { role: "assistant", content: "I found three catalog records in Kenya." },
    ]);
  });

  it("continues to open analysis when a requested place cannot be geocoded", async () => {
    const onNavigate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/assistant") {
        return new Response(JSON.stringify({
          message: "Focusing Mumbai and opening analysis.",
          actions: [
            { type: "search_location", locationQuery: "Mumbai" },
            { type: "navigate", route: "/analyze" },
          ],
          mode: "ai",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/geocode/search?")) {
        return new Response(JSON.stringify({ error: "Geocoder temporarily unavailable." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Where is the best land in Mumbai for a high-rise building?", { onNavigate });

    expect(onNavigate).toHaveBeenCalledWith("/analyze");
    expect(useApp.getState().aiMessages.at(-1)?.text).toContain("Geocoder temporarily unavailable");
  });

  it("reports an unconfigured weather provider without inventing measurements", async () => {
    useApp.getState().setAOI(rectangleAOI([-1, 50], [0, 51]));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/assistant") {
        return new Response(JSON.stringify({
          message: "Checking weather.",
          actions: [{ type: "get_weather_context" }],
          mode: "ai",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.startsWith("/api/meteomatics/context?")) {
        return new Response(JSON.stringify({
          source: "Meteomatics",
          configured: false,
          status: "not-configured",
          observedAt: null,
          values: [],
          warning: "Not configured.",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    await runCommand("Check the weather at the current area");

    const reply = useApp.getState().aiMessages.at(-1)?.text ?? "";
    expect(reply).toContain("Meteomatics weather is not configured");
    expect(reply).toContain("No weather measurements are available");
    expect(reply).not.toMatch(/\b\d+\s*(?:°C|°F|mm|km\/h)\b/);
  });

  it("selects and flies to an existing catalog record by its loaded ID", async () => {
    const record = {
      ...granule("nasa-granule-1", "2026-08-15T00:00:00Z"),
      bounds: { west: 10, south: 20, east: 12, north: 22 },
    };
    useApp.setState({ nisarGranules: [record], nisarStatus: "ready" });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) !== "/api/assistant") throw new Error(`Unexpected request: ${String(input)}`);
      return new Response(JSON.stringify({
        message: "Focusing on the loaded acquisition.",
        actions: [{ type: "select_result", recordId: record.id }],
        mode: "ai",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    await runCommand("Focus the latest currently loaded observation on the map");

    expect(useApp.getState().selectedId).toBe(record.id);
    expect(useApp.getState().view).toMatchObject({ lat: 21, lng: 11 });
    expect(useApp.getState().aiMessages.at(-1)?.text).toContain("Focusing on the loaded acquisition.");
  });

  it("aborts an in-flight assistant request without displaying a backend failure", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }));
    const controller = new AbortController();
    const pending = runCommand("Show the latest observations", { voice: true, signal: controller.signal });

    expect(requestSignal).toBe(controller.signal);
    controller.abort();

    expect(await pending).toBe(false);
    expect(useApp.getState().aiSteps).toBeNull();
    expect(useApp.getState().aiMessages.filter(message => message.role === "system")).toHaveLength(0);
  });
});
