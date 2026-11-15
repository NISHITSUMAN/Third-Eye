import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveEarthData, fetchNASAEONETEvents, fetchUSGSEarthquakes } from "../lib/live-data";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockJSON(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("public live event feeds", () => {
  it("normalizes USGS earthquake reports with official source links", async () => {
    const time = Date.parse("2026-10-15T08:30:00Z");
    const fetchMock = mockJSON({
      features: [{
        id: "us7000test",
        type: "Feature",
        geometry: { type: "Point", coordinates: [72.8, 19.1, 12.4] },
        properties: {
          mag: 4.6,
          place: "25 km west of Mumbai, India",
          time,
          url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
          magType: "mb",
          depth: 12.4,
          status: "reviewed",
          alert: "orange",
        },
      }],
    });

    const events = await fetchUSGSEarthquakes();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "live:usgs:us7000test",
      source: "USGS",
      layerId: "live-usgs",
      type: "earthquake",
      lat: 19.1,
      lng: 72.8,
      metric: "M 4.6",
      date: "2026-10-15T08:30:00.000Z",
      dataClass: "public-event-context",
      pagerAlert: "orange",
      nisarURCandidate: true,
    });
    expect(events[0]?.sourceUrl).toContain("https://earthquake.usgs.gov/");
    expect(events[0]?.sourceMetadata).toMatchObject({
      id: "us7000test",
      properties: { mag: 4.6, place: "25 km west of Mumbai, India", alert: "orange" },
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("minmagnitude=5.0");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("starttime=");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("endtime=");
    expect(events[0]?.summary).toContain("Depth 12.4 km");
    expect(events[0]?.summary).toContain("USGS PAGER alert: orange");
    expect(events[0]?.summary).not.toContain("NISAR acquisition confirmed");
  });

  it("rejects invalid USGS coordinates and unsafe source links", async () => {
    mockJSON({
      features: [
        {
          id: "invalid",
          geometry: { type: "Point", coordinates: [181, 20, 4] },
          properties: { time: Date.parse("2026-10-15T08:30:00Z"), mag: 3 },
        },
        {
          id: "safe-fallback",
          geometry: { type: "Point", coordinates: [72, 19, 4] },
          properties: {
            time: Date.parse("2026-10-15T08:30:00Z"),
            mag: 3,
            url: "javascript:alert(1)",
          },
        },
      ],
    });

    const events = await fetchUSGSEarthquakes();
    expect(events).toHaveLength(1);
    expect(events[0]?.sourceUrl).toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php");
  });

  it("does not promote lower PAGER alert levels to NISAR Urgent Response candidates", async () => {
    mockJSON({
      features: [{
        id: "usgs-yellow",
        geometry: { type: "Point", coordinates: [72, 19, 10] },
        properties: {
          time: Date.parse("2026-10-15T08:30:00Z"),
          mag: 5.2,
          alert: "yellow",
        },
      }],
    });

    const [event] = await fetchUSGSEarthquakes();
    expect(event).toMatchObject({
      pagerAlert: "yellow",
      nisarURCandidate: false,
      dataClass: "public-event-context",
    });
  });

  it("maps supported NASA EONET categories to separate live events", async () => {
    const fetchMock = mockJSON({
      events: [
        {
          id: "EONET_123",
          title: "Example wildfire",
          description: "A source-reported open wildfire.",
          link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_123",
          categories: [{ id: "wildfires", title: "Wildfires" }],
          geometry: [{ date: "2026-10-14T12:00:00Z", type: "Point", coordinates: [78, 21] }],
        },
        {
          id: "EONET_UNSUPPORTED",
          title: "Unsupported category",
          categories: [{ id: "dustHaze", title: "Dust and Haze" }],
          geometry: [{ date: "2026-10-14T12:00:00Z", type: "Point", coordinates: [0, 0] }],
        },
      ],
    });

    const events = await fetchNASAEONETEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "live:eonet:EONET_123",
      source: "NASA EONET",
      layerId: "live-eonet",
      type: "fire",
      title: "Example wildfire",
      lng: 78,
      lat: 21,
      dataClass: "public-event-context",
      pagerAlert: null,
      nisarURCandidate: false,
    });
    expect(events[0]?.sourceUrl).toContain("https://eonet.gsfc.nasa.gov/");
    expect(events[0]?.sourceMetadata).toMatchObject({
      id: "EONET_123",
      title: "Example wildfire",
      categories: [{ id: "wildfires", title: "Wildfires" }],
    });
    expect(events[0]?.summary).toContain("source-reported");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("status=all");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("start=");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("end=");
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("limit")).toBe("250");
  });

  it("allows a slow but successful NASA EONET archive response to finish", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((resolve, reject) => {
        const responseTimer = setTimeout(() => resolve({
          ok: true,
          status: 200,
          json: async () => ({ events: [] }),
        }), 25_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(responseTimer);
          reject(new Error("request aborted"));
        });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchNASAEONETEvents();
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(request).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the latest usable geometry and bounds coordinate traversal", async () => {
    mockJSON({
      events: [{
        id: "EONET_POLYGON",
        title: "Example flood",
        categories: [{ id: "floods", title: "Floods" }],
        geometry: [
          { date: "2026-10-12T00:00:00Z", type: "Point", coordinates: [70, 20] },
          { date: "2026-10-14T00:00:00Z", type: "Polygon", coordinates: [[[70, 20], [72, 20], [72, 22], [70, 22], [70, 20]]] },
        ],
      }],
    });

    const events = await fetchNASAEONETEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.date).toBe("2026-10-14T00:00:00.000Z");
    expect(events[0]?.lng).toBeCloseTo(70.8);
    expect(events[0]?.lat).toBeCloseTo(20.8);
    expect(events[0]?.geometry).toEqual({
      type: "Polygon",
      coordinates: [[[70, 20], [72, 20], [72, 22], [70, 22], [70, 20]]],
    });
  });

  it("omits EONET records without a source-reported geometry date", async () => {
    mockJSON({
      events: [{
        id: "EONET_NO_DATE",
        title: "Undated event",
        categories: [{ id: "wildfires", title: "Wildfires" }],
        geometry: [{ type: "Point", coordinates: [78, 21] }],
      }],
    });

    await expect(fetchNASAEONETEvents()).resolves.toEqual([]);
  });

  it("updates feeds independently and reuses recent successful feed results", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          features: [{
            id: "usgs-cached",
            geometry: { type: "Point", coordinates: [72.8, 19.1, 12] },
            properties: { time: Date.parse("2026-10-15T08:30:00Z"), mag: 5.2 },
          }],
        }),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ events: [] }),
      }));
    vi.stubGlobal("fetch", fetchMock);
    const updates: string[] = [];
    const first = await fetchLiveEarthData((result) => updates.push(`${result.source}:${result.status}`));
    expect(first.map((result) => result.status)).toEqual(["ready", "ready"]);
    expect(updates).toContain("USGS:ready");
    expect(updates).toContain("NASA EONET:ready");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const second = await fetchLiveEarthData();
    expect(second.every((result) => result.cached && result.status === "ready")).toBe(true);
    expect(second[0]?.events[0]?.id).toBe("live:usgs:usgs-cached");
  });

  it("surfaces HTTP failures instead of silently pretending the feed is live", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    await expect(fetchUSGSEarthquakes()).rejects.toThrow("HTTP 503");
  });
});
