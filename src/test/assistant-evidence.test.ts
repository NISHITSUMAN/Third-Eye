import { describe, expect, it } from "vitest";
import {
  createAssistantExecutionResult,
  formatAssistantExecutionSummary,
  sanitizeAssistantExecutionResult,
} from "../lib/assistant-evidence";

describe("assistant evidence results", () => {
  it("labels observation discovery as retrieved catalog data, not derived analysis", () => {
    const result = createAssistantExecutionResult(
      { type: "search_intelligence", workflowId: "soil-agriculture" },
      "NASA CMR returned 2 catalog matches; Planetary Computer returned 3 STAC items.",
    );

    expect(result).toMatchObject({
      tool: "search_intelligence",
      status: "completed",
      evidenceLevel: "retrieved_dataset",
      source: "NASA CMR and Microsoft Planetary Computer STAC",
    });
    expect(result.evidenceLevel).not.toBe("derived_analysis");
  });

  it("does not describe queued scientific work as completed evidence", () => {
    const result = createAssistantExecutionResult(
      { type: "process_selected_sentinel2_ndvi" },
      "Sentinel-2 NDVI processing job job-1 is queued (0% complete, stage: queued). This is queued work, not a completed scientific result.",
    );

    expect(result.status).toBe("partial");
    expect(result.evidenceLevel).toBe("insufficient_evidence");
  });

  it("does not promote missing weather or failed actions to evidence", () => {
    expect(createAssistantExecutionResult(
      { type: "get_weather_context" },
      "Meteomatics weather is not configured. No weather measurements are available.",
    ).evidenceLevel).toBe("insufficient_evidence");

    expect(createAssistantExecutionResult(
      { type: "search_nisar" },
      "Could not reach NASA CMR.",
      "failed",
    ).evidenceLevel).toBe("insufficient_evidence");
  });

  it("preserves partial-provider status without losing successful catalog evidence", () => {
    const result = createAssistantExecutionResult(
      { type: "search_intelligence", workflowId: "soil-agriculture" },
      "NASA CMR: search failed. Planetary Computer: 2 STAC items returned.",
    );

    expect(result.status).toBe("partial");
    expect(result.evidenceLevel).toBe("retrieved_dataset");
  });

  it("marks incomplete environmental and map findings as partial", () => {
    expect(createAssistantExecutionResult(
      { type: "get_climate_context", locationQuery: "Shimla" },
      '{"status":"partial","monthlySummary":[{"month":1}]}',
    ).status).toBe("partial");
    expect(createAssistantExecutionResult(
      { type: "get_climate_context", locationQueries: ["Shimla", "Ooty"] },
      '{"status":"partial","candidateErrors":["Open-Meteo data unavailable for Ooty"]}',
    ).status).toBe("partial");

    expect(createAssistantExecutionResult(
      {
        type: "map_ranked_places",
        places: [{ name: "Shimla", rank: 1, rationale: "Screening finding", evidence: [] }],
      },
      "Mapped 1 ranked candidate place(s). 1 candidate place(s) could not be geocoded and were omitted.",
    ).status).toBe("partial");
  });

  it("formats partial climate evidence without exposing raw serialized payloads", () => {
    const result = createAssistantExecutionResult(
      { type: "get_climate_context", locationQueries: ["Shimla", "Ooty"] },
      JSON.stringify({
        status: "partial",
        profiles: [{ location: "Shimla, India", monthlySummary: [[1, 5.2, 48, 5]] }],
        candidateErrors: ["Open-Meteo data unavailable for Ooty"],
      }),
    );

    const summary = formatAssistantExecutionSummary(result);
    expect(summary).toContain("Shimla, India");
    expect(summary).toContain("unavailable for Ooty");
    expect(summary).not.toContain("monthlySummary");
    expect(summary).not.toContain('"status"');
  });

  it("rejects client summaries that claim derived analysis", () => {
    expect(sanitizeAssistantExecutionResult({
      tool: "search_intelligence",
      status: "completed",
      evidenceLevel: "derived_analysis",
      source: "Third Eye",
      summary: "A claimed score.",
    })).toBeNull();
  });
});
