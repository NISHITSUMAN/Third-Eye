import type { Phenomenon } from "./earth-vocabulary";
import type { NISARCoverageProductCode } from "./sar-registry";

export type IntelligenceWorkflowId =
  | "wildfire-monitoring"
  | "flood-water"
  | "land-forest-change"
  | "ice-glacier-observation"
  | "soil-agriculture";

export interface PlanetaryComputerCollection {
  id: string;
  label: string;
}

export interface IntelligenceWorkflow {
  id: IntelligenceWorkflowId;
  label: string;
  description: string;
  eventTypes: readonly Phenomenon[];
  nisarProductCodes: readonly NISARCoverageProductCode[];
  planetaryComputerCollections: readonly PlanetaryComputerCollection[];
}

export const INTELLIGENCE_WORKFLOWS = [
  {
    id: "wildfire-monitoring",
    label: "Wildfire Monitoring",
    description: "Review source-reported fire context and nearby satellite observations. Burn-scar analysis is not available.",
    eventTypes: ["fire"],
    nisarProductCodes: ["GCOV", "GSLC"],
    planetaryComputerCollections: [
      { id: "modis-14A1-061", label: "MODIS active fires" },
      { id: "sentinel-1-rtc", label: "Sentinel-1 radar" },
      { id: "sentinel-2-l2a", label: "Sentinel-2 optical" },
    ],
  },
  {
    id: "flood-water",
    label: "Flood & Water",
    description: "Review source-reported flood context and search radar and optical observation catalogs. Flood extent is not calculated.",
    eventTypes: ["flood"],
    nisarProductCodes: ["GCOV", "GSLC"],
    planetaryComputerCollections: [
      { id: "sentinel-1-rtc", label: "Sentinel-1 radar" },
      { id: "sentinel-2-l2a", label: "Sentinel-2 optical" },
      { id: "landsat-c2-l2", label: "Landsat optical" },
    ],
  },
  {
    id: "land-forest-change",
    label: "Land & Forest Change",
    description: "Discover geocoded radar and optical records for the selected area. No land-cover change analysis is available.",
    eventTypes: ["fire", "landslide"],
    nisarProductCodes: ["GCOV", "GSLC"],
    planetaryComputerCollections: [
      { id: "sentinel-1-rtc", label: "Sentinel-1 radar" },
      { id: "sentinel-2-l2a", label: "Sentinel-2 optical" },
      { id: "landsat-c2-l2", label: "Landsat optical" },
    ],
  },
  {
    id: "ice-glacier-observation",
    label: "Ice & Glacier Observation",
    description: "Discover radar and optical records for the selected area. No glacier-motion measurement is calculated.",
    eventTypes: [],
    nisarProductCodes: ["GUNW", "GOFF", "ROFF"],
    planetaryComputerCollections: [
      { id: "sentinel-1-rtc", label: "Sentinel-1 radar" },
      { id: "sentinel-2-l2a", label: "Sentinel-2 optical" },
      { id: "landsat-c2-l2", label: "Landsat optical" },
    ],
  },
  {
    id: "soil-agriculture",
    label: "Soil & Agriculture",
    description: "Discover soil-moisture, backscatter, and optical catalog records. SME2 is provisional; no agricultural condition is inferred.",
    eventTypes: [],
    nisarProductCodes: ["SME2", "GCOV"],
    planetaryComputerCollections: [
      { id: "sentinel-1-rtc", label: "Sentinel-1 radar" },
      { id: "sentinel-2-l2a", label: "Sentinel-2 optical" },
      { id: "modis-13Q1-061", label: "MODIS vegetation index" },
    ],
  },
] as const satisfies readonly IntelligenceWorkflow[];

export function getIntelligenceWorkflow(id: IntelligenceWorkflowId): IntelligenceWorkflow {
  return INTELLIGENCE_WORKFLOWS.find((workflow) => workflow.id === id)!;
}

export function isIntelligenceWorkflowId(value: unknown): value is IntelligenceWorkflowId {
  return typeof value === "string" && INTELLIGENCE_WORKFLOWS.some((workflow) => workflow.id === value);
}
