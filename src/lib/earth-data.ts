import { PHENOMENA, type Phenomenon } from "./earth-vocabulary";
import { NISAR_PRODUCTS, NISAR_PRODUCT_SOURCE, SAR_MISSIONS } from "./sar-registry";

export type Provenance = "live";
export type EvidenceClass = "nisar" | "supporting" | "multi-source";
export type ObservationStage = "observed" | "detected" | "interpreted";
export type SeverityBand = "low" | "moderate" | "high";
export type LodBand = "global" | "regional" | "local" | "analysis";
export type EarthMode = "3d" | "2d";

export interface Coordinate { lat: number; lng: number }
export interface EarthGeometry {
  id: string;
  kind: "footprint" | "perimeter" | "track";
  coordinates: Coordinate[];
}

export interface EarthEventRecord {
  id: string;
  type: Phenomenon;
  title: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  date: string;
  metric: string;
  metricLabel: string;
  severity: number;
  confidence: "Low" | "Moderate" | "High";
  evidence: { source: string; strength: "Strong" | "Moderate" | "Weak" }[];
  interpretation: string;
  observationId: string;
  provenance: Provenance;
  stage: ObservationStage;
  evidenceClass: EvidenceClass;
  validFrom: string;
  validTo: string;
  geometry: EarthGeometry;
}

export const EARTH_EVENTS: readonly EarthEventRecord[] = [];

export const DATASETS = [
  ...NISAR_PRODUCTS.map((product) => ({
    id: product.code,
    group: "PRIMARY",
    name: `NISAR ${product.code}`,
    availability: product.coverageSearch ? "CMR SEARCH SUPPORTED" : "CMR COLLECTION SEARCH",
    description: `${product.name}. ${product.description} Catalog metadata and browse discovery only; raster analysis is not available in this deployment.`,
    sourceUrl: NISAR_PRODUCT_SOURCE,
  })),
  ...SAR_MISSIONS.filter((mission) => mission.id !== "nisar").map((mission) => ({
    id: mission.id.toUpperCase(),
    group: "MISSION",
    name: mission.name,
    availability: "NOT INTEGRATED",
    description: `${mission.sensor}. Provider: ${mission.provider}. ${mission.accessSummary}`,
    sourceUrl: mission.sourceUrl,
  })),
  { id: "OPERA-CMR", group: "MISSION", name: "NASA OPERA", availability: "LIVE CMR COLLECTION METADATA", description: "NASA OPERA collection discovery through CMR. Collection metadata only; this app does not download, process, or interpret OPERA raster products.", sourceUrl: "https://search.earthdata.nasa.gov/search?q=OPERA" },
  { id: "FIRMS", group: "SUPPORTING", name: "FIRMS thermal anomalies", availability: "NOT CONNECTED", description: "Thermal hotspot evidence source." },
  { id: "LANDSAT", group: "SUPPORTING", name: "Landsat optical imagery", availability: "NOT CONNECTED", description: "Optical context and vegetation indices." },
  { id: "DEM", group: "SUPPORTING", name: "Elevation and slope", availability: "NOT CONNECTED", description: "Terrain context for interpretation." },
  { id: "USGS-EQ", group: "SUPPORTING", name: "USGS Earthquake Catalog", availability: "LIVE + HISTORICAL CONTEXT", description: "Public USGS catalog for magnitude 5+ earthquakes across a two-year archive. Context only; not a NISAR product." },
  { id: "NASA-EONET", group: "SUPPORTING", name: "NASA EONET Event Archive", availability: "LIVE + HISTORICAL CONTEXT", description: "Public open and closed natural-event records. Context only; not a NISAR product." },
] as const;

export const severityBand = (severity: number): SeverityBand =>
  severity >= 0.7 ? "high" : severity >= 0.45 ? "moderate" : "low";

export const confidenceRank: Record<"Low" | "Moderate" | "High", number> = {
  Low: 1,
  Moderate: 2,
  High: 3,
};

export const lodForAltitude = (altitude: number): LodBand =>
  altitude >= 1.55 ? "global" : altitude >= 0.2 ? "regional" : altitude >= 0.015 ? "local" : "analysis";

export function eventOpacity(event: EarthEventRecord) {
  if (event.confidence === "High") return 1;
  if (event.confidence === "Moderate") return 0.68;
  return 0.38;
}

export function isPhenomenon(value: string): value is Phenomenon {
  return PHENOMENA.some((item) => item.id === value);
}
