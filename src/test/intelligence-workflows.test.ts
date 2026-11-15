import { describe, expect, it } from "vitest";
import { INTELLIGENCE_WORKFLOWS, getIntelligenceWorkflow, isIntelligenceWorkflowId } from "../lib/intelligence-workflows";

describe("outcome-based intelligence workflows", () => {
  it("defines the five requested goals with real, allowlisted catalog mappings", () => {
    expect(INTELLIGENCE_WORKFLOWS.map(({ label }) => label)).toEqual([
      "Wildfire Monitoring",
      "Flood & Water",
      "Land & Forest Change",
      "Ice & Glacier Observation",
      "Soil & Agriculture",
    ]);

    for (const workflow of INTELLIGENCE_WORKFLOWS) {
      expect(workflow.nisarProductCodes.length).toBeGreaterThan(0);
      expect(workflow.planetaryComputerCollections.length).toBeGreaterThan(0);
    }

    expect(getIntelligenceWorkflow("land-forest-change").nisarProductCodes).toEqual(["GCOV", "GSLC"]);
    expect(getIntelligenceWorkflow("ice-glacier-observation").nisarProductCodes).toEqual(["GUNW", "GOFF", "ROFF"]);
    expect(getIntelligenceWorkflow("soil-agriculture").nisarProductCodes).toEqual(["SME2", "GCOV"]);
    expect(getIntelligenceWorkflow("soil-agriculture").planetaryComputerCollections).toContainEqual({
      id: "modis-13Q1-061",
      label: "MODIS vegetation index",
    });
  });

  it("validates workflow ids before using server collection allowlists", () => {
    expect(isIntelligenceWorkflowId("wildfire-monitoring")).toBe(true);
    expect(isIntelligenceWorkflowId("custom-collection")).toBe(false);
    expect(isIntelligenceWorkflowId(null)).toBe(false);
  });
});
