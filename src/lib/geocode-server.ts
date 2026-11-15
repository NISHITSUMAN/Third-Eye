import {
  isValidGeoBounds,
  normalizeGeoSearchResult,
  type GeoSearchResponse,
  type GeoSearchResult,
  type GeoSearchType,
} from "./geocode";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 128;
const REQUEST_TIMEOUT_MS = 6000;

type CacheEntry = { expiresAt: number; value: GeoSearchResponse | GeoSearchResult };
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: GeoSearchResponse | GeoSearchResult) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}

async function fetchJSON<T>(url: string, requestSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (requestSignal?.aborted) controller.abort();
  else requestSignal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(requestSignal?.aborted ? "Request was cancelled." : "Geocoding provider timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", abort);
  }
}

function pointBbox(longitude: number, latitude: number): [number, number, number, number] {
  return [
    Math.max(-180, longitude - 0.25),
    Math.max(-90, latitude - 0.25),
    Math.min(180, longitude + 0.25),
    Math.min(90, latitude + 0.25),
  ];
}

function typeFromPhoton(value: unknown): GeoSearchType {
  const item = typeof value === "string" ? value.toLowerCase() : "";
  if (/country/.test(item)) return "country";
  if (/state|province|region|district/.test(item)) return "state";
  if (/city/.test(item)) return "city";
  if (/locality|town|village|municipality/.test(item)) return "town";
  if (/street|house|address/.test(item)) return "address";
  if (/mountain|peak/.test(item)) return "mountain";
  if (/river|stream/.test(item)) return "river";
  if (/volcano/.test(item)) return "volcano";
  if (/glacier/.test(item)) return "glacier";
  return "landmark";
}

function photonResults(payload: unknown): GeoSearchResult[] {
  if (!payload || typeof payload !== "object" || !("features" in payload) || !Array.isArray(payload.features)) {
    throw new Error("Photon returned an unexpected response.");
  }
  return payload.features.flatMap((feature: unknown): GeoSearchResult[] => {
    if (!feature || typeof feature !== "object" || !("geometry" in feature) || !("properties" in feature)) return [];
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (!geometry || typeof geometry !== "object" || !("coordinates" in geometry) || !Array.isArray(geometry.coordinates)
      || !properties || typeof properties !== "object") return [];
    const [longitude, latitude] = geometry.coordinates;
    if (typeof longitude !== "number" || typeof latitude !== "number") return [];
    const props = properties as Record<string, unknown>;
    const name = typeof props.name === "string" ? props.name : "";
    if (!name) return [];
    const extent = Array.isArray(props.extent) ? props.extent : null;
    const sourceBounds = extent && extent.length === 4 && extent.every(value => typeof value === "number")
      ? [extent[0]!, extent[3]!, extent[2]!, extent[1]!] as [number, number, number, number]
      : null;
    const validSourceBounds = sourceBounds && isValidGeoBounds(sourceBounds) ? sourceBounds : null;
    const bbox = validSourceBounds ?? pointBbox(longitude, latitude);
    const resultGeometry = validSourceBounds
      ? {
          type: "Polygon" as const,
          coordinates: [[
            [bbox[0], bbox[1]],
            [bbox[2], bbox[1]],
            [bbox[2], bbox[3]],
            [bbox[0], bbox[3]],
            [bbox[0], bbox[1]],
          ]],
        }
      : { type: "Point" as const, coordinates: [longitude, latitude] as [number, number] };
    const valid = normalizeGeoSearchResult({
      id: `photon:${String(props.osm_type ?? "place")}:${String(props.osm_id ?? `${longitude},${latitude}`)}`,
      name,
      displayName: [name, props.city, props.state, props.country].filter(value => typeof value === "string" && value).join(", "),
      type: typeFromPhoton(props.osm_value ?? props.type),
      latitude,
      longitude,
      bbox,
      geometry: resultGeometry,
      provider: "photon-osm",
      confidence: null,
      providerRelevance: typeof props.importance === "number" && Number.isFinite(props.importance)
        ? Math.max(0, Math.min(1, props.importance))
        : null,
      attribution: "© OpenStreetMap contributors · Photon",
      extentQuality: validSourceBounds ? "source" : "approximate",
    });
    return valid ? [valid] : [];
  });
}

function typeFromOpenMeteo(value: unknown): GeoSearchType {
  const code = typeof value === "string" ? value.toUpperCase() : "";
  if (code === "PCLI") return "country";
  if (/^ADM/.test(code)) return "state";
  if (code === "PPL" || code === "PPLA" || code === "PPLC") return "city";
  if (/PPL/.test(code)) return "town";
  if (/MT|MTS/.test(code)) return "mountain";
  if (/STM|RIV/.test(code)) return "river";
  return "landmark";
}

function openMeteoResults(payload: unknown): GeoSearchResult[] {
  if (!payload || typeof payload !== "object" || !("results" in payload)) {
    throw new Error("Open-Meteo returned an unexpected response.");
  }
  if (!Array.isArray(payload.results)) return [];
  return payload.results.flatMap((item: unknown): GeoSearchResult[] => {
    if (!item || typeof item !== "object") return [];
    const props = item as Record<string, unknown>;
    if (typeof props.name !== "string" || typeof props.latitude !== "number" || typeof props.longitude !== "number") return [];
    const name = props.name;
    const displayName = [name, props.admin1, props.country]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .join(", ");
    const result = normalizeGeoSearchResult({
      id: `open-meteo:${String(props.id ?? `${props.latitude},${props.longitude}`)}`,
      name,
      displayName,
      type: typeFromOpenMeteo(props.feature_code),
      latitude: props.latitude,
      longitude: props.longitude,
      bbox: pointBbox(props.longitude, props.latitude),
      provider: "open-meteo-geonames",
      confidence: null,
      providerRelevance: null,
      attribution: "GeoNames · Open-Meteo Geocoding API",
      extentQuality: "approximate",
    });
    return result ? [result] : [];
  });
}

function mergeResults(results: GeoSearchResult[]): GeoSearchResult[] {
  const merged = new Map<string, GeoSearchResult>();
  for (const result of results) {
    const key = `${result.name.toLowerCase()}|${result.latitude.toFixed(3)}|${result.longitude.toFixed(3)}`;
    const existing = merged.get(key);
    if (!existing || result.extentQuality === "source" || result.provider === "photon-osm") merged.set(key, result);
  }
  return [...merged.values()]
    .sort((a, b) => (b.providerRelevance ?? -1) - (a.providerRelevance ?? -1))
    .slice(0, 12);
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeoSearchResponse> {
  const cacheKey = `search:${query.trim().toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached && "results" in cached) return cached;

  const photonUrl = new URL("https://photon.komoot.io/api/");
  photonUrl.searchParams.set("q", query);
  photonUrl.searchParams.set("limit", "8");
  const openMeteoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  openMeteoUrl.searchParams.set("name", query);
  openMeteoUrl.searchParams.set("count", "8");
  openMeteoUrl.searchParams.set("language", "en");
  openMeteoUrl.searchParams.set("format", "json");

  const warnings: string[] = [];
  let photon: GeoSearchResult[] = [];
  let photonAvailable = true;
  try {
    photon = photonResults(await fetchJSON<unknown>(photonUrl.toString(), signal));
  } catch (error) {
    if (signal?.aborted) throw new Error("Request was cancelled.");
    photonAvailable = false;
    warnings.push(`Photon: ${error instanceof Error ? error.message : "request failed"}`);
  }
  if (signal?.aborted) throw new Error("Request was cancelled.");

  let openMeteo: GeoSearchResult[] = [];
  let openMeteoAvailable = false;
  if (!photon.length) {
    try {
      openMeteo = openMeteoResults(await fetchJSON<unknown>(openMeteoUrl.toString(), signal));
      openMeteoAvailable = true;
    } catch (error) {
      if (signal?.aborted) throw new Error("Request was cancelled.");
      warnings.push(`Open-Meteo: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  if (!photonAvailable && !openMeteoAvailable) throw new Error(warnings.join(" "));

  const results = mergeResults(photon.length ? photon : openMeteo);
  const response: GeoSearchResponse = {
    status: warnings.length ? "partial" : results.length === 0 ? "no-results" : "ready",
    results,
    warnings,
  };
  cacheSet(cacheKey, response);
  return response;
}

export async function reversePlace(latitude: number, longitude: number, signal?: AbortSignal): Promise<GeoSearchResult> {
  const cacheKey = `reverse:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = cacheGet(cacheKey);
  if (cached && !("results" in cached)) return cached;

  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("localityLanguage", "en");
  const payload = await fetchJSON<unknown>(url.toString(), signal);
  if (!payload || typeof payload !== "object") throw new Error("BigDataCloud returned an unexpected response.");
  const value = payload as Record<string, unknown>;
  const name = [value.locality, value.city, value.principalSubdivision, value.countryName]
    .find(item => typeof item === "string" && item.trim());
  if (typeof name !== "string") throw new Error("No reverse-geocoded place name was returned.");
  const result = normalizeGeoSearchResult({
    id: `bigdatacloud:${latitude.toFixed(5)},${longitude.toFixed(5)}`,
    name,
    displayName: [value.locality, value.city, value.principalSubdivision, value.countryName]
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .join(", "),
    type: "location",
    latitude,
    longitude,
    bbox: pointBbox(longitude, latitude),
    provider: "bigdatacloud",
    confidence: null,
    providerRelevance: null,
    attribution: "BigDataCloud reverse geocoding",
    extentQuality: "approximate",
  });
  if (!result) throw new Error("BigDataCloud returned invalid coordinates.");
  cacheSet(cacheKey, result);
  return result;
}
