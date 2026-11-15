import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { AOI } from "./analysis";
import type { GeoSearchResult } from "./geocode";
import type { IntelligenceWorkflowId } from "./intelligence-workflows";
import type { LiveEarthEvent } from "./live-data";
import type { NISARGranule } from "./nasa-cmr";
import type { PlanetaryComputerSearchResult, PlanetaryObservation } from "./planetary-computer";
import { phenomenonColor, type Phenomenon } from "./earth-vocabulary";
import { nisarProductColor } from "./sar-registry";

export type GeographicResultKind =
  | "place"
  | "public-event"
  | "nisar-acquisition"
  | "satellite-observation";

export type GeographicLayerId =
  | "search-location"
  | "live-usgs"
  | "live-eonet"
  | "nisar-coverage"
  | "planetary-observations";

export type GeographicBounds = [west: number, south: number, east: number, north: number];

export interface GeographicResult {
  id: string;
  provider: string;
  kind: GeographicResultKind;
  layerId: GeographicLayerId;
  title: string;
  description: string;
  geometry: Geometry | null;
  bounds: GeographicBounds | null;
  center: { lat: number; lng: number };
  temporal: { start: string | null; end: string | null };
  metadata: Record<string, string | number | boolean | null>;
  status: string | null;
  confidence: number | null;
  links: Array<{ label: string; href: string }>;
  sourceRecord: LiveEarthEvent | NISARGranule | PlanetaryObservation | GeoSearchResult | null;
}

export interface GeographicResultInput {
  layers: ReadonlySet<string>;
  time: { start: string; end: string; current: string };
  aoi: AOI | null;
  liveEvents: readonly LiveEarthEvent[];
  nisarGranules: readonly NISARGranule[];
  planetaryComputerResult: PlanetaryComputerSearchResult | null;
  activeIntelligenceWorkflowId: IntelligenceWorkflowId;
  selectedId: string | null;
  locationResult: GeoSearchResult | null;
  mode: "science" | "intelligence";
  filter: { types: Phenomenon[] | null; region: string | null };
}

export interface GeographicFeatureProperties {
  id: string;
  provider: string;
  kind: GeographicResultKind;
  layerId: GeographicLayerId;
  title: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  selected: boolean;
  dataClass: "public-event-context" | "catalog-observation" | "place-context";
  extentType: "source-geometry" | "source-footprint" | "bounding-box" | "point";
  color: string | null;
}

const isValidBounds = (bounds: readonly number[] | null | undefined): bounds is GeographicBounds =>
  Boolean(bounds && bounds.length === 4 && bounds.every(Number.isFinite) &&
    bounds[0]! >= -180 && bounds[2]! <= 180 && bounds[0]! < bounds[2]! &&
    bounds[1]! >= -90 && bounds[3]! <= 90 && bounds[1]! < bounds[3]!);

function positionsForGeometry(geometry: Geometry | null): Position[] {
  if (!geometry) return [];
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(positionsForGeometry);
  }
  const positions: Position[] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      if (Number.isFinite(value[0]) && Number.isFinite(value[1])) {
        positions.push(value as Position);
      }
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  return positions;
}

export function geometryBounds(geometry: Geometry | null): GeographicBounds | null {
  const positions = positionsForGeometry(geometry);
  if (!positions.length) return null;
  const bounds = positions.reduce<GeographicBounds>(
    ([west, south, east, north], [lng, lat]) => [
      Math.min(west, lng!),
      Math.min(south, lat!),
      Math.max(east, lng!),
      Math.max(north, lat!),
    ],
    [180, 90, -180, -90],
  );
  return isValidBounds(bounds) ? bounds : null;
}

function boundsPolygon([west, south, east, north]: GeographicBounds): Geometry {
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function centerFor(geometry: Geometry | null, bounds: GeographicBounds | null, fallback: { lat: number; lng: number }) {
  if (geometry?.type === "Point") {
    return { lat: geometry.coordinates[1]!, lng: geometry.coordinates[0]! };
  }
  const resolvedBounds = bounds ?? geometryBounds(geometry);
  return resolvedBounds
    ? { lat: (resolvedBounds[1] + resolvedBounds[3]) / 2, lng: (resolvedBounds[0] + resolvedBounds[2]) / 2 }
    : fallback;
}

function visibleInTime(input: GeographicResultInput, start: string | null, end: string | null): boolean {
  const day = (start ?? end)?.slice(0, 10);
  return !day || (day >= input.time.start && day <= input.time.end && day <= input.time.current);
}

function overlapsAOI(
  input: GeographicResultInput,
  bounds: GeographicBounds | null,
  center?: { lat: number; lng: number },
): boolean {
  const aoiBounds = input.aoi?.bounds;
  if (!isValidBounds(aoiBounds)) return true;
  if (!isValidBounds(bounds)) {
    return center
      ? center.lng >= aoiBounds[0]! && center.lng <= aoiBounds[2]! &&
        center.lat >= aoiBounds[1]! && center.lat <= aoiBounds[3]!
      : true;
  }
  return bounds[2] >= aoiBounds[0]! && bounds[0] <= aoiBounds[2]! &&
    bounds[3] >= aoiBounds[1]! && bounds[1] <= aoiBounds[3]!;
}

function eventResult(input: GeographicResultInput, event: LiveEarthEvent): GeographicResult {
  const geometry = event.geometry ?? { type: "Point", coordinates: [event.lng, event.lat] } as const;
  const bounds = geometryBounds(geometry);
  return {
    id: event.id,
    provider: event.source,
    kind: "public-event",
    layerId: event.layerId,
    title: event.title,
    description: event.summary,
    geometry,
    bounds,
    center: centerFor(geometry, bounds, { lat: event.lat, lng: event.lng }),
    temporal: { start: event.date, end: event.date },
    metadata: {
      eventType: event.type,
      sourceId: event.sourceId,
      sourceLabel: event.sourceLabel,
      metric: event.metric,
      metricLabel: event.metricLabel,
      pagerAlert: event.pagerAlert,
      dataClass: event.dataClass,
    },
    status: event.source === "NASA EONET" ? event.metric.toLowerCase() : null,
    confidence: null,
    links: [{ label: "Open source report", href: event.sourceUrl }],
    sourceRecord: event,
  };
}

function nisarResult(input: GeographicResultInput, granule: NISARGranule): GeographicResult | null {
  const bounds: GeographicBounds | null = isValidBounds(granule.bounds
    ? [granule.bounds.west, granule.bounds.south, granule.bounds.east, granule.bounds.north]
    : null)
    ? [granule.bounds!.west, granule.bounds!.south, granule.bounds!.east, granule.bounds!.north]
    : null;
  if (!input.layers.has("nisar-coverage") ||
    !input.layers.has(`prod-${granule.productCode}`) ||
    !visibleInTime(input, granule.startDate, granule.endDate)) return null;
  const footprint = granule.footprint && granule.footprint.length >= 3
    ? granule.footprint
    : null;
  const geometry: Geometry | null = footprint
    ? {
        type: "Polygon",
        coordinates: [[...footprint, footprint[0]!]],
      }
    : bounds ? boundsPolygon(bounds) : null;
  if (!geometry) return null;
  const resolvedBounds = bounds ?? geometryBounds(geometry);
  const center = centerFor(geometry, resolvedBounds, input.aoi?.center ?? { lat: 0, lng: 0 });
  if (!overlapsAOI(input, resolvedBounds, center)) return null;
  return {
    id: granule.id,
    provider: "NASA CMR",
    kind: "nisar-acquisition",
    layerId: "nisar-coverage",
    title: granule.granuleId,
    description: `${granule.productCode} · ${granule.collectionShortName}`,
    geometry,
    bounds: resolvedBounds,
    center,
    temporal: { start: granule.startDate, end: granule.endDate },
    metadata: {
      productCode: granule.productCode,
      collection: granule.collectionShortName,
      maturity: granule.maturity,
      productionConfiguration: granule.productionConfiguration,
      extentType: footprint ? "source-footprint" : "bounding-box",
      orbitDirection: granule.orbitDirection,
      polarization: granule.polarization,
      track: granule.trackNumber,
      frame: granule.frameNumber,
    },
    status: granule.maturity,
    confidence: null,
    links: [
      { label: "NASA CMR metadata", href: granule.metadataUrl },
      { label: "Earthdata record", href: granule.earthdataSearchUrl },
      ...(granule.browseUrl ? [{ label: "Browse image", href: granule.browseUrl }] : []),
    ],
    sourceRecord: granule,
  };
}

function observationResult(input: GeographicResultInput, item: PlanetaryObservation): GeographicResult | null {
  if (!input.layers.has("planetary-observations") || !visibleInTime(input, item.datetime, item.datetime)) return null;
  const geometry = item.geometry ?? (isValidBounds(item.bbox) ? boundsPolygon(item.bbox) : null);
  const bounds = isValidBounds(item.bbox) ? item.bbox : geometryBounds(geometry);
  const center = centerFor(geometry, bounds, input.aoi?.center ?? { lat: 0, lng: 0 });
  if (!geometry || !overlapsAOI(input, bounds, center)) return null;
  return {
    id: item.id,
    provider: "Microsoft Planetary Computer",
    kind: "satellite-observation",
    layerId: "planetary-observations",
    title: item.title,
    description: item.collectionLabel,
    geometry,
    bounds,
    center,
    temporal: { start: item.datetime, end: item.datetime },
    metadata: {
      collectionId: item.collectionId,
      collectionLabel: item.collectionLabel,
      platform: item.platform,
      instruments: item.instruments.join(", "),
      dataClass: item.dataClass,
      extentType: item.geometry ? "source-geometry" : "bounding-box",
    },
    status: "catalog-observation",
    confidence: null,
    links: item.previewUrl ? [{ label: "Open interactive source preview", href: item.previewUrl }] : [],
    sourceRecord: item,
  };
}

export function buildGeographicResults(input: GeographicResultInput): GeographicResult[] {
  const results: GeographicResult[] = [];
  if (input.locationResult && input.layers.has("search-location")) {
    const result = input.locationResult;
    const geometry: Geometry = "geometry" in result && result.geometry
      ? result.geometry
      : { type: "Point", coordinates: [result.longitude, result.latitude] };
    const bounds = isValidBounds(result.bbox) ? result.bbox : geometryBounds(geometry);
    results.push({
      id: result.id,
      provider: result.provider,
      kind: "place",
      layerId: "search-location",
      title: result.displayName,
      description: result.attribution,
      geometry,
      bounds,
      center: { lat: result.latitude, lng: result.longitude },
      temporal: { start: null, end: null },
      metadata: {
        placeType: result.type,
        extentQuality: result.extentQuality,
        extentType: !result.geometry || result.geometry.type === "Point" ? "point" : "source-geometry",
      },
      status: null,
      confidence: result.confidence,
      links: [],
      sourceRecord: result,
    });
  }

  // Enabled source layers show raw context; a selected analysis workflow must not hide them.
  for (const event of input.liveEvents) {
    if (!input.layers.has(event.layerId) ||
      (input.filter.types !== null && !input.filter.types.includes(event.type)) ||
      input.filter.region && !`${event.region} ${event.country}`.toLowerCase().includes(input.filter.region.toLowerCase())) continue;
    const result = eventResult(input, event);
    if (visibleInTime(input, result.temporal.start, result.temporal.end) && overlapsAOI(input, result.bounds, result.center)) {
      results.push(result);
    }
  }

  for (const granule of input.nisarGranules) {
    const result = nisarResult(input, granule);
    if (result) results.push(result);
  }

  if (input.planetaryComputerResult?.workflowId === input.activeIntelligenceWorkflowId) {
    for (const item of input.planetaryComputerResult.items) {
      const result = observationResult(input, item);
      if (result) results.push(result);
    }
  }
  return results;
}

export function geographicFeature(
  result: GeographicResult,
  selectedId: string | null,
): Feature<Geometry, GeographicFeatureProperties> {
  const geometry = result.geometry
    ?? (result.bounds ? boundsPolygon(result.bounds) : { type: "Point", coordinates: [result.center.lng, result.center.lat] });
  const declaredExtentType = result.metadata.extentType;
  const extentType = declaredExtentType === "source-footprint" || declaredExtentType === "bounding-box" ||
    declaredExtentType === "source-geometry" || declaredExtentType === "point"
    ? declaredExtentType
    : result.kind === "nisar-acquisition"
      ? result.sourceRecord && "footprint" in result.sourceRecord && result.sourceRecord.footprint?.length
        ? "source-footprint"
        : "bounding-box"
      : result.kind === "place" ? "point" : "source-geometry";
  return {
    type: "Feature",
    id: result.id,
    properties: {
      id: result.id,
      provider: result.provider,
      kind: result.kind,
      layerId: result.layerId,
      title: result.title,
      description: result.description,
      startDate: result.temporal.start,
      endDate: result.temporal.end,
      status: result.status,
      selected: selectedId === result.id,
      dataClass: result.kind === "public-event"
        ? "public-event-context"
        : result.kind === "place"
          ? "place-context"
          : "catalog-observation",
      extentType,
      color: result.kind === "public-event" && result.sourceRecord && "source" in result.sourceRecord
        ? phenomenonColor(result.sourceRecord.type)
        : result.kind === "nisar-acquisition"
          ? nisarProductColor(String(result.metadata.productCode ?? ""))
          : null,
    },
    geometry,
  };
}

export function geographicFeatureCollection(
  results: readonly GeographicResult[],
  selectedId: string | null,
  layerId: GeographicLayerId,
): FeatureCollection<Geometry, GeographicFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: results.filter(result => result.layerId === layerId).map(result => geographicFeature(result, selectedId)),
  };
}

export function geographicShapeFeatureCollection(
  results: readonly GeographicResult[],
  selectedId: string | null,
  layerId: GeographicLayerId,
): FeatureCollection<Geometry, GeographicFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: results
      .filter(result => result.layerId === layerId && result.geometry?.type !== "Point")
      .map(result => geographicFeature(result, selectedId)),
  };
}

export function geographicPointFeatureCollection(
  results: readonly GeographicResult[],
  selectedId: string | null,
  layerId: GeographicLayerId,
): FeatureCollection<Geometry, GeographicFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: results.filter(result => result.layerId === layerId).map(result => {
      const feature = geographicFeature(result, selectedId);
      return {
        ...feature,
        geometry: { type: "Point", coordinates: [result.center.lng, result.center.lat] },
        properties: { ...feature.properties, extentType: "point" },
      };
    }),
  };
}
