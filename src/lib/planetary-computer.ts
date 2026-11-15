import type { Geometry } from "geojson";
import type { IntelligenceWorkflowId } from "./intelligence-workflows";

export type PlanetaryComputerStatus = "idle" | "loading" | "ready" | "partial" | "error";

export interface PlanetaryObservation {
  id: string;
  collectionId: string;
  collectionLabel: string;
  title: string;
  datetime: string | null;
  platform: string | null;
  instruments: string[];
  bbox: [number, number, number, number] | null;
  geometry: Geometry | null;
  itemUrl: string | null;
  previewUrl: string | null;
  dataClass: "catalog-observation";
  sourceMetadata?: Record<string, unknown>;
}

export interface PlanetaryComputerSearchResult {
  source: "Microsoft Planetary Computer STAC";
  dataClass: "catalog-metadata";
  workflowId: IntelligenceWorkflowId;
  startDate: string;
  endDate: string;
  matched: number | null;
  items: PlanetaryObservation[];
  warnings: string[];
  fetchedAt: string;
}

export interface PlanetaryComputerVisualization {
  source: "Microsoft Planetary Computer";
  itemId: string;
  collectionLabel: string;
  datetime: string | null;
  tiles: string[];
  bounds: [number, number, number, number];
  minZoom: number | null;
  maxZoom: number | null;
  attribution: string;
  verifiedAt: string;
}

export interface MeteomaticsContext {
  source: "Meteomatics";
  configured: boolean;
  status: "not-configured" | "configured" | "ready" | "partial";
  observedAt: string | null;
  values: Array<{
    parameter: "temperature" | "precipitation" | "wind-speed";
    label: string;
    value: number;
    unit: string;
  }>;
  warning: string | null;
}
