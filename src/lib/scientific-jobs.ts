export type ScientificJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";
export type ScientificJobStage = "queued" | "discovering" | "retrieving" | "validating" | "processing" | "publishing" | "completed" | "failed" | "cancelled";

export interface Sentinel2NDVISummary {
  measurement: string;
  unit: string;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  valid_pixels: number;
  area_pixels: number;
  valid_area_km2: number;
  masked_area_percent: number;
  spatial_resolution_m: number;
}

export interface ScientificJob {
  id: string;
  itemId: string;
  status: ScientificJobStatus;
  stage: ScientificJobStage;
  progress: number;
  errorMessage: string | null;
  result: {
    summary: Sentinel2NDVISummary;
    bounds: [number, number, number, number];
    previewPath: string;
    rasterPath: string;
    interpretation: string;
  } | null;
  provenance: Record<string, unknown> | null;
}

const JOB_STATUSES = ["queued", "processing", "completed", "failed", "cancelled"] as const;
const JOB_STAGES = ["queued", "discovering", "retrieving", "validating", "processing", "publishing", "completed", "failed", "cancelled"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isScientificJobStatus(value: unknown): value is ScientificJobStatus {
  return typeof value === "string" && JOB_STATUSES.some(status => status === value);
}

function isScientificJobStage(value: unknown): value is ScientificJobStage {
  return typeof value === "string" && JOB_STAGES.some(stage => stage === value);
}

function isNDVISummary(value: unknown): value is Sentinel2NDVISummary {
  if (!isRecord(value) || typeof value.measurement !== "string" || typeof value.unit !== "string") return false;
  const { mean, median, p10, p90, valid_pixels, area_pixels, valid_area_km2, masked_area_percent, spatial_resolution_m } = value;
  return isFiniteNumber(mean) &&
    isFiniteNumber(median) &&
    isFiniteNumber(p10) &&
    isFiniteNumber(p90) &&
    isFiniteNumber(valid_pixels) &&
    isFiniteNumber(area_pixels) &&
    isFiniteNumber(valid_area_km2) &&
    isFiniteNumber(masked_area_percent) &&
    isFiniteNumber(spatial_resolution_m) &&
    mean >= -1 && mean <= 1 &&
    median >= -1 && median <= 1 &&
    p10 >= -1 && p10 <= 1 &&
    p90 >= -1 && p90 <= 1 &&
    p10 <= median &&
    median <= p90 &&
    Number.isInteger(valid_pixels) &&
    Number.isInteger(area_pixels) &&
    valid_pixels > 0 &&
    valid_pixels <= area_pixels &&
    valid_area_km2 >= 0 &&
    masked_area_percent >= 0 &&
    masked_area_percent <= 100 &&
    spatial_resolution_m > 0;
}

function isGeographicBounds(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [west, south, east, north] = value;
  return isFiniteNumber(west) &&
    isFiniteNumber(south) &&
    isFiniteNumber(east) &&
    isFiniteNumber(north) &&
    west >= -180 &&
    west < east &&
    east <= 180 &&
    south >= -90 &&
    south < north &&
    north <= 90;
}

export function parseScientificJob(value: unknown): ScientificJob {
  if (!isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.item_id !== "string" ||
      !isScientificJobStatus(value.status) ||
      !isScientificJobStage(value.stage) ||
      !isFiniteNumber(value.progress) ||
      value.progress < 0 ||
      value.progress > 100) {
    throw new Error("The scientific job response has an invalid shape.");
  }

  let result: ScientificJob["result"] = null;
  if (value.result !== null && value.result !== undefined) {
    if (!isRecord(value.result) ||
        !isNDVISummary(value.result.summary) ||
        !isGeographicBounds(value.result.bounds) ||
        typeof value.result.preview_path !== "string" ||
        typeof value.result.raster_path !== "string" ||
        typeof value.result.interpretation !== "string") {
      throw new Error("The scientific job result is incomplete or invalid.");
    }
    result = {
      summary: value.result.summary,
      bounds: value.result.bounds,
      previewPath: value.result.preview_path,
      rasterPath: value.result.raster_path,
      interpretation: value.result.interpretation,
    };
  }
  const provenance = isRecord(value.provenance) ? value.provenance : null;
  if ((value.status === "completed" && (!result || !provenance)) ||
      (value.status !== "completed" && result !== null)) {
    throw new Error("The scientific job status does not match its stored result.");
  }

  return {
    id: value.id,
    itemId: value.item_id,
    status: value.status,
    stage: value.stage,
    progress: value.progress,
    errorMessage: typeof value.error_message === "string" ? value.error_message : null,
    result,
    provenance,
  };
}
