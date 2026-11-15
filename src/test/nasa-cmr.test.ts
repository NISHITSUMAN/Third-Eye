import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchNISARGranuleByConceptId,
  searchNISARCollections,
  searchNISARGranules,
  searchNISARCoverage,
  searchOPERACatalogCollections,
} from "../lib/nasa-cmr";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockCMR(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("NASA CMR metadata adapter", () => {
  it("loads a real granule directly by concept ID for shareable observation URLs", async () => {
    const fetchMock = mockCMR({
      meta: {
        "concept-id": "G12345-ASF",
        "collection-concept-id": "C12345-ASF",
        "native-id": "NISAR_L2_GCOV_TEST",
      },
      umm: {
        GranuleUR: "NISAR_L2_GCOV_TEST",
        TemporalExtent: { RangeDateTime: {
          BeginningDateTime: "2026-10-01T00:00:00Z",
          EndingDateTime: "2026-10-01T00:00:01Z",
        } },
        DataCenters: [{ ShortName: "ASF DAAC" }],
        AdditionalAttributes: [
          { Name: "PRODUCTION_CONFIGURATION", Values: [{ Value: "URGENT_RESPONSE" }] },
          { Name: "ORBIT_DIRECTION", Values: [{ Value: "ASCENDING" }] },
          { Name: "POLARIZATION", Value: "HH+HV" },
          { Name: "TRACK_NUMBER", Value: "42" },
        ],
        Platforms: [{ ShortName: "NISAR", Instruments: [{ ShortName: "L-SAR" }] }],
        CollectionReference: {
          ShortName: "NISAR_L1_UR_RSLC_V1",
          EntryTitle: "NISAR Range-Doppler Single-Look Complex Product",
        },
        ProductionDateTime: "2026-10-01T01:00:00Z",
        SpatialExtent: { HorizontalSpatialDomain: { Geometry: {
          GPolygons: [{ Boundary: { Points: [
            { Longitude: 71, Latitude: 19 },
            { Longitude: 72, Latitude: 19 },
            { Longitude: 72, Latitude: 20 },
            { Longitude: 71, Latitude: 19 },
          ] } }],
        } } },
        RelatedUrls: [{
          URL: "https://browse.example.org/nisar.png",
          Type: "GET RELATED VISUALIZATION",
          URLContentType: "Visualization",
          MimeType: "image/png",
        }],
      },
    });

    const granule = await fetchNISARGranuleByConceptId("G12345-ASF");
    expect(granule).toMatchObject({
      dataClass: "catalog-metadata",
      id: "nisar:G12345-ASF",
      conceptId: "G12345-ASF",
      collectionConceptId: "C12345-ASF",
      productCode: "RSLC",
      maturity: "unknown",
      productionConfiguration: "urgent-response",
      orbitDirection: "ASCENDING",
      polarization: "HH+HV",
      trackNumber: "42",
      frameNumber: null,
      productionTime: "2026-10-01T01:00:00Z",
      platform: "NISAR",
      instrument: "L-SAR",
      collectionShortName: "NISAR_L1_UR_RSLC_V1",
      startDate: "2026-10-01T00:00:00Z",
      producer: "ASF DAAC",
      browseUrl: "https://browse.example.org/nisar.png",
    });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      "/search/concepts/G12345-ASF.umm_json",
    );
    const earthdataUrl = new URL(granule.earthdataSearchUrl);
    expect(earthdataUrl.pathname).toBe("/search/granules");
    expect(earthdataUrl.searchParams.get("p")).toBe("C12345-ASF");
    expect(earthdataUrl.searchParams.get("g")).toBe("G12345-ASF");
    expect(earthdataUrl.searchParams.has("q")).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Accept: "application/vnd.nasa.cmr.umm+json, application/json" },
    });
  });

  it("normalizes public NISAR collection metadata and ignores unrelated records", async () => {
    const fetchMock = mockCMR({
      hits: 2,
      items: [
        {
          meta: { "concept-id": "C12345-ASF", "revision-date": "2026-10-01T00:00:00Z" },
          umm: {
            ShortName: "NISAR_L2_GCOV_PROVISIONAL_V1",
            EntryTitle: "NISAR Provisional Geocoded Covariance Product",
            Version: "1",
            Abstract: "A <b>sample</b> abstract with &amp; entities.",
            DOI: { DOI: "10.5067/NISAR/GCOV.001" },
            ProcessingLevel: { Id: "2" },
            TemporalExtents: [{ RangeDateTime: { BeginningDateTime: "2026-01-01T00:00:00Z", EndingDateTime: "2026-10-01T00:00:00Z" } }],
          },
        },
        {
          meta: { "concept-id": "C99999-OTHER" },
          umm: { ShortName: "OTHER", EntryTitle: "Unrelated dataset" },
        },
      ],
    });

    const result = await searchNISARCollections();
    expect(result.hits).toBe(2);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0]).toMatchObject({
      dataClass: "catalog-metadata",
      conceptId: "C12345-ASF",
      shortName: "NISAR_L2_GCOV_PROVISIONAL_V1",
      version: "1",
      processingLevel: "2",
      productCode: "GCOV",
      maturity: "provisional",
      doi: "10.5067/NISAR/GCOV.001",
      startDate: "2026-01-01T00:00:00Z",
      endDate: "2026-10-01T00:00:00Z",
      abstract: "A sample abstract with & entities.",
    });
    expect(result.collections[0]?.metadataUrl).toBe("https://cmr.earthdata.nasa.gov/search/concepts/C12345-ASF");
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.hostname).toBe("cmr.earthdata.nasa.gov");
    expect(requested.searchParams.get("keyword")).toBe("NISAR");
    expect(requested.searchParams.get("has_granules")).toBe("true");
  });

  it("loads only real OPERA CMR collection metadata and excludes keyword-only unrelated records", async () => {
    const fetchMock = mockCMR({
      hits: 14,
      items: [
        {
          meta: { "concept-id": "C456-ASF", "revision-date": "2026-10-01T00:00:00Z" },
          umm: {
            ShortName: "OPERA_L3_DISP-S1_V1",
            EntryTitle: "OPERA Sentinel-1 Displacement",
            Version: "1",
            Abstract: "Source-reported displacement product metadata.",
            DOI: { DOI: "10.5067/OPERA/DISP.001" },
            ProcessingLevel: { Id: "3" },
            TemporalExtents: [{ RangeDateTime: { BeginningDateTime: "2025-01-01T00:00:00Z", EndingDateTime: "2026-10-01T00:00:00Z" } }],
          },
        },
        {
          meta: { "concept-id": "C457-ASF" },
          umm: { ShortName: "ASF_ECMWF_TROP", EntryTitle: "Unrelated keyword match" },
        },
      ],
    });

    const result = await searchOPERACatalogCollections();
    expect(result.hits).toBe(14);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0]).toMatchObject({
      dataClass: "catalog-metadata",
      shortName: "OPERA_L3_DISP-S1_V1",
      title: "OPERA Sentinel-1 Displacement",
      processingLevel: "3",
      startDate: "2025-01-01T00:00:00Z",
      doi: "10.5067/OPERA/DISP.001",
    });
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("keyword")).toBe("OPERA");
    expect(requested.searchParams.get("has_granules")).toBe("true");
  });

  it("prefers exact polygon footprints and searches granules by collection, area, and time", async () => {
    const fetchMock = mockCMR({
      hits: 35,
      items: [{
        meta: { "concept-id": "G12345-ASF", "native-id": "granule-native-id" },
        umm: {
          GranuleUR: "NISAR_L2_GCOV_SAMPLE",
          TemporalExtent: { RangeDateTime: { BeginningDateTime: "2026-09-10T12:00:00Z", EndingDateTime: "2026-09-10T12:01:00Z" } },
          DataCenters: [{ ShortName: "ASF" }],
          SpatialExtent: {
            HorizontalSpatialDomain: {
              Geometry: {
                GPolygons: [{
                  Boundary: {
                    Points: [
                      { Longitude: 71, Latitude: 19 },
                      { Longitude: 72.5, Latitude: 19.2 },
                      { Longitude: 72.4, Latitude: 20.5 },
                      { Longitude: 71.2, Latitude: 20 },
                      { Longitude: 71, Latitude: 19 },
                    ],
                  },
                }],
                BoundingRectangles: [{ WestBoundingCoordinate: 71, SouthBoundingCoordinate: 19, EastBoundingCoordinate: 73, NorthBoundingCoordinate: 21 }],
              },
            },
          },
          RelatedUrls: [
            { Type: "GET RELATED VISUALIZATION", URLContentType: "Visualization", URL: "https://browse.example.org/granule.png" },
            { Type: "GET DATA", URLContentType: "DistributionURL", URL: "https://data.example.org/granule.h5" },
          ],
        },
      }],
    });

    const result = await searchNISARGranules({
      collectionConceptId: "C12345-ASF",
      collectionShortName: "NISAR_L2_GCOV_PROVISIONAL_V1",
      bounds: { west: 70, south: 18, east: 74, north: 22 },
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      productCodes: ["GCOV", "GSLC"],
      pageSize: 12,
      pageNumber: 2,
    });

    expect(result.hits).toBe(35);
    expect(result.granules).toHaveLength(1);
    expect(result.granules[0]).toMatchObject({
      conceptId: "G12345-ASF",
      granuleId: "NISAR_L2_GCOV_SAMPLE",
      startDate: "2026-09-10T12:00:00Z",
      producer: "ASF",
      productCode: "GCOV",
      bounds: { west: 71, south: 19, east: 72.5, north: 20.5 },
      footprint: [[71, 19], [72.5, 19.2], [72.4, 20.5], [71.2, 20], [71, 19]],
      browseUrl: "https://browse.example.org/granule.png",
      dataUrl: "https://data.example.org/granule.h5",
    });
    expect(result.granules[0]?.sourceMetadata).toMatchObject({
      meta: { "concept-id": "G12345-ASF", "native-id": "granule-native-id" },
      umm: { GranuleUR: "NISAR_L2_GCOV_SAMPLE" },
    });
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.pathname).toContain("/granules.umm_json");
    expect(requested.searchParams.get("collection_concept_id")).toBe("C12345-ASF");
    expect(requested.searchParams.get("bounding_box")).toBe("70,18,74,22");
    expect(requested.searchParams.get("temporal[]")).toBe("2026-09-01T00:00:00Z,2026-09-30T23:59:59Z");
    expect(requested.searchParams.get("page_size")).toBe("12");
    expect(requested.searchParams.get("page_num")).toBe("2");
    expect(requested.searchParams.getAll("sort_key[]")).toContain("-revision_date");
    expect(requested.searchParams.has("browsable")).toBe(false);
  });

  it("does not turn antimeridian-crossing CMR polygons into world-spanning footprints", async () => {
    mockCMR({
      hits: 1,
      items: [{
        meta: { "concept-id": "G12346-ASF", "native-id": "wrapped-granule" },
        umm: {
          GranuleUR: "NISAR_L2_GCOV_WRAPPED",
          SpatialExtent: { HorizontalSpatialDomain: { Geometry: {
            GPolygons: [{ Boundary: { Points: [
              { Longitude: 179, Latitude: 10 },
              { Longitude: -179, Latitude: 10 },
              { Longitude: -179, Latitude: 12 },
              { Longitude: 179, Latitude: 10 },
            ] } }],
          } } },
        },
      }],
    });

    const result = await searchNISARGranules({
      collectionConceptId: "C12345-ASF",
      collectionShortName: "NISAR_L2_GCOV_PROVISIONAL_V1",
    });

    expect(result.granules[0]).toMatchObject({ bounds: null, footprint: null });
  });

  it("selects CMR maturity groups whose reported dates overlap the requested range", async () => {
    const collectionPayload = {
      hits: 3,
      items: [
        { meta: { "concept-id": "C100-ASF", "revision-date": "2026-10-10T00:00:00Z" }, umm: { ShortName: "NISAR_L2_GCOV_PROVISIONAL_V1", EntryTitle: "NISAR GCOV Provisional", Version: "1", Abstract: "", TemporalExtents: [{ RangeDateTime: { BeginningDateTime: "2025-01-01T00:00:00Z", EndingDateTime: "2026-10-20T23:59:59Z" } }] } },
        { meta: { "concept-id": "C101-ASF", "revision-date": "2026-09-10T00:00:00Z" }, umm: { ShortName: "NISAR_L2_GCOV_VALIDATED_V1", EntryTitle: "NISAR GCOV Validated", Version: "1", Abstract: "", TemporalExtents: [{ RangeDateTime: { BeginningDateTime: "2026-10-21T00:00:00Z", EndingDateTime: "2027-01-01T00:00:00Z" } }] } },
        { meta: { "concept-id": "C200-ASF", "revision-date": "2026-10-01T00:00:00Z" }, umm: { ShortName: "NISAR_L2_GSLC_PROVISIONAL_V1", EntryTitle: "NISAR GSLC", Version: "1", Abstract: "", TemporalExtents: [{ RangeDateTime: { BeginningDateTime: "2025-01-01T00:00:00Z", EndingDateTime: "2026-12-31T23:59:59Z" } }] } },
      ],
    };
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const requestUrl = new URL(input);
      const isCollectionsQuery = requestUrl.pathname.endsWith("/collections.umm_json");
      const requestedDay = requestUrl.searchParams.get("temporal[]")?.slice(0, 10) ?? "2026-09-10";
      const payload = isCollectionsQuery
        ? collectionPayload
        : {
          hits: 251,
          items: [{
            meta: { "concept-id": "G100-ASF", "native-id": "granule-1" },
            umm: {
              GranuleUR: "NISAR_TEST_GRANULE",
              TemporalExtent: { RangeDateTime: { BeginningDateTime: `${requestedDay}T12:00:00Z`, EndingDateTime: `${requestedDay}T12:01:00Z` } },
              SpatialExtent: { HorizontalSpatialDomain: { Geometry: { BoundingRectangles: [{ WestBoundingCoordinate: 71, SouthBoundingCoordinate: 19, EastBoundingCoordinate: 73, NorthBoundingCoordinate: 21 }] } } },
              RelatedUrls: [{ Type: "GET RELATED VISUALIZATION", URLContentType: "Visualization", URL: "https://browse.example.org/granule.png" }],
            },
          }],
        };
      return Promise.resolve({ ok: true, status: 200, json: async () => payload });
    });
    vi.stubGlobal("fetch", fetchMock);

    const historical = await searchNISARCoverage({
      bounds: { west: 70, south: 18, east: 74, north: 22 },
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(historical.productCollections.map(item => item.shortName)).toEqual(expect.arrayContaining([
      "NISAR_L2_GCOV_PROVISIONAL_V1",
      "NISAR_L2_GSLC_PROVISIONAL_V1",
    ]));

    const recent = await searchNISARCoverage({
      bounds: { west: 70, south: 18, east: 74, north: 22 },
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      productCodes: ["GCOV", "GSLC"],
      page: 2,
    });

    expect(recent.productCollections.map(item => item.shortName)).toEqual(expect.arrayContaining([
      "NISAR_L2_GCOV_VALIDATED_V1",
      "NISAR_L2_GSLC_PROVISIONAL_V1",
    ]));
    expect(recent.productCollections.map(item => item.maturity)).toEqual(["validated", "provisional"]);
    expect(recent.collections).toHaveLength(3);
    expect(recent.granules).toHaveLength(2);
    expect(recent.page).toBe(2);
    expect(recent.hasMore).toBe(true);
    expect(recent.granules[0]).toMatchObject({
      productCode: "GCOV",
      bounds: { west: 71, south: 19, east: 73, north: 21 },
      browseUrl: "https://browse.example.org/granule.png",
    });
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.has("browsable")).toBe(false);
    const granuleRequests = fetchMock.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter(url => url.pathname.endsWith("/granules.umm_json"));
    expect(granuleRequests.length).toBeGreaterThan(0);
    for (const request of granuleRequests) {
      expect(request.searchParams.get("page_size")).toBe("100");
      expect(request.searchParams.getAll("sort_key[]")).toContain("-revision_date");
    }
    expect(new Set(granuleRequests.map(request => request.searchParams.get("page_num")))).toEqual(new Set(["1", "2"]));
  });

  it("keeps urgent-response and other unknown-maturity collections in separate groups", async () => {
    const collectionPayload = {
      hits: 2,
      items: [
        {
          meta: { "concept-id": "C300-ASF", "revision-date": "2026-10-01T00:00:00Z" },
          umm: {
            ShortName: "NISAR_L3_SME2_V1",
            EntryTitle: "NISAR soil moisture",
            Version: "1",
            Abstract: "",
            TemporalExtents: [{ RangeDateTime: { BeginningDateTime: "2026-01-01T00:00:00Z", EndingDateTime: "2026-12-31T00:00:00Z" } }],
          },
        },
        {
          meta: { "concept-id": "C301-ASF", "revision-date": "2026-10-01T00:00:00Z" },
          umm: {
            ShortName: "NISAR_L3_UR_SME2_V1",
            EntryTitle: "NISAR urgent-response soil moisture",
            Version: "1",
            Abstract: "",
            TemporalExtents: [{ RangeDateTime: { BeginningDateTime: "2026-01-01T00:00:00Z", EndingDateTime: "2026-12-31T00:00:00Z" } }],
          },
        },
      ],
    };
    const granulePayload = {
      hits: 1,
      items: [{
        meta: { "concept-id": "G300-ASF" },
        umm: {
          GranuleUR: "NISAR_L3_SME2_SAMPLE",
          TemporalExtent: { RangeDateTime: { BeginningDateTime: "2026-10-10T00:00:00Z", EndingDateTime: "2026-10-10T00:00:00Z" } },
        },
      }],
    };
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const url = new URL(input);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => url.pathname.endsWith("/collections.umm_json") ? collectionPayload : granulePayload,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNISARCoverage({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      productCodes: ["SME2"],
    });

    expect(result.productCollections.map(item => item.productionConfiguration).sort()).toEqual(["unknown", "urgent-response"]);
    expect(result.productCollections).toHaveLength(2);
  });

  it("limits simultaneous granule searches when several NISAR collections are selected", async () => {
    const shortNames = [
      "NISAR_L2_GCOV_PROVISIONAL_V1",
      "NISAR_L2_GSLC_PROVISIONAL_V1",
      "NISAR_L2_GUNW_PROVISIONAL_V1",
      "NISAR_L3_SME2_PROVISIONAL_V1",
      "NISAR_L3_SME2_BETA_V1",
    ];
    const collectionPayload = {
      hits: shortNames.length,
      items: shortNames.map((shortName, index) => ({
        meta: { "concept-id": `C${400 + index}-ASF`, "revision-date": "2026-10-10T00:00:00Z" },
        umm: {
          ShortName: shortName,
          EntryTitle: shortName,
          Version: "1",
          Abstract: "",
          TemporalExtents: [{ RangeDateTime: {
            BeginningDateTime: "2026-01-01T00:00:00Z",
            EndingDateTime: "2026-12-31T23:59:59Z",
          } }],
        },
      })),
    };
    let activeSearches = 0;
    let maximumConcurrentSearches = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/collections.umm_json")) {
        return { ok: true, status: 200, json: async () => collectionPayload };
      }
      activeSearches += 1;
      maximumConcurrentSearches = Math.max(maximumConcurrentSearches, activeSearches);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeSearches -= 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          hits: 1,
          items: [{
            meta: {
              "concept-id": "G400-ASF",
              "collection-concept-id": url.searchParams.get("collection_concept_id"),
              "native-id": "sample-granule",
            },
            umm: {
              GranuleUR: "NISAR_TEST_GRANULE",
              TemporalExtent: { SingleDateTime: "2026-10-10T00:00:00Z" },
              SpatialExtent: { HorizontalSpatialDomain: { Geometry: {
                BoundingRectangles: [{
                  WestBoundingCoordinate: 71,
                  SouthBoundingCoordinate: 19,
                  EastBoundingCoordinate: 72,
                  NorthBoundingCoordinate: 20,
                }],
              } } },
            },
          }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNISARCoverage({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      productCodes: ["GCOV", "GSLC", "GUNW", "SME2"],
    });

    expect(result.productCollections).toHaveLength(5);
    expect(result.granules).toHaveLength(4);
    expect(result.granules.map(granule => granule.productCode).sort()).toEqual(["GCOV", "GSLC", "GUNW", "SME2"]);
    expect(result.granuleHitsByProduct).toEqual({ GCOV: 1, GSLC: 1, GUNW: 1, SME2: 1 });
    expect(result.granuleStatusByProduct).toEqual({
      GCOV: "ready",
      GSLC: "ready",
      GUNW: "ready",
      SME2: "ready",
    });
    expect(maximumConcurrentSearches).toBe(3);
    const granuleRequests = fetchMock.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter(url => url.pathname.endsWith("/granules.umm_json"));
    expect(granuleRequests).toHaveLength(4);
    expect(granuleRequests.some(url => url.searchParams.getAll("collection_concept_id").length === 2)).toBe(true);
  });

  it("rejects malformed IDs, dates, and bounds before making a request", async () => {
    const fetchMock = mockCMR({ hits: 0, items: [] });
    await expect(searchNISARGranules({ collectionConceptId: "bad-id" })).rejects.toThrow(/collection/i);
    await expect(searchNISARGranules({
      collectionConceptId: "C12345-ASF",
      startDate: "2026-10-01",
      endDate: "2026-09-01",
    })).rejects.toThrow(/on or before/i);
    await expect(searchNISARGranules({
      collectionConceptId: "C12345-ASF",
      startDate: "2026-02-31",
      endDate: "2026-03-01",
    })).rejects.toThrow(/real calendar date/i);
    await expect(searchNISARGranules({
      collectionConceptId: "C12345-ASF",
      bounds: { west: 181, south: 0, east: 190, north: 10 },
    })).rejects.toThrow(/bounds/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports HTTP and unexpected response errors clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(searchNISARCollections()).rejects.toThrow(/HTTP 503/i);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ notItems: [] }) }));
    await expect(searchNISARCollections()).rejects.toThrow(/unexpected collection response/i);
  });

  it("allows CMR collection responses that take longer than the old 15-second timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({
        ok: true,
        status: 200,
        json: async () => ({ hits: 0, items: [] }),
      }), 16_000);
    })));

    const result = searchNISARCollections();
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(result).resolves.toEqual({ collections: [], hits: 0 });
  });

  it("retries once after a transient CMR network failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ hits: 0, items: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchNISARCollections()).resolves.toEqual({ collections: [], hits: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses recently fetched collection metadata", async () => {
    const fetchMock = mockCMR({ hits: 0, items: [] });

    const first = await searchNISARCollections();
    const second = await searchNISARCollections();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses labeled recent collection metadata when CMR is temporarily unavailable", async () => {
    vi.useFakeTimers();
    const fetchMock = mockCMR({ hits: 0, items: [] });
    await searchNISARCollections();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const resultPromise = searchNISARCollections();
    await vi.advanceTimersByTimeAsync(250);
    const result = await resultPromise;

    expect(result.hits).toBe(0);
    expect(result.warnings).toContain(
      "NASA CMR is unavailable; using recently cached collection metadata. Granule results are still queried live.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries once after a CMR request timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<never>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ hits: 0, items: [] }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = searchNISARCollections();
    await vi.advanceTimersByTimeAsync(30_250);

    await expect(result).resolves.toEqual({ collections: [], hits: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
