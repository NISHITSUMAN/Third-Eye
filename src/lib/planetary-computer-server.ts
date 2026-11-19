import type { Geometry } from "geojson";
import { validateGeometry } from "./analysis";
import {
  getIntelligenceWorkflow,
  type IntelligenceWorkflowId,
} from "./intelligence-workflows";
import type {
  PlanetaryComputerSearchResult,
  PlanetaryObservation,
  PlanetaryComputerVisualization,
} from "./planetary-computer";

const STAC_SEARCH_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_NETWORK_ATTEMPTS = 3;
const MAX_TIMEOUT_ATTEMPTS = 2;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_STALE_MS = 60 * 60_000;
const MAX_CACHE_ENTRIES = 32;
const MAX_ITEMS = 100;
const VISUALIZATION_TIMEOUT_MS = 9_000;
const RETRY_DELAY_MS = 250;

interface CacheEntry {
  result: PlanetaryComputerSearchResult;
  expiresAt: number;
  staleUntil: number;
}

const searchCache = new Map<string, CacheEntry>();
const visualizationCache = new Map<string, { value: PlanetaryComputerVisualization; expiresAt: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validDateTime(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function validBounds(value: unknown): PlanetaryObservation["bbox"] {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [west, south, east, north] = value;
  if (
    typeof west !== "number" || typeof south !== "number" ||
    typeof east !== "number" || typeof north !== "number" ||
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 || east > 180 || west >= east ||
    south < -90 || north > 90 || south >= north
  ) return null;
  return [west, south, east, north];
}

function safeItemUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "planetarycomputer.microsoft.com" &&
        !url.hostname.endsWith(".planetarycomputer.microsoft.com"))
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function safePreviewUrl(
  value: unknown,
  expectedCollectionId: string,
  expectedItemId: string,
): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "planetarycomputer.microsoft.com" ||
      url.pathname !== "/api/data/v1/item/map" ||
      url.searchParams.get("collection") !== expectedCollectionId ||
      url.searchParams.get("item") !== expectedItemId
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeObservation(
  value: unknown,
  workflowId: IntelligenceWorkflowId,
  expectedCollectionId: string,
): { item: PlanetaryObservation | null; warning: string | null } {
  if (!isRecord(value) || value.type !== "Feature" || !isRecord(value.properties)) {
    return { item: null, warning: "An invalid STAC item was omitted." };
  }
  const properties = value.properties;
  const collectionId = typeof value.collection === "string" ? value.collection : "";
  const workflow = getIntelligenceWorkflow(workflowId);
  const collection = workflow.planetaryComputerCollections.find((entry) => entry.id === collectionId);
  const sourceId = typeof value.id === "string" ? value.id.trim() : "";
  if (!collection || collectionId !== expectedCollectionId || !sourceId || sourceId.length > 200) {
    return { item: null, warning: "An item outside the requested collections was omitted." };
  }

  let geometry: Geometry | null = null;
  let warning: string | null = null;
  if (value.geometry !== null && value.geometry !== undefined) {
    try {
      geometry = validateGeometry(value.geometry).geometry;
    } catch {
      warning = "One or more catalog geometries were invalid and are not mapped.";
    }
  }

  const linkList = Array.isArray(value.links) ? value.links : [];
  const itemLink = linkList.find((link) =>
    isRecord(link) && (link.rel === "self" || link.rel === "canonical"),
  );
  const previewLink = linkList.find((link) =>
    isRecord(link) && link.rel === "preview" && link.type === "text/html",
  );
  const instruments = Array.isArray(properties.instruments)
    ? properties.instruments.filter((instrument): instrument is string =>
        typeof instrument === "string" && instrument.length <= 80,
      ).slice(0, 8)
    : [];
  const datetime = validDateTime(properties.datetime) ??
    validDateTime(properties.start_datetime) ??
    validDateTime(properties.end_datetime);
  const item: PlanetaryObservation = {
    id: `pc:${collectionId}:${sourceId}`,
    collectionId,
    collectionLabel: collection.label,
    title: typeof properties.title === "string" && properties.title.trim()
      ? properties.title.trim().slice(0, 240)
      : sourceId,
    datetime,
    platform: typeof properties.platform === "string" ? properties.platform.slice(0, 80) : null,
    instruments,
    bbox: validBounds(value.bbox),
    geometry,
    itemUrl: isRecord(itemLink) ? safeItemUrl(itemLink.href) : null,
    previewUrl: isRecord(previewLink)
      ? safePreviewUrl(previewLink.href, collectionId, sourceId)
      : null,
    dataClass: "catalog-observation",
    sourceMetadata: value,
  };
  return { item, warning };
}

function cacheKey(
  workflowId: IntelligenceWorkflowId,
  startDate: string,
  endDate: string,
  geometry: Geometry | null,
) {
  return JSON.stringify([workflowId, startDate, endDate, geometry]);
}

interface CollectionSearchResult {
  collectionId: string;
  items: PlanetaryObservation[];
  matched: number | null;
  warnings: string[];
  error: string | null;
}

async function postSearch(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_NETWORK_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error("The observation search was cancelled.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await fetch(STAC_SEARCH_URL, {
        method: "POST",
        headers: { Accept: "application/geo+json, application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`Microsoft Planetary Computer returned HTTP ${response.status}.`);
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        throw error;
      }
      return await response.json() as unknown;
    } catch (error) {
      if (signal?.aborted) throw new Error("The observation search was cancelled.");
      if (error instanceof Error && error.message.startsWith("Microsoft Planetary Computer returned HTTP ")) {
        throw error;
      }
      const timedOut = controller.signal.aborted;
      lastError = timedOut
        ? new Error(`Microsoft Planetary Computer timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
        : error instanceof TypeError
          ? new Error("Microsoft Planetary Computer could not be reached. Check your network and try again.")
          : error;
      const attemptLimit = timedOut ? MAX_TIMEOUT_ATTEMPTS : error instanceof TypeError ? MAX_NETWORK_ATTEMPTS : 1;
      if (attempt + 1 < attemptLimit) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Microsoft Planetary Computer search failed.");
}

async function searchCollection(
  workflowId: IntelligenceWorkflowId,
  collectionId: string,
  startDate: string,
  endDate: string,
  geometry: Geometry | null,
  signal?: AbortSignal,
): Promise<CollectionSearchResult> {
  const body: Record<string, unknown> = {
    collections: [collectionId],
    limit: MAX_ITEMS,
    sortby: [{ field: "properties.datetime", direction: "desc" }],
  };
  if (collectionId === "jrc-gsw") {
    // JRC Global Surface Water is a static long-term Landsat baseline,
    // not a time-series scene collection. Do not hide it behind the UI's
    // recent observation date range.
  } else {
    body.datetime = `${startDate}T00:00:00Z/${endDate}T23:59:59Z`;
  }
  if (geometry) body.intersects = geometry;

  const payload = await postSearch(body, signal);
  if (!isRecord(payload) || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("Microsoft Planetary Computer returned an unexpected STAC response.");
  }

  const warnings: string[] = [];
  const items: PlanetaryObservation[] = [];
  for (const feature of payload.features.slice(0, MAX_ITEMS)) {
    const normalized = normalizeObservation(feature, workflowId, collectionId);
    if (normalized.item) items.push(normalized.item);
    if (normalized.warning) warnings.push(normalized.warning);
  }
  const context = isRecord(payload.context) ? payload.context : null;
  const matchedValue = context?.matched ?? payload.numberMatched;
  const matched = typeof matchedValue === "number" && Number.isFinite(matchedValue) && matchedValue >= 0
    ? Math.floor(matchedValue)
    : null;
  return { collectionId, items, matched, warnings, error: null };
}

export async function searchPlanetaryComputer(
  workflowId: IntelligenceWorkflowId,
  startDate: string,
  endDate: string,
  geometry: Geometry | null,
  signal?: AbortSignal,
): Promise<PlanetaryComputerSearchResult> {
  const workflow = getIntelligenceWorkflow(workflowId);
  const key = cacheKey(workflowId, startDate, endDate, geometry);
  const cached = searchCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.result;

  try {
    const collectionResults = await Promise.all(workflow.planetaryComputerCollections.map(async (collection) => {
      try {
        return await searchCollection(workflowId, collection.id, startDate, endDate, geometry, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        return {
          collectionId: collection.id,
          items: [],
          matched: null,
          warnings: [],
          error: error instanceof Error ? error.message : "The collection search failed.",
        };
      }

    }));
    const failedCollections = collectionResults.filter((result) => result.error);
    const successfulCollections = collectionResults.filter((result) => !result.error);
    if (!successfulCollections.length) {
      throw new Error(failedCollections.map((result) => {
        const collection = workflow.planetaryComputerCollections.find((item) => item.id === result.collectionId);
        return `${collection?.label ?? result.collectionId}: ${result.error}`;
      }).join(" "));
    }

    const warnings = successfulCollections.flatMap((result) => result.warnings);
    for (const result of failedCollections) {
      const collection = workflow.planetaryComputerCollections.find((item) => item.id === result.collectionId);
      warnings.push(`${collection?.label ?? result.collectionId} catalog search failed: ${result.error}`);
    }
    const itemsByCollection = successfulCollections.map((result) =>
      [...result.items].sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? "")),
    );
    const items: PlanetaryObservation[] = [];
    for (let index = 0; items.length < MAX_ITEMS; index += 1) {
      let foundItem = false;
      for (const collectionItems of itemsByCollection) {
        const item = collectionItems[index];
        if (!item) continue;
        items.push(item);
        foundItem = true;
        if (items.length === MAX_ITEMS) break;
      }
      if (!foundItem) break;
    }
    items.sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? ""));
    const matched = failedCollections.length === 0 && successfulCollections.every((result) => result.matched !== null)
      ? successfulCollections.reduce((total, result) => total + (result.matched ?? 0), 0)
      : null;
    const result: PlanetaryComputerSearchResult = {
      source: "Microsoft Planetary Computer STAC",
      dataClass: "catalog-metadata",
      workflowId,
      startDate,
      endDate,
      matched,
      items,
      warnings: [...new Set(warnings)],
      fetchedAt: new Date().toISOString(),
    };
    if (!failedCollections.length) {
      searchCache.delete(key);
      searchCache.set(key, { result, expiresAt: now + CACHE_TTL_MS, staleUntil: now + CACHE_STALE_MS });
      while (searchCache.size > MAX_CACHE_ENTRIES) {
        const oldest = searchCache.keys().next().value;
        if (oldest === undefined) break;
        searchCache.delete(oldest);
      }
    }
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (cached && cached.staleUntil > now) {
      return {
        ...cached.result,
        warnings: [...cached.result.warnings, "Provider is unavailable; showing a previously cached catalog response."],
      };
    }
    throw error;
  }
}

function safeVisualizationUrl(value: unknown): string | null {
      if (typeof value !== "string") return null;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.hostname !== "planetarycomputer.microsoft.com" ||
          url.username || url.password ||
          [...url.searchParams.keys()].some(key => /^(sig|token|se|sp|sv|credential|authorization)$/i.test(key))) return null;
        return url.href;
      } catch {
        return null;
      }
    }

    function tileUrl(template: string, zoom: number, x: number, y: number, scheme: unknown): string | null {
      const tileY = scheme === "tms" ? 2 ** zoom - y - 1 : y;
      const expanded = template.replace(/\{(?:z|tileMatrix)\}/g, String(zoom))
        .replace(/\{(?:x|tileCol)\}/g, String(x))
        .replace(/\{(?:y|tileRow)\}/g, String(tileY))
        .replace(/\{(?:quadkey|time)\}/g, "");
      return safeVisualizationUrl(expanded);
    }

    function tileAt(bounds: NonNullable<PlanetaryObservation["bbox"]>, template: string, scheme: unknown): string | null {
      const zoom = 8;
      const longitude = (bounds[0] + bounds[2]) / 2;
      const latitude = Math.max(-85.05112878, Math.min(85.05112878, (bounds[1] + bounds[3]) / 2));
      const scale = 2 ** zoom;
      const x = Math.max(0, Math.min(scale - 1, Math.floor((longitude + 180) / 360 * scale)));
      const radians = latitude * Math.PI / 180;
      const y = Math.max(0, Math.min(scale - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * scale)));
      return tileUrl(template, zoom, x, y, scheme);
    }

    async function fetchVisualizationJson(url: string, signal?: AbortSignal): Promise<unknown> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VISUALIZATION_TIMEOUT_MS);
      const forwardAbort = () => controller.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });
      try {
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
        if (!response.ok) throw new Error(`The imagery metadata endpoint returned HTTP ${response.status}.`);
        return await response.json() as unknown;
      } catch (error) {
        if (signal?.aborted) throw new Error("The imagery request was cancelled.");
        if (controller.signal.aborted) throw new Error("The imagery metadata request timed out.");
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", forwardAbort);
      }
    }

    async function verifyImageTile(url: string, signal?: AbortSignal): Promise<void> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VISUALIZATION_TIMEOUT_MS);
      const forwardAbort = () => controller.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });
      try {
        const response = await fetch(url, {
          headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" },
          signal: controller.signal,
        });
        if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("image/")) {
          throw new Error("The observation tile could not be verified as an image.");
        }
        if (response.body) await response.body.cancel();
      } catch (error) {
        if (signal?.aborted) throw new Error("The imagery request was cancelled.");
        if (controller.signal.aborted) throw new Error("The imagery tile verification timed out.");
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", forwardAbort);
      }
    }

    export async function verifyPlanetaryComputerVisualization(
      workflowId: IntelligenceWorkflowId,
      collectionId: string,
      itemId: string,
      signal?: AbortSignal,
    ): Promise<PlanetaryComputerVisualization> {
      const workflow = getIntelligenceWorkflow(workflowId);
      const collection = workflow.planetaryComputerCollections.find(item => item.id === collectionId);
      if (!collection || !/^[A-Za-z0-9._:-]{1,200}$/.test(itemId)) {
        throw new Error("The observation is outside the selected workflow's supported collections.");
      }
      const key = `${workflowId}:${collectionId}:${itemId}`;
      const cached = visualizationCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      const itemUrl = `https://planetarycomputer.microsoft.com/api/stac/v1/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`;
      const itemPayload = await fetchVisualizationJson(itemUrl, signal);
      if (!isRecord(itemPayload) || itemPayload.type !== "Feature" ||
        itemPayload.collection !== collectionId || itemPayload.id !== itemId ||
        !isRecord(itemPayload.properties) || !isRecord(itemPayload.assets)) {
        throw new Error("The STAC item could not be verified for this observation.");
      }

      const tileAsset = Object.entries(itemPayload.assets).find(([keyName, raw]) => {
        if (!isRecord(raw)) return false;
        const roles = Array.isArray(raw.roles) ? raw.roles : [];
        return keyName.toLowerCase() === "tilejson" ||
          roles.includes("tiles") && typeof raw.type === "string" && raw.type.toLowerCase().includes("json");
      });
      const tileJsonUrl = tileAsset && isRecord(tileAsset[1]) ? safeVisualizationUrl(tileAsset[1].href) : null;
      if (!tileJsonUrl) {
        throw new Error("This observation does not publish a verified public tile visualization asset.");
      }
      const tileJson = await fetchVisualizationJson(tileJsonUrl, signal);
      if (!isRecord(tileJson) || !Array.isArray(tileJson.tiles) || !tileJson.tiles.length) {
        throw new Error("The observation's tile metadata does not contain a usable tile template.");
      }
      const tiles = tileJson.tiles.filter((tile): tile is string =>
        typeof tile === "string" && Boolean(safeVisualizationUrl(
          tile.replace(/\{(?:z|tileMatrix)\}/g, "8")
            .replace(/\{(?:x|tileCol)\}/g, "128")
            .replace(/\{(?:y|tileRow)\}/g, "128"),
        )),
      ).slice(0, 4);
      const bounds = validBounds(itemPayload.bbox) ?? validBounds(tileJson.bounds);
      if (!tiles.length || !bounds) {
        throw new Error("The observation is missing a safe tile template or geographic extent.");
      }
      const probeUrl = tileAt(bounds, tiles[0]!, tileJson.scheme);
      if (!probeUrl) throw new Error("The imagery tile URL is not on the public Planetary Computer service.");
      await verifyImageTile(probeUrl, signal);

      const result: PlanetaryComputerVisualization = {
        source: "Microsoft Planetary Computer",
        itemId: `pc:${collectionId}:${itemId}`,
        collectionLabel: collection.label,
        datetime: validDateTime(itemPayload.properties.datetime) ??
          validDateTime(itemPayload.properties.start_datetime) ??
          validDateTime(itemPayload.properties.end_datetime),
        tiles,
        bounds,
        minZoom: typeof tileJson.minzoom === "number" && Number.isFinite(tileJson.minzoom) ? tileJson.minzoom : null,
        maxZoom: typeof tileJson.maxzoom === "number" && Number.isFinite(tileJson.maxzoom) ? tileJson.maxzoom : null,
        attribution: typeof tileJson.attribution === "string" && tileJson.attribution.trim()
          ? tileJson.attribution.trim()
          : "Microsoft Planetary Computer",
        verifiedAt: new Date().toISOString(),
      };
      visualizationCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
      while (visualizationCache.size > MAX_CACHE_ENTRIES) {
        const oldest = visualizationCache.keys().next().value;
        if (oldest === undefined) break;
        visualizationCache.delete(oldest);
      }
  return result;
}
