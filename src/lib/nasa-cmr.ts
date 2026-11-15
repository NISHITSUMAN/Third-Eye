import {
  compareNISARMaturity,
  DEFAULT_NISAR_PRODUCTS,
  extractNISARProductCode,
  inferNISARProductionConfiguration,
  inferNISARMaturity,
  NISAR_COVERAGE_PRODUCT_CODES,
  isNISARCoverageProductCode,
  type NISARCoverageProductCode,
  type NISARMaturity,
  type NISARProductionConfiguration,
  type NISARProductCode,
} from "./sar-registry";

const CMR_BASE = "https://cmr.earthdata.nasa.gov/search";
const CMR_TIMEOUT_MS = 30_000;
const CMR_REQUEST_ATTEMPTS = 2;
const CMR_RETRY_DELAY_MS = 250;
const CMR_COLLECTION_CACHE_TTL_MS = 5 * 60_000;
const CMR_COLLECTION_CACHE_STALE_MS = 60 * 60_000;
const CMR_GRANULE_SEARCH_CONCURRENCY = 3;
const CMR_COVERAGE_PAGE_SIZE = 100;

export interface CMRBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface NISARCollection {
  dataClass: "catalog-metadata";
  conceptId: string;
  shortName: string;
  title: string;
  version: string;
  abstract: string;
  processingLevel: string;
  productCode: NISARProductCode | null;
  maturity: NISARMaturity;
  productionConfiguration: NISARProductionConfiguration;
  doi: string | null;
  startDate: string | null;
  endDate: string | null;
  revisionDate: string | null;
  metadataUrl: string;
  earthdataSearchUrl: string;
}

interface NISARCollectionsResult {
  collections: NISARCollection[];
  hits: number;
  warnings?: string[];
}

const collectionCache = new Map<number, {
  result: NISARCollectionsResult;
  expiresAt: number;
  staleUntil: number;
  fetchImplementation: typeof fetch;
}>();

export type NISARPosition = [number, number];

export interface NISARGranule {
  dataClass: "catalog-metadata";
  id: string;
  conceptId: string;
  granuleId: string;
  collectionConceptId: string;
  collectionShortName: string;
  productCode: NISARProductCode | "NISAR";
  maturity: NISARMaturity;
  productionConfiguration: NISARProductionConfiguration;
  orbitDirection: string | null;
  polarization: string | null;
  trackNumber: string | null;
  frameNumber: string | null;
  productionTime: string | null;
  platform: string | null;
  instrument: string | null;
  title: string;
  startDate: string | null;
  endDate: string | null;
  producer: string;
  bounds: CMRBounds | null;
  footprint: NISARPosition[] | null;
  browseUrl: string | null;
  dataUrl: string | null;
  metadataUrl: string;
  earthdataSearchUrl: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface OPERACatalogCollection {
  dataClass: "catalog-metadata";
  conceptId: string;
  shortName: string;
  title: string;
  version: string;
  processingLevel: string;
  abstract: string;
  doi: string | null;
  startDate: string | null;
  endDate: string | null;
  revisionDate: string | null;
  metadataUrl: string;
  earthdataSearchUrl: string;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function granuleSpatial(umm: Record<string, unknown>): { bounds: CMRBounds | null; footprint: NISARPosition[] | null } {
  const spatial = recordOf(umm.SpatialExtent);
  const horizontal = recordOf(spatial?.HorizontalSpatialDomain);
  const geometry = recordOf(horizontal?.Geometry);

  // Keep the actual source footprint when CMR provides one. A bounding rectangle
  // is only a fallback, because it can considerably overstate a radar swath.
  const polygons = Array.isArray(geometry?.GPolygons) ? geometry.GPolygons : [];
  let crossesAntimeridian = false;
  for (const polygonCandidate of polygons) {
    const polygon = recordOf(polygonCandidate);
    const boundary = recordOf(polygon?.Boundary);
    const points = Array.isArray(boundary?.Points) ? boundary.Points : [];
    const footprint = points.flatMap((value): NISARPosition[] => {
      const point = recordOf(value);
      const lng = finiteNumber(point?.Longitude);
      const lat = finiteNumber(point?.Latitude);
      return lng !== null && lat !== null &&
        Math.abs(lng) <= 180 && Math.abs(lat) <= 90
        ? [[lng, lat]]
        : [];
    });
    if (footprint.length >= 3) {
      const longitudes = footprint.map(point => point[0]);
      const latitudes = footprint.map(point => point[1]);
      const west = Math.min(...longitudes);
      const east = Math.max(...longitudes);
      const south = Math.min(...latitudes);
      const north = Math.max(...latitudes);
      if (east - west > 180) {
        crossesAntimeridian = true;
        continue;
      }
      if (west < east && south < north) {
        return { bounds: { west, south, east, north }, footprint };
      }
    }
  }

  if (crossesAntimeridian) return { bounds: null, footprint: null };

  // Some providers publish only a coarse extent; keep it usable for search and
  // map coverage while leaving footprint null so the UI can identify the fallback.
  const rectangles = Array.isArray(geometry?.BoundingRectangles)
    ? geometry.BoundingRectangles
    : geometry?.BoundingRectangle ? [geometry.BoundingRectangle] : [];
  for (const candidate of rectangles) {
    const item = recordOf(candidate);
    if (!item) continue;
    const west = finiteNumber(item.WestBoundingCoordinate);
    const south = finiteNumber(item.SouthBoundingCoordinate);
    const east = finiteNumber(item.EastBoundingCoordinate);
    const north = finiteNumber(item.NorthBoundingCoordinate);
    if (west !== null && south !== null && east !== null && north !== null &&
        west >= -180 && east <= 180 && south >= -90 && north <= 90 &&
        west < east && south < north) {
      return { bounds: { west, south, east, north }, footprint: null };
    }
  }
  return { bounds: null, footprint: null };
}

function safeCMRRelatedUrl(value: unknown): string | null {
  const candidate = textValue(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function granuleRelatedUrls(umm: Record<string, unknown>) {
  const related = Array.isArray(umm.RelatedUrls) ? umm.RelatedUrls : [];
  let browseUrl: string | null = null;
  let dataUrl: string | null = null;
  for (const candidate of related) {
    const item = recordOf(candidate);
    if (!item) continue;
    const url = safeCMRRelatedUrl(item.URL);
    if (!url) continue;
    const type = textValue(item.Type).toUpperCase();
    const contentType = textValue(item.URLContentType).toLowerCase();
    const mimeType = textValue(item.MimeType).toLowerCase();
    if (!browseUrl && (
      type.includes("VISUALIZATION") ||
      contentType.includes("visualization") ||
      mimeType.startsWith("image/")
    )) browseUrl = url;
    if (!dataUrl && (
      type.includes("GET DATA") ||
      type.includes("DIRECT ACCESS") ||
      contentType.includes("distribution")
    )) dataUrl = url;
  }
  return { browseUrl, dataUrl };
}

interface CMRItem {
  meta?: Record<string, unknown>;
  umm?: Record<string, unknown>;
}

interface CMRResponse {
  hits?: number;
  items?: CMRItem[];
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function additionalAttribute(umm: Record<string, unknown>, names: readonly string[]): string {
  const keys = new Set(names.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const attributes = Array.isArray(umm.AdditionalAttributes) ? umm.AdditionalAttributes : [];
  for (const candidate of attributes) {
    const item = recordOf(candidate);
    if (!item) continue;
    const name = textValue(item.Name).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!keys.has(name)) continue;
    const direct = textValue(item.Value);
    if (direct) return direct;
    const values = Array.isArray(item.Values) ? item.Values : [];
    for (const value of values) {
      const record = recordOf(value);
      const text = textValue(record?.Value);
      if (text) return text;
    }
  }
  return "";
}

function firstPlatformValue(umm: Record<string, unknown>, key: "ShortName" | "Instruments"): string {
  const platforms = Array.isArray(umm.Platforms) ? umm.Platforms : [];
  for (const candidate of platforms) {
    const platform = recordOf(candidate);
    if (!platform) continue;
    if (key === "ShortName") {
      const value = textValue(platform.ShortName);
      if (value) return value;
      continue;
    }
    const instruments = Array.isArray(platform.Instruments) ? platform.Instruments : [];
    for (const item of instruments) {
      const name = textValue(recordOf(item)?.ShortName);
      if (name) return name;
    }
  }
  return "";
}

function safePlainText(value: unknown): string {
  return textValue(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRange(umm: Record<string, unknown>): { start: string | null; end: string | null } {
  const extents = Array.isArray(umm.TemporalExtents) ? umm.TemporalExtents : [];
  for (const extent of extents) {
    if (!extent || typeof extent !== "object") continue;
    const record = extent as Record<string, unknown>;
    const range = record.RangeDateTime && typeof record.RangeDateTime === "object"
      ? record.RangeDateTime as Record<string, unknown>
      : null;
    if (range) {
      return {
        start: textValue(range.BeginningDateTime) || null,
        end: textValue(range.EndingDateTime) || null,
      };
    }
    const single = record.SingleDateTime;
    if (typeof single === "string") return { start: single, end: single };
  }
  return { start: null, end: null };
}

async function fetchCMR<T>(
  url: URL,
  accept = "application/vnd.nasa.cmr.umm_results+json, application/json",
  signal?: AbortSignal,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < CMR_REQUEST_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error("NASA CMR search was cancelled.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CMR_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: accept },
      });
      if (!response.ok) {
        const error = new Error(`NASA CMR returned HTTP ${response.status}.`);
        if (attempt === 0 && (response.status === 408 || response.status === 429 || response.status >= 500)) {
          lastError = error;
        } else {
          throw error;
        }
      } else {
        return await response.json() as T;
      }
    } catch (error) {
      if (signal?.aborted) throw new Error("NASA CMR search was cancelled.");
      if (error instanceof Error && error.message.startsWith("NASA CMR returned HTTP ")) {
        throw error;
      } else if (controller.signal.aborted) {
        lastError = new Error("NASA CMR search timed out. Try again.");
      } else if (error instanceof TypeError) {
        lastError = new Error("NASA CMR could not be reached. Check your network or browser access to Earthdata.");
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }

    if (attempt < CMR_REQUEST_ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, CMR_RETRY_DELAY_MS));
    }
  }
  throw lastError ?? new Error("NASA CMR search failed.");
}

/**
 * Search public NASA CMR metadata for NISAR collections with granules.
 * This discovers catalog metadata only; it does not download or process science rasters.
 */
export async function searchNISARCollections(pageSize = 100, signal?: AbortSignal): Promise<NISARCollectionsResult> {
  if (signal?.aborted) throw new Error("NASA CMR search was cancelled.");
  const normalizedPageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const fetchImplementation = globalThis.fetch;
  const cached = collectionCache.get(normalizedPageSize);
  if (cached?.fetchImplementation === fetchImplementation && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const url = new URL(`${CMR_BASE}/collections.umm_json`);
  url.searchParams.set("keyword", "NISAR");
  url.searchParams.set("has_granules", "true");
  url.searchParams.set("page_size", String(normalizedPageSize));
  url.searchParams.append("sort_key[]", "-revision_date");

  let data: CMRResponse;
  try {
    data = await fetchCMR<CMRResponse>(url, undefined, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (cached?.fetchImplementation === fetchImplementation && cached.staleUntil > Date.now()) {
      return {
        ...cached.result,
        warnings: [
          ...(cached.result.warnings ?? []),
          "NASA CMR is unavailable; using recently cached collection metadata. Granule results are still queried live.",
        ],
      };
    }
    throw error;
  }
  if (!Array.isArray(data.items)) throw new Error("NASA CMR returned an unexpected collection response.");

  const collections: NISARCollection[] = data.items.flatMap((item) => {
    const meta = item.meta;
    const umm = item.umm;
    if (!meta || !umm) return [];
    const conceptId = textValue(meta["concept-id"] ?? meta.concept_id);
    const shortName = textValue(umm.ShortName);
    const title = textValue(umm.EntryTitle);
    if (!conceptId || !shortName || !title || !/NISAR/i.test(shortName + " " + title)) return [];
    const dates = parseRange(umm);
    const doiRecord = umm.DOI && typeof umm.DOI === "object" ? umm.DOI as Record<string, unknown> : null;
    const doi = textValue(doiRecord?.DOI) || textValue(doiRecord?.doi) || null;
    const levelRecord = umm.ProcessingLevel && typeof umm.ProcessingLevel === "object"
      ? umm.ProcessingLevel as Record<string, unknown>
      : null;
    const processingLevel = textValue(levelRecord?.Id) || textValue(levelRecord?.ShortName) || textValue(levelRecord?.Description);
    return [{
      dataClass: "catalog-metadata",
      conceptId,
      shortName,
      title,
      version: textValue(umm.Version),
      abstract: safePlainText(umm.Abstract),
      processingLevel,
      productCode: extractNISARProductCode(shortName),
      maturity: inferNISARMaturity(shortName),
      productionConfiguration: inferNISARProductionConfiguration(
        shortName,
        additionalAttribute(umm, ["production configuration", "production mode", "acquisition mode"]),
      ),
      doi,
      startDate: dates.start,
      endDate: dates.end,
      revisionDate: textValue(meta["revision-date"]) || null,
      metadataUrl: `https://cmr.earthdata.nasa.gov/search/concepts/${encodeURIComponent(conceptId)}`,
      earthdataSearchUrl: `https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(shortName)}`,
    }];
  });

  collections.sort((a, b) => {
    const score = (item: NISARCollection) =>
      (/NISAR_L[123]/i.test(item.shortName) ? 10 : 0) +
      (item.productCode ? 5 : 0);
    return compareNISARMaturity(a.maturity, b.maturity) ||
      score(b) - score(a) ||
      a.title.localeCompare(b.title);
  });
  const result = {
    collections,
    hits: typeof data.hits === "number" && Number.isFinite(data.hits) ? data.hits : collections.length,
  };
  const cachedAt = Date.now();
  collectionCache.set(normalizedPageSize, {
    result,
    expiresAt: cachedAt + CMR_COLLECTION_CACHE_TTL_MS,
    staleUntil: cachedAt + CMR_COLLECTION_CACHE_STALE_MS,
    fetchImplementation,
  });
  return result;
}

/** Search real OPERA collection records in NASA CMR; this does not access or process raster products. */
export async function searchOPERACatalogCollections(pageSize = 100): Promise<{
  collections: OPERACatalogCollection[];
  hits: number;
}> {
  const url = new URL(`${CMR_BASE}/collections.umm_json`);
  url.searchParams.set("keyword", "OPERA");
  url.searchParams.set("has_granules", "true");
  url.searchParams.set("page_size", String(Math.max(1, Math.min(100, Math.floor(pageSize)))));
  url.searchParams.append("sort_key[]", "-revision_date");

  const data = await fetchCMR<CMRResponse>(url);
  if (!Array.isArray(data.items)) throw new Error("NASA CMR returned an unexpected OPERA collection response.");

  const collections: OPERACatalogCollection[] = data.items.flatMap((item) => {
    const meta = item.meta;
    const umm = item.umm;
    if (!meta || !umm) return [];
    const conceptId = textValue(meta["concept-id"] ?? meta.concept_id);
    const shortName = textValue(umm.ShortName);
    const title = textValue(umm.EntryTitle);
    if (!conceptId || !shortName.startsWith("OPERA_") || !title) return [];
    const level = recordOf(umm.ProcessingLevel);
    const doiRecord = recordOf(umm.DOI);
    const dates = parseRange(umm);
    return [{
      dataClass: "catalog-metadata",
      conceptId,
      shortName,
      title,
      version: textValue(umm.Version),
      processingLevel: textValue(level?.Id) || textValue(level?.ShortName) || textValue(level?.Description),
      abstract: safePlainText(umm.Abstract),
      doi: textValue(doiRecord?.DOI) || textValue(doiRecord?.doi) || null,
      startDate: dates.start,
      endDate: dates.end,
      revisionDate: textValue(meta["revision-date"]) || null,
      metadataUrl: `https://cmr.earthdata.nasa.gov/search/concepts/${encodeURIComponent(conceptId)}`,
      earthdataSearchUrl: `https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(shortName)}`,
    }];
  });
  return {
    collections,
    hits: typeof data.hits === "number" && Number.isFinite(data.hits) ? data.hits : collections.length,
  };
}

function validateDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real calendar date in YYYY-MM-DD format.`);
  }
  return value;
}

function validateBounds(bounds: CMRBounds): void {
  const values = [bounds.west, bounds.south, bounds.east, bounds.north];
  if (!values.every(Number.isFinite)
    || bounds.west < -180 || bounds.east > 180 || bounds.west >= bounds.east
    || bounds.south < -90 || bounds.north > 90 || bounds.south >= bounds.north) {
    throw new Error("The area bounds are invalid. Choose an area with valid longitude and latitude limits.");
  }
}

/**
 * Search real NISAR granule metadata for a chosen CMR collection.
 * An AOI bbox and date range are optional. Browse links are optional and downloads may need Earthdata Login.
 */
function normalizeNISARGranule(
  item: CMRItem,
  options: { collectionConceptId?: string; collectionShortName?: string } = {},
): NISARGranule | null {
  const meta = item.meta;
  const umm = item.umm;
  if (!meta || !umm) return null;
  const conceptId = textValue(meta["concept-id"] ?? meta.concept_id);
  const granuleId = textValue(umm.GranuleUR) || textValue(meta["native-id"] ?? meta.native_id);
  if (!conceptId || !granuleId) return null;

  const temporal = recordOf(umm.TemporalExtent);
  const range = recordOf(temporal?.RangeDateTime);
  const singleDate = textValue(temporal?.SingleDateTime) || "";
  const startDate = textValue(range?.BeginningDateTime) || singleDate || null;
  const endDate = textValue(range?.EndingDateTime) || singleDate || null;
  const dataCenters = Array.isArray(umm.DataCenters) ? umm.DataCenters : [];
  const producer = textValue(recordOf(dataCenters[0])?.ShortName);
  const spatial = granuleSpatial(umm);
  const related = granuleRelatedUrls(umm);
  const collection = recordOf(umm.CollectionReference);
  const collectionConceptId =
    textValue(meta["collection-concept-id"] ?? meta.collection_concept_id) ||
    options.collectionConceptId ||
    "";
  const collectionShortName =
    options.collectionShortName ||
    textValue(collection?.ShortName) ||
    textValue(collection?.EntryTitle) ||
    collectionConceptId;
  const productCode =
    extractNISARProductCode(collectionShortName) ||
    extractNISARProductCode(granuleId) ||
    "NISAR";
  const configurationAttribute = additionalAttribute(umm, [
    "production configuration",
    "production mode",
    "acquisition mode",
  ]);
  const productionConfiguration = inferNISARProductionConfiguration(
    configurationAttribute,
    collectionShortName,
    granuleId,
  );
  const title = textValue(collection?.EntryTitle) || granuleId;
  const earthdataSearchUrl = new URL("https://search.earthdata.nasa.gov/search/granules");
  if (collectionConceptId) earthdataSearchUrl.searchParams.set("p", collectionConceptId);
  earthdataSearchUrl.searchParams.set("g", conceptId);

  return {
    dataClass: "catalog-metadata",
    id: `nisar:${conceptId}`,
    conceptId,
    granuleId,
    collectionConceptId,
    collectionShortName,
    productCode,
    maturity: inferNISARMaturity(collectionShortName),
    productionConfiguration,
    orbitDirection: additionalAttribute(umm, ["orbit direction", "orbitdirection"]) || textValue(umm.OrbitDirection) || null,
    polarization: additionalAttribute(umm, ["polarization", "polarisation"]) || textValue(umm.Polarization) || null,
    trackNumber: additionalAttribute(umm, ["track number", "tracknumber"]) || textValue(umm.TrackNumber) || null,
    frameNumber: additionalAttribute(umm, ["frame number", "framenumber"]) || textValue(umm.FrameNumber) || null,
    productionTime: textValue(umm.ProductionDateTime) || null,
    platform: firstPlatformValue(umm, "ShortName") || null,
    instrument: firstPlatformValue(umm, "Instruments") || null,
    title,
    startDate,
    endDate,
    producer,
    bounds: spatial.bounds,
    footprint: spatial.footprint,
    browseUrl: related.browseUrl,
    dataUrl: related.dataUrl,
    metadataUrl: `https://cmr.earthdata.nasa.gov/search/concepts/${encodeURIComponent(conceptId)}`,
    earthdataSearchUrl: earthdataSearchUrl.toString(),
    sourceMetadata: { meta, umm },
  };
}

/** Load a real granule directly so observation URLs continue to work after refresh or sharing. */
export async function fetchNISARGranuleByConceptId(conceptId: string): Promise<NISARGranule> {
  if (!/^G\d+-[A-Z0-9_-]+$/i.test(conceptId)) {
    throw new Error("The NISAR granule ID is invalid.");
  }
  const url = new URL(`${CMR_BASE}/concepts/${encodeURIComponent(conceptId)}.umm_json`);
  const item = await fetchCMR<CMRItem>(url, "application/vnd.nasa.cmr.umm+json, application/json");
  const granule = normalizeNISARGranule(item);
  if (!granule || granule.conceptId !== conceptId) {
    throw new Error("NASA CMR did not return that NISAR granule. It may have been removed or its ID may be incorrect.");
  }
  return granule;
}

export async function searchNISARGranules(options: {
  collectionConceptId?: string;
  collectionConceptIds?: string[];
  collectionShortNamesByConceptId?: Readonly<Record<string, string>>;
  bounds?: CMRBounds | null;
  startDate?: string | null;
  endDate?: string | null;
  pageSize?: number;
  pageNumber?: number;
  collectionShortName?: string;
  signal?: AbortSignal;
}): Promise<{ granules: NISARGranule[]; hits: number }> {
  const collectionConceptIds = [...new Set([
    ...(options.collectionConceptId ? [options.collectionConceptId] : []),
    ...(options.collectionConceptIds ?? []),
  ])];
  if (!collectionConceptIds.length || collectionConceptIds.some(id => !/^C\d+-[A-Z0-9_-]+$/i.test(id))) {
    throw new Error("Choose valid NASA CMR collections before searching for granules.");
  }
  const url = new URL(`${CMR_BASE}/granules.umm_json`);
  for (const conceptId of collectionConceptIds) {
    url.searchParams.append("collection_concept_id", conceptId);
  }
  url.searchParams.set("page_size", String(Math.max(1, Math.min(100, Math.floor(options.pageSize ?? 10)))));
  const pageNumber = options.pageNumber ?? 1;
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 1000) {
    throw new Error("NASA CMR page number must be a whole number between 1 and 1000.");
  }
  url.searchParams.set("page_num", String(pageNumber));
  // Start-date sorting is slow for global NISAR collections with hundreds of thousands of matches.
  // Revision order gives a fast, bounded recent sample; results are sorted by acquisition below.
  url.searchParams.append("sort_key[]", "-revision_date");

  if (options.bounds) {
    validateBounds(options.bounds);
    const { west, south, east, north } = options.bounds;
    url.searchParams.set("bounding_box", [west, south, east, north].join(","));
  }
  if (options.startDate || options.endDate) {
    if (!options.startDate || !options.endDate) throw new Error("Choose both a start and end date.");
    const start = validateDate(options.startDate, "Start date");
    const end = validateDate(options.endDate, "End date");
    if (start > end) throw new Error("Start date must be on or before end date.");
    url.searchParams.append("temporal[]", `${start}T00:00:00Z,${end}T23:59:59Z`);
  }

  const data = await fetchCMR<CMRResponse>(url, undefined, options.signal);
  if (!Array.isArray(data.items)) throw new Error("NASA CMR returned an unexpected granule response.");

  const granules: NISARGranule[] = data.items.flatMap((item) => {
    const meta = item.meta;
    const collectionConceptId = textValue(meta?.["collection-concept-id"] ?? meta?.collection_concept_id)
      || options.collectionConceptId
      || collectionConceptIds[0]
      || "";
    const collectionShortName = options.collectionShortNamesByConceptId?.[collectionConceptId]
      || options.collectionShortName;
    const granule = normalizeNISARGranule(item, {
      collectionConceptId,
      ...(collectionShortName !== undefined
        ? { collectionShortName }
        : {}),
    });
    return granule ? [granule] : [];
  });

  return {
    granules,
    hits: typeof data.hits === "number" && Number.isFinite(data.hits) ? data.hits : granules.length,
  };
}

export interface NISARCoverageResult {
  collections: NISARCollection[];
  collectionHits: number;
  productCollections: NISARCollection[];
  granules: NISARGranule[];
  granuleHits: number;
  granuleHitsByProduct: Partial<Record<NISARCoverageProductCode, number>>;
  granuleStatusByProduct: Partial<Record<NISARCoverageProductCode, "ready" | "no-collection" | "error">>;
  page: number;
  pageSize: number;
  hasMore: boolean;
  warnings: string[];
}

function collectionOverlapsDateRange(
  collection: NISARCollection,
  startDate: string,
  endDate: string,
): boolean {
  const searchStart = Date.parse(`${startDate}T00:00:00Z`);
  const searchEnd = Date.parse(`${endDate}T23:59:59.999Z`);
  const collectionStart = collection.startDate ? Date.parse(collection.startDate) : NaN;
  const collectionEnd = collection.endDate ? Date.parse(collection.endDate) : NaN;
  return (!Number.isFinite(collectionEnd) || collectionEnd >= searchStart) &&
    (!Number.isFinite(collectionStart) || collectionStart <= searchEnd);
}

/**
 * Discover real NISAR product records and their available spatial footprints for the selected area and time.
 * It returns catalog metadata and browse links; it does not download or process HDF5 rasters.
 */
export async function searchNISARCoverage(options: {
  bounds?: CMRBounds | null;
  startDate: string;
  endDate: string;
  productCodes?: string[];
  page?: number;
  signal?: AbortSignal;
}): Promise<NISARCoverageResult> {
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    throw new Error("NASA CMR page number must be a whole number between 1 and 1000.");
  }
  const catalog = await searchNISARCollections(100, options.signal);
  const requestedCodes = options.productCodes?.length ? options.productCodes : DEFAULT_NISAR_PRODUCTS;
  const productCodes = [...new Set(requestedCodes.map(code => code.toUpperCase()))]
    .filter(isNISARCoverageProductCode);
  if (!productCodes.length) {
    throw new Error(`Select at least one supported NISAR product family: ${NISAR_COVERAGE_PRODUCT_CODES.join(", ")}.`);
  }
  const selected: NISARCollection[] = [];
  const used = new Set<string>();
  const warnings: string[] = [...(catalog.warnings ?? [])];

  for (const code of productCodes) {
    const candidates = catalog.collections
      .filter(collection => collection.productCode === code)
      .filter(collection => collectionOverlapsDateRange(collection, options.startDate, options.endDate));
    candidates.sort((a, b) => {
      return compareNISARMaturity(a.maturity, b.maturity) ||
        (Date.parse(b.revisionDate || "") || 0) - (Date.parse(a.revisionDate || "") || 0);
    });
    const maturityGroups = new Set<string>();
    for (const candidate of candidates) {
      const maturityGroup = `${candidate.maturity}:${candidate.productionConfiguration}`;
      if (maturityGroups.has(maturityGroup) || used.has(candidate.conceptId)) continue;
      maturityGroups.add(maturityGroup);
      used.add(candidate.conceptId);
      selected.push(candidate);
    }
    if (!candidates.length) {
      warnings.push(`${code}: no CMR collection metadata overlaps the selected date range.`);
    }
  }

  if (!selected.length) {
    throw new Error(warnings.join(" ") || `NASA CMR returned no matching collection for product family: ${productCodes.join(", ")}.`);
  }

  const collectionsByProduct = new Map<string, NISARCollection[]>();
  for (const collection of selected) {
    if (!collection.productCode) continue;
    const group = collectionsByProduct.get(collection.productCode) ?? [];
    group.push(collection);
    collectionsByProduct.set(collection.productCode, group);
  }
  const productGroups = [...collectionsByProduct.values()];
  const results: PromiseSettledResult<{ granules: NISARGranule[]; hits: number }>[] = [];
  for (let offset = 0; offset < productGroups.length; offset += CMR_GRANULE_SEARCH_CONCURRENCY) {
    if (options.signal?.aborted) throw new Error("NASA CMR search was cancelled.");
    const batch = productGroups.slice(offset, offset + CMR_GRANULE_SEARCH_CONCURRENCY);
    results.push(...await Promise.allSettled(batch.map(collection =>
      searchNISARGranules({
        collectionConceptIds: collection.map(item => item.conceptId),
        collectionShortNamesByConceptId: Object.fromEntries(
          collection.map(item => [item.conceptId, item.shortName]),
        ),
        bounds: options.bounds ?? null,
        startDate: options.startDate,
        endDate: options.endDate,
        pageSize: CMR_COVERAGE_PAGE_SIZE,
        pageNumber: page,
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    )));
  }
  const granules: NISARGranule[] = [];
  let granuleHits = 0;
  const granuleHitsByProduct: Partial<Record<NISARCoverageProductCode, number>> = {};
  const granuleStatusByProduct: NISARCoverageResult["granuleStatusByProduct"] = {};
  for (const code of productCodes) {
    if (!collectionsByProduct.has(code)) {
      granuleHitsByProduct[code] = 0;
      granuleStatusByProduct[code] = "no-collection";
    }
  }
  results.forEach((result, index) => {
    const collectionGroup = productGroups[index];
    if (!collectionGroup) return;
    if (result.status === "fulfilled") {
      granuleHits += result.value.hits;
      const code = collectionGroup[0]?.productCode;
      if (code && isNISARCoverageProductCode(code)) {
        granuleHitsByProduct[code] = (granuleHitsByProduct[code] ?? 0) + result.value.hits;
        granuleStatusByProduct[code] = "ready";
      }
      granules.push(...result.value.granules);
    } else {
      const productCode = collectionGroup[0]?.productCode ?? "NISAR";
      if (isNISARCoverageProductCode(productCode)) granuleStatusByProduct[productCode] = "error";
      warnings.push(`${productCode}: ${result.reason instanceof Error ? result.reason.message : "granule search failed"}`);
    }
  });

  granules.sort((a, b) => (Date.parse(b.startDate || "") || 0) - (Date.parse(a.startDate || "") || 0));
  return {
    collections: catalog.collections,
    collectionHits: catalog.hits,
    productCollections: selected,
    granules,
    granuleHits,
    granuleHitsByProduct,
    granuleStatusByProduct,
    page,
    pageSize: CMR_COVERAGE_PAGE_SIZE,
    hasMore: results.some(result =>
      result.status === "fulfilled" && result.value.hits > page * CMR_COVERAGE_PAGE_SIZE,
    ),
    warnings,
  };
}
