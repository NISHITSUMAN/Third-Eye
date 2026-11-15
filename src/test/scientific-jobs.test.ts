import { describe, expect, it } from "vitest";
import { parseScientificJob } from "../lib/scientific-jobs";

const completedJob = {
  id: "job-1",
  item_id: "sentinel-item-1",
  status: "completed",
  stage: "completed",
  progress: 100,
  error_message: null,
  result: {
    summary: {
      measurement: "Sentinel-2 L2A normalized difference vegetation index",
      unit: "unitless",
      mean: 0.41,
      median: 0.4,
      p10: 0.2,
      p90: 0.6,
      valid_pixels: 120,
      area_pixels: 150,
      valid_area_km2: 0.012,
      masked_area_percent: 20,
      spatial_resolution_m: 10,
    },
    bounds: [-122, 37, -121.9, 37.1],
    preview_path: "user-1/job-1/sentinel2-ndvi-preview.png",
    raster_path: "user-1/job-1/sentinel2-ndvi.tif",
    interpretation: "Single-date NDVI measurement summary.",
  },
  provenance: { source: "Microsoft Planetary Computer" },
};

describe("scientific processing job response validation", () => {
  it("preserves completed measurements, bounds and provenance", () => {
    expect(parseScientificJob(completedJob)).toMatchObject({
      id: "job-1",
      itemId: "sentinel-item-1",
      status: "completed",
      result: {
        bounds: [-122, 37, -121.9, 37.1],
        summary: { mean: 0.41, valid_pixels: 120 },
      },
      provenance: { source: "Microsoft Planetary Computer" },
    });
  });

  it("rejects malformed completed results instead of showing success-shaped data", () => {
    const invalid = {
      ...completedJob,
      result: { ...completedJob.result, bounds: [-122, 38, -121, 37] },
    };
    expect(() => parseScientificJob(invalid)).toThrow("result is incomplete or invalid");
  });
});
