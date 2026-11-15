import type { Geometry } from "geojson";
import { validateGeometry } from "./analysis";

export type GeoSearchType =
  | "country"
  | "state"
  | "city"
  | "town"
  | "address"
  | "landmark"
  | "mountain"
  | "river"
  | "volcano"
  | "glacier"
  | "location"
  | "coordinates"
  | "bbox"
  | "track_frame";

export type GeoSearchProvider =
  | "local-parser"
  | "photon-osm"
  | "open-meteo-geonames"
  | "bigdatacloud";

export interface GeoSearchResult {
  id: string;
  name: string;
  displayName: string;
  type: GeoSearchType;
  latitude: number;
  longitude: number;
  bbox: [number, number, number, number];
  geometry?: Geometry;
  provider: GeoSearchProvider;
  confidence: number | null;
  providerRelevance: number | null;
  attribution: string;
  extentQuality: "source" | "approximate";
}

export interface GeoSearchResponse {
  status: "ready" | "partial" | "no-results";
  results: GeoSearchResult[];
  warnings: string[];
}

export function isValidGeoBounds(bounds: readonly number[]): bounds is [number, number, number, number] {
  if (bounds.length !== 4 || !bounds.every(Number.isFinite)) return false;
  const [west, south, east, north] = bounds;
  return west! >= -180 && east! <= 180 && west! < east!
    && south! >= -90 && north! <= 90 && south! < north!;
}

function pointBounds(longitude: number, latitude: number): [number, number, number, number] {
  return [
    Math.max(-180, longitude - 0.25),
    Math.max(-90, latitude - 0.25),
    Math.min(180, longitude + 0.25),
    Math.min(90, latitude + 0.25),
  ];
}

function resultFromBounds(
  bbox: [number, number, number, number],
  displayName: string,
  type: "coordinates" | "bbox",
  extentQuality: "source" | "approximate",
): GeoSearchResult {
  const [west, south, east, north] = bbox;
  const name = displayName;
  return {
    id: `local:${type}:${bbox.join(",")}`,
    name,
    displayName,
    type,
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    bbox,
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
    provider: "local-parser",
    confidence: null,
    providerRelevance: null,
    attribution: "Parsed from coordinates supplied by the user.",
    extentQuality,
  };
}

function parseDecimalPair(query: string): GeoSearchResult | null {
  const match = query.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    id: `local:coordinates:${latitude},${longitude}`,
    name: "Coordinates",
    displayName: `${latitude}, ${longitude}`,
    type: "coordinates",
    latitude,
    longitude,
    bbox: pointBounds(longitude, latitude),
    geometry: { type: "Point", coordinates: [longitude, latitude] },
    provider: "local-parser",
    confidence: null,
    providerRelevance: null,
    attribution: "Coordinates supplied by the user; search extent is an approximate 0.25° buffer.",
    extentQuality: "approximate",
  };
}

function parseDmsComponent(value: string): { axis: "latitude" | "longitude"; decimal: number } | null {
  const match = value.trim().match(/^(\d{1,3})\s*(?:°|d)\s*(\d{1,2})?\s*(?:'|m)?\s*(\d+(?:\.\d+)?)?\s*(?:"|s)?\s*([NSEW])$/i);
  if (!match) return null;
  const degrees = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const direction = match[4]!.toUpperCase();
  if (minutes >= 60 || seconds >= 60) return null;
  const axis = direction === "N" || direction === "S" ? "latitude" : "longitude";
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  if ((axis === "latitude" && magnitude > 90) || (axis === "longitude" && magnitude > 180)) return null;
  return {
    axis,
    decimal: direction === "S" || direction === "W" ? -magnitude : magnitude,
  };
}

function parseDmsPair(query: string): GeoSearchResult | null {
  const parts = query.split(",");
  if (parts.length !== 2) return null;
  const first = parseDmsComponent(parts[0] ?? "");
  const second = parseDmsComponent(parts[1] ?? "");
  if (!first || !second || first.axis === second.axis) return null;
  const latitude = first.axis === "latitude" ? first.decimal : second.decimal;
  const longitude = first.axis === "longitude" ? first.decimal : second.decimal;
  return parseDecimalPair(`${latitude}, ${longitude}`);
}

function parseBoundingBox(query: string): GeoSearchResult | null {
  const raw = query.trim().replace(/^bbox\s*[:=]?\s*/i, "");
  const values = raw.split(/[,\s]+/).map(Number);
  if (values.length !== 4 || !isValidGeoBounds(values)) return null;
  return resultFromBounds(values, `Bounding box ${values.join(", ")}`, "bbox", "source");
}

function parseWktPolygon(query: string): GeoSearchResult | null {
  const match = query.trim().match(/^POLYGON\s*\(\(\s*([^()]+?)\s*\)\)\s*$/i);
  if (!match) return null;
  const points = match[1]!.split(",").map(pair => pair.trim().split(/\s+/).map(Number));
  if (points.length < 4 || points.some(point =>
    point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
      || Math.abs(point[0]!) > 180 || Math.abs(point[1]!) > 90,
  )) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) return null;
  const longitudes = points.map(point => point[0]!);
  const latitudes = points.map(point => point[1]!);
  const bounds: [number, number, number, number] = [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
  if (!isValidGeoBounds(bounds) || bounds[2] - bounds[0] > 180) return null;
  return {
    ...resultFromBounds(bounds, "WKT polygon", "bbox", "source"),
    geometry: { type: "Polygon", coordinates: [points] },
  };
}

export function parseLocalGeoQuery(query: string): GeoSearchResult | null {
  return parseDecimalPair(query)
    ?? parseDmsPair(query)
    ?? parseWktPolygon(query)
    ?? parseBoundingBox(query);
}

export function isAntimeridianBBoxQuery(query: string): boolean {
  const raw = query.trim().replace(/^bbox\s*[:=]?\s*/i, "");
  const values = raw.split(/[,\s]+/).map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) return false;
  const [west, south, east, north] = values;
  return west! >= -180 && west! <= 180 && east! >= -180 && east! <= 180
    && west! > east! && south! >= -90 && north! <= 90 && south! < north!;
}

export function isTrackFrameQuery(query: string): boolean {
  return /\btrack\s*[:#]?\s*\d+\s*(?:[,/ ]\s*|\s+)frame\s*[:#]?\s*\d+\b/i.test(query.trim());
}

export function normalizeGeoSearchResult(value: unknown): GeoSearchResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { latitude, longitude, bbox, geometry, displayName, name, type, provider, id, confidence, providerRelevance, attribution } = record;
  if (typeof latitude !== "number" || typeof longitude !== "number"
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    || !Array.isArray(bbox) || !isValidGeoBounds(bbox)
    || typeof displayName !== "string" || !displayName.trim()
    || typeof name !== "string" || !name.trim()
    || typeof id !== "string"
    || (confidence !== null && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1))
    || (providerRelevance !== null && (typeof providerRelevance !== "number" || !Number.isFinite(providerRelevance) || providerRelevance < 0 || providerRelevance > 1))
    || typeof attribution !== "string" || !attribution.trim()
    || !["country", "state", "city", "town", "address", "landmark", "mountain", "river", "volcano", "glacier", "location", "coordinates", "bbox", "track_frame"].includes(String(type))
    || !["local-parser", "photon-osm", "open-meteo-geonames", "bigdatacloud"].includes(String(provider))) return null;
  const bboxTuple = bbox as [number, number, number, number];
  let safeGeometry: Geometry;
  try {
    safeGeometry = geometry === undefined
      ? { type: "Point", coordinates: [longitude, latitude] }
      : validateGeometry(geometry).geometry;
  } catch {
    return null;
  }
  return {
    id,
    name,
    displayName,
    type: type as GeoSearchType,
    latitude,
    longitude,
    bbox: bboxTuple,
    geometry: safeGeometry,
    provider: provider as GeoSearchProvider,
    confidence: typeof confidence === "number" ? confidence : null,
    providerRelevance: typeof providerRelevance === "number" ? providerRelevance : null,
    attribution,
    extentQuality: record.extentQuality === "source" ? "source" : "approximate",
  };
}

export async function fetchReverseGeocode(latitude: number, longitude: number): Promise<GeoSearchResult> {
  const query = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
  const response = await fetch(`/api/geocode/reverse?${query.toString()}`, { headers: { Accept: "application/json" } });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Reverse geocoding failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  const result = normalizeGeoSearchResult(payload);
  if (!result) throw new Error("The reverse-geocoding service returned an invalid location.");
  return result;
}
