import type { Geometry } from "geojson";
import { validateGeometry } from "./analysis";
import type { Phenomenon } from "./earth-vocabulary";

export type LiveLayerId = "live-usgs" | "live-eonet";
export type LiveSource = "USGS" | "NASA EONET";
export type USGSPagerAlert = "green" | "yellow" | "orange" | "red" | null;
export type LiveFeedStatus = "idle" | "loading" | "ready" | "error";

/** Real public-feed records, kept distinct from NASA CMR catalog metadata. */
export interface LiveEarthEvent {
  id: string;
  sourceId: string;
  source: LiveSource;
  sourceLabel: string;
  sourceUrl: string;
  layerId: LiveLayerId;
  type: Phenomenon;
  title: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  geometry?: Geometry;
  date: string;
  metric: string;
  metricLabel: string;
  summary: string;
  dataClass: "public-event-context";
  pagerAlert: USGSPagerAlert;
  nisarURCandidate: boolean;
  sourceMetadata?: Record<string, unknown>;
}

interface USGSFeature {
  id?: string;
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    url?: string | null;
    detail?: string | null;
    magType?: string | null;
    depth?: number | null;
    status?: string | null;
    title?: string | null;
    alert?: string | null;
  } | null;
}

interface EONETGeometry {
  date?: string;
  type?: string;
  coordinates?: unknown;
}

interface EONETEvent {
  id?: string;
  title?: string;
  description?: string | null;
  closed?: string | null;
  link?: string;
  categories?: Array<{ id?: string; title?: string }>;
  sources?: Array<{ id?: string; url?: string }>;
  geometry?: EONETGeometry[];
}

export interface LiveFeedResult {
  source: LiveSource;
  status: "ready" | "error";
  events: LiveEarthEvent[];
  updatedAt: string | null;
  cached: boolean;
  error: string | null;
}

interface LiveFeedCache {
  events: LiveEarthEvent[];
  updatedAt: string;
  expiresAt: number;
}

const LIVE_CACHE_TTL_MS = 5 * 60_000;
const liveCache = new Map<LiveSource, LiveFeedCache>();

async function fetchJSON<T>(url: string, timeoutMs = 12_000): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/geo+json, application/json" },
      });
      if (!response.ok) {
        const error = new Error(`Request failed with HTTP ${response.status}.`);
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        throw error;
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Request failed with HTTP ")) throw error;
      if (controller.signal.aborted) {
        if (attempt === 1) throw new Error(`The data source timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      } else if (attempt === 1) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("The data source request failed.");
}

const validCoordinate = (lng: unknown, lat: unknown): boolean =>
  typeof lng === "number" && typeof lat === "number" &&
  Number.isFinite(lng) && Number.isFinite(lat) &&
  Math.abs(lng) <= 180 && Math.abs(lat) <= 90;

function usgsPagerAlert(value: unknown): USGSPagerAlert {
  return value === "green" || value === "yellow" || value === "orange" || value === "red"
    ? value
    : null;
}

function safeSourceUrl(value: string | null | undefined, fallback: string, kind: "USGS" | "NASA EONET") {
  try {
    const url = new URL(value || fallback);
    const trustedHost = kind === "USGS"
      ? url.hostname === "usgs.gov" || url.hostname.endsWith(".usgs.gov")
      : url.hostname === "nasa.gov" || url.hostname.endsWith(".nasa.gov");
    return url.protocol === "https:" && trustedHost ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function historicalStartDate() {
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  return start;
}

/** Fetch the USGS public catalog for two years of M5+ earthquakes, not just today's feed. */
export async function fetchUSGSEarthquakes(): Promise<LiveEarthEvent[]> {
  const start = historicalStartDate();
  const end = new Date();
  const query = new URLSearchParams({
    format: "geojson",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    minmagnitude: "5.0",
    limit: "5000",
    orderby: "time",
  });
  const data = await fetchJSON<{ features?: USGSFeature[] }>(
    `https://earthquake.usgs.gov/fdsnws/event/1/query?${query.toString()}`,
  );
  if (!Array.isArray(data.features)) throw new Error("USGS returned an unexpected GeoJSON response.");

  return data.features.flatMap((feature): LiveEarthEvent[] => {
    const p = feature.properties;
    const coordinates = feature.geometry?.coordinates;
    if (!p || !Array.isArray(coordinates) || coordinates.length < 2) return [];
    const [lng, lat, depth] = coordinates;
    if (typeof lng !== "number" || typeof lat !== "number" || !validCoordinate(lng, lat)) return [];
    const time = typeof p.time === "number" ? new Date(p.time) : new Date(NaN);
    if (!Number.isFinite(time.getTime())) return [];
    const magnitude = typeof p.mag === "number" && Number.isFinite(p.mag) ? p.mag : null;
    const pagerAlert = usgsPagerAlert(p.alert);
    const nisarURCandidate = pagerAlert === "orange" || pagerAlert === "red";
    const title = p.title || p.place || "Reported earthquake";
    const sourceId = feature.id || `usgs-${time.getTime()}-${lng}-${lat}`;
    const details = [
      magnitude === null ? "Magnitude not reported" : `Magnitude ${magnitude.toFixed(1)}${p.magType ? ` (${p.magType})` : ""}`,
      typeof depth === "number" && Number.isFinite(depth) ? `Depth ${depth.toFixed(1)} km` : null,
      p.status ? `Catalog status: ${p.status}` : null,
      pagerAlert ? `USGS PAGER alert: ${pagerAlert}.` : null,
    ].filter(Boolean).join(" · ");
    return [{
      id: `live:usgs:${sourceId}`,
      sourceId,
      source: "USGS",
      sourceLabel: "USGS Earthquake Catalog (M5+)",
      sourceUrl: safeSourceUrl(p.url || p.detail, "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", "USGS"),
      layerId: "live-usgs",
      type: "earthquake",
      title,
      region: p.place || title,
      country: "",
      lat,
      lng,
      geometry: { type: "Point", coordinates: [lng, lat] },
      date: time.toISOString(),
      metric: magnitude === null ? "—" : `M ${magnitude.toFixed(1)}`,
      metricLabel: "reported earthquake magnitude",
      summary: details,
      dataClass: "public-event-context",
      pagerAlert,
      nisarURCandidate,
      sourceMetadata: { ...feature },
    }];
  });
}

function categoryPhenomenon(categories: EONETEvent["categories"]): Phenomenon | null {
  const ids = (categories ?? []).map(category => `${category.id ?? ""} ${category.title ?? ""}`.toLowerCase()).join(" ");
  if (/wildfire|wildfires|fire/.test(ids)) return "fire";
  if (/flood/.test(ids)) return "flood";
  if (/landslide/.test(ids)) return "landslide";
  if (/volcano/.test(ids)) return "volcano";
  return null;
}

function meanCoordinate(value: unknown): [number, number] | null {
  const positions: Array<[number, number]> = [];
  const visit = (item: unknown) => {
    if (!Array.isArray(item) || positions.length >= 2000) return;
    const lng = item[0];
    const lat = item[1];
    if (typeof lng === "number" && typeof lat === "number" && validCoordinate(lng, lat)) {
      positions.push([lng, lat]);
      return;
    }
    item.forEach(visit);
  };
  visit(value);
  if (!positions.length) return null;
  const sum = positions.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0] as [number, number]);
  return [sum[0] / positions.length, sum[1] / positions.length];
}

/** Fetch open and closed NASA EONET events within the same two-year archive window. */
export async function fetchNASAEONETEvents(): Promise<LiveEarthEvent[]> {
  const start = historicalStartDate().toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const query = new URLSearchParams({ status: "all", start, end, limit: "250" });
  const data = await fetchJSON<{ events?: EONETEvent[] }>(
    `https://eonet.gsfc.nasa.gov/api/v3/events?${query.toString()}`,
    35_000,
  );
  if (!Array.isArray(data.events)) throw new Error("NASA EONET returned an unexpected response.");

  return data.events.flatMap((event): LiveEarthEvent[] => {
    const type = categoryPhenomenon(event.categories);
    if (!type || !Array.isArray(event.geometry) || !event.geometry.length) return [];
    const latest = [...event.geometry]
      .filter((geometry) => geometry.date && Number.isFinite(Date.parse(geometry.date)))
      .sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!))
      .at(-1);
    if (!latest?.date) return [];
    const coordinate = meanCoordinate(latest.coordinates);
    if (!coordinate) return [];
    const [lng, lat] = coordinate;
    let geometry: Geometry | null = null;
    if (latest.type && latest.coordinates !== undefined) {
      try {
        geometry = validateGeometry({ type: latest.type, coordinates: latest.coordinates }).geometry;
      } catch {
        geometry = null;
      }
    }
    geometry ??= { type: "Point", coordinates: [lng, lat] };
    const date = new Date(latest.date).toISOString();
    const category = event.categories?.find(item =>
      item.id && categoryPhenomenon([item]) === type,
    )?.title ?? type;
    const sourceId = event.id || `${type}-${date}-${lng}-${lat}`;
    return [{
      id: `live:eonet:${sourceId}`,
      sourceId,
      source: "NASA EONET",
      sourceLabel: "NASA Earth Observatory Natural Event Tracker",
      sourceUrl: safeSourceUrl(event.link, "https://eonet.gsfc.nasa.gov/", "NASA EONET"),
      layerId: "live-eonet",
      type,
      title: event.title || category,
      region: category,
      country: "",
      lat,
      lng,
      geometry,
      date,
      metric: event.closed ? "CLOSED" : "OPEN",
      metricLabel: category,
      summary: [
        event.description || `EONET event categorized as ${category}.`,
        event.closed ? `Closed on ${event.closed.slice(0, 10)}.` : "Currently listed as open by NASA EONET.",
      ].join(" "),
      dataClass: "public-event-context",
      pagerAlert: null,
      nisarURCandidate: false,
      sourceMetadata: { ...event, selectedGeometry: latest },
    }];
  });
}

async function fetchCachedFeed(
  source: LiveSource,
  fetcher: () => Promise<LiveEarthEvent[]>,
): Promise<LiveFeedResult> {
  const cached = liveCache.get(source);
  if (cached && cached.expiresAt > Date.now()) {
    return { source, status: "ready", events: cached.events, updatedAt: cached.updatedAt, cached: true, error: null };
  }
  try {
    const events = await fetcher();
    const updatedAt = new Date().toISOString();
    liveCache.set(source, { events, updatedAt, expiresAt: Date.now() + LIVE_CACHE_TTL_MS });
    return { source, status: "ready", events, updatedAt, cached: false, error: null };
  } catch (error) {
    return {
      source,
      status: "error",
      events: [],
      updatedAt: null,
      cached: false,
      error: error instanceof Error ? error.message : "The public event feed could not be loaded.",
    };
  }
}

export async function fetchLiveEarthData(
  onFeed?: (result: LiveFeedResult) => void,
): Promise<LiveFeedResult[]> {
  const feeds: Array<[LiveSource, () => Promise<LiveEarthEvent[]>]> = [
    ["USGS", fetchUSGSEarthquakes],
    ["NASA EONET", fetchNASAEONETEvents],
  ];
  return Promise.all(feeds.map(async ([source, fetcher]) => {
    const result = await fetchCachedFeed(source, fetcher);
    onFeed?.(result);
    return result;
  }));
}
