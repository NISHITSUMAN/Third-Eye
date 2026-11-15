import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../lib/store";
import type { NISARCoverageResult, NISARGranule } from "../lib/nasa-cmr";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useApp.setState({
    aoi: null,
    nisarStatus: "idle",
    nisarError: null,
    nisarGranules: [],
    nisarGranuleHits: 0,
    nisarGranuleHitsByProduct: {},
    nisarGranuleStatusByProduct: {},
    nisarPage: 0,
    nisarHasMore: false,
    nisarSelectedProductCodes: ["GCOV", "GSLC"],
  });
});

function granule(id: string, granuleId = id): NISARGranule {
  return {
    dataClass: "catalog-metadata",
    id,
    conceptId: id,
    granuleId,
    collectionConceptId: "C123-ASF",
    collectionShortName: "NISAR_L2_GCOV_PROVISIONAL_V1",
    productCode: "GCOV",
    maturity: "provisional",
    productionConfiguration: "standard",
    orbitDirection: null,
    polarization: null,
    trackNumber: null,
    frameNumber: null,
    productionTime: null,
    platform: "NISAR",
    instrument: "L-SAR",
    title: granuleId,
    startDate: "2026-01-01T00:00:00Z",
    endDate: null,
    producer: "ASF",
    bounds: null,
    footprint: null,
    browseUrl: null,
    dataUrl: null,
    metadataUrl: `https://cmr.earthdata.nasa.gov/search/concepts/${id}`,
    earthdataSearchUrl: "https://search.earthdata.nasa.gov/",
  };
}

function coverage(page: number, granules: NISARGranule[]): NISARCoverageResult {
  return {
    collections: [],
    collectionHits: 0,
    productCollections: [],
    granules,
    granuleHits: 3,
    granuleHitsByProduct: { GCOV: 3 },
    granuleStatusByProduct: { GCOV: "ready" },
    page,
    pageSize: 100,
    hasMore: page === 1,
    warnings: [],
  };
}

describe("NISAR global coverage requests", () => {
  it("does not add an India bounding box when no area is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        collections: [],
        collectionHits: 0,
        productCollections: [],
        granules: [],
        granuleHits: 0,
        granuleHitsByProduct: { GCOV: 0 },
        granuleStatusByProduct: { GCOV: "ready" },
        page: 1,
        pageSize: 100,
        hasMore: false,
        warnings: [],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);
    useApp.setState({ aoi: null });

    await useApp.getState().refreshNISARData(["GCOV"]);

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(requestedUrl.pathname).toBe("/api/nisar/coverage");
    for (const bound of ["west", "south", "east", "north"]) {
      expect(requestedUrl.searchParams.has(bound)).toBe(false);
    }
  });

  it("keeps product visibility aligned with the product families being searched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...coverage(1, []),
        granuleHits: 0,
        granuleHitsByProduct: { GUNW: 0, SME2: 0 },
        granuleStatusByProduct: { GUNW: "ready", SME2: "ready" },
      }),
    }));
    useApp.setState({ layers: new Set(["nisar-coverage", "prod-GCOV", "prod-GSLC"]) });

    await useApp.getState().refreshNISARData(["GUNW", "SME2"]);

    const state = useApp.getState();
    expect(state.nisarSelectedProductCodes).toEqual(["GUNW", "SME2"]);
    expect([...state.layers].filter(layer => layer.startsWith("prod-"))).toEqual(["prod-GUNW", "prod-SME2"]);
  });

  it("shares an in-flight request for the same geography and date range", async () => {
    let resolveResponse: ((response: { ok: boolean; json: () => Promise<object> }) => void) | undefined;
    const pending = new Promise<{ ok: boolean; json: () => Promise<object> }>(resolve => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    useApp.setState({ aoi: null });

    const first = useApp.getState().refreshNISARData(["GCOV"]);
    const second = useApp.getState().refreshNISARData(["GCOV"]);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse?.({
      ok: true,
      json: async () => ({
        collections: [],
        collectionHits: 0,
        productCollections: [],
        granules: [],
        granuleHits: 0,
        granuleHitsByProduct: { GCOV: 0 },
        granuleStatusByProduct: { GCOV: "ready" },
        page: 1,
        pageSize: 100,
        hasMore: false,
        warnings: [],
      }),
    });
    await Promise.all([first, second]);

    expect(useApp.getState().nisarStatus).toBe("ready");
  });

  it("appends later pages and deduplicates granules by source record ID", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input, "http://localhost").searchParams.get("page"));
      const result = page === 1
        ? coverage(1, [granule("one"), granule("duplicate", "original")])
        : coverage(2, [granule("duplicate", "revised"), granule("three")]);
      return { ok: true, json: async () => result };
    });
    vi.stubGlobal("fetch", fetchMock);
    useApp.setState({ aoi: null });

    await useApp.getState().refreshNISARData(["GCOV"]);
    await useApp.getState().refreshNISARData(["GCOV"], 2, true);

    const state = useApp.getState();
    expect(state.nisarPage).toBe(2);
    expect(state.nisarHasMore).toBe(false);
    expect(state.nisarGranules).toHaveLength(3);
    expect(state.nisarGranules.find(item => item.id === "duplicate")?.granuleId).toBe("revised");
  });
});
