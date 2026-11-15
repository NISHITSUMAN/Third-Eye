import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useApp } from "../lib/store";
import type { NISARGranule } from "../lib/nasa-cmr";
import { useObservationExplanation, type ObservationExplanationTarget } from "../components/te/useObservationExplanation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useApp.setState({ nisarGranules: [], liveEvents: [], planetaryComputerResult: null });
});

function granule(id: string, bounds: NISARGranule["bounds"]): NISARGranule {
  return {
    dataClass: "catalog-metadata",
    id,
    conceptId: id,
    granuleId: `NISAR_GCOV_${id}`,
    collectionConceptId: "C123-ASF",
    collectionShortName: "NISAR_L2_GCOV_PROVISIONAL_V1",
    productCode: "GCOV",
    maturity: "provisional",
    productionConfiguration: "standard",
    orbitDirection: null,
    polarization: "HH",
    trackNumber: null,
    frameNumber: null,
    productionTime: null,
    platform: "NISAR",
    instrument: "L-SAR",
    title: `Record ${id}`,
    startDate: "2026-10-10T00:00:00Z",
    endDate: null,
    producer: "ASF",
    bounds,
    footprint: null,
    browseUrl: null,
    dataUrl: null,
    metadataUrl: `https://cmr.earthdata.nasa.gov/search/concepts/${id}`,
    earthdataSearchUrl: "https://search.earthdata.nasa.gov/",
  };
}

describe("selected observation AI explanation", () => {
  it("requests an explanation immediately with spatially overlapping loaded records", async () => {
    useApp.setState({
      nisarGranules: [granule("neighbor", { west: 1, south: 1, east: 3, north: 3 })],
      liveEvents: [],
      planetaryComputerResult: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      explanation: "This catalog record describes a radar product.",
      relatedRecordCount: 1,
      relatedRecordsAnalyzed: 1,
      provider: "Groq",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const target: ObservationExplanationTarget = {
      id: "selected",
      kind: "nisar",
      source: "NASA CMR",
      title: "Selected NISAR record",
      product: "GCOV",
      date: "2026-10-10T00:00:00Z",
      coordinates: { lat: 1.5, lng: 1.5 },
      bounds: [0, 0, 2, 2],
      metadata: { productCode: "GCOV" },
    };

    const { result } = renderHook(() => useObservationExplanation(target));

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as {
      operation: string;
      observation: { relatedRecords: Array<{ title: string }> };
    };
    expect(body.operation).toBe("explain_observation");
    expect(body.observation.relatedRecords).toContainEqual(expect.objectContaining({ title: "Record neighbor" }));
    expect(result.current.explanation).toBe("This catalog record describes a radar product.");
    expect(result.current.relatedRecords).toContainEqual(expect.objectContaining({
      id: "neighbor",
      title: "Record neighbor",
      source: "NASA CMR / ASF",
      product: "GCOV",
      date: "2026-10-10T00:00:00Z",
    }));
  });
});
